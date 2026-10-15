import { useEffect, useRef } from "react";
import type { SaveConflictChoice } from "../lib/documents";
import type { SaveConflictRequest } from "../stores/appStore";

interface SaveConflictDialogProps {
  request: SaveConflictRequest;
  onResolve: (choice: SaveConflictChoice) => void;
}

export function SaveConflictDialog({
  request,
  onResolve,
}: SaveConflictDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const side = request.side === "left" ? "Left" : "Right";
  const missingFile = request.reason === "missingFile";
  const missingFolder = request.reason === "missingFolder";
  const existingDestination =
    request.isSaveAs && !missingFile && !missingFolder;
  const title = missingFolder
    ? `Cannot save ${side.toLowerCase()} file`
    : missingFile
      ? `${side} file is missing`
      : existingDestination
        ? `${side} save destination already exists`
        : `${side} file changed on disk`;

  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-conflict-title"
        aria-describedby="save-conflict-description"
        className="bg-white rounded-lg shadow-xl border border-gray-200 w-[520px] max-w-full"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (
            (event.metaKey || event.ctrlKey) &&
            ["w", "s"].includes(event.key.toLowerCase())
          ) {
            event.preventDefault();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onResolve("cancel");
          } else if (event.key === "Tab") {
            const buttons =
              dialogRef.current?.querySelectorAll<HTMLButtonElement>("button");
            if (!buttons?.length) return;
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="px-4 py-3 border-b border-gray-200">
          <h2
            id="save-conflict-title"
            className="text-sm font-semibold text-gray-900"
          >
            {title}
          </h2>
        </div>
        <div className="px-4 py-3 text-sm text-gray-700 space-y-3">
          <p id="save-conflict-description">
            {missingFolder
              ? "The original folder is no longer available. Save your edits to another location."
              : missingFile
                ? "The file no longer exists at this path. Recreate it here, or save your edits elsewhere."
                : existingDestination
                  ? "A file already exists at this save location. Replace it with your edits, open its disk version, or choose another location."
                  : "The file was changed outside JustCompare. Reload the disk version, replace it with your edited text, or save your edits elsewhere."}
          </p>
          <p className="font-mono text-xs text-gray-500 break-all">
            {request.path}
          </p>
          <p className="text-xs text-gray-500">
            Your edits are kept if you cancel.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex flex-wrap gap-2 justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onResolve("cancel")}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2"
          >
            Cancel
          </button>
          {!missingFile && !missingFolder && (
            <button
              type="button"
              onClick={() => onResolve("reload")}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2"
            >
              {existingDestination ? "Open disk version" : "Reload from disk"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onResolve("saveAs")}
            className={`px-3 py-1.5 text-xs rounded cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2 ${missingFolder ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-gray-300 bg-white hover:bg-gray-100"}`}
          >
            Save as…
          </button>
          {!missingFolder && (
            <button
              type="button"
              onClick={() => onResolve(missingFile ? "recreate" : "overwrite")}
              className={`px-3 py-1.5 text-xs rounded cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2 ${missingFile ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-amber-100 text-amber-900 hover:bg-amber-200"}`}
            >
              {missingFile ? "Recreate file" : "Overwrite"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
