import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOLDER_TAB_ID,
  INITIAL_TAB_ID,
  selectIsTabDirty,
  useAppStore,
  type FileTabBuffer,
} from "./appStore";
import type { ComparisonEntry, FileEntry } from "../types";
import { saveWordWrap } from "../lib/persistence";

vi.mock("../lib/persistence", () => ({
  saveComparisonMode: vi.fn().mockResolvedValue(undefined),
  saveWordWrap: vi.fn().mockResolvedValue(undefined),
  savePaths: vi.fn().mockResolvedValue(undefined),
  loadPaths: vi.fn().mockResolvedValue({ leftPath: null, rightPath: null }),
}));

function makeBuffer(overrides: Partial<FileTabBuffer> = {}): FileTabBuffer {
  return {
    documentId: "doc",
    revision: 0,
    canonicalPath: "/a",
    diskVersion: "v1",
    bom: false,
    saving: false,
    operationError: null,
    text: "a\nb\nc\n",
    diskText: "a\nb\nc\n",
    mtimeMs: 100,
    terminator: "\n",
    dirty: false,
    yellowRanges: [],
    diskStale: false,
    ...overrides,
  };
}

function makeDir(path: string): FileEntry {
  const parts = path.split("/");
  return {
    name: parts[parts.length - 1] ?? path,
    relative_path: path,
    is_directory: true,
    size: 0,
    modified: 0,
    children: [],
  };
}

function makeDirComparison(paths: string[]): ComparisonEntry[] {
  return paths.map((path) => ({
    left: makeDir(path),
    right: makeDir(path),
    status: "DirectoryBoth",
    children: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    leftPath: null,
    rightPath: null,
    comparison: null,
    comparing: false,
    wordWrap: false,
    error: null,
    expandedPaths: new Set<string>(),
    columnWidths: { size: 96, modified: 160 },
    selectedPaths: new Set<string>(),
    selectionAnchor: null,
    tabs: [{ id: FOLDER_TAB_ID, kind: "folder-compare" }],
    activeTabId: FOLDER_TAB_ID,
    fileTabs: {},
  });
});

// ------- Tier 1 -------

