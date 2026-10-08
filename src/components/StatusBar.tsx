import { useMemo } from "react";
import type { ComparisonEntry } from "../types";
import { useAppStore } from "../stores/appStore";

interface StatusBarProps {
  comparison: ComparisonEntry[] | null;
}

interface Counts {
  identical: number;
  metadata: number;
  modified: number;
  leftOnly: number;
  rightOnly: number;
}

function countStatuses(entries: ComparisonEntry[] | null): Counts {
  const counts: Counts = {
    metadata: 0,
    identical: 0,
    modified: 0,
    leftOnly: 0,
    rightOnly: 0,
  };
  if (!entries) return counts;

  for (const entry of entries) {
    switch (entry.status) {
      case "MetadataMatch":
        counts.metadata++;
        break;
      case "Identical":
        counts.identical++;
        break;
      case "Modified":
        counts.modified++;
        break;
      case "LeftOnly":
      case "DirectoryLeftOnly":
        counts.leftOnly++;
        break;
      case "RightOnly":
      case "DirectoryRightOnly":
        counts.rightOnly++;
        break;
    }
    if (entry.children) {
      const childCounts = countStatuses(entry.children);
      counts.metadata += childCounts.metadata;
      counts.identical += childCounts.identical;
      counts.modified += childCounts.modified;
      counts.leftOnly += childCounts.leftOnly;
      counts.rightOnly += childCounts.rightOnly;
    }
  }
  return counts;
}

export function StatusBar({ comparison }: StatusBarProps) {
  const counts = useMemo(() => countStatuses(comparison), [comparison]);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (activeTab && activeTab.kind === "file-compare") {
    return (
      <div className="flex items-center h-7 px-4 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 truncate">
        {activeTab.leftFilePath}
        <span className="mx-1 text-gray-400">{"\u2194"}</span>
        {activeTab.rightFilePath}
      </div>
    );
  }

  if (!comparison) {
    return (
      <div className="flex items-center h-7 px-4 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
        Select two folders and click Compare
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 h-7 px-4 bg-gray-50 border-t border-gray-200 text-xs">
      <span className="text-gray-600">
        {counts.identical} verified identical
      </span>
      <span className="text-gray-600">{counts.metadata} metadata matches</span>
      <span className="text-amber-600">{counts.modified} modified</span>
      <span className="text-purple-600">{counts.leftOnly} left-only</span>
      <span className="text-purple-600">{counts.rightOnly} right-only</span>
    </div>
  );
}
