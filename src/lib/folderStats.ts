import type { ComparisonEntry } from "../types";

export interface EntryCounts {
  files: number;
  folders: number;
}

export interface FolderStats {
  identical: number;
  metadata: number;
  modified: EntryCounts;
  leftOnly: EntryCounts;
  rightOnly: EntryCounts;
  total: EntryCounts;
}

/** Counts every comparison entry, including descendants of collapsed folders. */
export function folderStats(entries: ComparisonEntry[] | null): FolderStats {
  const counts: FolderStats = {
    identical: 0,
    metadata: 0,
    modified: { files: 0, folders: 0 },
    leftOnly: { files: 0, folders: 0 },
    rightOnly: { files: 0, folders: 0 },
    total: { files: 0, folders: 0 },
  };

  function visit(items: ComparisonEntry[]) {
    for (const entry of items) {
      // A file/folder mismatch belongs in the folder bucket because either side
      // can contain descendants. Matched files or folders count once per pair.
      const kind =
        entry.left?.is_directory || entry.right?.is_directory
          ? "folders"
          : "files";
      counts.total[kind]++;
      switch (entry.status) {
        case "Identical":
          counts.identical++;
          break;
        case "MetadataMatch":
          counts.metadata++;
          break;
        case "Modified":
          counts.modified[kind]++;
          break;
        case "DirectoryBoth":
          // Use the same recursive backend flag as the modified folder icon.
          if (entry.has_modified_children) counts.modified.folders++;
          break;
        case "LeftOnly":
        case "DirectoryLeftOnly":
          counts.leftOnly[kind]++;
          break;
        case "RightOnly":
        case "DirectoryRightOnly":
          counts.rightOnly[kind]++;
          break;
      }
      if (entry.children) visit(entry.children);
    }
  }

  if (entries) visit(entries);
  return counts;
}
