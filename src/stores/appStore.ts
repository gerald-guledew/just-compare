import { create } from "zustand";
import type { ComparisonEntry, ComparisonMode } from "../types";
import {
  savePaths,
  saveComparisonMode,
  saveWordWrap,
} from "../lib/persistence";
import type { Terminator, YellowRange } from "../lib/splice";
import { shiftYellowRanges, spliceLines } from "../lib/splice";

export interface ColumnWidths {
  size: number;
  modified: number;
}

export const FOLDER_TAB_ID = "folder";
export const INITIAL_TAB_ID = "compare";

export type Side = "left" | "right";

export type Tab =
  | { id: string; kind: "compare" }
  | { id: string; kind: "folder-compare" }
  | {
      id: string;
      kind: "file-compare";
      leftFilePath: string;
      rightFilePath: string;
      displayName: string;
    };

export interface FolderTabState {
  leftPath: string | null;
  rightPath: string | null;
  comparison: ComparisonEntry[] | null;
  comparisonMode: ComparisonMode;
  error: string | null;
  comparisonWarnings: string[];
  expandedPaths: Set<string>;
  selectedPaths: Set<string>;
  selectionAnchor: string | null;
}

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

function filePairLabel(leftFilePath: string, rightFilePath: string): string {
  const leftName = basename(leftFilePath);
  const rightName = basename(rightFilePath);
  if (!leftName && !rightName) return "File Compare";
  if (!leftName) return rightName;
  if (!rightName || leftName === rightName) return leftName;
  return `${leftName} ↔ ${rightName}`;
}

export interface AppState {
  leftPath: string | null;
  rightPath: string | null;
  comparison: ComparisonEntry[] | null;
  comparing: boolean;
  operating: boolean;
  comparisonMode: ComparisonMode;
  wordWrap: boolean;
  comparisonWarnings: string[];
  setComparisonMode: (mode: ComparisonMode) => void;
  setWordWrap: (wordWrap: boolean) => void;
  error: string | null;
  expandedPaths: Set<string>;
  columnWidths: ColumnWidths;

  selectedPaths: Set<string>;
  selectionAnchor: string | null;

