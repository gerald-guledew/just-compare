import { create } from "zustand";
import type { ComparisonEntry, ComparisonMode } from "../types";
import { savePaths, saveComparisonMode } from "../lib/persistence";
import type { Terminator, YellowRange } from "../lib/splice";
import { shiftYellowRanges, spliceLines } from "../lib/splice";

export interface ColumnWidths {
  size: number;
  modified: number;
}

export const FOLDER_TAB_ID = "folder";

export type Side = "left" | "right";

export type Tab =
  | { id: typeof FOLDER_TAB_ID; kind: "folder-compare" }
  | {
      id: string;
      kind: "file-compare";
      leftFilePath: string;
      rightFilePath: string;
      displayName: string;
    };

export interface SetComparisonOptions {
  preserveExpanded?: boolean;
}

export interface FileTabBuffer {
  documentId: string;
  revision: number;
  canonicalPath: string;
  diskVersion: string;
  bom: boolean;
  saving: boolean;
  operationError: string | null;
  text: string;
  diskText: string;
  mtimeMs: number;
  terminator: Terminator;
  dirty: boolean;
  yellowRanges: YellowRange[];
  diskStale: boolean;
}

export interface FileTabState {
  left: FileTabBuffer | null;
  right: FileTabBuffer | null;
  leftError: string | null;
  rightError: string | null;
}

export interface BufferMergeArgs {
  actualText?: string;
  side: Side;
  start: number; // 1-indexed inclusive
  end: number; // 1-indexed exclusive
  replacement: string[];
}

export interface BufferEdit {
  start: number; // 1-indexed inclusive
  end: number; // 1-indexed exclusive
  replacementCount: number;
}

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

interface AppState {
  leftPath: string | null;
  rightPath: string | null;
  comparison: ComparisonEntry[] | null;
  comparing: boolean;
  operating: boolean;
  comparisonMode: ComparisonMode;
  comparisonWarnings: string[];
  setComparisonMode: (mode: ComparisonMode) => void;
  error: string | null;
  expandedPaths: Set<string>;
  columnWidths: ColumnWidths;

  selectedPaths: Set<string>;
  selectionAnchor: string | null;

  tabs: Tab[];
  activeTabId: string;

  fileTabs: Record<string, FileTabState>;
  saveConflict: { path: string; message: string } | null;

