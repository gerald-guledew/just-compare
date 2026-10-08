import type { ComparisonMode } from "../types";
import { useEffect, useState } from "react";
import type { OperationKind } from "../hooks/useFolderOps";
import type { Side } from "../stores/appStore";

interface ToolbarProps {
  leftPath: string | null;
  rightPath: string | null;
  comparing: boolean;
  mode: ComparisonMode;
  onModeChange: (mode: ComparisonMode) => void;
  selectionSize: number;
  onPickLeft: () => void;
  onPickRight: () => void;
  onCompare: () => void;
  onCommitLeft: (path: string | null) => void;
  onCommitRight: (path: string | null) => void;
  onAction: (
    kind: OperationKind,
    sourceSide: Side,
    target: "left" | "right" | "arbitrary",
  ) => void;
  onDelete: (side: Side) => void;
}

export function Toolbar({
  leftPath,
  rightPath,
  comparing,
  mode,
  onModeChange,
  selectionSize,
  onPickLeft,
  onPickRight,
  onCompare,
  onCommitLeft,
  onCommitRight,
  onAction,
  onDelete,
}: ToolbarProps) {
  const canCompare = !!leftPath && !!rightPath && !comparing;
  const canAct = selectionSize > 0 && !comparing;

  return (
    <div className="flex flex-col gap-2 px-4 py-2 border-b border-gray-200 bg-white">
      {/* Row 1: path inputs + Compare */}
      <div className="flex items-center gap-3">
        <button
          onClick={onPickLeft}
          disabled={comparing}
          className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Left Folder
        </button>
        <PathInput
          value={leftPath}
          disabled={comparing}
          ariaLabel="Left folder path"
          onCommit={onCommitLeft}
        />

        <div className="w-px h-6 bg-gray-200 shrink-0" />

        <button
          onClick={onPickRight}
          disabled={comparing}
          className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Right Folder
        </button>
        <PathInput
          value={rightPath}
          disabled={comparing}
          ariaLabel="Right folder path"
          onCommit={onCommitRight}
        />

        <div className="w-px h-6 bg-gray-200 shrink-0" />

        <button
          onClick={onCompare}
          disabled={!canCompare}
          className="shrink-0 px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {comparing ? "Comparing…" : "Compare"}
        </button>
      </div>

      {/* Row 2: action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs">
          Comparison:{" "}
          <select
            aria-label="Comparison mode"
            disabled={comparing}
            value={mode}
            onChange={(e) =>
              onModeChange(e.target.value === "Verified" ? "Verified" : "Quick")
            }
            className="border rounded px-2 py-1"
          >
            <option value="Quick">Quick</option>
            <option value="Verified">Verified</option>
          </select>
        </label>
        <span className="text-xs text-gray-500">
          {mode === "Quick"
            ? "Size and timestamp; checks bytes when equal-sized files have different timestamps."
            : "Checks file contents regardless of timestamp."}
        </span>
      </div>
      <ActionGroup canAct={canAct} onAction={onAction} onDelete={onDelete} />
    </div>
  );
}

function ActionGroup({
  canAct,
  onAction,
  onDelete,
}: {
  canAct: boolean;
  onAction: ToolbarProps["onAction"];
  onDelete: ToolbarProps["onDelete"];
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <ActionButton
        title="Copy left → right (F5)"
        disabled={!canAct}
        onClick={() => onAction("copy", "left", "right")}
        label="Copy"
        arrow="right"
      />
      <ActionButton
        title="Copy right → left (Shift+F5)"
        disabled={!canAct}
        onClick={() => onAction("copy", "right", "left")}
        label="Copy"
        arrow="left"
      />
      <ActionButton
        title="Move left → right (F6)"
        disabled={!canAct}
        onClick={() => onAction("move", "left", "right")}
        label="Move"
        arrow="right"
      />
      <ActionButton
        title="Move right → left (Shift+F6)"
        disabled={!canAct}
        onClick={() => onAction("move", "right", "left")}
        label="Move"
        arrow="left"
      />
      <div className="w-px h-5 bg-gray-200 mx-1" />
      <ActionButton
        title="Copy selection from left to a folder… (F7)"
        disabled={!canAct}
        onClick={() => onAction("copy", "left", "arbitrary")}
        label="Copy L→…"
      />
      <ActionButton
        title="Move selection from left to a folder… (Shift+F7)"
        disabled={!canAct}
        onClick={() => onAction("move", "left", "arbitrary")}
        label="Move L→…"
      />
      <ActionButton
        title="Copy selection from right to a folder… (Ctrl+F7)"
        disabled={!canAct}
        onClick={() => onAction("copy", "right", "arbitrary")}
        label="Copy R→…"
      />
      <ActionButton
        title="Move selection from right to a folder… (Ctrl+Shift+F7)"
        disabled={!canAct}
        onClick={() => onAction("move", "right", "arbitrary")}
        label="Move R→…"
      />
      <div className="w-px h-5 bg-gray-200 mx-1" />
      <ActionButton
        title="Delete selection from left (Delete)"
        disabled={!canAct}
        onClick={() => onDelete("left")}
        label="Delete L"
        danger
      />
      <ActionButton
        title="Delete selection from right (Shift+Delete)"
        disabled={!canAct}
        onClick={() => onDelete("right")}
        label="Delete R"
        danger
      />
    </div>
  );
}

function ActionButton({
  title,
  disabled,
  onClick,
  label,
  arrow,
  danger,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  label: string;
  arrow?: "left" | "right";
  danger?: boolean;
}) {
  const colorClass = danger
    ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 px-2 py-1 text-xs rounded border ${colorClass} disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1`}
    >
      {arrow === "left" && <span aria-hidden>{"◀"}</span>}
      <span>{label}</span>
      {arrow === "right" && <span aria-hidden>{"▶"}</span>}
    </button>
  );
}

function PathInput({
  value,
  disabled,
  ariaLabel,
  onCommit,
}: {
  value: string | null;
  disabled: boolean;
  ariaLabel: string;
  onCommit: (path: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === value) return;
    onCommit(next);
  };

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(value ?? "");
          e.currentTarget.blur();
        }
      }}
      onBlur={commit}
      disabled={disabled}
      spellCheck={false}
      placeholder="None"
      className="flex-1 min-w-0 px-2 py-1 text-sm text-gray-700 font-mono bg-white border border-gray-200 rounded focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-400"
      aria-label={ariaLabel}
      title={value ?? ""}
    />
  );
}
