import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
import * as monaco from "monaco-editor";
import App from "../../src/App";
import "../../src/styles/globals.css";
import { useAppStore } from "../../src/stores/appStore";
import {
  loadPaths,
  loadWordWrap,
  saveWordWrap,
} from "../../src/lib/persistence";
import { diffText, readFileText } from "../../src/lib/tauri";
import type { DiffLine, FileDiffResult, FileReadResult } from "../../src/types";

vi.mock("../../src/lib/persistence", () => ({
  loadPaths: vi.fn(),
  loadComparisonMode: vi.fn().mockResolvedValue("Quick"),
  loadWordWrap: vi.fn(),
  savePaths: vi.fn().mockResolvedValue(undefined),
  saveComparisonMode: vi.fn().mockResolvedValue(undefined),
  saveWordWrap: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/lib/tauri", () => ({
  readFileText: vi.fn(),
  saveDocument: vi.fn(),
  saveFileDialog: vi.fn().mockResolvedValue(null),
  openFileDialog: vi.fn().mockResolvedValue(null),
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
  comparisonPathKind: vi.fn().mockResolvedValue("file"),
  onOsFileDrag: vi.fn().mockResolvedValue(() => {}),
  fileVersion: vi.fn(async (path: string) => `version:${path}`),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  message: vi.fn(),
}));

const leftPath = "/fixtures/HalterIntermediateEngineers.md";
const rightPath = "/fixtures/HalterSeniorEngineers.md";
const paragraph = "Build dependable systems and collaborate across teams. ";
const longUrl = `https://example.test/engineering/${"reference-segment/".repeat(70)}`;
const leftRows = [
  "# Engineering roles",
  `Left-only introduction: ${paragraph.repeat(16)}`,
  "Shared responsibilities",
  "Deliver features.",
  "Next aligned section",
  longUrl,
  "Shared end marker",
  `Left-only appendix: ${paragraph.repeat(10)}`,
];
const rightRows = [
  `Right-only introduction: ${paragraph.repeat(12)}`,
  "# Engineering roles",
  "Shared responsibilities",
  `Lead technical direction: ${paragraph.repeat(20)}`,
  "Next aligned section",
  "https://example.test/senior",
  "Shared end marker",
  `Right-only appendix: ${longUrl}`,
];
const leftText = leftRows.join("\n");
const rightText = rightRows.join("\n");
const rowPairs: Array<[number | null, number | null]> = [
  [null, 1],
  [1, 2],
  [2, null],
  [3, 3],
  [4, 4],
  [5, 5],
  [6, 6],
  [7, 7],
  [8, null],
  [null, 8],
];

function fixtureDiff(left: string, right: string): FileDiffResult {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const lines = rowPairs.map<DiffLine>(([leftNum, rightNum]) => {
    const leftLine = leftNum === null ? null : leftLines[leftNum - 1];
    const rightLine = rightNum === null ? null : rightLines[rightNum - 1];
    const kind =
      leftLine === null
        ? "Insert"
        : rightLine === null
          ? "Delete"
          : leftLine === rightLine
            ? "Equal"
            : "Replace";
    return {
      kind,
      left_num: leftNum,
      right_num: rightNum,
      left:
        leftLine === null
          ? null
          : [{ text: leftLine, changed: kind !== "Equal" }],
      right:
        rightLine === null
          ? null
          : [{ text: rightLine, changed: kind !== "Equal" }],
    };
  });
  return { binary: false, too_large: false, lines };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function fixtureRead(path: string): FileReadResult {
  const text = path === leftPath ? leftText : rightText;
  if (path !== leftPath && path !== rightPath)
    throw new Error(`Unexpected fixture path: ${path}`);
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

function editors() {
  const state = useAppStore.getState();
  const buffers = state.fileTabs[state.activeTabId];
  const all = monaco.editor.getEditors();
  const left = all.find(
    (ed) => ed.getModel()?.uri.path === `/${buffers?.left?.documentId}`,
  );
  const right = all.find(
    (ed) => ed.getModel()?.uri.path === `/${buffers?.right?.documentId}`,
  );
  if (!left || !right) throw new Error("Expected both real Monaco editors");
  return { left, right };
}

async function openFixture() {
  useAppStore.getState().openFilePairTab(leftPath, rightPath);
  await vi.waitFor(() => {
    const { left, right } = editors();
    expect(left.getModel()?.getValue()).toBe(leftText);
    expect(right.getModel()?.getValue()).toBe(rightText);
    expect(left.getLayoutInfo().width).toBeGreaterThan(300);
    expect(left.getLayoutInfo().height).toBeGreaterThan(200);
    expect(left.getModel()?.getAllDecorations().length).toBeGreaterThan(0);
    expectAlignedRows();
  });
  return editors();
}

function expectAlignedRows() {
  const { left, right } = editors();
  for (const [leftNum, rightNum] of rowPairs) {
    if (leftNum === null || rightNum === null) continue;
    expect(
      Math.abs(
        left.getTopForLineNumber(leftNum) - right.getTopForLineNumber(rightNum),
      ),
      `Aligned logical row ${leftNum} / ${rightNum}`,
    ).toBeLessThanOrEqual(1);
  }
  expect(
    Math.abs(left.getContentHeight() - right.getContentHeight()),
  ).toBeLessThanOrEqual(1);
}

function lineHeight(ed: monaco.editor.ICodeEditor, line: number) {
  return ed.getBottomForLineNumber(line) - ed.getTopForLineNumber(line);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPaths).mockResolvedValue({ leftPath: null, rightPath: null });
  vi.mocked(loadWordWrap).mockResolvedValue(false);
  vi.mocked(readFileText).mockImplementation(async (path) => fixtureRead(path));
  vi.mocked(diffText).mockImplementation(async (left, right) =>
    fixtureDiff(left, right),
  );
  useAppStore.setState({
    leftPath: null,
    rightPath: null,
    comparison: null,
    comparisonMode: "Quick",
    wordWrap: false,
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
    fileTabs: {},
    saveConflict: null,
  });
});

