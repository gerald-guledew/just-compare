import { useEffect, useState } from "react";
import { openFileDialog } from "../lib/tauri";

interface PaneHeaderProps {
  side: "left" | "right";
  path: string;
  onPathCommit?: (newPath: string) => void;
  isDirty?: boolean;
  hasError?: boolean;
  onSave?: () => void;
}

export function PaneHeader({
  side,
  path,
  onPathCommit,
  isDirty = false,
  hasError = false,
  onSave,
}: PaneHeaderProps) {
  const [draft, setDraft] = useState(path);
  useEffect(() => {
    setDraft(path);
  }, [path]);

  const commit = () => {
    const next = draft.trim();
    if (!next || next === path) {
      setDraft(path);
      return;
    }
    onPathCommit?.(next);
  };

  const pickFile = async () => {
    const picked = await openFileDialog(path);
    if (picked && picked !== path) {
      onPathCommit?.(picked);
    }
  };

  return (
    <div className="flex items-center h-8 px-2 bg-gray-50 text-xs text-gray-600 font-medium gap-1 min-w-0">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(path);
            e.currentTarget.blur();
          }
        }}
        onBlur={commit}
        readOnly={!onPathCommit}
        spellCheck={false}
        className={`flex-1 min-w-0 px-2 py-0.5 bg-white border rounded text-xs font-mono focus:outline-none focus:ring-1 read-only:bg-gray-50 read-only:border-transparent read-only:cursor-default ${
          hasError
            ? "border-red-300 text-red-700 focus:border-red-400 focus:ring-red-100"
            : "border-gray-200 text-gray-700 focus:border-blue-400 focus:ring-blue-100"
        }`}
        aria-label={side === "left" ? "Left file path" : "Right file path"}
        title={path}
      />
      {isDirty && <span className="text-amber-600 shrink-0">*</span>}
      {onPathCommit && (
        <button
          type="button"
          onClick={() => void pickFile()}
          className="flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-200 cursor-pointer"
          aria-label="Choose file"
          title="Choose file"
        >
          {/* Feather v4.29.2 folder icon, MIT. See docs/ASSET_PROVENANCE.md. */}
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
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
      {onSave && (
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || hasError}
          className="flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-500 disabled:cursor-not-allowed cursor-pointer"
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
        </button>
      )}
    </div>
  );
}
