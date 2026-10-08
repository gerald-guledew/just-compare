import type { FileEntry, ComparisonStatus } from "../types";
import type { ColumnWidths } from "../stores/appStore";
import { formatFileSize, formatDate } from "../lib/format";
import { useShiftHeld } from "../hooks/useShiftHeld";

// Original folder and document glyphs. See docs/ASSET_PROVENANCE.md.
function FolderIcon({ twoTone }: { twoTone?: boolean }) {
  if (twoTone) {
    return (
      <svg width="14" height="14" viewBox="0 0 20 20">
        <defs>
          <linearGradient id="folderTwoTone" x1="0" x2="1" y1="0" y2="0">
            <stop offset="50%" stopColor="#dc2626" />
            <stop offset="50%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <path
          fill="url(#folderTwoTone)"
          d="M2 3h6l3 3h7v11H2Z"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 3h6l3 3h7v11H2Z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="14" viewBox="0 0 16 20" fill="currentColor">
      <path d="M1 1h8v6h6v12H1Z" />
      <path d="m11 1 4 4h-4Z" />
    </svg>
  );
}

export interface RowClick {
  cmd: boolean;
  shift: boolean;
}

interface FileRowProps {
  entry: FileEntry | null;
  rowRelativePath: string;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  hasOrphanChildren: boolean;
  hasModifiedChildren: boolean;
  status?: ComparisonStatus;
  columnWidths: ColumnWidths;
  selected: boolean;
  onSelect: (relativePath: string, click: RowClick) => void;
  onToggle: (relativePath: string) => void;
  onDoubleClick?: (entry: FileEntry) => void;
  /** Start of a possible drag of this row to the other pane. */
  onRowMouseDown?: (relativePath: string, e: React.MouseEvent) => void;
  onContextMenu?: (relativePath: string, e: React.MouseEvent) => void;
}

function isOrphan(status: ComparisonStatus): boolean {
  return (
    status === "LeftOnly" ||
    status === "RightOnly" ||
    status === "DirectoryLeftOnly" ||
    status === "DirectoryRightOnly"
  );
}

function getRowClasses(status?: ComparisonStatus): string {
  if (!status) return "";
  if (isOrphan(status)) return "bg-purple-50";
  if (status === "Modified") return "bg-amber-50";
  return "";
}

function getTextClass(status?: ComparisonStatus): string {
  if (!status) return "";
  if (isOrphan(status)) return "text-purple-700";
  if (status === "Modified") return "text-red-700";
  return "";
}

export function FileRow({
  entry,
  rowRelativePath,
  depth,
  isExpanded,
  hasChildren,
  hasOrphanChildren,
  hasModifiedChildren,
  status,
  columnWidths,
  selected,
  onSelect,
  onToggle,
  onDoubleClick,
  onRowMouseDown,
  onContextMenu,
}: FileRowProps) {
  const shiftHeld = useShiftHeld();
  const indent = depth * 20;
  const statusBg = getRowClasses(status);
  // Selection wins over status colors visually.
  const bgClass = selected
    ? "bg-blue-200/70"
    : `hover:bg-blue-100/50 ${statusBg}`;

  // Placeholder row for entries that don't exist on this side
  if (!entry) {
    return (
      <div
        className={`flex items-center h-8 px-2 text-sm border-b border-gray-100 ${selected ? "bg-blue-200/70" : statusBg}`}
        style={{ paddingLeft: `${indent + 8}px` }}
        onClick={(e) => {
          if (!rowRelativePath) return;
          onSelect(rowRelativePath, { cmd: e.metaKey || e.ctrlKey, shift: e.shiftKey });
        }}
        onContextMenu={(e) => {
          if (!rowRelativePath || !onContextMenu) return;
          onContextMenu(rowRelativePath, e);
        }}
      >
        <span className="w-5 shrink-0" />
        <span className="w-5 shrink-0" />
        <span className="flex-1 text-gray-300 italic truncate">---</span>
        <span className="shrink-0" style={{ width: columnWidths.size }} />
        <span className="shrink-0" style={{ width: columnWidths.modified }} />
      </div>
    );
  }

  const isDir = entry.is_directory;
  const textClass = getTextClass(status);

  const statusIsOrphan = status ? isOrphan(status) : false;
  const twoTone = isDir && hasOrphanChildren && hasModifiedChildren;
  const iconColorClass = statusIsOrphan
    ? "text-purple-500"
    : isDir && hasOrphanChildren && !hasModifiedChildren
      ? "text-purple-500"
      : isDir && hasModifiedChildren && !hasOrphanChildren
        ? "text-red-600"
        : "text-gray-400";

  const handleClick = (e: React.MouseEvent) => {
    const click: RowClick = {
      cmd: e.metaKey || e.ctrlKey,
      shift: e.shiftKey,
    };
    onSelect(entry.relative_path, click);
    // Plain click on a directory row also toggles expansion. Modifier-clicks
    // are select-only, matching most file managers.
    if (isDir && !click.cmd && !click.shift) {
      onToggle(entry.relative_path);
    }
  };

  return (
    <div
      onMouseDown={
        onRowMouseDown
          ? (e) => onRowMouseDown(entry.relative_path, e)
          : undefined
      }
      className={`flex items-center h-8 px-2 ${onRowMouseDown && shiftHeld ? "cursor-grab active:cursor-grabbing" : "cursor-default"} select-none text-sm border-b border-gray-100 ${bgClass}`}
      style={{ paddingLeft: `${indent + 8}px` }}
      onClick={handleClick}
      onDoubleClick={
        !isDir && onDoubleClick ? () => onDoubleClick(entry) : undefined
      }
      onContextMenu={
        onContextMenu
          ? (e) => onContextMenu(entry.relative_path, e)
          : undefined
      }
    >
      {/* Expand/collapse chevron */}
      <span className="w-5 shrink-0 text-gray-400 text-xs">
        {hasChildren ? (isExpanded ? "▼" : "▶") : ""}
      </span>

      {/* File/folder icon — SVG so CSS color works */}
      <span className={`w-5 shrink-0 flex items-center ${iconColorClass}`}>
        {isDir ? <FolderIcon twoTone={twoTone} /> : <FileIcon />}
      </span>

      {/* Name */}
      <span
        className={`flex-1 truncate ${isDir ? "font-medium" : ""} ${textClass}`}
      >
        {entry.name}
      </span>

      {/* Size */}
      <span
        className={`text-right shrink-0 tabular-nums ${textClass || "text-gray-500"}`}
        style={{ width: columnWidths.size }}
      >
        {isDir ? "" : formatFileSize(entry.size)}
      </span>

      {/* Modified date */}
      <span
        className={`text-right shrink-0 ${textClass || "text-gray-500"}`}
        style={{ width: columnWidths.modified }}
      >
        {formatDate(entry.modified)}
      </span>
    </div>
  );
}