describe("unified comparison tabs", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it("starts with one neutral tab and no selected paths", () => {
    const state = useAppStore.getInitialState();
    expect(state.tabs).toEqual([{ id: INITIAL_TAB_ID, kind: "compare" }]);
    expect(state.activeTabId).toBe(INITIAL_TAB_ID);
    expect(state.leftPath).toBeNull();
    expect(state.rightPath).toBeNull();
    expect(state.fileTabs).toEqual({});
    expect(state.folderTabs).toEqual({});
  });

  it("uses the same tab for a first file on either side and preserves the other path", () => {
    const store = useAppStore.getState();
    store.selectComparisonPath(INITIAL_TAB_ID, "right", "/r/right.md", "file");
    expect(useAppStore.getState().tabs).toEqual([
      {
        id: INITIAL_TAB_ID,
        kind: "file-compare",
        leftFilePath: "",
        rightFilePath: "/r/right.md",
        displayName: "right.md",
      },
    ]);
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l/left.md", "file");
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      id: INITIAL_TAB_ID,
      leftFilePath: "/l/left.md",
      rightFilePath: "/r/right.md",
    });
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/folder", "folder");
    expect(useAppStore.getState().tabs[0].kind).toBe("file-compare");
  });

  it("opens a direct pair in the current neutral tab", () => {
    useAppStore.getState().openFilePairTab("/l/a.md", "/r/b.md");
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      id: INITIAL_TAB_ID,
      kind: "file-compare",
      leftFilePath: "/l/a.md",
      rightFilePath: "/r/b.md",
    });
  });

  it("creates separate neutral tabs even when every tab is empty", () => {
    const store = useAppStore.getState();
    store.newCompareTab();
    store.newCompareTab();
    const { tabs, activeTabId } = useAppStore.getState();
    expect(tabs).toHaveLength(3);
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(3);
    expect(tabs.every((tab) => tab.kind === "compare")).toBe(true);
    expect(activeTabId).toBe(tabs[2].id);
  });

  it("clears active folder globals for a neutral tab while retaining its snapshot and mode", () => {
    const store = useAppStore.getState();
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l", "folder");
    store.selectComparisonPath(INITIAL_TAB_ID, "right", "/r", "folder");
    store.setComparisonMode("Verified");
    const comparison = makeDirComparison(["src"]);
    store.setComparison(comparison);
    store.toggleExpanded("src");
    store.setSelection(["src"]);
    store.setError("Folder warning");
    useAppStore.setState({ comparisonWarnings: ["Scan warning"] });
    store.newCompareTab();
    const state = useAppStore.getState();
    expect(state.leftPath).toBeNull();
    expect(state.rightPath).toBeNull();
    expect(state.comparison).toBeNull();
    expect(state.comparisonMode).toBe("Verified");
    expect(state.error).toBeNull();
    expect(state.comparisonWarnings).toEqual([]);
    expect(state.expandedPaths).toEqual(new Set());
    expect(state.selectedPaths).toEqual(new Set());
    expect(state.selectionAnchor).toBeNull();
    expect(state.folderTabs[INITIAL_TAB_ID]).toMatchObject({
      leftPath: "/l",
      rightPath: "/r",
      comparison,
      comparisonMode: "Verified",
      error: "Folder warning",
      comparisonWarnings: ["Scan warning"],
      selectedPaths: new Set(["src"]),
    });
    store.setActiveTab(INITIAL_TAB_ID);
    expect(useAppStore.getState().comparison).toBe(comparison);
  });

  it("changes the tab lifecycle version for away-and-back switches and last-tab reset", () => {
    const store = useAppStore.getState();
    const initialVersion = useAppStore.getState().tabLifecycleVersion;
    store.newCompareTab();
    const secondId = useAppStore.getState().activeTabId;
    expect(useAppStore.getState().tabLifecycleVersion).toBe(initialVersion + 1);
    store.setActiveTab(INITIAL_TAB_ID);
    expect(useAppStore.getState().tabLifecycleVersion).toBe(initialVersion + 2);
    store.setActiveTab(secondId);
    expect(useAppStore.getState().tabLifecycleVersion).toBe(initialVersion + 3);
    store.setActiveTab(secondId);
    expect(useAppStore.getState().tabLifecycleVersion).toBe(initialVersion + 3);
    store.closeTab(INITIAL_TAB_ID);
    expect(useAppStore.getState().tabLifecycleVersion).toBe(initialVersion + 3);
    store.closeTab(secondId);
    expect(useAppStore.getState().tabLifecycleVersion).toBe(initialVersion + 4);
    expect(useAppStore.getState().activeTabId).toBe(INITIAL_TAB_ID);
  });

  it("keeps the lifecycle version stable when selecting either file side in place", () => {
    const store = useAppStore.getState();
    const version = useAppStore.getState().tabLifecycleVersion;
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l/a.md", "file");
    store.selectComparisonPath(INITIAL_TAB_ID, "right", "/r/b.md", "file");
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l/c.md", "file");
    expect(useAppStore.getState().tabLifecycleVersion).toBe(version);
  });

  it("keeps the lifecycle version stable for first folder selection, opposite side and mode", () => {
    const store = useAppStore.getState();
    const version = useAppStore.getState().tabLifecycleVersion;
    store.selectComparisonPath(INITIAL_TAB_ID, "right", "/r", "folder");
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l", "folder");
    store.setComparisonMode("Verified");
    store.setLeftPath("/changed-left");
    store.setRightPath("/changed-right");
    expect(useAppStore.getState().tabLifecycleVersion).toBe(version);
  });

  it("restores independent folder roots, results, mode, errors and selection", () => {
    const store = useAppStore.getState();
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/a/left", "folder");
    store.selectComparisonPath(INITIAL_TAB_ID, "right", "/a/right", "folder");
    store.setComparisonMode("Verified");
    const firstResult = makeDirComparison(["src"]);
    store.setComparison(firstResult);
    store.toggleExpanded("src");
    store.setSelection(["src"]);
    store.setError("First folder error");
    useAppStore.setState({ comparisonWarnings: ["First folder warning"] });
    store.newCompareTab();
    const secondId = useAppStore.getState().activeTabId;
    store.selectComparisonPath(secondId, "right", "/b/right", "folder");
    expect(useAppStore.getState().leftPath).toBeNull();
    expect(useAppStore.getState().comparison).toBeNull();
    expect(useAppStore.getState().comparisonMode).toBe("Verified");
    store.selectComparisonPath(secondId, "left", "/b/left", "folder");
    store.setComparisonMode("Quick");
    const secondResult = makeDirComparison(["docs"]);
    store.setComparison(secondResult);

    store.setActiveTab(INITIAL_TAB_ID);
    expect(useAppStore.getState()).toMatchObject({
      leftPath: "/a/left",
      rightPath: "/a/right",
      comparison: firstResult,
      comparisonMode: "Verified",
      error: "First folder error",
      comparisonWarnings: ["First folder warning"],
      expandedPaths: new Set(["src"]),
      selectedPaths: new Set(["src"]),
      selectionAnchor: "src",
      comparing: false,
    });
    store.setActiveTab(secondId);
    expect(useAppStore.getState()).toMatchObject({
      leftPath: "/b/left",
      rightPath: "/b/right",
      comparison: secondResult,
      comparisonMode: "Quick",
      error: null,
      comparisonWarnings: [],
      expandedPaths: new Set(),
      selectedPaths: new Set(),
    });
  });

  it("retains file edits across folder and neutral tab switches and closes", () => {
    const store = useAppStore.getState();
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l/a.md", "file");
    const buffer = makeBuffer({ text: "edited\n", dirty: true });
    store.setFileTabBuffer(INITIAL_TAB_ID, "left", buffer);
    store.newCompareTab();
    const folderId = useAppStore.getState().activeTabId;
    store.selectComparisonPath(folderId, "left", "/folders/left", "folder");
    store.newCompareTab();
    store.closeTab(folderId);
    store.setActiveTab(INITIAL_TAB_ID);
    expect(useAppStore.getState().fileTabs[INITIAL_TAB_ID].left).toBe(buffer);
    expect(useAppStore.getState().fileTabs[INITIAL_TAB_ID].left?.dirty).toBe(
      true,
    );
    expect(useAppStore.getState().folderTabs[folderId]).toBeUndefined();
  });

  it("restores the remaining folder comparison when closing the active folder tab", () => {
    const store = useAppStore.getState();
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/first/left", "folder");
    store.selectComparisonPath(
      INITIAL_TAB_ID,
      "right",
      "/first/right",
      "folder",
    );
    const comparison = makeDirComparison(["src"]);
    store.setComparison(comparison);
    store.newCompareTab();
    const secondId = useAppStore.getState().activeTabId;
    store.selectComparisonPath(secondId, "left", "/second/left", "folder");
    store.closeTab(secondId);
    expect(useAppStore.getState().activeTabId).toBe(INITIAL_TAB_ID);
    expect(useAppStore.getState().leftPath).toBe("/first/left");
    expect(useAppStore.getState().rightPath).toBe("/first/right");
    expect(useAppStore.getState().comparison).toBe(comparison);
    expect(useAppStore.getState().folderTabs[secondId]).toBeUndefined();
  });

  it("clears the final folder comparison and returns to one empty neutral tab", () => {
    const store = useAppStore.getState();
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l", "folder");
    store.selectComparisonPath(INITIAL_TAB_ID, "right", "/r", "folder");
    store.setComparison(makeDirComparison(["src"]));
    store.toggleExpanded("src");
    store.setSelection(["src"]);
    store.closeTab(INITIAL_TAB_ID);
    expect(useAppStore.getState()).toMatchObject({
      tabs: [{ id: INITIAL_TAB_ID, kind: "compare" }],
      activeTabId: INITIAL_TAB_ID,
      leftPath: null,
      rightPath: null,
      comparison: null,
      folderTabs: {},
      selectedPaths: new Set(),
      expandedPaths: new Set(),
    });
  });

  it("drops a final file tab's buffers when returning to the empty comparison", () => {
    const store = useAppStore.getState();
    store.openFilePairTab("/l/a", "/r/a");
    store.setFileTabBuffer(INITIAL_TAB_ID, "left", makeBuffer());
    store.closeTab(INITIAL_TAB_ID);
    expect(useAppStore.getState().tabs).toEqual([
      { id: INITIAL_TAB_ID, kind: "compare" },
    ]);
    expect(useAppStore.getState().fileTabs).toEqual({});
  });

  it("holds the operation's active folder context until the operation finishes", () => {
    const store = useAppStore.getState();
    store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l", "folder");
    store.newCompareTab();
    const secondId = useAppStore.getState().activeTabId;
    store.setActiveTab(INITIAL_TAB_ID);
    useAppStore.setState({ operating: true });
    store.setActiveTab(secondId);
    store.newCompareTab();
    store.closeTab(INITIAL_TAB_ID);
    store.openFilePairTab("/a", "/b");
    store.selectComparisonPath(INITIAL_TAB_ID, "right", "/r", "folder");
    expect(useAppStore.getState().activeTabId).toBe(INITIAL_TAB_ID);
    expect(useAppStore.getState().tabs).toHaveLength(2);
    expect(useAppStore.getState().rightPath).toBeNull();
  });
});