afterEach(async () => {
  root?.unmount();
  root = null;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  host?.remove();
  host = null;
  useAppStore.setState({ fileTabs: {}, wordWrap: false });
  for (const model of monaco.editor.getModels()) model.dispose();
});

it("aligns asymmetric wrapped Markdown and URLs through pane resizing and toggling", async () => {
  mountApp();
  await expect
    .element(page.getByRole("button", { name: "New comparison", exact: true }))
    .toBeVisible();
  expect(host?.querySelector("button[aria-pressed]")).toBeNull();
  const { left, right } = await openFixture();
  const wrap = page.getByRole("button", { name: "Wrap Text", exact: true });
  await expect.element(wrap).toHaveAttribute("aria-pressed", "false");
  const normalLineHeight = left.getOption(
    monaco.editor.EditorOption.lineHeight,
  );
  const unwrappedTop = left.getTopForLineNumber(7);
  const leftModel = left.getModel();
  const rightModel = right.getModel();

  await wrap.click();
  await vi.waitFor(() => {
    expect(left.getOption(monaco.editor.EditorOption.wordWrap)).toBe("on");
    expect(right.getOption(monaco.editor.EditorOption.wordWrap)).toBe("on");
    expect(lineHeight(right, 4)).toBeGreaterThan(normalLineHeight * 3);
    expect(lineHeight(left, 6)).toBeGreaterThan(normalLineHeight * 3);
    expectAlignedRows();
  });
  await expect.element(wrap).toHaveAttribute("aria-pressed", "true");
  expect(saveWordWrap).toHaveBeenLastCalledWith(true);

  const beforeResizeWidth = left.getLayoutInfo().width;
  const beforeResizeTop = left.getTopForLineNumber(7);
  host!.style.width = "860px";
  await vi.waitFor(() => {
    expect(left.getLayoutInfo().width).toBeLessThan(beforeResizeWidth);
    expect(left.getTopForLineNumber(7)).toBeGreaterThan(beforeResizeTop);
    expectAlignedRows();
  });
  const minimap = host!.querySelector('[aria-label="Diff minimap"]');
  const markers = minimap?.querySelectorAll<HTMLElement>(".bg-red-400");
  expect(markers?.length).toBe(6);
  const replacementMarkerTop = Number.parseFloat(markers![2].style.top);
  expect(replacementMarkerTop).toBeCloseTo(
    (left.getTopForLineNumber(4) / left.getContentHeight()) * 100,
    1,
  );

  await wrap.click();
  await vi.waitFor(() => {
    expect(left.getOption(monaco.editor.EditorOption.wordWrap)).toBe("off");
    expect(right.getOption(monaco.editor.EditorOption.wordWrap)).toBe("off");
    expect(lineHeight(right, 4)).toBe(normalLineHeight);
    expect(lineHeight(left, 6)).toBe(normalLineHeight);
    expect(left.getTopForLineNumber(7)).toBe(unwrappedTop);
    expectAlignedRows();
  });
  expect(left.getModel()).toBe(leftModel);
  expect(right.getModel()).toBe(rightModel);
  expect(left.getModel()?.getValue()).toBe(leftText);
  expect(right.getModel()?.getValue()).toBe(rightText);
  expect(
    useAppStore.getState().fileTabs[useAppStore.getState().activeTabId].left
      ?.dirty,
  ).toBe(false);
  expect(
    useAppStore.getState().fileTabs[useAppStore.getState().activeTabId].right
      ?.dirty,
  ).toBe(false);
});

it("shares Alt+Z between panes and keeps undo history across wrapping changes", async () => {
  mountApp();
  await expect
    .element(page.getByRole("button", { name: "New comparison", exact: true }))
    .toBeVisible();
  const { left, right } = await openFixture();
  const model = left.getModel()!;
  const originalModel = model;
  const column = model.getLineMaxColumn(4);
  left.pushUndoStop();
  left.executeEdits("typing", [
    {
      range: new monaco.Range(4, column, 4, column),
      text: " Typed edit.",
    },
  ]);
  left.pushUndoStop();
  await vi.waitFor(() =>
    expect(
      useAppStore.getState().fileTabs[useAppStore.getState().activeTabId].left
        ?.dirty,
    ).toBe(true),
  );
  const editedText = model.getValue();

  left.focus();
  await userEvent.keyboard("{Alt>}z{/Alt}");
  await vi.waitFor(() => {
    expect(left.getOption(monaco.editor.EditorOption.wordWrap)).toBe("on");
    expect(right.getOption(monaco.editor.EditorOption.wordWrap)).toBe("on");
    expectAlignedRows();
  });
  expect(model.getValue()).toBe(editedText);
  right.focus();
  await userEvent.keyboard("{Alt>}z{/Alt}");
  await vi.waitFor(() => {
    expect(left.getOption(monaco.editor.EditorOption.wordWrap)).toBe("off");
    expect(right.getOption(monaco.editor.EditorOption.wordWrap)).toBe("off");
  });
  expect(left.getModel()).toBe(originalModel);
  await model.undo();
  await vi.waitFor(() => expect(model.getValue()).toBe(leftText));
  expect(right.getModel()?.getValue()).toBe(rightText);
  await model.redo();
  await vi.waitFor(() => expect(model.getValue()).toBe(editedText));
});