  tabs: Tab[];
  activeTabId: string;
  folderTabs: Record<string, FolderTabState>;
  comparisonContextVersion: number;
  tabLifecycleVersion: number;

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
  openFilePairTab: (leftFilePath: string, rightFilePath: string) => void;
  newCompareTab: () => void;
  selectComparisonPath: (
    tabId: string,
    side: Side,
    path: string,
    kind: "file" | "folder",
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

function emptyFolderState(comparisonMode: ComparisonMode): FolderTabState {
  return {
    leftPath: null,
    rightPath: null,
    comparison: null,
    comparisonMode,
    error: null,
    comparisonWarnings: [],
    expandedPaths: new Set<string>(),
    selectedPaths: new Set<string>(),
    selectionAnchor: null,
  };
}

function folderSnapshot(state: AppState): FolderTabState {
  return {
    leftPath: state.leftPath,
    rightPath: state.rightPath,
    comparison: state.comparison,
    comparisonMode: state.comparisonMode,
    error: state.error,
    comparisonWarnings: state.comparisonWarnings,
    expandedPaths: state.expandedPaths,
    selectedPaths: state.selectedPaths,
    selectionAnchor: state.selectionAnchor,
  };
}

export function selectActiveFolderTab(state: AppState) {
  return state.tabs.find(
    (tab): tab is Extract<Tab, { kind: "folder-compare" }> =>
      tab.id === state.activeTabId && tab.kind === "folder-compare",
  );
}

function snapshotFolderTabs(state: AppState): Record<string, FolderTabState> {
  if (!selectActiveFolderTab(state)) return state.folderTabs;
  return { ...state.folderTabs, [state.activeTabId]: folderSnapshot(state) };
}

function activateTab(
  state: AppState,
  tab: Tab,
  folderTabs = snapshotFolderTabs(state),
): Partial<AppState> {
  const folder =
    tab.kind === "folder-compare"
      ? (folderTabs[tab.id] ?? emptyFolderState(state.comparisonMode))
      : tab.kind === "compare"
        ? emptyFolderState(state.comparisonMode)
        : undefined;
  return {
    ...folder,
    folderTabs,
    activeTabId: tab.id,
    comparing: false,
    comparisonContextVersion: state.comparisonContextVersion + 1,
    tabLifecycleVersion: state.tabLifecycleVersion + 1,
  };
}

export const useAppStore = create<AppState>()((set, get) => ({
  leftPath: null,
  rightPath: null,
  comparison: null,
  comparing: false,
  operating: false,
  comparisonMode: "Quick",
  wordWrap: false,
  comparisonWarnings: [],
  setComparisonMode: (mode) => {
    set({
      comparisonMode: mode,
      comparison: null,
      comparisonWarnings: [],
      selectedPaths: new Set(),
      selectionAnchor: null,
      comparing: false,
      comparisonContextVersion: get().comparisonContextVersion + 1,
    });
    saveComparisonMode(mode).catch(console.error);
  },
  setWordWrap: (wordWrap) => {
    set({ wordWrap });
    saveWordWrap(wordWrap).catch(console.error);
  },
  error: null,
  expandedPaths: new Set<string>(),
  columnWidths: { size: 96, modified: 160 },
  selectedPaths: new Set<string>(),
  selectionAnchor: null,

  tabs: [{ id: INITIAL_TAB_ID, kind: "compare" }],
  activeTabId: INITIAL_TAB_ID,
  folderTabs: {},
  comparisonContextVersion: 0,
  tabLifecycleVersion: 0,

  fileTabs: {},
  saveConflict: null,

  setLeftPath: (path) => {
    set({
      leftPath: path,
      comparison: null,
      comparisonWarnings: [],
      selectedPaths: new Set(),
      selectionAnchor: null,
      expandedPaths: new Set(),
      error: null,
      comparing: false,
      comparisonContextVersion: get().comparisonContextVersion + 1,
    });
    savePaths(path, get().rightPath).catch(console.error);
  },
  setRightPath: (path) => {
    set({
      rightPath: path,
      comparison: null,
      comparisonWarnings: [],
      selectedPaths: new Set(),
      selectionAnchor: null,
      expandedPaths: new Set(),
      error: null,
      comparing: false,
      comparisonContextVersion: get().comparisonContextVersion + 1,
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
    get().openFilePairTab(
      `${leftFolder}/${relativePath}`,
      `${rightFolder}/${relativePath}`,
    );
  },
  openFilePairTab: (leftFilePath, rightFilePath) => {
    const state = get();
    if (state.operating) return;
    const existing = state.tabs.find(
      (t) =>
        t.kind === "file-compare" &&
        t.leftFilePath === leftFilePath &&
        t.rightFilePath === rightFilePath,
    );
    if (existing) {
      get().setActiveTab(existing.id);
      return;
    }
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    const newTab: Tab = {
      id: active?.kind === "compare" ? active.id : crypto.randomUUID(),
      kind: "file-compare",
      leftFilePath,
      rightFilePath,
      displayName: filePairLabel(leftFilePath, rightFilePath),
    };
    set({
      ...activateTab(state, newTab),
      tabs:
        active?.kind === "compare"
          ? state.tabs.map((tab) => (tab.id === active.id ? newTab : tab))
          : [...state.tabs, newTab],
    });
  },
  newCompareTab: () => {
    const state = get();
    if (state.operating) return;
    const tab: Tab = { id: crypto.randomUUID(), kind: "compare" };
    set({ ...activateTab(state, tab), tabs: [...state.tabs, tab] });
  },
  selectComparisonPath: (tabId, side, path, kind) => {
    const state = get();
    if (state.operating) return;
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || !path) return;
    if (kind === "file") {
      if (tab.kind === "folder-compare") return;
      if (tab.kind === "file-compare") {
        get().setTabFilePath(tabId, side, path);
        return;
      }
      const leftFilePath = side === "left" ? path : "";
      const rightFilePath = side === "right" ? path : "";
      const fileTab: Tab = {
        id: tabId,
        kind: "file-compare",
        leftFilePath,
        rightFilePath,
        displayName: filePairLabel(leftFilePath, rightFilePath),
      };
      set({
        tabs: state.tabs.map((item) => (item.id === tabId ? fileTab : item)),
      });
      return;
    }
    if (tab.kind === "file-compare") return;
    const previous =
      tab.kind === "compare"
        ? emptyFolderState(state.comparisonMode)
        : tabId === state.activeTabId
          ? folderSnapshot(state)
          : (state.folderTabs[tabId] ?? emptyFolderState(state.comparisonMode));
    const folder: FolderTabState = {
      ...previous,
      [side === "left" ? "leftPath" : "rightPath"]: path,
      comparison: null,
      error: null,
      comparisonWarnings: [],
      expandedPaths: new Set(),
      selectedPaths: new Set(),
      selectionAnchor: null,
    };
    const folderTab: Tab = { id: tabId, kind: "folder-compare" };
    set({
      ...(tabId === state.activeTabId
        ? {
            ...folder,
            comparing: false,
            comparisonContextVersion: state.comparisonContextVersion + 1,
          }
        : {}),
      tabs: state.tabs.map((item) => (item.id === tabId ? folderTab : item)),
      folderTabs: { ...state.folderTabs, [tabId]: folder },
    });
    savePaths(folder.leftPath, folder.rightPath).catch(console.error);
  },
  closeTab: (id) => {
    set((state) => {
      if (state.operating) return state;
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return state;
      const nextTabs = state.tabs.filter((t) => t.id !== id);
      const { [id]: _omit, ...restTabs } = state.fileTabs;
      const { [id]: _folder, ...folderTabs } = snapshotFolderTabs(state);
      if (nextTabs.length === 0) {
        return {
          ...emptyFolderState(state.comparisonMode),
          tabs: [{ id: INITIAL_TAB_ID, kind: "compare" }],
          activeTabId: INITIAL_TAB_ID,
          fileTabs: restTabs,
          folderTabs: {},
          comparing: false,
          comparisonContextVersion: state.comparisonContextVersion + 1,
          tabLifecycleVersion: state.tabLifecycleVersion + 1,
        };
      }
      const nextActive = nextTabs[Math.max(0, idx - 1)];
      return {
        ...(state.activeTabId === id
          ? activateTab(state, nextActive, folderTabs)
          : { folderTabs }),
        tabs: nextTabs,
        fileTabs: restTabs,
      };
    });
  },
  setActiveTab: (id) => {
    const state = get();
    if (state.operating || state.activeTabId === id) return;
    const tab = state.tabs.find((candidate) => candidate.id === id);
    if (tab) set(activateTab(state, tab));
  },

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
      if (state.operating) return state;
      const target = state.tabs.find((tab) => tab.id === tabId);
      if (target?.kind !== "file-compare") return state;
      const currentPath =
        side === "left" ? target.leftFilePath : target.rightFilePath;
      if (currentPath === newPath) return state;
      const tabs = state.tabs.map((t) => {
        if (t.id !== tabId || t.kind !== "file-compare") return t;
        const leftFilePath = side === "left" ? newPath : t.leftFilePath;
        const rightFilePath = side === "right" ? newPath : t.rightFilePath;
        const updated: Tab = {
          ...t,
          leftFilePath,
          rightFilePath,
          displayName: filePairLabel(leftFilePath, rightFilePath),
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
