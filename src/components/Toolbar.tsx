import type { ComparisonMode } from "../types";
import type { OperationKind } from "../hooks/useFolderOps";
import type { Side } from "../stores/appStore";

interface ToolbarProps {
  leftPath: string | null;
  rightPath: string | null;
  comparing: boolean;
  mode: ComparisonMode;
  onModeChange: (mode: ComparisonMode) => void;
  selectionSize: number;
  onCompare: () => void;
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
  onCompare,
  onAction,
  onDelete,
}: ToolbarProps) {
  const canCompare = !!leftPath && !!rightPath && !comparing;
  const canAct = selectionSize > 0 && !comparing;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onCompare}
          disabled={!canCompare}
          className="shrink-0 px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {comparing ? "Comparing…" : "Compare"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          Comparison:{" "}
          <select
            aria-label="Comparison mode"
            disabled={comparing}
            value={mode}
            title={
              mode === "Quick"
                ? "Size and timestamp; checks bytes when equal-sized files have different timestamps."
                : "Checks file contents regardless of timestamp."
            }
            onChange={(e) =>
              onModeChange(e.target.value === "Verified" ? "Verified" : "Quick")
            }
            className="border border-gray-300 rounded px-2 py-1 bg-white text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40"
          >
            <option value="Quick">Quick</option>
            <option value="Verified">Verified</option>
          </select>
        </label>
      </div>
      <div className="w-px h-5 bg-gray-200" aria-hidden="true" />
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
