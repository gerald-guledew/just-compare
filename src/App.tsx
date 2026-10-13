import {
  lazy,
  Suspense,
  Component,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  selectActiveFolderTab,
  selectIsTabDirty,
  useAppStore,
  type Side,
} from "./stores/appStore";
import { useComparison } from "./hooks/useComparison";
import { useFolderOps, type OperationKind } from "./hooks/useFolderOps";
import { openFolderDialog } from "./lib/tauri";
import { useComparisonPaths } from "./hooks/useComparisonPaths";
import { ComparisonSetupView } from "./components/ComparisonSetupView";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { ComparisonView } from "./components/ComparisonView";
import {
  installDocumentWatch,
  reloadTab,
  saveTab,
  resolveSaveConflict,
} from "./lib/documents";
const FileCompareView = lazy(() =>
  import("./components/FileCompareView").then((m) => ({
    default: m.FileCompareView,
  })),
);
import { FolderDropTarget } from "./components/FolderDropTarget";
import { StatusBar } from "./components/StatusBar";
import { ConflictDialog } from "./components/ConflictDialog";
import { ProgressDialog } from "./components/ProgressDialog";
import { loadComparisonMode, loadWordWrap } from "./lib/persistence";

async function reloadActiveFileTab(): Promise<void> {
  await reloadTab(useAppStore.getState().activeTabId);
}
async function saveActiveFileTab(): Promise<void> {
  await saveTab(useAppStore.getState().activeTabId);
}

class EditorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div role="alert">
        Unable to load the editor. Close and reopen this tab to retry.
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function App() {
  const leftPath = useAppStore((s) => s.leftPath);
  const rightPath = useAppStore((s) => s.rightPath);
  const comparing = useAppStore((s) => s.comparing);
  const error = useAppStore((s) => s.error);
  const comparison = useAppStore((s) => s.comparison);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabLifecycleVersion = useAppStore((s) => s.tabLifecycleVersion);
  const closeTab = useAppStore((s) => s.closeTab);
  const isActiveDirty = useAppStore((s) => selectIsTabDirty(s, s.activeTabId));
  const selectionSize = useAppStore((s) => s.selectedPaths.size);
  const clearSelection = useAppStore((s) => s.clearSelection);

  const saveConflict = useAppStore((s) => s.saveConflict);
  const operating = useAppStore((s) => s.operating);
  const mode = useAppStore((s) => s.comparisonMode);
  const warnings = useAppStore((s) => s.comparisonWarnings);
  const folderOps = useFolderOps();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const isFolderTab = activeTab.kind === "folder-compare";
  const isFileTab = activeTab.kind === "file-compare";
  const paths = useComparisonPaths(activeTab.id);
  useEffect(() => installDocumentWatch(), []);

  const handleAction = useCallback(
    async (
      kind: OperationKind,
      sourceSide: Side,
      target: "left" | "right" | "arbitrary",
    ) => {
      const state = useAppStore.getState();
      if (!selectActiveFolderTab(state) || state.operating) return;
      if (target === "arbitrary") {
        const folder = await openFolderDialog();
        if (!folder) return;
        const latest = useAppStore.getState();
        if (
          latest.activeTabId !== state.activeTabId ||
          latest.comparisonContextVersion !== state.comparisonContextVersion ||
          latest.selectedPaths !== state.selectedPaths
        )
          return;
        await folderOps.runOperation({
          kind,
          sourceSide,
          targetSide: "arbitrary",
          targetFolder: folder,
        });
      } else {
        await folderOps.runOperation({
          kind,
          sourceSide,
          targetSide: target,
        });
      }
    },
    [folderOps],
  );

  useEffect(() => {
    Promise.all([loadComparisonMode(), loadWordWrap()])
      .then(([comparisonMode, wordWrap]) => {
        useAppStore.setState({ comparisonMode, wordWrap });
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        const { activeTabId } = useAppStore.getState();
        e.preventDefault();
        const dirty = selectIsTabDirty(useAppStore.getState(), activeTabId);
        if (!dirty) {
          closeTab(activeTabId);
          return;
        }
        void confirm("Discard unsaved changes on this tab?", {
          title: "Close tab",
          kind: "warning",
        }).then((ok) => {
          if (ok) closeTab(activeTabId);
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeTab]);

  const { compare } = useComparison();

  const contentRef = useRef<HTMLDivElement | null>(null);

  const handleRefresh = useCallback(() => {
    if (isFolderTab) compare();
    else if (isFileTab) void reloadActiveFileTab();
  }, [isFolderTab, isFileTab, compare]);

  const refreshDisabled =
    isFolderTab && (comparing || operating || !leftPath || !rightPath);

  const handleSave = useCallback(() => {
    void saveActiveFileTab();
  }, []);

  const canSave = isFileTab && isActiveDirty;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        (e.code === "KeyZ" || e.key.toLowerCase() === "z")
      ) {
        const state = useAppStore.getState();
        if (
          !state.tabs.some(
            (tab) =>
              tab.id === state.activeTabId && tab.kind === "file-compare",
          )
        )
          return;
        e.preventDefault();
        state.setWordWrap(!state.wordWrap);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Cmd/Ctrl+Z is intentionally NOT handled here: the focused Monaco editor
  // owns undo for typed edits AND for merge-button edits (merges go through
  // Monaco's edit API). A window-level listener would double-fire alongside
  // Monaco's native undo and either undo twice or undo nothing depending on
  // event ordering.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "s"
      ) {
        const { activeTabId } = useAppStore.getState();
        if (
          !useAppStore
            .getState()
            .tabs.some(
              (tab) => tab.id === activeTabId && tab.kind === "file-compare",
            )
        )
          return;
        e.preventDefault();
        void saveActiveFileTab();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Folder-tab-only shortcuts: copy/move actions and Esc-clears-selection.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        !selectActiveFolderTab(useAppStore.getState()) ||
        useAppStore.getState().operating
      )
        return;
      // Skip if user is typing in an input.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const key = e.key;
      if (key === "Escape") {
        e.preventDefault();
        clearSelection();
        return;
      }

      // Delete = delete from left, Shift+Delete = delete from right.
      // Backspace mirrors Delete for macOS users used to it.
      if (key === "Delete" || key === "Backspace") {
        if (useAppStore.getState().selectedPaths.size === 0) return;
        e.preventDefault();
        const side: Side = e.shiftKey ? "right" : "left";
        void folderOps.runDelete(side);
        return;
      }

      const fnMap: Record<
        string,
        [OperationKind, Side, "left" | "right" | "arbitrary"]
      > = {
        F5: ["copy", "left", "right"],
        F6: ["move", "left", "right"],
        F7: ["copy", "left", "arbitrary"],
      };
      const shiftMap: Record<
        string,
        [OperationKind, Side, "left" | "right" | "arbitrary"]
      > = {
        F5: ["copy", "right", "left"],
        F6: ["move", "right", "left"],
        F7: ["move", "left", "arbitrary"],
      };
      const ctrlMap: Record<
        string,
        [OperationKind, Side, "left" | "right" | "arbitrary"]
      > = {
        F7: ["copy", "right", "arbitrary"],
      };
      const ctrlShiftMap: Record<
        string,
        [OperationKind, Side, "left" | "right" | "arbitrary"]
      > = {
        F7: ["move", "right", "arbitrary"],
      };

      let spec:
        [OperationKind, Side, "left" | "right" | "arbitrary"] | undefined;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) spec = ctrlShiftMap[key];
      else if (e.metaKey || e.ctrlKey) spec = ctrlMap[key];
      else if (e.shiftKey) spec = shiftMap[key];
      else spec = fnMap[key];

      if (spec) {
        e.preventDefault();
        const [kind, side, target] = spec;
        void handleAction(kind, side, target);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAction, clearSelection]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900">
      <TabBar
        onRefresh={handleRefresh}
        refreshDisabled={refreshDisabled}
        onSave={handleSave}
        canSave={canSave}
      />

      {isFolderTab && (
        <Toolbar
          leftPath={leftPath}
          rightPath={rightPath}
          comparing={comparing || operating}
          mode={mode}
          onModeChange={useAppStore.getState().setComparisonMode}
          selectionSize={selectionSize}
          onCompare={compare}
          onAction={(kind, sourceSide, target) =>
            void handleAction(kind, sourceSide, target)
          }
          onDelete={(side) => void folderOps.runDelete(side)}
        />
      )}

      {paths.error && (
        <div
          role="alert"
          className="px-4 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200"
        >
          {paths.error}
        </div>
      )}

      {isFolderTab && error && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200">
          Error: {error}
        </div>
      )}

      {isFolderTab && warnings.length > 0 && (
        <div
          role="alert"
          className="px-4 py-2 bg-amber-50 text-amber-800 text-xs max-h-24 overflow-auto"
        >
          {warnings.slice(0, 20).map((w, i) => (
            <div key={i}>{w}</div>
          ))}
          {warnings.length > 20 && (
            <div>{warnings.length - 20} additional warnings.</div>
          )}
        </div>
      )}
      <div ref={contentRef} className="relative flex-1 overflow-hidden p-2">
        {isFolderTab && comparison && (
          <FolderDropTarget
            areaRef={contentRef}
            onDropFolder={(side, path) =>
              void paths.commitPath(side, path, true)
            }
          />
        )}
        {isFolderTab && comparison ? (
          <ComparisonView
            key={activeTab.id}
            onRunOperation={folderOps.runOperation}
            onDelete={folderOps.runDelete}
            onPathCommit={paths.commitPath}
            onPick={(side) => void paths.pickPath(side, "folder")}
            disabled={operating || comparing}
          />
        ) : (
          !isFileTab && (
            <ComparisonSetupView
              key={`${activeTab.id}:${tabLifecycleVersion}`}
              itemKind={isFolderTab ? "folder" : "unknown"}
              leftPath={isFolderTab ? (leftPath ?? "") : ""}
              rightPath={isFolderTab ? (rightPath ?? "") : ""}
              pendingSides={paths.pendingSides}
              disabled={operating || comparing}
              onPathCommit={paths.commitPath}
              onPick={(side, kind) => void paths.pickPath(side, kind)}
              onDrop={(side, path) => void paths.commitPath(side, path, true)}
            />
          )
        )}

        {!isFolderTab && activeTab.kind === "file-compare" && (
          <EditorBoundary key={activeTab.id}>
            <Suspense fallback={<div>Loading editor…</div>}>
              <FileCompareView
                key={activeTab.id}
                tabId={activeTab.id}
                leftFilePath={activeTab.leftFilePath}
                rightFilePath={activeTab.rightFilePath}
                onPathCommit={paths.commitPath}
                onPickFile={(side) => void paths.pickPath(side, "file")}
                pathsDisabled={operating}
              />
            </Suspense>
          </EditorBoundary>
        )}
      </div>

      <StatusBar comparison={comparison} />

      {saveConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="File changed on disk"
            className="bg-white p-5 rounded shadow-xl max-w-lg"
          >
            <h2 className="font-semibold">File changed on disk</h2>
            <p className="text-sm break-all my-3">{saveConflict.path}</p>
            <p className="text-sm">
              {saveConflict.message}. Choose how to handle your local edits.
            </p>
            <div className="flex gap-3 mt-4">
              <button onClick={() => resolveSaveConflict("reload")}>
                Reload from disk
              </button>
              <button onClick={() => resolveSaveConflict("overwrite")}>
                Overwrite
              </button>
              <button autoFocus onClick={() => resolveSaveConflict("cancel")}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {folderOps.conflictRequest && (
        <ConflictDialog
          request={folderOps.conflictRequest}
          onResolve={folderOps.resolveConflict}
        />
      )}
      {folderOps.progressVisible && folderOps.progressState && (
        <ProgressDialog
          state={folderOps.progressState}
          onCancel={() => void folderOps.cancel()}
        />
      )}
    </div>
  );
}
