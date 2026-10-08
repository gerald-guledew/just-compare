import { useCallback, useRef, useState } from "react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  cancelFsOp,
  executeFsItem,
  planFsBatch,
  deletePaths,
  startFsOp,
  endFsOp,
  resolvePaths,
  type FsOpProgress,
} from "../lib/tauri";
import { checkOpenDocuments } from "../lib/documents";
import { refreshComparison } from "./useComparison";
import { useAppStore, type Side } from "../stores/appStore";
import type { ComparisonEntry, FileEntry } from "../types";
import type {
  ConflictRequest,
  ConflictResolution,
} from "../components/ConflictDialog";
import type { ProgressState } from "../components/ProgressDialog";
export type OperationKind = "copy" | "move";
export type OperationSpec =
  | { kind: OperationKind; sourceSide: Side; targetSide: Side }
  | {
      kind: OperationKind;
      sourceSide: Side;
      targetSide: "arbitrary";
      targetFolder: string;
    };
function find(
  entries: ComparisonEntry[] | null,
  path: string,
  side: Side,
): FileEntry | null {
  for (const entry of entries ?? []) {
    const fe = entry[side];
    if (fe?.relative_path === path) return fe;
    const child = find(entry.children, path, side);
    if (child) return child;
  }
  return null;
}
export function pathAffected(path: string, parent: string): boolean {
  const normalize = (s: string) => s.replace(/\\/g, "/").replace(/\/$/, "");
  const p = normalize(path);
  const root = normalize(parent);
  return p === root || p.startsWith(root + "/");
}
async function warnDirty(paths: string[], action: string): Promise<boolean> {
  const hits: string[] = [];
  for (const tab of Object.values(useAppStore.getState().fileTabs))
    for (const side of ["left", "right"] as const) {
      const buf = tab[side];
      if (buf?.dirty && paths.some((p) => pathAffected(buf.canonicalPath, p)))
        hits.push(buf.canonicalPath);
    }
  return (
    hits.length === 0 ||
    (await confirm(
      `These files have unsaved changes and are affected by ${action}:\n\n${hits.slice(0, 5).join("\n")}\n\nContinue anyway?`,
      { title: "Unsaved changes", kind: "warning" },
    ))
  );
}
export function useFolderOps() {
  const [conflictRequest, setConflictRequest] =
    useState<ConflictRequest | null>(null);
  const resolver = useRef<((r: ConflictResolution) => void) | null>(null);
  const [progressVisible, setProgressVisible] = useState(false);
  const [progressState, setProgressState] = useState<ProgressState | null>(
    null,
  );
  const opId = useRef<string | null>(null);
  const batchTotals = useRef({ items: 0, bytes: 0 });
  const progressByItem = useRef(
    new Map<string, { items: number; bytes: number }>(),
  );
  const resolveConflict = useCallback((choice: ConflictResolution) => {
    const resolve = resolver.current;
    resolver.current = null;
    setConflictRequest(null);
    resolve?.(choice);
  }, []);
  const ask = useCallback(
    (request: ConflictRequest) =>
      new Promise<ConflictResolution>((resolve) => {
        resolver.current = resolve;
        setConflictRequest(request);
      }),
    [],
  );
  const cancel = useCallback(async () => {
    resolveConflict("cancel");
    if (!opId.current) return;
    setProgressState((p) => p && { ...p, cancelling: true });
    await cancelFsOp(opId.current);
  }, [resolveConflict]);

  const lifecycle = useCallback(
    async (
      action: "copy" | "move" | "delete",
      work: (id: string) => Promise<void>,
    ) => {
      if (useAppStore.getState().operating || useAppStore.getState().comparing)
        return;
      useAppStore.setState({ operating: true });
      batchTotals.current = { items: 0, bytes: 0 };
      progressByItem.current.clear();
      let id: string | null = null;
      let unlisten: UnlistenFn | null = null;
      const timer = window.setTimeout(() => setProgressVisible(true), 250);
      setProgressState({
        action,
        completedItems: 0,
        totalItems: 0,
        completedBytes: 0,
        totalBytes: 0,
        currentPath: "Preflight",
        cancelling: false,
      });
      try {
        id = await startFsOp();
        opId.current = id;
        unlisten = await listen<FsOpProgress>(
          "fs_op_progress",
          ({ payload: p }) => {
            if (p.opId !== id) return;
            progressByItem.current.set(p.itemPath, {
              items: p.completedItems,
              bytes: p.completedBytes,
            });
            const accumulated = [...progressByItem.current.values()].reduce(
              (sum, value) => ({
                items: sum.items + value.items,
                bytes: sum.bytes + value.bytes,
              }),
              { items: 0, bytes: 0 },
            );
            setProgressState(
              (prev) =>
                prev && {
                  ...prev,
                  completedItems: accumulated.items,
                  totalItems: batchTotals.current.items || p.totalItems,
                  completedBytes: accumulated.bytes,
                  totalBytes: batchTotals.current.bytes || p.totalBytes,
                  currentPath: p.currentPath,
                },
            );
          },
        );
        await work(id);
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        if (text !== "cancelled")
          await message(text, { title: `${action} failed`, kind: "error" });
      } finally {
        clearTimeout(timer);
        unlisten?.();
        setProgressVisible(false);
        setProgressState(null);
        resolveConflict("cancel");
        if (id) await endFsOp(id).catch(console.error);
        opId.current = null;
        // Refresh while the batch lock remains held so a second operation cannot race this result.
        await refreshComparison(true);
        useAppStore.getState().clearSelection();
        useAppStore.setState({ operating: false });
        await checkOpenDocuments();
      }
    },
    [resolveConflict],
  );

  const runOperation = useCallback(
    async (spec: OperationSpec) => {
      const state = useAppStore.getState();
      if (!state.leftPath || !state.rightPath || !state.selectedPaths.size)
        return;
      if (spec.targetSide === spec.sourceSide) return;
      const source =
        spec.sourceSide === "left" ? state.leftPath : state.rightPath;
      const target =
        spec.targetSide === "arbitrary"
          ? spec.targetFolder
          : spec.targetSide === "left"
            ? state.leftPath
            : state.rightPath;
      const pairs: [string, string][] = [...state.selectedPaths]
        .filter((p) => find(state.comparison, p, spec.sourceSide))
        .map((p) => [
          `${source}/${p}`,
          `${target}/${spec.targetSide === "arbitrary" ? p.split("/").pop() : p}`,
        ]);
      if (!pairs.length) {
        await message("No selected items exist on the source side.", {
          title: "Nothing to do",
          kind: "info",
        });
        return;
      }
      await lifecycle(spec.kind, async (id) => {
        const items = await planFsBatch(pairs, id);
        batchTotals.current = {
          items: items.length,
          bytes: items.reduce((sum, item) => sum + item.totalBytes, 0),
        };
        const affected = items.flatMap((i) =>
          spec.kind === "move" ? [i.src, i.dst] : [i.dst],
        );
        if (!(await warnDirty(affected, spec.kind))) return;
        if (
          !(await confirm(
            `${spec.kind === "copy" ? "Copy" : "Move"} ${items.length} item(s) to ${target}?`,
            { title: "Confirm operation", kind: "info" },
          ))
        )
          return;
        let all = false;
        let skipAll = false;
        for (const item of items) {
          let overwrite = false;
          if (item.destinationVersion !== null) {
            if (skipAll) continue;
            if (!all) {
              const choice = await ask({
                srcPath: item.src,
                dstPath: item.dst,
                isDir: item.isDirectory,
                action: spec.kind,
              });
              if (choice === "cancel") return;
              if (choice === "no" || choice === "no-all") {
                skipAll = choice === "no-all";
                continue;
              }
              all = choice === "yes-all";
            }
            overwrite = true;
          }
          // An intervening destination change stops the item; retrying starts fresh preflight and confirmation.
          await executeFsItem(item, spec.kind === "move", overwrite, id);
        }
      });
    },
    [ask, lifecycle],
  );

  const runDelete = useCallback(
    async (side: Side) => {
      const state = useAppStore.getState();
      if (!state.leftPath || !state.rightPath) return;
      const root = side === "left" ? state.leftPath : state.rightPath;
      const selected = [...state.selectedPaths].filter((p) =>
        find(state.comparison, p, side),
      );
      const paths = selected
        .filter(
          (p) =>
            !selected.some((other) => p !== other && pathAffected(p, other)),
        )
        .map((p) => `${root}/${p}`);
      if (!paths.length) return;
      await lifecycle("delete", async (id) => {
        const canonicalPaths = await resolvePaths(paths);
        if (!(await warnDirty(canonicalPaths, "deletion"))) return;
        if (
          await confirm(
            `Delete ${paths.length} item(s) from ${side}? This cannot be undone.`,
            { title: "Delete files", kind: "warning" },
          )
        )
          await deletePaths(paths, id);
      });
    },
    [lifecycle],
  );
  return {
    runOperation,
    runDelete,
    conflictRequest,
    resolveConflict,
    progressVisible,
    progressState,
    cancel,
  };
}
