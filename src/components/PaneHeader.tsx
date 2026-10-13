import { useEffect, useRef, useState } from "react";
import { openFileDialog, openFolderDialog } from "../lib/tauri";
import {
  PathPickerButton,
  type ComparisonItemKind,
  type SelectedComparisonKind,
} from "./PathPickerButton";

export type PathCommitResult = void | boolean | Promise<void | boolean>;

interface PaneHeaderProps {
  side: "left" | "right";
  path: string;
  itemKind?: ComparisonItemKind;
  onPathCommit?: (newPath: string) => PathCommitResult;
  onPick?: (kind?: SelectedComparisonKind) => void;
  disabled?: boolean;
  isDirty?: boolean;
  hasError?: boolean;
  onSave?: () => void;
}

export function PaneHeader({
  side,
  path,
  itemKind = "file",
  onPathCommit,
  onPick,
  disabled = false,
  isDirty = false,
  hasError = false,
  onSave,
}: PaneHeaderProps) {
  const [draft, setDraft] = useState(path);
  const cancelCommitRef = useRef(false);
  const commitSequenceRef = useRef(0);
  const draftVersionRef = useRef(0);
  const draftRef = useRef(path);
  const acceptedPathRef = useRef(path);
  const mountedRef = useRef(true);
  acceptedPathRef.current = path;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    draftVersionRef.current++;
    draftRef.current = path;
    setDraft(path);
  }, [path]);

  const resetDraft = () => {
    draftVersionRef.current++;
    draftRef.current = acceptedPathRef.current;
    setDraft(acceptedPathRef.current);
  };

  const commit = async () => {
    const sequence = ++commitSequenceRef.current;
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      return;
    }
    const next = draftRef.current.trim();
    if (disabled || next === path || (!next && itemKind === "file")) {
      resetDraft();
      return;
    }
    const draftVersion = draftVersionRef.current;
    const canReset = () =>
      mountedRef.current &&
      sequence === commitSequenceRef.current &&
      draftVersion === draftVersionRef.current;
    try {
      const accepted = await onPathCommit?.(next);
      if (accepted === false && canReset()) resetDraft();
    } catch (error) {
      if (canReset()) resetDraft();
      console.error("Unable to change comparison path:", error);
    }
  };

  const pickPath = async (kind: SelectedComparisonKind) => {
    if (onPick) {
      onPick(kind);
      return;
    }
    const picked =
      kind === "folder"
        ? await openFolderDialog()
        : await openFileDialog(path || undefined);
    if (picked && picked !== path) {
      await onPathCommit?.(picked);
    }
  };
  const itemLabel = itemKind === "unknown" ? "folder/file" : itemKind;
  const sideLabel = side === "left" ? "Left" : "Right";

  return (
    <div className="flex items-center h-8 px-2 bg-gray-50 text-xs text-gray-600 font-medium gap-1 min-w-0">
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          draftVersionRef.current++;
          draftRef.current = e.target.value;
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelCommitRef.current = true;
            resetDraft();
            e.currentTarget.blur();
          }
        }}
        onBlur={() => void commit()}
        readOnly={!onPathCommit}
        disabled={disabled}
        spellCheck={false}
        className={`flex-1 min-w-0 px-2 py-0.5 bg-white border rounded text-xs font-mono focus:outline-none focus:ring-1 read-only:bg-gray-50 read-only:border-transparent read-only:cursor-default ${
          hasError
            ? "border-red-300 text-red-700 focus:border-red-400 focus:ring-red-100"
            : "border-gray-200 text-gray-700 focus:border-blue-400 focus:ring-blue-100"
        }`}
        aria-label={`${sideLabel} ${itemKind === "unknown" ? "comparison" : itemKind} path`}
        title={path}
        placeholder={`Choose a ${side} ${itemLabel}`}
      />
      {isDirty && <span className="text-amber-600 shrink-0">*</span>}
      {(onPathCommit || onPick) && (
        <PathPickerButton
          side={side}
          itemKind={itemKind}
          onPick={(kind) => void pickPath(kind)}
          disabled={disabled}
        />
      )}
      {onSave && (
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || !isDirty || hasError}
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