describe("wordWrap", () => {
  it("defaults to unwrapped text", () => {
    expect(useAppStore.getInitialState().wordWrap).toBe(false);
  });

  it("updates and persists the preference in either direction", () => {
    const store = useAppStore.getState();
    store.setWordWrap(true);
    expect(useAppStore.getState().wordWrap).toBe(true);
    expect(saveWordWrap).toHaveBeenLastCalledWith(true);

    store.setWordWrap(false);
    expect(useAppStore.getState().wordWrap).toBe(false);
    expect(saveWordWrap).toHaveBeenLastCalledWith(false);
  });

  it("retains wrap preference when switching between comparisons", () => {
    const store = useAppStore.getState();
    store.setWordWrap(true);
    store.openFilePairTab("/L/a.txt", "/R/b.txt");
    store.setActiveTab(FOLDER_TAB_ID);
    expect(useAppStore.getState().wordWrap).toBe(true);
  });
});

describe("setComparison", () => {
  it("resets expansion by default for a fresh comparison", () => {
    const store = useAppStore.getState();
    store.setComparison(makeDirComparison(["src"]));
    store.toggleExpanded("src");

    store.setComparison(makeDirComparison(["src"]));

    expect(useAppStore.getState().expandedPaths).toEqual(new Set());
  });

  it("preserves expanded directories when requested", () => {
    const store = useAppStore.getState();
    store.setComparison(makeDirComparison(["src", "docs"]));
    store.toggleExpanded("src");
    store.toggleExpanded("docs");

    store.setComparison(makeDirComparison(["src", "docs"]), {
      preserveExpanded: true,
    });

    expect(useAppStore.getState().expandedPaths).toEqual(
      new Set(["src", "docs"]),
    );
  });

  it("drops preserved expansions for directories removed by refresh", () => {
    const store = useAppStore.getState();
    store.setComparison(makeDirComparison(["src", "deleted"]));
    store.toggleExpanded("src");
    store.toggleExpanded("deleted");

    store.setComparison(makeDirComparison(["src"]), {
      preserveExpanded: true,
    });

    expect(useAppStore.getState().expandedPaths).toEqual(new Set(["src"]));
  });
});

