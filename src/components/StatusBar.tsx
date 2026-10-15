import { useMemo } from "react";
import type { ComparisonEntry } from "../types";
import { useAppStore } from "../stores/appStore";
import { documentStats, type DiffStats } from "../lib/fileStats";
import { folderStats } from "../lib/folderStats";

export interface FileDiffSummary {
  tabId: string;
  left: { documentId: string; revision: number } | null;
  right: { documentId: string; revision: number } | null;
  loading: boolean;
  error: boolean;
  differences: DiffStats | null;
}

interface StatusBarProps {
  comparison: ComparisonEntry[] | null;
  fileDiff?: FileDiffSummary | null;
}

export function StatusBar({ comparison, fileDiff }: StatusBarProps) {
  const counts = useMemo(() => folderStats(comparison), [comparison]);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const fileTab = useAppStore((s) => s.fileTabs[activeTabId]);
  const leftStats = useMemo(
    () => (fileTab?.left ? documentStats(fileTab.left.text) : null),
    [fileTab?.left?.text],
  );
  const rightStats = useMemo(
    () => (fileTab?.right ? documentStats(fileTab.right.text) : null),
    [fileTab?.right?.text],
  );

  if (activeTab?.kind === "compare") {
    return (
      <div className="flex items-center h-7 px-4 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
        Choose two files or two folders to compare
      </div>
    );
  }

  if (activeTab && activeTab.kind === "file-compare") {
    const currentDiff =
      fileDiff?.tabId === activeTabId &&
      fileDiff.left?.documentId === fileTab?.left?.documentId &&
      fileDiff.left?.revision === fileTab?.left?.revision &&
      fileDiff.right?.documentId === fileTab?.right?.documentId &&
      fileDiff.right?.revision === fileTab?.right?.revision
        ? fileDiff
        : null;
    const differences = currentDiff?.differences;
    const comparisonFailed = !!(
      fileTab?.leftError ||
      fileTab?.rightError ||
      currentDiff?.error
    );
    return (
      <div
        role="group"
        aria-label="File comparison summary"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 min-h-7 shrink-0 px-3 py-1 bg-gray-50 border-t border-gray-200 text-xs text-gray-600"
      >
        <span title="Counts for the current left editor text">
          {leftStats
            ? `Left: ${quantity(leftStats.lines, "line")} · ${quantity(leftStats.words, "word")}`
            : fileTab?.leftError
              ? "Left: unavailable"
              : activeTab.leftFilePath
                ? "Loading left file…"
                : "Choose a left file"}
        </span>
        <span title="Counts for the current right editor text">
          {rightStats
            ? `Right: ${quantity(rightStats.lines, "line")} · ${quantity(rightStats.words, "word")}`
            : fileTab?.rightError
              ? "Right: unavailable"
              : activeTab.rightFilePath
                ? "Loading right file…"
                : "Choose a right file"}
        </span>
        <span title="Counts compare aligned positions in both files, including blank lines. Adjacent differences form a group. Left-only and right-only lines have no matching line at that position on the other side. Moved text can count on both sides at different positions.">
          {comparisonFailed
            ? "Comparison unavailable"
            : !leftStats || !rightStats
              ? "Waiting for both files"
              : !currentDiff || currentDiff.loading || !differences
                ? "Comparing…"
                : differences.blocks === 0
                  ? "Identical text"
                  : `${quantity(differences.blocks, "difference group")} · ${quantity(differences.changed, "changed line pair")} · ${quantity(differences.leftOnly, "left-only line")} · ${quantity(differences.rightOnly, "right-only line")}`}
        </span>
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
    <div
      role="group"
      aria-label="Folder comparison summary"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 min-h-7 shrink-0 px-3 py-1 bg-gray-50 border-t border-gray-200 text-xs"
    >
      <span
        className="text-gray-500"
        title="Counts include all nested items, even inside collapsed folders. Matched paths count once."
      >
        All nested items
      </span>
      <span
        className="text-gray-600"
        title="These file pairs were confirmed identical by comparing their contents."
      >
        {quantity(counts.identical, "file")} identical by content
      </span>
      <span
        className="text-gray-600"
        title="File pairs with matching size and modification time. Their contents have not been checked."
      >
        {quantity(counts.metadata, "file")} matching size and time
      </span>
      <span className="text-amber-700">
        Modified: {quantity(counts.modified.files, "file")},{" "}
        {quantity(counts.modified.folders, "folder")}
      </span>
      <span className="text-purple-700">
        Left-only: {quantity(counts.leftOnly.files, "file")},{" "}
        {quantity(counts.leftOnly.folders, "folder")}
      </span>
      <span className="text-purple-700">
        Right-only: {quantity(counts.rightOnly.files, "file")},{" "}
        {quantity(counts.rightOnly.folders, "folder")}
      </span>
    </div>
  );
}

function quantity(count: number, label: string): string {
  return `${count.toLocaleString()} ${label}${count === 1 ? "" : "s"}`;
}
