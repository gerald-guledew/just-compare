import { afterEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import App from "../../src/App";
import { useAppStore } from "../../src/stores/appStore";
import { compareFolders } from "../../src/lib/tauri";
vi.mock("../../src/lib/persistence", () => ({
  loadPaths: vi.fn().mockResolvedValue({ leftPath: "/l", rightPath: "/r" }),
  loadComparisonMode: vi.fn().mockResolvedValue("Quick"),
  savePaths: vi.fn().mockResolvedValue(undefined),
  saveComparisonMode: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/lib/tauri", () => ({
  readFileText: vi.fn(),
  saveDocument: vi.fn(),
  openFileDialog: vi.fn(),
  diffText: vi.fn(),
  planFsBatch: vi.fn(),
  executeFsItem: vi.fn(),
  deletePaths: vi.fn(),
  startFsOp: vi.fn(),
  endFsOp: vi.fn(),
  cancelFsOp: vi.fn(),
  resolvePaths: vi.fn(),
  compareFolders: vi
    .fn()
    .mockResolvedValue({ entries: [], mode: "Quick", warnings: [] }),
  openFolderDialog: vi.fn(),
  isDirectory: vi.fn(),
  onOsFileDrag: vi.fn().mockResolvedValue(() => {}),
  fileVersion: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  message: vi.fn(),
}));
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  root?.unmount();
  host?.remove();
});
it("opens the comparison workspace directly without initializing Monaco, then selects Verified", async () => {
  useAppStore.setState({
    fileTabs: {},
    tabs: [{ id: "folder", kind: "folder-compare" }],
    activeTabId: "folder",
    operating: false,
    comparing: false,
    comparison: null,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  root.render(<App />);
  await vi.waitFor(() => expect(useAppStore.getState().leftPath).toBe("/l"));
  await expect
    .element(page.getByRole("button", { name: "Compare", exact: true }))
    .toBeVisible();
  expect(document.body.textContent).not.toContain(
    "Start a folder compare session.",
  );
  expect(document.body.textContent).not.toContain("New Folder Compare");
  expect(window.MonacoEnvironment).toBeUndefined();
  expect(
    performance
      .getEntriesByType("resource")
      .some((entry) =>
        /monaco-editor|editor\.worker|ts\.worker/.test(entry.name),
      ),
  ).toBe(false);
  await page
    .getByRole("combobox", { name: "Comparison mode" })
    .selectOptions("Verified");
  expect(useAppStore.getState().comparisonMode).toBe("Verified");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await vi.waitFor(() =>
    expect(compareFolders).toHaveBeenCalledWith("/l", "/r", "Verified"),
  );
});