describe("openFileCompareTab", () => {
  it("creates a tab with UUID id and joined paths", () => {
    useAppStore.getState().openFileCompareTab("/L", "/R", "sub/file.txt");
    const { tabs, activeTabId } = useAppStore.getState();
    expect(tabs).toHaveLength(2);
    const tab = tabs[1];
    if (tab.kind !== "file-compare") throw new Error("expected file tab");
    expect(tab.leftFilePath).toBe("/L/sub/file.txt");
    expect(tab.rightFilePath).toBe("/R/sub/file.txt");
    expect(tab.displayName).toBe("file.txt");
    expect(tab.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(activeTabId).toBe(tab.id);
  });

  it("focuses an existing tab instead of duplicating", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "file.txt");
    const firstId = useAppStore.getState().activeTabId;
    store.setActiveTab(FOLDER_TAB_ID);
    store.openFileCompareTab("/L", "/R", "file.txt");
    expect(useAppStore.getState().tabs).toHaveLength(2);
    expect(useAppStore.getState().activeTabId).toBe(firstId);
  });

  it("creates a separate tab when relative paths differ", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "a.txt");
    store.openFileCompareTab("/L", "/R", "b.txt");
    expect(useAppStore.getState().tabs).toHaveLength(3);
  });
});

describe("openFilePairTab", () => {
  const leftFilePath = "/docs/Gerald/HalterIntermediateEngineers.md";
  const rightFilePath = "/docs/Gerald/HalterSeniorEngineers.md";

  it("opens different filenames without a folder comparison", () => {
    useAppStore.getState().openFilePairTab(leftFilePath, rightFilePath);

    const { tabs, activeTabId, leftPath, rightPath, comparison } =
      useAppStore.getState();
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toEqual({
      id: activeTabId,
      kind: "file-compare",
      leftFilePath,
      rightFilePath,
      displayName: "HalterIntermediateEngineers.md ↔ HalterSeniorEngineers.md",
    });
    expect(leftPath).toBeNull();
    expect(rightPath).toBeNull();
    expect(comparison).toBeNull();
  });

  it("preserves existing folder roots, results and selection", () => {
    const comparison = makeDirComparison(["src"]);
    const expandedPaths = new Set(["src"]);
    const selectedPaths = new Set(["src"]);
    useAppStore.setState({
      leftPath: "/folders/left",
      rightPath: "/folders/right",
      comparison,
      expandedPaths,
      selectedPaths,
      selectionAnchor: "src",
      error: "Folder warning",
    });

    useAppStore.getState().openFilePairTab(leftFilePath, rightFilePath);

    const state = useAppStore.getState();
    expect(state.leftPath).toBe("/folders/left");
    expect(state.rightPath).toBe("/folders/right");
    expect(state.comparison).toBe(comparison);
    expect(state.expandedPaths).toBe(expandedPaths);
    expect(state.selectedPaths).toBe(selectedPaths);
    expect(state.selectionAnchor).toBe("src");
    expect(state.error).toBe("Folder warning");
  });

  it("reuses an exact pair and keeps a swapped pair separate", () => {
    const store = useAppStore.getState();
    store.openFilePairTab(leftFilePath, rightFilePath);
    const firstId = useAppStore.getState().activeTabId;
    store.openFilePairTab(rightFilePath, leftFilePath);
    const swappedId = useAppStore.getState().activeTabId;
    expect(swappedId).not.toBe(firstId);

    store.openFilePairTab(leftFilePath, rightFilePath);

    expect(useAppStore.getState().tabs).toHaveLength(3);
    expect(useAppStore.getState().activeTabId).toBe(firstId);
  });

  it("creates and reuses an empty File Compare tab", () => {
    const store = useAppStore.getState();
    store.openFilePairTab("", "");
    const id = useAppStore.getState().activeTabId;
    expect(useAppStore.getState().tabs[1]).toEqual({
      id,
      kind: "file-compare",
      leftFilePath: "",
      rightFilePath: "",
      displayName: "File Compare",
    });
    store.setActiveTab(FOLDER_TAB_ID);

    store.openFilePairTab("", "");

    expect(useAppStore.getState().tabs).toHaveLength(2);
    expect(useAppStore.getState().activeTabId).toBe(id);
  });

  it("shares existing folder file tabs with direct pairs", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "sub/file.txt");
    const id = useAppStore.getState().activeTabId;

    store.openFilePairTab("/L/sub/file.txt", "/R/sub/file.txt");

    expect(useAppStore.getState().tabs).toHaveLength(2);
    expect(useAppStore.getState().activeTabId).toBe(id);
    expect(useAppStore.getState().tabs[1]).toMatchObject({
      displayName: "file.txt",
    });
  });

  it("updates labels as either side is selected or replaced", () => {
    const store = useAppStore.getState();
    store.openFilePairTab("", "");
    const id = useAppStore.getState().activeTabId;
    const label = () => {
      const tab = useAppStore.getState().tabs.find((t) => t.id === id);
      if (tab?.kind !== "file-compare") throw new Error("expected file tab");
      return tab.displayName;
    };

    store.setTabFilePath(id, "right", rightFilePath);
    expect(label()).toBe("HalterSeniorEngineers.md");
    store.setTabFilePath(id, "left", leftFilePath);
    expect(label()).toBe(
      "HalterIntermediateEngineers.md ↔ HalterSeniorEngineers.md",
    );
    store.setTabFilePath(id, "left", "/other/HalterSeniorEngineers.md");
    expect(label()).toBe("HalterSeniorEngineers.md");
    store.setTabFilePath(id, "right", "");
    expect(label()).toBe("HalterSeniorEngineers.md");
    store.setTabFilePath(id, "left", "");
    expect(label()).toBe("File Compare");
    store.setTabFilePath(id, "left", "C:\\docs\\left.md");
    store.setTabFilePath(id, "right", "C:\\docs\\right.md");
    expect(label()).toBe("left.md ↔ right.md");
  });
});

