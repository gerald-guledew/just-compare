import { formatFileSize } from "../lib/format";

export interface ProgressState {
  action: "copy" | "move" | "delete";
  completedItems: number;
  totalItems: number;
  completedBytes: number;
  totalBytes: number;
  currentPath: string;
  cancelling: boolean;
}

interface ProgressDialogProps {
  state: ProgressState;
  onCancel: () => void;
}

export function ProgressDialog({ state, onCancel }: ProgressDialogProps) {
  const verb =
    state.action === "copy"
      ? "Copying"
      : state.action === "move"
        ? "Moving"
        : "Deleting";
  const itemPct =
    state.totalItems > 0
      ? Math.min(100, (state.completedItems / state.totalItems) * 100)
      : 0;
  const bytePct =
    state.totalBytes > 0
      ? Math.min(100, (state.completedBytes / state.totalBytes) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-[520px] max-w-[90vw]">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">{`${verb}…`}</h2>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="text-xs text-gray-600 truncate font-mono">
            {state.currentPath || "Preparing…"}
          </div>

          <ProgressBar
            label={
              state.totalItems > 0
                ? `${state.completedItems} of ${state.totalItems} items`
                : "Preparing or processing files…"
            }
            pct={itemPct}
          />

          {state.totalBytes > 0 && (
            <ProgressBar
              label={`${formatFileSize(state.completedBytes)} of ${formatFileSize(state.totalBytes)}`}
              pct={bytePct}
            />
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
          <span className="text-[11px] text-gray-500 italic">
            Files already copied or moved will not be reverted.
          </span>
          <button
            type="button"
            onClick={onCancel}
            disabled={state.cancelling}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {state.cancelling ? "Cancelling…" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-gray-500 mb-1">
        <span>{label}</span>
        <span>{Math.floor(pct)}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
