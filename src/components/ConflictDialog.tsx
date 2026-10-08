export type ConflictResolution =
  | "yes"
  | "no"
  | "yes-all"
  | "no-all"
  | "cancel";

export interface ConflictRequest {
  srcPath: string;
  dstPath: string;
  isDir: boolean;
  action: "copy" | "move";
}

interface ConflictDialogProps {
  request: ConflictRequest;
  onResolve: (r: ConflictResolution) => void;
}

export function ConflictDialog({ request, onResolve }: ConflictDialogProps) {
  const verb = request.action === "copy" ? "Copy" : "Move";
  const noun = request.isDir ? "directory" : "file";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-[520px] max-w-[90vw]">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">
            {`${verb} ${noun} — destination already exists`}
          </h2>
        </div>
        <div className="px-4 py-3 text-xs text-gray-700 space-y-2">
          <div>
            <span className="text-gray-500">Source: </span>
            <span className="font-mono break-all">{request.srcPath}</span>
          </div>
          <div>
            <span className="text-gray-500">Destination: </span>
            <span className="font-mono break-all text-amber-700">
              {request.dstPath}
            </span>
          </div>
          <div className="text-gray-600 pt-1">
            Overwrite the existing {noun} on the destination side?
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={() => onResolve("cancel")}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-100 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onResolve("no-all")}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-100 cursor-pointer"
          >
            No to all
          </button>
          <button
            type="button"
            onClick={() => onResolve("no")}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-100 cursor-pointer"
          >
            No
          </button>
          <button
            type="button"
            onClick={() => onResolve("yes-all")}
            className="px-3 py-1.5 text-xs rounded bg-amber-100 hover:bg-amber-200 text-amber-900 cursor-pointer"
          >
            Yes to all
          </button>
          <button
            type="button"
            onClick={() => onResolve("yes")}
            className="px-3 py-1.5 text-xs rounded bg-amber-500 hover:bg-amber-600 text-white cursor-pointer"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