describe("closeTab", () => {
  it("resets the last folder tab to a neutral comparison", () => {
    useAppStore.getState().closeTab(FOLDER_TAB_ID);
    expect(useAppStore.getState().tabs).toEqual([
      { id: INITIAL_TAB_ID, kind: "compare" },
    ]);
  });

  it("removes the tab and drops its fileTabs entry", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "a.txt");
    const id = useAppStore.getState().activeTabId;
    store.initFileTab(id);
    expect(useAppStore.getState().fileTabs[id]).toBeDefined();
    store.closeTab(id);
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useAppStore.getState().fileTabs[id]).toBeUndefined();
  });

  it("shifts active to the previous tab when closing active", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "a.txt");
    const a = useAppStore.getState().activeTabId;
    store.openFileCompareTab("/L", "/R", "b.txt");
    const b = useAppStore.getState().activeTabId;
    store.closeTab(b);
    expect(useAppStore.getState().activeTabId).toBe(a);
  });

  it("leaves activeTabId unchanged when closing a non-active tab", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "a.txt");
    const a = useAppStore.getState().activeTabId;
    store.openFileCompareTab("/L", "/R", "b.txt");
    const b = useAppStore.getState().activeTabId;
    store.setActiveTab(b);
    store.closeTab(a);
    expect(useAppStore.getState().activeTabId).toBe(b);
  });

  it("falls back to folder tab when closing the only file tab", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "a.txt");
    const id = useAppStore.getState().activeTabId;
    store.closeTab(id);
    expect(useAppStore.getState().activeTabId).toBe(FOLDER_TAB_ID);
  });
});

