import { confirm } from "@tauri-apps/plugin-dialog";
import { fileVersion, readFileText, saveDocument } from "./tauri";
import { detectTerminator } from "./splice";
import { useAppStore, type FileTabBuffer, type Side } from "../stores/appStore";

export type SaveConflictChoice = "reload" | "overwrite" | "cancel";
let conflictResolver: ((choice: SaveConflictChoice) => void) | null = null;
let conflictQueue: Promise<unknown> = Promise.resolve();
export function resolveSaveConflict(choice: SaveConflictChoice): void {
  const resolve = conflictResolver;
  conflictResolver = null;
  useAppStore.setState({ saveConflict: null });
  resolve?.(choice);
}
function askConflict(
  path: string,
  message: string,
): Promise<SaveConflictChoice> {
  const task = conflictQueue.then(
    () =>
      new Promise<SaveConflictChoice>((resolve) => {
        conflictResolver = resolve;
        useAppStore.setState({ saveConflict: { path, message } });
      }),
  );
  conflictQueue = task.catch(() => undefined);
  return task;
}

export function documentBuffer(
  r: Awaited<ReturnType<typeof readFileText>>,
): FileTabBuffer {
  return {
    text: r.text,
    diskText: r.text,
    mtimeMs: r.mtime_ms,
    terminator: detectTerminator(r.text),
    documentId: crypto.randomUUID(),
    revision: 0,
    canonicalPath: r.canonical_path,
    diskVersion: r.disk_version,
    bom: r.bom,
    saving: false,
    operationError: null,
    dirty: false,
    yellowRanges: [],
    diskStale: false,
  };
}
function current(
  tabId: string,
  side: Side,
  documentId: string,
): FileTabBuffer | null {
  return useAppStore.getState().fileTabs[tabId]?.[side]?.documentId ===
    documentId
    ? useAppStore.getState().fileTabs[tabId][side]
    : null;
}
function patch(
  tabId: string,
  side: Side,
  documentId: string,
  update: Partial<FileTabBuffer>,
): void {
  const buf = current(tabId, side, documentId);
  if (!buf) return;
  useAppStore.getState().setFileTabBuffer(tabId, side, { ...buf, ...update });
}
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function reloadDocument(
  tabId: string,
  side: Side,
  prompt = true,
): Promise<void> {
  const original = useAppStore.getState().fileTabs[tabId]?.[side];
  if (!original) return;
  try {
    if (
      prompt &&
      original.dirty &&
      !(await confirm("Discard local changes on this side?", {
        title: "Reload from disk",
        kind: "warning",
      }))
    )
      return;
    const fresh = await readFileText(original.canonicalPath);
    const latest = current(tabId, side, original.documentId);
    if (!latest || latest.revision !== original.revision) return;
    patch(tabId, side, original.documentId, {
      ...documentBuffer(fresh),
      revision: original.revision + 1,
    });
  } catch (e) {
    patch(tabId, side, original.documentId, { operationError: errorText(e) });
  }
}

const saves = new Map<string, Promise<void>>();
const pending = new Map<string, Promise<void>>();
export function saveDocumentSide(tabId: string, side: Side): Promise<void> {
  const snapshot = useAppStore.getState().fileTabs[tabId]?.[side];
  if (snapshot && useAppStore.getState().operating) {
    patch(tabId, side, snapshot.documentId, {
      operationError:
        "A filesystem operation is running. Save again after it finishes.",
    });
    return Promise.resolve();
  }
  if (!snapshot?.dirty) return Promise.resolve();
  const key = `${snapshot.documentId}:${snapshot.revision}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const prior = saves.get(snapshot.canonicalPath) ?? Promise.resolve();
  const task = prior
    .catch(() => undefined)
    .then(async () => {
      if (!current(tabId, side, snapshot.documentId)) return;
      patch(tabId, side, snapshot.documentId, {
        saving: true,
        operationError: null,
      });
      // A previous queued save of this same document may have advanced the disk version.
      let expected: string | null =
        current(tabId, side, snapshot.documentId)?.diskVersion ??
        snapshot.diskVersion;
      try {
        for (;;) {
          const outcome = await saveDocument(
            snapshot.canonicalPath,
            snapshot.text,
            snapshot.bom,
            expected,
          );
          if (!current(tabId, side, snapshot.documentId)) return;
          if (outcome.kind === "saved") {
            useAppStore
              .getState()
              .markSaved(
                tabId,
                side,
                outcome.mtime_ms,
                snapshot.text,
                snapshot.documentId,
                outcome.disk_version,
              );
            return;
          }
          patch(tabId, side, snapshot.documentId, { diskStale: true });
          const choice = await askConflict(
            snapshot.canonicalPath,
            outcome.message,
          );
          if (!current(tabId, side, snapshot.documentId) || choice === "cancel")
            return;
          if (choice === "reload") {
            await reloadDocument(tabId, side);
            return;
          }
          expected = outcome.disk_version;
        }
      } catch (e) {
        patch(tabId, side, snapshot.documentId, {
          operationError: errorText(e),
        });
      } finally {
        patch(tabId, side, snapshot.documentId, { saving: false });
      }
    });
  pending.set(key, task);
  saves.set(snapshot.canonicalPath, task);
  void task.finally(() => {
    pending.delete(key);
    if (saves.get(snapshot.canonicalPath) === task)
      saves.delete(snapshot.canonicalPath);
  });
  return task;
}
export async function saveTab(
  tabId: string,
  side: Side | "all" = "all",
): Promise<void> {
  for (const target of side === "all" ? (["left", "right"] as const) : [side])
    await saveDocumentSide(tabId, target);
}
export async function reloadTab(tabId: string): Promise<void> {
  await reloadDocument(tabId, "left");
  await reloadDocument(tabId, "right");
}

let checking: Promise<void> | null = null;
export function checkOpenDocuments(): Promise<void> {
  if (checking) return checking;
  checking = (async () => {
    for (const [tabId, tab] of Object.entries(
      useAppStore.getState().fileTabs,
    )) {
      for (const side of ["left", "right"] as const) {
        const original = tab[side];
        if (!original || original.saving) continue;
        try {
          const version = await fileVersion(original.canonicalPath);
          const latest = current(tabId, side, original.documentId);
          if (
            !latest ||
            latest.saving ||
            latest.revision !== original.revision ||
            version === latest.diskVersion
          )
            continue;
          if (latest.dirty || version === null)
            patch(tabId, side, original.documentId, { diskStale: true });
          else await reloadDocument(tabId, side, false);
        } catch (e) {
          patch(tabId, side, original.documentId, {
            diskStale: true,
            operationError: errorText(e),
          });
        }
      }
    }
  })().finally(() => {
    checking = null;
  });
  return checking;
}
export function installDocumentWatch(): () => void {
  const check = () => {
    void checkOpenDocuments();
  };
  window.addEventListener("focus", check);
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (
      state.activeTabId !== prev.activeTabId ||
      (!state.operating && prev.operating)
    )
      check();
  });
  return () => {
    window.removeEventListener("focus", check);
    unsubscribe();
  };
}
