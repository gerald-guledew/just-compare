export interface FileEntry {
  name: string;
  relative_path: string;
  is_directory: boolean;
  size: number;
  modified: number;
  children: FileEntry[] | null;
}

export type ComparisonStatus =
  | "Identical"
  | "MetadataMatch"
  | "Modified"
  | "LeftOnly"
  | "RightOnly"
  | "DirectoryBoth"
  | "DirectoryLeftOnly"
  | "DirectoryRightOnly";

export interface ComparisonEntry {
  left: FileEntry | null;
  right: FileEntry | null;
  status: ComparisonStatus;
  children: ComparisonEntry[] | null;
  has_orphan_children?: boolean;
  has_modified_children?: boolean;
}

export type DiffLineKind = "Equal" | "Insert" | "Delete" | "Replace";

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: DiffLineKind;
  left_num: number | null;
  right_num: number | null;
  left: DiffSegment[] | null;
  right: DiffSegment[] | null;
}

export interface FileDiffResult {
  binary: boolean;
  too_large: boolean;
  lines: DiffLine[];
}

export type ComparisonMode = "Quick" | "Verified";
export interface ComparisonResult {
  entries: ComparisonEntry[];
  mode: ComparisonMode;
  warnings: string[];
}
export interface FileReadResult {
  text: string;
  bom: boolean;
  canonical_path: string;
  disk_version: string;
  mtime_ms: number;
  size: number;
}
export type SaveOutcome =
  | { kind: "saved"; disk_version: string; mtime_ms: number }
  | { kind: "conflict"; disk_version: string | null; message: string };

export interface FlatComparisonEntry {
  comparison: ComparisonEntry;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  /** True if this directory recursively contains LeftOnly/RightOnly/DirectoryLeftOnly/DirectoryRightOnly children */
  hasOrphanChildren: boolean;
  /** True if this directory recursively contains Modified children */
  hasModifiedChildren: boolean;
}
