import { confirm } from "@tauri-apps/plugin-dialog";
import {
  FOLDER_TAB_ID,
  selectIsTabDirty,
  useAppStore,
  type Tab,
} from "../stores/appStore";

interface TabBarProps {
  onRefresh: () => void;
  refreshDisabled: boolean;
  onSave: () => void;
  canSave: boolean;
}

function tabLabel(tab: Tab): string {
  if (tab.kind === "folder-compare") return "Folder Compare";
  return tab.displayName;
}

export function TabBar({
  onRefresh,
  refreshDisabled,
  onSave,
  canSave,
}: TabBarProps) {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const fileTabs = useAppStore((s) => s.fileTabs);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);

  const handleClose = async (tabId: string) => {
    const dirty = selectIsTabDirty(useAppStore.getState(), tabId);
    if (dirty) {
      const ok = await confirm("Discard unsaved changes on this tab?", {
        title: "Close tab",
        kind: "warning",
      });
      if (!ok) return;
    }
    closeTab(tabId);
  };

  return (
    <div className="flex items-end h-9 bg-gray-100 border-b border-gray-200 px-2 gap-0.5 overflow-x-auto shrink-0">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const canClose = tab.id !== FOLDER_TAB_ID;
        const state = fileTabs[tab.id];
        const dirty = !!(state?.left?.dirty || state?.right?.dirty);
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex items-center gap-2 h-8 px-3 rounded-t-md border-t border-l border-r text-sm cursor-pointer select-none max-w-64 ${
              active
                ? "bg-white border-gray-200 text-gray-900"
                : "bg-gray-200 border-transparent text-gray-600 hover:bg-gray-150"
            }`}
          >
            <span className="truncate">
              {tabLabel(tab)}
              {dirty && <span className="text-amber-600 ml-1">*</span>}
            </span>
            {canClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleClose(tab.id);
                }}
                className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-gray-400 hover:bg-gray-300 hover:text-gray-700"
                aria-label="Close tab"
              >
                {"\u00D7"}
              </button>
            )}
          </div>
        );
      })}
      <div className="flex-1" />
      <button
        onClick={onSave}
        disabled={!canSave}
        className="self-center h-7 px-2 mb-0.5 flex items-center gap-1 text-sm rounded text-gray-700 hover:bg-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        aria-label="Save"
        title="Save (Cmd/Ctrl+S)"
      >
        {/* Feather v4.29.2 save icon, MIT. See docs/ASSET_PROVENANCE.md. */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        <span>Save</span>
      </button>
      <button
        onClick={onRefresh}
        disabled={refreshDisabled}
        className="self-center h-7 px-2 mb-0.5 flex items-center gap-1 text-sm rounded text-gray-700 hover:bg-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        aria-label="Refresh comparison"
        title="Refresh comparison"
      >
        {/* Original refresh glyph. See docs/ASSET_PROVENANCE.md. */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6a8 8 0 1 0 2 9" />
          <polyline points="18 2 18 6 14 6" />
        </svg>
        <span>Refresh</span>
      </button>
    </div>
  );
}
