import { useCallback, useMemo, useState } from "react";
import type { FileEntry } from "../types";
import { useAppStore, type Side } from "../stores/appStore";
import { useComparisonTree } from "../hooks/useComparisonTree";
import { ComparisonPane } from "./ComparisonPane";
import {
  ContextMenu,
  type ContextMenuEntry,
  type ContextMenuState,
} from "./ContextMenu";
import type { RowClick } from "./FileRow";
import type { OperationKind, OperationSpec } from "../hooks/useFolderOps";
import { useRowPointerDrag } from "../hooks/useRowPointerDrag";
import { openFolderDialog } from "../lib/tauri";
import { PaneHeader, type PathCommitResult } from "./PaneHeader";

interface ComparisonViewProps {
  onRunOperation: (spec: OperationSpec) => Promise<void>;
  onDelete: (side: Side) => Promise<void>;
  onPathCommit: (side: Side, path: string) => PathCommitResult;
  onPick: (side: Side) => void;
  disabled?: boolean;
}

export function ComparisonView({
  onRunOperation,
  onDelete,
  onPathCommit,
  onPick,
  disabled = false,
}: ComparisonViewProps) {
  const leftPath = useAppStore((s) => s.leftPath);
  const rightPath = useAppStore((s) => s.rightPath);
  const comparison = useAppStore((s) => s.comparison);
  const expandedPaths = useAppStore((s) => s.expandedPaths);
  const toggleExpanded = useAppStore((s) => s.toggleExpanded);
  const columnWidths = useAppStore((s) => s.columnWidths);
  const setColumnWidths = useAppStore((s) => s.setColumnWidths);
  const openFileCompareTab = useAppStore((s) => s.openFileCompareTab);
  const selectedPaths = useAppStore((s) => s.selectedPaths);
  const setSelection = useAppStore((s) => s.setSelection);
  const toggleSelection = useAppStore((s) => s.toggleSelection);
  const extendSelectionTo = useAppStore((s) => s.extendSelectionTo);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const { onRowMouseDownFor, dropTargetSide } =
    useRowPointerDrag(onRunOperation);

  const handleFileDoubleClick = useCallback(
    (entry: FileEntry) => {
      const { leftPath, rightPath } = useAppStore.getState();
      if (!leftPath || !rightPath) return;
      openFileCompareTab(leftPath, rightPath, entry.relative_path);
    },
    [openFileCompareTab],
  );

  const {
    leftRef,
    rightRef,
    flatItems,
    leftVirtualizer,
    rightVirtualizer,
    onLeftScroll,
    onRightScroll,
    rowHeight,
  } = useComparisonTree(comparison, expandedPaths);

  // The visible flat list of relative paths, needed for shift-select range
  // expansion in the store.
  const flatPaths = useMemo(
    () =>
      flatItems.map((item) => {
        const fe = item.comparison.left ?? item.comparison.right;
        return fe?.relative_path ?? "";
      }),
    [flatItems],
  );

  const onSelect = useCallback(
    (relativePath: string, click: RowClick) => {
      if (!relativePath) return;
      if (click.shift) extendSelectionTo(relativePath, flatPaths);
      else if (click.cmd) toggleSelection(relativePath);
      else setSelection([relativePath]);
    },
    [flatPaths, extendSelectionTo, toggleSelection, setSelection],
  );

  // Context menu state.
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const buildMenuItems = useCallback(
    (paneSide: Side, rowPath: string | null): ContextMenuEntry[] => {
      const otherSide: Side = paneSide === "left" ? "right" : "left";
      const hasSelection =
        (rowPath && useAppStore.getState().selectedPaths.has(rowPath)) ||
        useAppStore.getState().selectedPaths.size > 0 ||
        rowPath !== null;

      const arrow = paneSide === "left" ? "→" : "←";

      const runWithSourceSide =
        (kind: OperationKind, target: "left" | "right" | "arbitrary") =>
        async () => {
          if (target === "arbitrary") {
            const state = useAppStore.getState();
            const folder = await openFolderDialog();
            if (!folder) return;
            const latest = useAppStore.getState();
            if (
              latest.activeTabId !== state.activeTabId ||
              latest.comparisonContextVersion !==
                state.comparisonContextVersion ||
              latest.selectedPaths !== state.selectedPaths
            )
              return;
            await onRunOperation({
              kind,
              sourceSide: paneSide,
              targetSide: "arbitrary",
              targetFolder: folder,
            });
          } else {
            await onRunOperation({
              kind,
              sourceSide: paneSide,
              targetSide: target,
            });
          }
        };

      const items: ContextMenuEntry[] = [
        {
          label: `Copy ${arrow} other side`,
          shortcut: paneSide === "left" ? "F5" : "Shift+F5",
          disabled: !hasSelection || useAppStore.getState().operating,
          onClick: () => void runWithSourceSide("copy", otherSide)(),
        },
        {
          label: `Move ${arrow} other side`,
          shortcut: paneSide === "left" ? "F6" : "Shift+F6",
          disabled: !hasSelection || useAppStore.getState().operating,
          onClick: () => void runWithSourceSide("move", otherSide)(),
        },
        {
          label: "Copy to folder…",
          disabled: !hasSelection || useAppStore.getState().operating,
          onClick: () => void runWithSourceSide("copy", "arbitrary")(),
        },
        {
          label: "Move to folder…",
          disabled: !hasSelection || useAppStore.getState().operating,
          onClick: () => void runWithSourceSide("move", "arbitrary")(),
        },
        { divider: true },
        {
          label: `Delete from ${paneSide}`,
          shortcut: paneSide === "left" ? "Delete" : "Shift+Delete",
          disabled: !hasSelection || useAppStore.getState().operating,
          onClick: () => void onDelete(paneSide),
        },
        { divider: true },
        {
          label: "Clear selection",
          shortcut: "Esc",
          disabled: useAppStore.getState().selectedPaths.size === 0,
          onClick: () => clearSelection(),
        },
      ];
      return items;
    },
    [onRunOperation, onDelete, clearSelection],
  );

  const onContextMenu = useCallback(
    (rowPath: string | null, side: Side, e: React.MouseEvent) => {
      e.preventDefault();
      // If the clicked row isn't in selection, replace selection with it so the
      // menu acts on the right thing.
      if (rowPath && !useAppStore.getState().selectedPaths.has(rowPath)) {
        setSelection([rowPath]);
      }
      setMenu({
        x: e.clientX,
        y: e.clientY,
        side,
        rowPath,
        items: buildMenuItems(side, rowPath),
      });
    },
    [setSelection, buildMenuItems],
  );

  return (
    <div className="flex flex-col h-full min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] border-b border-gray-200">
        <PaneHeader
          side="left"
          path={leftPath ?? ""}
          itemKind="folder"
          onPathCommit={(path) => onPathCommit("left", path)}
          onPick={() => onPick("left")}
          disabled={disabled}
        />
        <div className="bg-gray-200" />
        <PaneHeader
          side="right"
          path={rightPath ?? ""}
          itemKind="folder"
          onPathCommit={(path) => onPathCommit("right", path)}
          onPick={() => onPick("right")}
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] flex-1 min-h-0">
        <div className="min-w-0 min-h-0">
          <ComparisonPane
            side="left"
            flatItems={flatItems}
            scrollRef={leftRef}
            virtualizer={leftVirtualizer}
            rowHeight={rowHeight}
            columnWidths={columnWidths}
            selectedPaths={selectedPaths}
            onScroll={onLeftScroll}
            onToggle={toggleExpanded}
            onColumnResize={setColumnWidths}
            onFileDoubleClick={handleFileDoubleClick}
            onSelect={onSelect}
            onClearSelection={clearSelection}
            onRowMouseDown={onRowMouseDownFor("left")}
            isDropTarget={dropTargetSide === "left"}
            onContextMenu={onContextMenu}
          />
        </div>
        <div className="bg-gray-100" />
        <div className="min-w-0 min-h-0">
          <ComparisonPane
            side="right"
            flatItems={flatItems}
            scrollRef={rightRef}
            virtualizer={rightVirtualizer}
            rowHeight={rowHeight}
            columnWidths={columnWidths}
            selectedPaths={selectedPaths}
            onScroll={onRightScroll}
            onToggle={toggleExpanded}
            onColumnResize={setColumnWidths}
            onFileDoubleClick={handleFileDoubleClick}
            onSelect={onSelect}
            onClearSelection={clearSelection}
            onRowMouseDown={onRowMouseDownFor("right")}
            isDropTarget={dropTargetSide === "right"}
            onContextMenu={onContextMenu}
          />
        </div>
      </div>
      <ContextMenu state={menu} onClose={closeMenu} />
    </div>
  );
}