describe("initFileTab", () => {
  it("creates an empty document state", () => {
    useAppStore.getState().initFileTab("t1");
    const tab = useAppStore.getState().fileTabs["t1"];
    expect(tab).toBeDefined();
    expect(tab.left).toBeNull();
    expect(tab.right).toBeNull();
    expect(tab.leftError).toBeNull();
    expect(tab.rightError).toBeNull();
  });

  it("is idempotent — a second call does not clobber existing state", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer("t1", "left", makeBuffer({ text: "marker\n" }));
    store.initFileTab("t1");
    expect(useAppStore.getState().fileTabs["t1"].left?.text).toBe("marker\n");
  });
});

describe("setFileTabBuffer", () => {
  it("stores the buffer and clears that side's error", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setLoadError("t1", "left", "missing");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    const tab = useAppStore.getState().fileTabs["t1"];
    expect(tab.left).not.toBeNull();
    expect(tab.leftError).toBeNull();
  });

  it("leaves the other side's error untouched", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setLoadError("t1", "right", "bad");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    expect(useAppStore.getState().fileTabs["t1"].rightError).toBe("bad");
  });

  it("loads each side without replacing the other buffer", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    const left = useAppStore.getState().fileTabs["t1"].left;
    expect(useAppStore.getState().fileTabs["t1"].right).toBeNull();
    store.setFileTabBuffer("t1", "right", makeBuffer());
    expect(useAppStore.getState().fileTabs["t1"].left).toBe(left);
  });

  it("retains the load error when the other side loads", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setLoadError("t1", "left", "no-file");
    store.setFileTabBuffer("t1", "right", makeBuffer());
    expect(useAppStore.getState().fileTabs["t1"].leftError).toBe("no-file");
    expect(useAppStore.getState().fileTabs["t1"].right).not.toBeNull();
  });
});

describe("setLoadError", () => {
  it("writes only to the matching side", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setLoadError("t1", "left", "boom");
    const tab = useAppStore.getState().fileTabs["t1"];
    expect(tab.leftError).toBe("boom");
    expect(tab.rightError).toBeNull();
  });

  it("retains independent errors on both sides", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setLoadError("t1", "left", "x");
    store.setLoadError("t1", "right", "y");
    expect(useAppStore.getState().fileTabs["t1"].leftError).toBe("x");
    expect(useAppStore.getState().fileTabs["t1"].rightError).toBe("y");
  });
});

