import { beforeEach, expect, it, vi } from "vitest";
import { refreshComparison } from "./useComparison";
import { FOLDER_TAB_ID, INITIAL_TAB_ID, useAppStore } from "../stores/appStore";
import { compareFolders } from "../lib/tauri";
import type { ComparisonResult } from "../types";
vi.mock("../lib/tauri", () => ({
  compareFolders: vi.fn(),
  openFolderDialog: vi.fn(),
}));
vi.mock("../lib/persistence", () => ({
  savePaths: vi.fn().mockResolvedValue(undefined),
  saveComparisonMode: vi.fn().mockResolvedValue(undefined),
}));
function deferred() {
  let resolve!: (value: ComparisonResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ComparisonResult>((r, fail) => {
    resolve = r;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(compareFolders).mockReset();
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    tabs: [{ id: FOLDER_TAB_ID, kind: "folder-compare" }],
    activeTabId: FOLDER_TAB_ID,
    leftPath: "/l",
    rightPath: "/r",
    comparisonMode: "Quick",
    comparison: null,
    comparing: false,
    operating: false,
    comparisonWarnings: [],
  });
});
it("ignores an older comparison when a newer request completes first", async () => {
  const old = deferred(),
    next = deferred();
  vi.mocked(compareFolders)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(next.promise);
  const first = refreshComparison(),
    second = refreshComparison();
  next.resolve({ entries: [], mode: "Quick", warnings: ["new result"] });
  await second;
  old.resolve({ entries: [], mode: "Quick", warnings: ["old result"] });
  await first;
  expect(useAppStore.getState().comparisonWarnings).toEqual(["new result"]);
});
it("does not apply results after changing roots or mode", async () => {
  const old = deferred();
  vi.mocked(compareFolders).mockReturnValue(old.promise);
  const task = refreshComparison();
  useAppStore.setState({ comparisonMode: "Verified", leftPath: "/new" });
  old.resolve({ entries: [], mode: "Quick", warnings: ["old result"] });
  await task;
  expect(useAppStore.getState().comparison).toBeNull();
  expect(useAppStore.getState().comparing).toBe(false);
});

it("does not scan a neutral or file comparison even when folder globals retain roots", async () => {
  const store = useAppStore.getState();
  store.newCompareTab();
  await refreshComparison();
  store.setActiveTab(FOLDER_TAB_ID);
  store.openFilePairTab("/left.md", "/right.md");
  expect(useAppStore.getState().leftPath).toBe("/l");
  expect(useAppStore.getState().rightPath).toBe("/r");
  await refreshComparison();
  expect(compareFolders).not.toHaveBeenCalled();
});

it("refreshes folder results internally while the filesystem operation lock is held", async () => {
  const result: ComparisonResult = {
    entries: [],
    mode: "Quick",
    warnings: ["Refreshed after a filesystem operation"],
  };
  vi.mocked(compareFolders).mockResolvedValue(result);
  useAppStore.setState({ operating: true });
  await refreshComparison(true);
  expect(compareFolders).toHaveBeenCalledWith("/l", "/r", "Quick");
  expect(useAppStore.getState().comparison).toEqual(result.entries);
  expect(useAppStore.getState().comparisonWarnings).toEqual(result.warnings);
  expect(useAppStore.getState().comparing).toBe(false);
  expect(useAppStore.getState().operating).toBe(true);
});

it("discards a folder scan after switching away and back, without restoring a loading flag", async () => {
  const old = deferred();
  vi.mocked(compareFolders).mockReturnValue(old.promise);
  const task = refreshComparison();
  expect(useAppStore.getState().comparing).toBe(true);
  const store = useAppStore.getState();
  store.newCompareTab();
  store.setActiveTab(FOLDER_TAB_ID);
  expect(useAppStore.getState().comparing).toBe(false);
  old.resolve({
    entries: [],
    mode: "Quick",
    warnings: ["cancelled folder scan"],
  });
  await task;
  expect(useAppStore.getState().comparison).toBeNull();
  expect(useAppStore.getState().comparisonWarnings).toEqual([]);
  expect(useAppStore.getState().comparing).toBe(false);
});

it("does not leak a rejected scan into another comparison tab", async () => {
  const old = deferred();
  vi.mocked(compareFolders).mockReturnValue(old.promise);
  const task = refreshComparison();
  const store = useAppStore.getState();
  store.newCompareTab();
  const otherId = useAppStore.getState().activeTabId;
  store.selectComparisonPath(otherId, "left", "/new-left", "folder");
  store.selectComparisonPath(otherId, "right", "/new-right", "folder");
  old.reject(new Error("The previous folder cannot be read"));
  await task;
  expect(useAppStore.getState().error).toBeNull();
  expect(useAppStore.getState().leftPath).toBe("/new-left");
  store.setActiveTab(FOLDER_TAB_ID);
  expect(useAppStore.getState().error).toBeNull();
  expect(useAppStore.getState().comparing).toBe(false);
});

it("keeps a new tab's scan active when an older folder scan settles", async () => {
  const old = deferred();
  const current = deferred();
  vi.mocked(compareFolders)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const first = refreshComparison();
  const store = useAppStore.getState();
  store.newCompareTab();
  const otherId = useAppStore.getState().activeTabId;
  store.selectComparisonPath(otherId, "left", "/new-left", "folder");
  store.selectComparisonPath(otherId, "right", "/new-right", "folder");
  const second = refreshComparison();
  old.resolve({ entries: [], mode: "Quick", warnings: ["old"] });
  await first;
  expect(useAppStore.getState().comparing).toBe(true);
  current.resolve({ entries: [], mode: "Quick", warnings: ["current"] });
  await second;
  expect(useAppStore.getState().comparing).toBe(false);
  expect(useAppStore.getState().comparisonWarnings).toEqual(["current"]);
});

it("discards a completion when the last folder tab was closed and its id was reused", async () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const store = useAppStore.getState();
  store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l", "folder");
  store.selectComparisonPath(INITIAL_TAB_ID, "right", "/r", "folder");
  const old = deferred();
  vi.mocked(compareFolders).mockReturnValue(old.promise);
  const task = refreshComparison();
  store.closeTab(INITIAL_TAB_ID);
  store.selectComparisonPath(INITIAL_TAB_ID, "left", "/l", "folder");
  store.selectComparisonPath(INITIAL_TAB_ID, "right", "/r", "folder");
  old.resolve({ entries: [], mode: "Quick", warnings: ["closed comparison"] });
  await task;
  expect(useAppStore.getState().comparison).toBeNull();
  expect(useAppStore.getState().comparisonWarnings).toEqual([]);
});