  setLeftPath: (path: string | null) => void;
  setRightPath: (path: string | null) => void;
  setComparison: (
    comparison: ComparisonEntry[] | null,
    options?: SetComparisonOptions,
  ) => void;
  setError: (error: string | null) => void;
  toggleExpanded: (relativePath: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  setColumnWidths: (widths: ColumnWidths) => void;

  clearSelection: () => void;
  setSelection: (paths: string[]) => void;
  toggleSelection: (path: string) => void;
  extendSelectionTo: (path: string, flatPaths: string[]) => void;

  openFileCompareTab: (
    leftFolder: string,
    rightFolder: string,
    relativePath: string,
  ) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  initFileTab: (tabId: string) => void;
  setFileTabBuffer: (tabId: string, side: Side, buf: FileTabBuffer) => void;
  setLoadError: (tabId: string, side: Side, err: string | null) => void;
  setTabFilePath: (tabId: string, side: Side, newPath: string) => void;
  applyBufferMerge: (tabId: string, args: BufferMergeArgs) => void;
  setFileTabBufferText: (
    tabId: string,
    side: Side,
    newText: string,
    edit: BufferEdit | null,
  ) => void;
  markSaved: (
    tabId: string,
    side: Side,
    newMtimeMs: number,
    savedText: string,
    documentId: string,
    diskVersion: string,
  ) => void;
}

function collectDirPaths(
  entries: ComparisonEntry[] | null,
  paths: Set<string>,
) {
  if (!entries) return;
  for (const entry of entries) {
    const fileEntry = entry.left ?? entry.right;
    if (fileEntry?.is_directory) {
      paths.add(fileEntry.relative_path);
      collectDirPaths(entry.children, paths);
    }
  }
}

function retainExistingDirPaths(
  comparison: ComparisonEntry[] | null,
  previousExpanded: Set<string>,
): Set<string> {
  const validDirPaths = new Set<string>();
  collectDirPaths(comparison, validDirPaths);
  return new Set(
    [...previousExpanded].filter((path) => validDirPaths.has(path)),
  );
}

function ensureTabState(
  fileTabs: Record<string, FileTabState>,
  tabId: string,
): FileTabState {
  return (
    fileTabs[tabId] ?? {
      left: null,
      right: null,
      leftError: null,
      rightError: null,
    }
  );
}

function updateBuffer(
  tab: FileTabState,
  side: Side,
  update: (buf: FileTabBuffer) => FileTabBuffer,
): FileTabState {
  const buf = tab[side];
  if (!buf) return tab;
  return { ...tab, [side]: update(buf) };
}

export const useAppStore = create<AppState>()((set, get) => ({
  leftPath: null,
  rightPath: null,
  comparison: null,
  comparing: false,
  operating: false,
  comparisonMode: "Quick",
  comparisonWarnings: [],
  setComparisonMode: (mode) => {
    set({
      comparisonMode: mode,
      comparison: null,
      comparisonWarnings: [],
      selectedPaths: new Set(),
      comparing: false,
    });
    saveComparisonMode(mode).catch(console.error);
  },
  error: null,
  expandedPaths: new Set<string>(),
  columnWidths: { size: 96, modified: 160 },
  selectedPaths: new Set<string>(),
  selectionAnchor: null,

  tabs: [{ id: FOLDER_TAB_ID, kind: "folder-compare" }],
  activeTabId: FOLDER_TAB_ID,

  fileTabs: {},
  saveConflict: null,

  setLeftPath: (path) => {
    set({
      leftPath: path,
      comparison: null,
      comparisonWarnings: [],
      selectedPaths: new Set(),
    });
    savePaths(path, get().rightPath).catch(console.error);
  },
  setRightPath: (path) => {
    set({
      rightPath: path,
      comparison: null,
      comparisonWarnings: [],
      selectedPaths: new Set(),
    });
    savePaths(get().leftPath, path).catch(console.error);
  },
  setComparison: (comparison, options) =>
    set((state) => ({
      comparison,
      expandedPaths: options?.preserveExpanded
        ? retainExistingDirPaths(comparison, state.expandedPaths)
        : new Set<string>(),
      selectedPaths: new Set<string>(),
      selectionAnchor: null,
    })),
  setError: (error) => set({ error }),
  toggleExpanded: (relativePath) =>
    set((state) => {
      const next = new Set(state.expandedPaths);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return { expandedPaths: next };
    }),
  expandAll: () =>
    set((state) => {
      const paths = new Set<string>();
      collectDirPaths(state.comparison, paths);
      return { expandedPaths: paths };
    }),
  collapseAll: () => set({ expandedPaths: new Set<string>() }),
  setColumnWidths: (widths) => set({ columnWidths: widths }),

  clearSelection: () =>
    set({ selectedPaths: new Set<string>(), selectionAnchor: null }),
  setSelection: (paths) =>
    set({
      selectedPaths: new Set(paths),
      selectionAnchor: paths[paths.length - 1] ?? null,
    }),
  toggleSelection: (path) =>
    set((state) => {
      const next = new Set(state.selectedPaths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { selectedPaths: next, selectionAnchor: path };
    }),
  extendSelectionTo: (path, flatPaths) =>
    set((state) => {
      const anchor = state.selectionAnchor ?? path;
      const startIdx = flatPaths.indexOf(anchor);
      const endIdx = flatPaths.indexOf(path);
      if (startIdx < 0 || endIdx < 0) {
        return {
          selectedPaths: new Set([path]),
          selectionAnchor: path,
        };
      }
      const [lo, hi] =
        startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const range = flatPaths.slice(lo, hi + 1);
      return { selectedPaths: new Set(range), selectionAnchor: path };
    }),

  openFileCompareTab: (leftFolder, rightFolder, relativePath) => {
    const leftFilePath = `${leftFolder}/${relativePath}`;
    const rightFilePath = `${rightFolder}/${relativePath}`;
    const existing = get().tabs.find(
      (t) =>
        t.kind === "file-compare" &&
        t.leftFilePath === leftFilePath &&
        t.rightFilePath === rightFilePath,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const newTab: Tab = {
      id: crypto.randomUUID(),
      kind: "file-compare",
      leftFilePath,
      rightFilePath,
      displayName: basename(relativePath),
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
  },
  closeTab: (id) => {
    if (id === FOLDER_TAB_ID) return;
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return state;
      const nextTabs = state.tabs.filter((t) => t.id !== id);
      let nextActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        nextActiveId = nextTabs[Math.max(0, idx - 1)]?.id ?? FOLDER_TAB_ID;
      }
      const { [id]: _omit, ...restTabs } = state.fileTabs;
      return {
        tabs: nextTabs,
        activeTabId: nextActiveId,
        fileTabs: restTabs,
      };
    });
  },
  setActiveTab: (id) => set({ activeTabId: id }),

  initFileTab: (tabId) =>
    set((state) => {
      if (state.fileTabs[tabId]) return state;
      return {
        fileTabs: {
          ...state.fileTabs,
          [tabId]: {
            left: null,
            right: null,
            leftError: null,
            rightError: null,
          },
        },
      };
    }),
  setFileTabBuffer: (tabId, side, buf) =>
    set((state) => {
      const tab = ensureTabState(state.fileTabs, tabId);
      const errorKey = side === "left" ? "leftError" : "rightError";
      const nextTab: FileTabState = {
        ...tab,
        [side]: buf,
        [errorKey]: null,
      };
      return {
        fileTabs: { ...state.fileTabs, [tabId]: nextTab },
      };
    }),
  setLoadError: (tabId, side, err) =>
    set((state) => {
      const tab = ensureTabState(state.fileTabs, tabId);
      const errorKey = side === "left" ? "leftError" : "rightError";
      const nextTab: FileTabState = {
        ...tab,
        [errorKey]: err,
      };
      return {
        fileTabs: { ...state.fileTabs, [tabId]: nextTab },
      };
    }),
  setTabFilePath: (tabId, side, newPath) =>
    set((state) => {
      const tabs = state.tabs.map((t) => {
        if (t.id !== tabId || t.kind !== "file-compare") return t;
        const updated: Tab = {
          ...t,
          leftFilePath: side === "left" ? newPath : t.leftFilePath,
          rightFilePath: side === "right" ? newPath : t.rightFilePath,
        };
        return updated;
      });

      const existing = state.fileTabs[tabId];
      if (!existing) return { tabs };
      const errorKey = side === "left" ? "leftError" : "rightError";
      const nextTabState: FileTabState = {
        ...existing,
        [side]: null,
        [errorKey]: null,
      };
      return {
        tabs,
        fileTabs: { ...state.fileTabs, [tabId]: nextTabState },
      };
    }),
  applyBufferMerge: (tabId, args) =>
    set((state) => {
      const tab = state.fileTabs[tabId];
      if (!tab) return state;
      const buf = tab[args.side];
      if (!buf) return state;

      const nextText =
        args.actualText ??
        spliceLines(
          buf.text,
          args.start,
          args.end,
          args.replacement,
          buf.terminator,
        );
      const shifted = shiftYellowRanges(buf.yellowRanges, {
        start: args.start,
        end: args.end,
        replacementCount: args.replacement.length,
      });
      const newRange: YellowRange = {
        start: args.start,
        end: args.start + args.replacement.length,
      };
      const nextYellow =
        newRange.end > newRange.start ? [...shifted, newRange] : shifted;

      const nextBuf: FileTabBuffer = {
        ...buf,
        text: nextText,
        revision: buf.revision + 1,
        yellowRanges: nextYellow,
        dirty: nextText !== buf.diskText,
      };

      return {
        fileTabs: {
          ...state.fileTabs,
          [tabId]: {
            ...tab,
            [args.side]: nextBuf,
          },
        },
      };
    }),
  setFileTabBufferText: (tabId, side, newText, edit) =>
    set((state) => {
      const tab = state.fileTabs[tabId];
      if (!tab) return state;
      const buf = tab[side];
      if (!buf) return state;
      if (buf.text === newText) return state;

      // Yellow-range provenance: a non-overlapping line edit shifts ranges;
      // an overlapping edit drops them (handled inside shiftYellowRanges).
      // edit=null is the multi-event fallback (find-replace-all, multi-cursor):
      // drop everything to stay correct rather than guess.
      const nextYellow = edit ? shiftYellowRanges(buf.yellowRanges, edit) : [];

      // Terminator stays pinned to whatever the file was loaded as. A stray
      // CRLF paste into an LF file must not flip the on-disk encoding at save.
      const nextBuf: FileTabBuffer = {
        ...buf,
        text: newText,
        revision: buf.revision + 1,
        yellowRanges: nextYellow,
        dirty: newText !== buf.diskText,
      };

      return {
        fileTabs: {
          ...state.fileTabs,
          [tabId]: { ...tab, [side]: nextBuf },
        },
      };
    }),
  markSaved: (tabId, side, newMtimeMs, savedText, documentId, diskVersion) =>
    set((state) => {
      const tab = state.fileTabs[tabId];
      if (!tab || tab[side]?.documentId !== documentId) return state;
      const next = updateBuffer(tab, side, (buf) => ({
        ...buf,
        diskText: savedText,
        diskVersion,
        mtimeMs: newMtimeMs,
        dirty: buf.text !== savedText,
        yellowRanges: buf.text === savedText ? [] : buf.yellowRanges,
        saving: false,
        operationError: null,
        diskStale: false,
      }));
      return {
        fileTabs: { ...state.fileTabs, [tabId]: next },
      };
    }),
}));

export function selectIsTabDirty(state: AppState, tabId: string): boolean {
  const tab = state.fileTabs[tabId];
  if (!tab) return false;
  return !!(tab.left?.dirty || tab.right?.dirty);
}