describe("setTabFilePath", () => {
  it("updates only the matching side's path in the tabs array", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "a.txt");
    const id = useAppStore.getState().activeTabId;
    store.setTabFilePath(id, "left", "/L2/new.txt");
    const tab = useAppStore.getState().tabs.find((t) => t.id === id);
    if (!tab || tab.kind !== "file-compare") throw new Error();
    expect(tab.leftFilePath).toBe("/L2/new.txt");
    expect(tab.rightFilePath).toBe("/R/a.txt");
  });

  it("clears that side's buffer and error while preserving the other side", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "a.txt");
    const id = useAppStore.getState().activeTabId;
    store.initFileTab(id);
    store.setFileTabBuffer(id, "left", makeBuffer({ text: "l\n" }));
    store.setFileTabBuffer(id, "right", makeBuffer({ text: "r\n" }));
    store.setLoadError(id, "left", "stale");
    store.setTabFilePath(id, "left", "/L/new.txt");
    const ft = useAppStore.getState().fileTabs[id];
    expect(ft.left).toBeNull();
    expect(ft.leftError).toBeNull();
    expect(ft.right?.text).toBe("r\n");
  });

  it("still updates tabs when fileTabs has no entry for the id", () => {
    const store = useAppStore.getState();
    store.openFileCompareTab("/L", "/R", "a.txt");
    const id = useAppStore.getState().activeTabId;
    store.setTabFilePath(id, "right", "/R/new.txt");
    const tab = useAppStore.getState().tabs.find((t) => t.id === id);
    if (!tab || tab.kind !== "file-compare") throw new Error();
    expect(tab.rightFilePath).toBe("/R/new.txt");
  });
});

// ------- Tier 2 -------

describe("applyBufferMerge", () => {
  it("splices text, appends yellow range, flips dirty", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    store.applyBufferMerge("t1", {
      side: "left",
      start: 2,
      end: 3,
      replacement: ["X", "Y"],
    });
    const tab = useAppStore.getState().fileTabs["t1"];
    expect(tab.left?.text).toBe("a\nX\nY\nc\n");
    expect(tab.left?.yellowRanges).toEqual([{ start: 2, end: 4 }]);
    expect(tab.left?.dirty).toBe(true);
  });

  it("is a no-op when the buffer is missing on that side", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.applyBufferMerge("t1", {
      side: "left",
      start: 1,
      end: 2,
      replacement: ["X"],
    });
    const tab = useAppStore.getState().fileTabs["t1"];
    expect(tab.left).toBeNull();
  });

  it("is a no-op when the tab does not exist", () => {
    useAppStore.getState().applyBufferMerge("missing", {
      side: "left",
      start: 1,
      end: 2,
      replacement: ["X"],
    });
    expect(useAppStore.getState().fileTabs["missing"]).toBeUndefined();
  });
});

describe("setFileTabBufferText", () => {
  it("replaces text and flips dirty when text differs from disk", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    store.setFileTabBufferText("t1", "left", "a\nB\nc\n", {
      start: 2,
      end: 3,
      replacementCount: 1,
    });
    const buf = useAppStore.getState().fileTabs["t1"].left;
    expect(buf?.text).toBe("a\nB\nc\n");
    expect(buf?.dirty).toBe(true);
  });

  it("clears dirty when typed text matches diskText again", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer(
      "t1",
      "left",
      makeBuffer({ dirty: true, text: "a\nX\nc\n" }),
    );
    store.setFileTabBufferText("t1", "left", "a\nb\nc\n", {
      start: 2,
      end: 3,
      replacementCount: 1,
    });
    expect(useAppStore.getState().fileTabs["t1"].left?.dirty).toBe(false);
  });

  it("shifts yellow ranges across a non-overlapping line edit", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer(
      "t1",
      "left",
      makeBuffer({
        text: "a\nb\nc\nd\n",
        diskText: "a\nb\nc\nd\n",
        yellowRanges: [{ start: 3, end: 4 }],
      }),
    );
    // Insert one line at the very top: "X\na\nb\nc\nd\n".
    store.setFileTabBufferText("t1", "left", "X\na\nb\nc\nd\n", {
      start: 1,
      end: 1,
      replacementCount: 1,
    });
    const buf = useAppStore.getState().fileTabs["t1"].left;
    expect(buf?.yellowRanges).toEqual([{ start: 4, end: 5 }]);
  });

  it("drops yellow ranges that overlap the edit", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer(
      "t1",
      "left",
      makeBuffer({
        text: "a\nb\nc\n",
        diskText: "a\nb\nc\n",
        yellowRanges: [{ start: 2, end: 3 }],
      }),
    );
    store.setFileTabBufferText("t1", "left", "a\nB\nc\n", {
      start: 2,
      end: 3,
      replacementCount: 1,
    });
    expect(useAppStore.getState().fileTabs["t1"].left?.yellowRanges).toEqual(
      [],
    );
  });

  it("drops all yellow ranges when edit is null (multi-event fallback)", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer(
      "t1",
      "left",
      makeBuffer({
        yellowRanges: [
          { start: 1, end: 2 },
          { start: 3, end: 4 },
        ],
      }),
    );
    store.setFileTabBufferText("t1", "left", "ZZZ\n", null);
    expect(useAppStore.getState().fileTabs["t1"].left?.yellowRanges).toEqual(
      [],
    );
  });

  it("does not recompute terminator (CRLF paste does not flip an LF buffer)", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    store.setFileTabBufferText("t1", "left", "a\r\nb\r\nc\r\n", null);
    expect(useAppStore.getState().fileTabs["t1"].left?.terminator).toBe("\n");
  });

  it("is a no-op when newText equals current text (skips state update)", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    const before = useAppStore.getState().fileTabs["t1"].left;
    store.setFileTabBufferText("t1", "left", "a\nb\nc\n", null);
    const after = useAppStore.getState().fileTabs["t1"].left;
    expect(after).toBe(before);
  });

  it("is a no-op when the tab does not exist", () => {
    useAppStore.getState().setFileTabBufferText("missing", "left", "x", null);
    expect(useAppStore.getState().fileTabs["missing"]).toBeUndefined();
  });

  it("is a no-op when the side has no buffer", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBufferText("t1", "left", "x", null);
    expect(useAppStore.getState().fileTabs["t1"].left).toBeNull();
  });
});

