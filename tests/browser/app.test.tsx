import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
import App from "../../src/App";
import "../../src/styles/globals.css";
import { useAppStore } from "../../src/stores/appStore";
import {
  loadComparisonMode,
  loadPaths,
  loadWordWrap,
} from "../../src/lib/persistence";
import {
  compareFolders,
  diffText,
  comparisonPathKind,
  onOsFileDrag,
  openFileDialog,
  openFolderDialog,
  readFileText,
  type OsFileDragEvent,
} from "../../src/lib/tauri";
import type { ComparisonEntry } from "../../src/types";

vi.mock("../../src/lib/persistence", () => ({
  loadPaths: vi.fn(),
  loadComparisonMode: vi.fn(),
  loadWordWrap: vi.fn(),
  saveWordWrap: vi.fn().mockResolvedValue(undefined),
  savePaths: vi.fn().mockResolvedValue(undefined),
  saveComparisonMode: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/lib/tauri", () => ({
  readFileText: vi.fn(),
  saveDocument: vi.fn(),
  saveFileDialog: vi.fn().mockResolvedValue(null),
  openFileDialog: vi.fn(),
  diffText: vi.fn(),
  planFsBatch: vi.fn(),
  executeFsItem: vi.fn(),
  deletePaths: vi.fn(),
  startFsOp: vi.fn(),
  endFsOp: vi.fn(),
  cancelFsOp: vi.fn(),
  resolvePaths: vi.fn(),
  compareFolders: vi.fn(),
  openFolderDialog: vi.fn(),
  isDirectory: vi.fn(),
  comparisonPathKind: vi.fn(),
  onOsFileDrag: vi.fn(),
  fileVersion: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  message: vi.fn(),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const dragHandlers = new Set<(event: OsFileDragEvent) => void>();
const folderRoots = new Set(["/l", "/r", "/second-left", "/second-right"]);

function mountApp() {
  host = document.createElement("div");
  host.style.width = "1200px";
  host.style.height = "700px";
  document.body.append(host);
  root = createRoot(host);
  root.render(<App />);
}

async function commitPath(label: string, path: string) {
  await page.getByRole("textbox", { name: label }).fill(path);
  await userEvent.keyboard("{Enter}");
}

function comparisonEntry(name: string): ComparisonEntry {
  return {
    left: {
      name,
      relative_path: name,
      is_directory: false,
      size: 10,
      modified: 1,
      children: null,
    },
    right: null,
    status: "LeftOnly",
    children: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dragHandlers.clear();
  vi.mocked(loadPaths).mockResolvedValue({
    leftPath: "/saved-left",
    rightPath: "/saved-right",
  });
  vi.mocked(loadComparisonMode).mockResolvedValue("Quick");
  vi.mocked(loadWordWrap).mockResolvedValue(false);
  vi.mocked(openFileDialog).mockResolvedValue(null);
  vi.mocked(openFolderDialog).mockResolvedValue(null);
  vi.mocked(comparisonPathKind).mockImplementation(async (path) => {
    if (path === "/missing") throw new Error("Path does not exist");
    return folderRoots.has(path) ? "folder" : "file";
  });
  vi.mocked(compareFolders).mockImplementation(async (left, _right, mode) => ({
    entries: [comparisonEntry(left === "/l" ? "first.md" : "second.md")],
    mode,
    warnings: [],
  }));
  vi.mocked(onOsFileDrag).mockImplementation(async (handler) => {
    dragHandlers.add(handler);
    return () => dragHandlers.delete(handler);
  });
  useAppStore.setState({
    leftPath: null,
    rightPath: null,
    comparison: null,
    comparisonMode: "Quick",
    comparisonWarnings: [],
    comparing: false,
    operating: false,
    error: null,
    selectedPaths: new Set(),
    expandedPaths: new Set(),
    selectionAnchor: null,
    tabs: [{ id: "compare", kind: "compare" }],
    activeTabId: "compare",
    folderTabs: {},
    comparisonContextVersion: 0,
    fileTabs: {},
    saveConflict: null,
  });
});

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  dragHandlers.clear();
});

it("opens one neutral comparison without reading paths, scanning folders, or initializing Monaco", async () => {
  mountApp();
  await expect
    .element(page.getByRole("tab", { name: "Compare", exact: true }))
    .toBeVisible();
  await vi.waitFor(() => expect(loadComparisonMode).toHaveBeenCalled());
  await expect
    .element(page.getByRole("textbox", { name: "Left comparison path" }))
    .toHaveValue("");
  await expect
    .element(page.getByRole("textbox", { name: "Right comparison path" }))
    .toHaveValue("");
  await expect
    .element(page.getByRole("textbox", { name: "Left comparison path" }))
    .toHaveAttribute("placeholder", "Choose a left folder/file");
  await expect
    .element(page.getByRole("textbox", { name: "Right comparison path" }))
    .toHaveAttribute("placeholder", "Choose a right folder/file");
  await expect
    .element(page.getByRole("button", { name: "Select left folder/file" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Select right folder/file" }))
    .toBeVisible();
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(document.body.textContent).toContain(
    "Choose a folder/file, paste its path above, or drop it here.",
  );
  for (const name of [
    "Wrap Text",
    "Save",
    "Refresh comparison",
    "Compare Files",
  ])
    await expect
      .element(page.getByRole("button", { name, exact: true }))
      .not.toBeInTheDocument();
  await expect
    .element(page.getByRole("combobox", { name: "Comparison mode" }))
    .not.toBeInTheDocument();
  expect(useAppStore.getState()).toMatchObject({
    leftPath: null,
    rightPath: null,
    fileTabs: {},
    folderTabs: {},
  });
  expect(loadPaths).not.toHaveBeenCalled();
  expect(comparisonPathKind).not.toHaveBeenCalled();
  expect(readFileText).not.toHaveBeenCalled();
  expect(diffText).not.toHaveBeenCalled();
  expect(compareFolders).not.toHaveBeenCalled();
  expect(window.MonacoEnvironment).toBeUndefined();
  expect(
    performance
      .getEntriesByType("resource")
      .some((entry) =>
        /monaco-editor|editor\.worker|ts\.worker/.test(entry.name),
      ),
  ).toBe(false);
});

it.each(["left", "right"] as const)(
  "detects a folder selected on the %s first and puts the mode beside Compare",
  async (side) => {
    mountApp();
    const other = side === "left" ? "right" : "left";
    const path = side === "left" ? "/l" : "/r";
    await commitPath(
      `${side === "left" ? "Left" : "Right"} comparison path`,
      path,
    );
    await vi.waitFor(() =>
      expect(useAppStore.getState().tabs[0]).toEqual({
        id: "compare",
        kind: "folder-compare",
      }),
    );
    await expect
      .element(
        page.getByRole("textbox", {
          name: `${side === "left" ? "Left" : "Right"} folder path`,
        }),
      )
      .toHaveValue(path);
    await expect
      .element(page.getByRole("button", { name: `Choose ${other} folder` }))
      .toBeVisible();
    expect(compareFolders).not.toHaveBeenCalled();
    expect(readFileText).not.toHaveBeenCalled();
    expect(window.MonacoEnvironment).toBeUndefined();
    await expect
      .element(page.getByRole("button", { name: "Compare", exact: true }))
      .toBeDisabled();
    await commitPath(
      `${other === "left" ? "Left" : "Right"} folder path`,
      other === "left" ? "/l" : "/r",
    );
    await page
      .getByRole("combobox", { name: "Comparison mode" })
      .selectOptions(
        page.getByRole("option", { name: "Thorough", exact: true }),
      );
    const modeInput = document.querySelector<HTMLSelectElement>(
      '[aria-label="Comparison mode"]',
    );
    const compareButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Compare",
    );
    expect(modeInput).not.toBeNull();
    expect(modeInput!.value).toBe("Verified");
    expect(modeInput!.selectedOptions[0].textContent).toBe("Thorough");
    expect(compareButton).not.toBeUndefined();
    const modeRect = modeInput!.getBoundingClientRect();
    const compareRect = compareButton!.getBoundingClientRect();
    expect(Math.abs(modeRect.top - compareRect.top)).toBeLessThan(10);
    expect(Math.abs(modeRect.left - compareRect.left)).toBeLessThan(250);
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await vi.waitFor(() =>
      expect(compareFolders).toHaveBeenCalledWith("/l", "/r", "Verified"),
    );
    expect(window.MonacoEnvironment).toBeUndefined();
  },
);

it("keeps a neutral tab unchanged when the first folder picker is cancelled", async () => {
  mountApp();
  const initialTab = useAppStore.getState().tabs[0];
  await page.getByRole("button", { name: "Select right folder/file" }).click();
  await page.getByRole("menuitem", { name: "Choose a folder…" }).click();
  expect(openFolderDialog).toHaveBeenCalledWith(undefined);
  expect(useAppStore.getState().tabs).toEqual([initialTab]);
  expect(useAppStore.getState().activeTabId).toBe(initialTab.id);
  expect(comparisonPathKind).not.toHaveBeenCalled();
  expect(compareFolders).not.toHaveBeenCalled();
});

it("starts each folder picker from its own root and preserves the pair when cancelled", async () => {
  mountApp();
  await commitPath("Left comparison path", "/l");
  await commitPath("Right folder path", "/r");
  const initialState = useAppStore.getState();

  await page.getByRole("button", { name: "Choose left folder" }).click();
  expect(openFolderDialog).toHaveBeenLastCalledWith("/l");
  await page.getByRole("button", { name: "Choose right folder" }).click();
  expect(openFolderDialog).toHaveBeenLastCalledWith("/r");

  expect(useAppStore.getState()).toMatchObject({
    leftPath: "/l",
    rightPath: "/r",
    activeTabId: initialState.activeTabId,
  });
  expect(openFileDialog).not.toHaveBeenCalled();
  expect(compareFolders).not.toHaveBeenCalled();
});

it("rejects missing paths and files in a folder comparison, then recovers without replacing the other root", async () => {
  mountApp();
  await commitPath("Left comparison path", "/missing");
  await expect
    .element(page.getByText("Path does not exist", { exact: true }))
    .toBeVisible();
  expect(useAppStore.getState().tabs[0].kind).toBe("compare");
  await commitPath("Left comparison path", "/l");
  await commitPath("Right folder path", "/fixtures/other.md");
  await expect
    .element(
      page.getByText(
        "Choose a folder for this comparison. Files cannot be compared with folders.",
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(useAppStore.getState()).toMatchObject({
    leftPath: "/l",
    rightPath: null,
  });
  expect(readFileText).not.toHaveBeenCalled();
  expect(compareFolders).not.toHaveBeenCalled();
  await expect
    .element(page.getByRole("textbox", { name: "Right folder path" }))
    .toHaveValue("");
  await commitPath("Right folder path", "/r");
  await vi.waitFor(() => expect(useAppStore.getState().error).toBeNull());
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await vi.waitFor(() =>
    expect(compareFolders).toHaveBeenCalledWith("/l", "/r", "Quick"),
  );
});

it("detects the first dropped folder on the right and compares after the matching left drop", async () => {
  mountApp();
  await vi.waitFor(() => expect(dragHandlers.size).toBe(1));
  const bounds = host!.getBoundingClientRect();
  for (const handler of dragHandlers)
    handler({
      type: "drop",
      x: bounds.right - 10,
      y: bounds.top + 200,
      paths: ["/r"],
    });
  await vi.waitFor(() => expect(useAppStore.getState().rightPath).toBe("/r"));
  expect(useAppStore.getState().leftPath).toBeNull();
  expect(compareFolders).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(dragHandlers.size).toBe(1));
  for (const handler of dragHandlers)
    handler({
      type: "drop",
      x: bounds.left + 10,
      y: bounds.top + 200,
      paths: ["/l"],
    });
  await vi.waitFor(() =>
    expect(compareFolders).toHaveBeenCalledWith("/l", "/r", "Quick"),
  );
});

it("creates independent comparisons and restores each folder pair, result, selection, and comparison mode", async () => {
  mountApp();
  await commitPath("Left comparison path", "/l");
  await commitPath("Right folder path", "/r");
  await page
    .getByRole("combobox", { name: "Comparison mode" })
    .selectOptions("Verified");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await vi.waitFor(() =>
    expect(useAppStore.getState().comparison?.[0].left?.name).toBe("first.md"),
  );
  useAppStore.getState().setSelection(["first.md"]);
  const firstTabId = useAppStore.getState().activeTabId;
  const firstResult = useAppStore.getState().comparison;
  await page.getByRole("button", { name: "New comparison" }).click();
  const secondTabId = useAppStore.getState().activeTabId;
  expect(secondTabId).not.toBe(firstTabId);
  await expect
    .element(page.getByRole("textbox", { name: "Left comparison path" }))
    .toHaveValue("");
  await expect
    .element(page.getByRole("textbox", { name: "Right comparison path" }))
    .toHaveValue("");
  expect(useAppStore.getState()).toMatchObject({
    leftPath: null,
    rightPath: null,
    comparison: null,
  });
  await commitPath("Right comparison path", "/second-right");
  await commitPath("Left folder path", "/second-left");
  await page
    .getByRole("combobox", { name: "Comparison mode" })
    .selectOptions("Quick");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await vi.waitFor(() =>
    expect(useAppStore.getState().comparison?.[0].left?.name).toBe("second.md"),
  );
  const secondResult = useAppStore.getState().comparison;
  await page.getByRole("tab").nth(0).click();
  expect(useAppStore.getState()).toMatchObject({
    activeTabId: firstTabId,
    leftPath: "/l",
    rightPath: "/r",
    comparisonMode: "Verified",
  });
  expect(useAppStore.getState().comparison).toBe(firstResult);
  expect([...useAppStore.getState().selectedPaths]).toEqual(["first.md"]);
  await expect
    .element(page.getByRole("textbox", { name: "Left folder path" }))
    .toHaveValue("/l");
  await expect
    .element(page.getByRole("combobox", { name: "Comparison mode" }))
    .toHaveValue("Verified");
  await page.getByRole("tab").nth(1).click();
  expect(useAppStore.getState()).toMatchObject({
    activeTabId: secondTabId,
    leftPath: "/second-left",
    rightPath: "/second-right",
    comparisonMode: "Quick",
  });
  expect(useAppStore.getState().comparison).toBe(secondResult);
  expect(useAppStore.getState().selectedPaths.size).toBe(0);
  expect(readFileText).not.toHaveBeenCalled();
});

it("shows a compact plus button and returns to a single neutral comparison when the last populated tab closes", async () => {
  mountApp();
  const plus = page.getByRole("button", { name: "New comparison" });
  await expect.element(plus).toHaveTextContent("+");
  await commitPath("Left comparison path", "/l");
  const folderTabId = useAppStore.getState().activeTabId;
  await plus.click();
  expect(useAppStore.getState().tabs).toHaveLength(2);
  expect(useAppStore.getState().activeTabId).not.toBe(folderTabId);
  await expect
    .element(page.getByRole("textbox", { name: "Left comparison path" }))
    .toHaveValue("");
  await page.getByRole("button", { name: "Close tab" }).nth(1).click();
  expect(useAppStore.getState().activeTabId).toBe(folderTabId);
  await page.getByRole("button", { name: "Close tab" }).click();
  await expect
    .element(page.getByRole("tab", { name: "Compare", exact: true }))
    .toBeVisible();
  expect(useAppStore.getState().tabs).toHaveLength(1);
  expect(useAppStore.getState().tabs[0].kind).toBe("compare");
  await expect
    .element(page.getByRole("textbox", { name: "Left comparison path" }))
    .toHaveValue("");
  expect(useAppStore.getState()).toMatchObject({
    leftPath: null,
    rightPath: null,
    comparison: null,
    fileTabs: {},
    folderTabs: {},
  });
});

it("ignores a pending path classification after the last neutral tab closes and its identifier is reused", async () => {
  let resolveStale!: (kind: "file" | "folder") => void;
  const pendingStale = new Promise<"file" | "folder">((resolve) => {
    resolveStale = resolve;
  });
  vi.mocked(comparisonPathKind).mockImplementation(async (path) =>
    path === "/fixtures/stale.md" ? pendingStale : "folder",
  );
  mountApp();
  const originalTabId = useAppStore.getState().activeTabId;
  await commitPath("Left comparison path", "/fixtures/stale.md");
  await vi.waitFor(() =>
    expect(comparisonPathKind).toHaveBeenCalledWith("/fixtures/stale.md"),
  );
  await userEvent.keyboard("{Control>}w{/Control}");
  await expect
    .element(page.getByRole("textbox", { name: "Left comparison path" }))
    .toHaveValue("");
  expect(useAppStore.getState().tabs).toHaveLength(1);
  expect(useAppStore.getState().activeTabId).toBe(originalTabId);
  await commitPath("Right comparison path", "/r");
  await vi.waitFor(() =>
    expect(useAppStore.getState().tabs[0].kind).toBe("folder-compare"),
  );
  resolveStale("file");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await vi.waitFor(() =>
    expect(useAppStore.getState()).toMatchObject({
      leftPath: null,
      rightPath: "/r",
    }),
  );
  await expect
    .element(page.getByRole("textbox", { name: "Left folder path" }))
    .toHaveValue("");
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  expect(useAppStore.getState().tabs[0].kind).toBe("folder-compare");
  expect(useAppStore.getState().fileTabs).toEqual({});
  expect(readFileText).not.toHaveBeenCalled();
  expect(compareFolders).not.toHaveBeenCalled();
});

it("checks the latest comparison kind when opposite sides finish classification in a different order", async () => {
  let resolveFolder!: (kind: "file" | "folder") => void;
  let resolveFile!: (kind: "file" | "folder") => void;
  const pendingFolder = new Promise<"file" | "folder">((resolve) => {
    resolveFolder = resolve;
  });
  const pendingFile = new Promise<"file" | "folder">((resolve) => {
    resolveFile = resolve;
  });
  vi.mocked(comparisonPathKind).mockImplementation(async (path) =>
    path === "/l" ? pendingFolder : pendingFile,
  );
  mountApp();
  await commitPath("Left comparison path", "/l");
  await commitPath("Right comparison path", "/fixtures/other.md");
  expect(comparisonPathKind).toHaveBeenCalledWith("/l");
  expect(comparisonPathKind).toHaveBeenCalledWith("/fixtures/other.md");
  resolveFolder("folder");
  await vi.waitFor(() =>
    expect(useAppStore.getState()).toMatchObject({
      leftPath: "/l",
      rightPath: null,
    }),
  );
  resolveFile("file");
  await expect
    .element(
      page.getByText(
        "Choose a folder for this comparison. Files cannot be compared with folders.",
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(useAppStore.getState().tabs[0]).toEqual({
    id: "compare",
    kind: "folder-compare",
  });
  expect(useAppStore.getState()).toMatchObject({
    leftPath: "/l",
    rightPath: null,
    fileTabs: {},
  });
  await expect
    .element(page.getByRole("textbox", { name: "Right folder path" }))
    .toHaveValue("");
  expect(readFileText).not.toHaveBeenCalled();
  expect(compareFolders).not.toHaveBeenCalled();
});

it("restores synchronized folder scroll and visible rows after a tab switch, then resets scroll when a root changes", async () => {
  const entries = (prefix: string): ComparisonEntry[] =>
    Array.from({ length: 200 }, (_, index) => {
      const entry = comparisonEntry(
        `${prefix}-${String(index).padStart(3, "0")}.md`,
      );
      return { ...entry, right: entry.left, status: "Identical" };
    });
  vi.mocked(compareFolders).mockImplementation(async (left, _right, mode) => ({
    entries: entries(left === "/l" ? "entry" : "changed"),
    mode,
    warnings: [],
  }));
  const scroller = (side: "left" | "right") => {
    const element = document.querySelector<HTMLDivElement>(
      `[data-comparison-pane-side="${side}"] .overflow-auto`,
    );
    if (!element) throw new Error(`Expected the ${side} folder pane`);
    return element;
  };
  mountApp();
  await commitPath("Left comparison path", "/l");
  await commitPath("Right folder path", "/r");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await vi.waitFor(() =>
    expect(scroller("left").scrollHeight).toBeGreaterThan(
      scroller("left").clientHeight,
    ),
  );
  scroller("left").scrollTo({ top: 3200 });
  await vi.waitFor(() => {
    expect(scroller("left").scrollTop).toBe(3200);
    expect(scroller("right").scrollTop).toBe(3200);
  });
  await expect
    .element(page.getByText("entry-100.md", { exact: true }).nth(0))
    .toBeVisible();
  await page.getByRole("button", { name: "New comparison" }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Left comparison path" }))
    .toHaveValue("");
  expect(
    document.querySelector('[data-comparison-pane-side="left"]'),
  ).toBeNull();
  await page.getByRole("tab").nth(0).click();
  await vi.waitFor(() => {
    expect(scroller("left").scrollTop).toBe(3200);
    expect(scroller("right").scrollTop).toBe(3200);
  });
  await expect
    .element(page.getByText("entry-100.md", { exact: true }).nth(0))
    .toBeVisible();
  await commitPath("Left folder path", "/second-left");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await vi.waitFor(() => {
    expect(useAppStore.getState().comparison?.[0].left?.name).toBe(
      "changed-000.md",
    );
    expect(scroller("left").scrollTop).toBe(0);
    expect(scroller("right").scrollTop).toBe(0);
  });
  await expect
    .element(page.getByText("changed-000.md", { exact: true }).nth(0))
    .toBeVisible();
  await expect
    .element(page.getByText("changed-100.md", { exact: true }))
    .not.toBeInTheDocument();
  expect(readFileText).not.toHaveBeenCalled();
  expect(window.MonacoEnvironment).toBeUndefined();
});
