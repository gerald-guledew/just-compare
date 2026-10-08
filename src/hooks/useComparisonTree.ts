import { useMemo } from "react";
import type { ComparisonEntry, FlatComparisonEntry } from "../types";
import { useDiffScroll } from "./useDiffScroll";

const ROW_HEIGHT = 32;

function flattenComparisonTree(
  entries: ComparisonEntry[] | null,
  expandedPaths: Set<string>,
  depth: number = 0,
): FlatComparisonEntry[] {
  if (!entries) return [];

  const result: FlatComparisonEntry[] = [];
  for (const entry of entries) {
    const fileEntry = entry.left ?? entry.right;
    const isDir = !!entry.children || (fileEntry?.is_directory ?? false);
    const hasChildren =
      isDir && entry.children !== null && entry.children.length > 0;
    const relativePath = fileEntry?.relative_path ?? "";
    const isExpanded = expandedPaths.has(relativePath);
    const diffTypes = isDir
      ? {
          hasOrphan: entry.has_orphan_children ?? false,
          hasModified: entry.has_modified_children ?? false,
        }
      : { hasOrphan: false, hasModified: false };

    result.push({
      comparison: entry,
      depth,
      isExpanded,
      hasChildren,
      hasOrphanChildren: diffTypes.hasOrphan,
      hasModifiedChildren: diffTypes.hasModified,
    });

    if (isDir && isExpanded && entry.children) {
      const childRows = flattenComparisonTree(
        entry.children,
        expandedPaths,
        depth + 1,
      );
      for (const child of childRows) {
        result.push(child);
      }
    }
  }
  return result;
}

export function useComparisonTree(
  comparison: ComparisonEntry[] | null,
  expandedPaths: Set<string>,
) {
  const flatItems = useMemo(
    () => flattenComparisonTree(comparison, expandedPaths),
    [comparison, expandedPaths],
  );

  const scroll = useDiffScroll({
    count: flatItems.length,
    rowHeight: ROW_HEIGHT,
  });

  return {
    ...scroll,
    flatItems,
    rowHeight: ROW_HEIGHT,
  };
}
