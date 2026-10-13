import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
import * as monaco from "monaco-editor";
import App from "../../src/App";
import "../../src/styles/globals.css";
import { useAppStore } from "../../src/stores/appStore";
import { loadPaths } from "../../src/lib/persistence";
import {
  compareFolders,
  comparisonPathKind,
  onOsFileDrag,
  type OsFileDragEvent,
  diffText,
  openFileDialog,
  openFolderDialog,
  readFileText,
} from "../../src/lib/tauri";
import type {
  ComparisonEntry,
  FileDiffResult,
  FileReadResult,
} from "../../src/types";

vi.mock("../../src/lib/persistence", () => ({
  loadPaths: vi.fn(),
  loadComparisonMode: vi.fn().mockResolvedValue("Quick"),
  loadWordWrap: vi.fn().mockResolvedValue(false),
  saveWordWrap: vi.fn().mockResolvedValue(undefined),
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
  compareFolders: vi.fn(),
  openFolderDialog: vi.fn(),
  isDirectory: vi.fn(),
  comparisonPathKind: vi.fn(),
  onOsFileDrag: vi.fn().mockResolvedValue(() => {}),
  fileVersion: vi.fn(async (path: string) => `version:${path}`),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  message: vi.fn(),
}));

const leftPath = "/Users/gerald/Documents/HalterIntermediateEngineers.md";
const rightPath = "/Users/gerald/Documents/HalterSeniorEngineers.md";
const leftText =
  "# Halter Intermediate Engineers\n\nBuild reliable features.\n";
