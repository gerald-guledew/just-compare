import { beforeEach, expect, it, vi } from "vitest";
import { refreshComparison } from "./useComparison";
import { useAppStore } from "../stores/appStore";
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
  const promise = new Promise<ComparisonResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState({
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
