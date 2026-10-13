import { useCallback, useRef } from "react";
import type { Side } from "../stores/appStore";
import { useOsFileDrop } from "../hooks/useOsFileDrop";
import { DropTargetOverlay } from "./DropTargetOverlay";
import { PaneHeader, type PathCommitResult } from "./PaneHeader";
import { ComparisonPlaceholder } from "./ComparisonPlaceholder";
import type { SelectedComparisonKind } from "./PathPickerButton";

interface ComparisonSetupViewProps {
  leftPath: string;
  rightPath: string;
  itemKind: "unknown" | "folder";
  pendingSide?: Side | null;
  pendingSides?: ReadonlySet<Side>;
  error?: string | null;
  disabled: boolean;
  onPathCommit: (side: Side, path: string) => PathCommitResult;
  onPick: (side: Side, kind?: SelectedComparisonKind) => void;
  onDrop: (side: Side, path: string) => void;
}

/** Empty comparisons mount simple panes, keeping the editor out of startup. */
export function ComparisonSetupView({
  leftPath,
  rightPath,
  itemKind,
  pendingSide = null,
  pendingSides,
  error = null,
  disabled,
  onPathCommit,
  onPick,
  onDrop,
}: ComparisonSetupViewProps) {
  const panesRef = useRef<HTMLDivElement>(null);
  const handleDrop = useCallback(
    (side: Side, path: string) => {
      if (!disabled) onDrop(side, path);
    },
    [disabled, onDrop],
  );
  const dropSide = useOsFileDrop(panesRef, handleDrop);
  const leftPending = pendingSides?.has("left") || pendingSide === "left";
  const rightPending = pendingSides?.has("right") || pendingSide === "right";

  return (
    <div className="flex flex-col h-full min-h-0 gap-1">
      {error && (
        <div
          role="alert"
          className="px-3 py-2 rounded border border-red-200 bg-red-50 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <div
        ref={panesRef}
        className="relative flex-1 min-h-0 flex flex-col border border-gray-200 rounded-lg overflow-hidden bg-white"
      >
        {dropSide && !disabled && (
          <DropTargetOverlay
            side={dropSide}
            layout="inset-0 grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)]"
          />
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] border-b border-gray-200">
          <PaneHeader
            side="left"
            path={leftPath}
            itemKind={itemKind}
            onPathCommit={(path) => onPathCommit("left", path)}
            onPick={(kind) => onPick("left", kind)}
            disabled={disabled || leftPending}
          />
          <div className="bg-gray-200" />
          <PaneHeader
            side="right"
            path={rightPath}
            itemKind={itemKind}
            onPathCommit={(path) => onPathCommit("right", path)}
            onPick={(kind) => onPick("right", kind)}
            disabled={disabled || rightPending}
          />
        </div>
        <div className="grid flex-1 min-h-0 grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)]">
          <ComparisonPlaceholder
            side="left"
            itemKind={itemKind}
            path={leftPath}
            pending={leftPending}
            disabled={disabled}
            onPick={(kind) => onPick("left", kind)}
          />
          <div className="bg-gray-100" />
          <ComparisonPlaceholder
            side="right"
            itemKind={itemKind}
            path={rightPath}
            pending={rightPending}
            disabled={disabled}
            onPick={(kind) => onPick("right", kind)}
          />
        </div>
      </div>
    </div>
  );
}
