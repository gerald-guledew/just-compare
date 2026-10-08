import { useCallback, type RefObject } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { FileEntry, FlatComparisonEntry } from "../types";
import type { ColumnWidths, Side } from "../stores/appStore";
import { FileRow, type RowClick } from "./FileRow";
import { ColumnResizeHandle } from "./ColumnResizeHandle";

interface ComparisonPaneProps {
  side: Side;
  flatItems: FlatComparisonEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  rowHeight: number;
  columnWidths: ColumnWidths;
  selectedPaths: Set<string>;
  onScroll: () => void;
  onToggle: (relativePath: string) => void;
  onColumnResize: (widths: ColumnWidths) => void;
  onFileDoubleClick?: (entry: FileEntry) => void;
  onSelect: (relativePath: string, click: RowClick) => void;
  onClearSelection: () => void;
  onRowMouseDown: (relativePath: string, e: React.MouseEvent) => void;
  /** Rows dragged from the other pane are hovering over this one. */
  isDropTarget: boolean;
  onContextMenu: (
    relativePath: string | null,
    side: Side,
    e: React.MouseEvent,
  ) => void;
}

const MIN_COL_WIDTH = 48;

export function ComparisonPane({
  side,
  flatItems,
  scrollRef,
  virtualizer,
  rowHeight,
  columnWidths,
  selectedPaths,
  onScroll,
  onToggle,
  onColumnResize,
  onFileDoubleClick,
  onSelect,
  onClearSelection,
  onRowMouseDown,
  isDropTarget,
  onContextMenu,
}: ComparisonPaneProps) {
  const onResizeSize = useCallback(
    (delta: number) => {
      const next = Math.max(MIN_COL_WIDTH, columnWidths.size - delta);
      onColumnResize({ ...columnWidths, size: next });
    },
    [columnWidths, onColumnResize],
  );

  const onResizeModified = useCallback(
    (delta: number) => {
      const next = Math.max(MIN_COL_WIDTH, columnWidths.modified - delta);
      onColumnResize({ ...columnWidths, modified: next });
    },
    [columnWidths, onColumnResize],
  );

  return (
    <div
      data-comparison-pane-side={side}
      className={`flex flex-col h-full border rounded-lg overflow-hidden bg-white ${
        isDropTarget ? "border-blue-400 ring-2 ring-blue-400 ring-inset" : "border-gray-200"
      }`}
    >
      {/* Column headers */}
      <div className="flex items-center h-8 px-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide select-none">
        <span className="flex-1 pl-12">Name</span>
        <ColumnResizeHandle onResize={onResizeSize} />
        <span
          className="text-right"
          style={{ width: columnWidths.size }}
        >
          Size
        </span>
        <ColumnResizeHandle onResize={onResizeModified} />
        <span
          className="text-right"
          style={{ width: columnWidths.modified }}
        >
          Modified
        </span>
      </div>

      {/* Virtualised scrollable area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        onScroll={onScroll}
        onClick={(e) => {
          // Click on the empty area below rows clears the selection.
          if (e.target === e.currentTarget) onClearSelection();
        }}
        onContextMenu={(e) => {
          // Right-click on empty area opens an empty-context menu (no rows).
          if (e.target === e.currentTarget) onContextMenu(null, side, e);
        }}
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = flatItems[virtualRow.index];
            const entry =
              side === "left"
                ? item.comparison.left
                : item.comparison.right;
            const fileEntry = item.comparison.left ?? item.comparison.right;
            const relativePath = fileEntry?.relative_path ?? "";

            return (
              <div
                key={relativePath || virtualRow.index}
                className="absolute top-0 left-0 w-full"
                style={{
                  height: `${rowHeight}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <FileRow
                  entry={entry}
                  rowRelativePath={relativePath}
                  depth={item.depth}
                  isExpanded={item.isExpanded}
                  hasChildren={item.hasChildren}
                  hasOrphanChildren={item.hasOrphanChildren}
                  hasModifiedChildren={item.hasModifiedChildren}
                  status={item.comparison.status}
                  columnWidths={columnWidths}
                  selected={selectedPaths.has(relativePath)}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onDoubleClick={onFileDoubleClick}
                  onRowMouseDown={onRowMouseDown}
                  onContextMenu={(p, e) => onContextMenu(p, side, e)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