const rightText = "# Halter Senior Engineers\n\nLead reliable system design.\n";
const fileDiff: FileDiffResult = {
  binary: false,
  too_large: false,
  lines: [
    {
      kind: "Replace",
      left_num: 1,
      right_num: 1,
      left: [{ text: "# Halter Intermediate Engineers", changed: true }],
      right: [{ text: "# Halter Senior Engineers", changed: true }],
    },
    {
      kind: "Equal",
      left_num: 2,
      right_num: 2,
      left: [{ text: "", changed: false }],
      right: [{ text: "", changed: false }],
    },
    {
      kind: "Replace",
      left_num: 3,
      right_num: 3,
      left: [{ text: "Build reliable features.", changed: true }],
      right: [{ text: "Lead reliable system design.", changed: true }],
    },
  ],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const dragHandlers = new Set<(event: OsFileDragEvent) => void>();

function fileRead(path: string): FileReadResult {
  const text =
    path === leftPath ? leftText : path === rightPath ? rightText : null;
  if (text === null) throw new Error(`Unexpected fixture path: ${path}`);
  return {
    text,
    bom: false,
    canonical_path: path,
    disk_version: `version:${path}`,
    mtime_ms: 1000,
    size: new TextEncoder().encode(text).length,
  };
}

function mountApp() {
  host = document.createElement("div");
  host.style.width = "1200px";
  host.style.height = "700px";
  document.body.append(host);
  root = createRoot(host);
  root.render(<App />);
}

function activeFileTab() {
  const state = useAppStore.getState();
  const tab = state.tabs.find(
    (candidate) => candidate.id === state.activeTabId,
  );
  if (!tab || tab.kind !== "file-compare")
    throw new Error("Expected a file tab");
  return tab;
}

async function expectFixtureDiff() {
  const tabId = activeFileTab().id;
  await vi.waitFor(() =>
    expect(diffText).toHaveBeenCalledWith(
      leftText,
      rightText,
      tabId,
      expect.any(Number),
    ),
  );
  await vi.waitFor(() => {
    const buffers = useAppStore.getState().fileTabs[tabId];
    const left = monaco.editor.getModel(
      monaco.Uri.parse(`justcompare://document/${buffers.left?.documentId}`),
    );
    const right = monaco.editor.getModel(
      monaco.Uri.parse(`justcompare://document/${buffers.right?.documentId}`),
    );
    expect(left?.getValue()).toBe(leftText);
    expect(right?.getValue()).toBe(rightText);
    expect(
      left
        ?.getAllDecorations()
        .some(
          (decoration) => decoration.options.className === "diff-line-changed",
        ),
    ).toBe(true);
    expect(
      right
        ?.getAllDecorations()
        .some(
          (decoration) => decoration.options.className === "diff-line-changed",
        ),
    ).toBe(true);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPaths).mockResolvedValue({ leftPath: null, rightPath: null });
  dragHandlers.clear();
  vi.mocked(openFileDialog).mockResolvedValue(null);
  vi.mocked(openFolderDialog).mockResolvedValue(null);
  vi.mocked(comparisonPathKind).mockImplementation(async (path) => {
    if (path === "/missing") throw new Error("Path does not exist");
    return path.startsWith("/folder-") ? "folder" : "file";
  });
  vi.mocked(onOsFileDrag).mockImplementation(async (handler) => {
    dragHandlers.add(handler);
    return () => dragHandlers.delete(handler);
  });
  vi.mocked(readFileText).mockImplementation(async (path) => fileRead(path));
  vi.mocked(diffText).mockResolvedValue(fileDiff);
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
    wordWrap: false,
    fileTabs: {},
    saveConflict: null,
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  useAppStore.setState({ fileTabs: {} });
  dragHandlers.clear();
  for (const model of monaco.editor.getModels()) model.dispose();
});

async function chooseFirstFile(side: "left" | "right") {
  await page
    .getByRole("button", { name: `Select ${side} folder/file` })
    .click();
  await page.getByRole("menuitem", { name: "Choose a file…" }).click();
}

async function commitPath(label: string, path: string) {
  await page.getByRole("textbox", { name: label }).fill(path);
  await userEvent.keyboard("{Enter}");
}

it("compares independently named files from the initial tab without selecting folders", async () => {
  let resolveLeft!: (result: FileReadResult) => void;
  const pendingLeft = new Promise<FileReadResult>((resolve) => {
    resolveLeft = resolve;
  });
  vi.mocked(readFileText).mockImplementation(async (path) =>
    path === leftPath ? pendingLeft : fileRead(path),
  );
  mountApp();
  await expect
    .element(page.getByRole("textbox", { name: "Left comparison path" }))
    .toHaveValue("");
  await expect
    .element(page.getByRole("textbox", { name: "Right comparison path" }))
    .toHaveValue("");
  expect(readFileText).not.toHaveBeenCalled();
  expect(diffText).not.toHaveBeenCalled();
  const initialTab = useAppStore.getState().tabs[0];
  await chooseFirstFile("left");
  expect(openFileDialog).toHaveBeenCalledWith(undefined);
  expect(useAppStore.getState().tabs).toEqual([initialTab]);
  expect(useAppStore.getState().fileTabs).toEqual({});
  expect(comparisonPathKind).not.toHaveBeenCalled();
  expect(readFileText).not.toHaveBeenCalled();

  vi.mocked(openFileDialog).mockResolvedValueOnce(leftPath);
  await chooseFirstFile("left");
  await vi.waitFor(() => expect(readFileText).toHaveBeenCalledWith(leftPath));
  await expect
    .element(page.getByRole("textbox", { name: "Left file path" }))
    .toHaveValue(leftPath);
  await expect
    .element(page.getByRole("button", { name: "Choose right file" }))
    .toBeVisible();
  expect(activeFileTab().id).toBe(initialTab.id);
  expect(activeFileTab().rightFilePath).toBe("");
  expect(useAppStore.getState().tabs).toHaveLength(1);
  await expect
    .element(page.getByRole("button", { name: "Wrap Text" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("combobox", { name: "Comparison mode" }))
    .not.toBeInTheDocument();

  vi.mocked(openFileDialog).mockResolvedValueOnce(rightPath);
  await page.getByRole("button", { name: "Choose right file" }).click();
  await vi.waitFor(() => expect(readFileText).toHaveBeenCalledWith(rightPath));
  await expect
    .element(page.getByRole("textbox", { name: "Right file path" }))
    .toHaveValue(rightPath);
  resolveLeft(fileRead(leftPath));
  await expectFixtureDiff();
  expect(activeFileTab()).toMatchObject({
    leftFilePath: leftPath,
    rightFilePath: rightPath,
  });
  expect(activeFileTab().displayName).toContain(
    "HalterIntermediateEngineers.md",
  );
  expect(activeFileTab().displayName).toContain("HalterSeniorEngineers.md");
  expect(useAppStore.getState()).toMatchObject({
    leftPath: null,
    rightPath: null,
    comparison: null,
  });
  expect(readFileText).not.toHaveBeenCalledWith("");
  expect(openFolderDialog).not.toHaveBeenCalled();
  expect(compareFolders).not.toHaveBeenCalled();
  expect(loadPaths).not.toHaveBeenCalled();
});

it("detects a file pasted on the right first and rejects folders without replacing either document", async () => {
  mountApp();
  await commitPath("Right comparison path", rightPath);
  await vi.waitFor(() => expect(readFileText).toHaveBeenCalledWith(rightPath));
  await expect
    .element(page.getByRole("textbox", { name: "Left file path" }))
    .toHaveValue("");
  expect(activeFileTab()).toMatchObject({
    id: "compare",
    leftFilePath: "",
    rightFilePath: rightPath,
  });
  await commitPath("Left file path", "/folder-left");
  await expect
    .element(
      page.getByText(
        "Choose a file for this comparison. Folders cannot be compared with files.",
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(activeFileTab()).toMatchObject({
    leftFilePath: "",
    rightFilePath: rightPath,
  });
  expect(readFileText).not.toHaveBeenCalledWith("/folder-left");
  await expect
    .element(page.getByRole("textbox", { name: "Left file path" }))
    .toHaveValue("");
  await commitPath("Left file path", "/missing");
  await expect
    .element(page.getByText("Path does not exist", { exact: true }))
    .toBeVisible();
  expect(activeFileTab().rightFilePath).toBe(rightPath);
  await commitPath("Left file path", leftPath);
  await expectFixtureDiff();
  await vi.waitFor(() => expect(useAppStore.getState().error).toBeNull());
  const rightBuffer = useAppStore.getState().fileTabs[activeFileTab().id].right;
  await commitPath("Right file path", "/folder-right");
  await expect
    .element(
      page.getByText(
        "Choose a file for this comparison. Folders cannot be compared with files.",
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(activeFileTab().rightFilePath).toBe(rightPath);
  expect(useAppStore.getState().fileTabs[activeFileTab().id].right).toBe(
    rightBuffer,
  );
  await expect
    .element(page.getByRole("textbox", { name: "Right file path" }))
    .toHaveValue(rightPath);
  expect(compareFolders).not.toHaveBeenCalled();
});

it("keeps file pickers available after a read failure and restores an existing folder comparison", async () => {
  const folderComparison: ComparisonEntry[] = [
    {
      left: {
        name: "existing.md",
        relative_path: "existing.md",
        is_directory: false,
        size: 10,
        modified: 1,
        children: null,
      },
      right: null,
      status: "LeftOnly",
      children: null,
    },
  ];
  const selectedPaths = new Set(["existing.md"]);
  const expandedPaths = new Set(["existing-folder"]);
  useAppStore
    .getState()
    .selectComparisonPath("compare", "left", "/folder-left", "folder");
  useAppStore
    .getState()
    .selectComparisonPath("compare", "right", "/folder-right", "folder");
  useAppStore.setState({
    comparison: folderComparison,
    selectedPaths,
    expandedPaths,
  });
  const folderTabId = useAppStore.getState().activeTabId;
  const unreadablePath = "/Users/gerald/Documents/Unreadable.md";
  vi.mocked(readFileText).mockImplementation(async (path) => {
    if (path === unreadablePath) throw new Error("Permission denied");
    return fileRead(path);
  });
  mountApp();
  await page.getByRole("button", { name: "New comparison" }).click();
  vi.mocked(openFileDialog).mockResolvedValueOnce(unreadablePath);
  await chooseFirstFile("left");
  await expect
    .element(page.getByText("Permission denied", { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Choose left file" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Choose right file" }))
    .toBeVisible();

  vi.mocked(openFileDialog).mockResolvedValueOnce(leftPath);
  await page.getByRole("button", { name: "Choose left file" }).click();
  vi.mocked(openFileDialog).mockResolvedValueOnce(rightPath);
  await page.getByRole("button", { name: "Choose right file" }).click();
  await expectFixtureDiff();
  const recoveredTab = activeFileTab();
  const recoveredBuffers = useAppStore.getState().fileTabs[recoveredTab.id];
  expect(recoveredBuffers.leftError).toBeNull();
  expect(recoveredBuffers.rightError).toBeNull();
  await expect
    .element(page.getByRole("textbox", { name: "Left file path" }))
    .toHaveValue(leftPath);

  await page.getByRole("button", { name: "Choose right file" }).click();
  expect(openFileDialog).toHaveBeenLastCalledWith(rightPath);
  expect(activeFileTab()).toBe(recoveredTab);
  expect(useAppStore.getState().fileTabs[recoveredTab.id]).toBe(
    recoveredBuffers,
  );
  await page.getByRole("tab").nth(0).click();
  expect(useAppStore.getState()).toMatchObject({
    activeTabId: folderTabId,
    leftPath: "/folder-left",
    rightPath: "/folder-right",
  });
  expect(useAppStore.getState().comparison).toBe(folderComparison);
  expect(useAppStore.getState().selectedPaths).toBe(selectedPaths);
  expect(useAppStore.getState().expandedPaths).toBe(expandedPaths);
  await page.getByRole("tab").nth(1).click();
  await expectFixtureDiff();
  expect(useAppStore.getState().fileTabs[recoveredTab.id]).toBe(
    recoveredBuffers,
  );
  expect(readFileText).not.toHaveBeenCalledWith("");
  expect(openFolderDialog).not.toHaveBeenCalled();
  expect(compareFolders).not.toHaveBeenCalled();
});

it("detects the first dropped file without opening a folder or creating an extra tab", async () => {
  mountApp();
  await vi.waitFor(() => expect(dragHandlers.size).toBe(1));
  const bounds = host!.getBoundingClientRect();
  for (const handler of dragHandlers)
    handler({
      type: "drop",
      x: bounds.left + 10,
      y: bounds.top + 200,
      paths: [leftPath],
    });
  await vi.waitFor(() => expect(readFileText).toHaveBeenCalledWith(leftPath));
  await expect
    .element(page.getByRole("textbox", { name: "Left file path" }))
    .toHaveValue(leftPath);
  expect(activeFileTab()).toMatchObject({
    id: "compare",
    leftFilePath: leftPath,
    rightFilePath: "",
  });
  expect(useAppStore.getState().tabs).toHaveLength(1);
  await vi.waitFor(() => expect(dragHandlers.size).toBe(1));
  for (const handler of dragHandlers)
    handler({
      type: "drop",
      x: bounds.right - 10,
      y: bounds.top + 200,
      paths: [rightPath],
    });
  await expectFixtureDiff();
  expect(openFileDialog).not.toHaveBeenCalled();
  expect(openFolderDialog).not.toHaveBeenCalled();
  expect(compareFolders).not.toHaveBeenCalled();
});