describe("markSaved", () => {
  it("syncs diskText, clears dirty/yellow/mtime; leaves the other side untouched", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    store.setFileTabBuffer("t1", "right", makeBuffer());
    store.applyBufferMerge("t1", {
      side: "left",
      start: 1,
      end: 2,
      replacement: ["L"],
    });
    store.applyBufferMerge("t1", {
      side: "right",
      start: 1,
      end: 2,
      replacement: ["R"],
    });
    store.markSaved(
      "t1",
      "left",
      500,
      useAppStore.getState().fileTabs.t1.left!.text,
      "doc",
      "v2",
    );
    const tab = useAppStore.getState().fileTabs["t1"];
    expect(tab.left?.dirty).toBe(false);
    expect(tab.left?.diskText).toBe(tab.left?.text);
    expect(tab.left?.mtimeMs).toBe(500);
    expect(tab.left?.yellowRanges).toEqual([]);
    expect(tab.left?.diskStale).toBe(false);
    expect(tab.right?.dirty).toBe(true);
    expect(tab.right?.yellowRanges.length).toBeGreaterThan(0);
  });
});

describe("selectIsTabDirty", () => {
  it("returns false when the tab is missing", () => {
    expect(selectIsTabDirty(useAppStore.getState(), "nope")).toBe(false);
  });

  it("returns false when no side is dirty", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    store.setFileTabBuffer("t1", "right", makeBuffer());
    expect(selectIsTabDirty(useAppStore.getState(), "t1")).toBe(false);
  });

  it("returns true when either side is dirty", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer("t1", "left", makeBuffer());
    store.setFileTabBuffer("t1", "right", makeBuffer());
    store.applyBufferMerge("t1", {
      side: "right",
      start: 1,
      end: 2,
      replacement: ["R"],
    });
    expect(selectIsTabDirty(useAppStore.getState(), "t1")).toBe(true);
  });
});

describe("save revision safety", () => {
  it("keeps edits made after the submitted snapshot dirty", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer(
      "t1",
      "left",
      makeBuffer({ text: "submitted", dirty: true }),
    );
    store.setFileTabBufferText("t1", "left", "newer", null);
    store.markSaved("t1", "left", 500, "submitted", "doc", "v2");
    const buf = useAppStore.getState().fileTabs.t1.left!;
    expect(buf.diskText).toBe("submitted");
    expect(buf.text).toBe("newer");
    expect(buf.dirty).toBe(true);
    expect(buf.revision).toBe(1);
  });
  it("ignores a completion for a replaced document", () => {
    const store = useAppStore.getState();
    store.initFileTab("t1");
    store.setFileTabBuffer(
      "t1",
      "left",
      makeBuffer({ documentId: "replacement", dirty: true }),
    );
    store.markSaved("t1", "left", 500, "old", "doc", "v2");
    expect(useAppStore.getState().fileTabs.t1.left!.diskVersion).toBe("v1");
  });
  it("clears results when comparison mode changes", () => {
    const store = useAppStore.getState();
    store.setComparison(makeDirComparison(["a"]));
    store.setComparisonMode("Verified");
    expect(useAppStore.getState().comparison).toBeNull();
    expect(useAppStore.getState().comparisonMode).toBe("Verified");
  });
});
