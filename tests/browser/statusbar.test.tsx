import { afterEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import {
  StatusBar,
  type FileDiffSummary,
} from "../../src/components/StatusBar";
import { useAppStore, type FileTabBuffer } from "../../src/stores/appStore";
import type {
  ComparisonEntry,
  ComparisonStatus,
  FileEntry,
} from "../../src/types";
import "../../src/styles/globals.css";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(
  comparison: ComparisonEntry[] | null,
  fileDiff?: FileDiffSummary,
) {
  host = document.createElement("div");
  host.style.width = "1200px";
  document.body.append(host);
  root = createRoot(host);
  root.render(<StatusBar comparison={comparison} fileDiff={fileDiff} />);
}

function entry(
  status: ComparisonStatus,
  children: ComparisonEntry[] | null = null,
): ComparisonEntry {
  const source: FileEntry = {
    name: status.startsWith("Directory") ? "example-folder" : "example.txt",
    relative_path: "example",
    is_directory: status.startsWith("Directory"),
    size: 10,
    modified: 1,
    children: null,
  };
  return {
    left:
      status === "RightOnly" || status === "DirectoryRightOnly" ? null : source,
    right:
      status === "LeftOnly" || status === "DirectoryLeftOnly" ? null : source,
    status,
    children,
  };
}

function buffer(documentId: string, text: string): FileTabBuffer {
  return {
    documentId,
    revision: 0,
    canonicalPath: `/samples/${documentId}.txt`,
    diskVersion: "version-1",
    bom: false,
    saving: false,
    operationError: null,
    text,
    diskText: text,
    mtimeMs: 1,
    terminator: "\n",
    dirty: false,
    yellowRanges: [],
    diskStale: false,
  };
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

it("separates nested files from folders even when the tree is collapsed", async () => {
  const comparison = [
    entry("DirectoryLeftOnly", [
      entry("LeftOnly"),
      entry("LeftOnly"),
      entry("DirectoryLeftOnly", [entry("LeftOnly")]),
    ]),
    entry("DirectoryRightOnly", [entry("RightOnly"), entry("RightOnly")]),
    entry("DirectoryBoth", [
      entry("Identical"),
      entry("MetadataMatch"),
      entry("Modified"),
    ]),
  ];
  useAppStore.setState({
    activeTabId: "folder-summary",
    tabs: [{ id: "folder-summary", kind: "folder-compare" }],
    expandedPaths: new Set(),
    fileTabs: {},
  });
  mount(comparison);
  const summary = page.getByRole("group", {
    name: "Folder comparison summary",
  });
  await expect.element(summary).toHaveTextContent("All nested items");
  await expect
    .element(summary)
    .toHaveTextContent("1 file identical by content");
  await expect
    .element(summary)
    .toHaveTextContent("1 file matching size and time");
  await expect
    .element(summary)
    .toHaveTextContent("Modified: 1 file, 0 folders");
  await expect
    .element(summary)
    .toHaveTextContent("Left-only: 3 files, 2 folders");
  await expect
    .element(summary)
    .toHaveTextContent("Right-only: 2 files, 1 folder");
  await expect
    .element(page.getByText("All nested items", { exact: true }))
    .toHaveAttribute(
      "title",
      "Counts include all nested items, even inside collapsed folders. Matched paths count once.",
    );
  await expect
    .element(page.getByText("1 file matching size and time", { exact: true }))
    .toHaveAttribute(
      "title",
      "File pairs with matching size and modification time. Their contents have not been checked.",
    );
  const before = host?.textContent;
  useAppStore.setState({ expandedPaths: new Set(["example"]) });
  await vi.waitFor(() => expect(host?.textContent).toBe(before));
});

it("describes positional line changes without altering their totals", async () => {
  useAppStore.setState({
    activeTabId: "file-summary",
    tabs: [
      {
        id: "file-summary",
        kind: "file-compare",
        leftFilePath: "/samples/left.txt",
        rightFilePath: "/samples/right.txt",
        displayName: "Example",
      },
    ],
    fileTabs: {
      "file-summary": {
        left: buffer("left", "one\n\nthree"),
        right: buffer("right", "one\n\nthree\nfour"),
        leftError: null,
        rightError: null,
      },
    },
  });
  mount(null, {
    tabId: "file-summary",
    left: { documentId: "left", revision: 0 },
    right: { documentId: "right", revision: 0 },
    loading: false,
    error: false,
    differences: { blocks: 9, changed: 4, leftOnly: 4, rightOnly: 5 },
  });
  const summary = page.getByRole("group", { name: "File comparison summary" });
  await expect.element(summary).toHaveTextContent("Left: 3 lines · 2 words");
  await expect.element(summary).toHaveTextContent("Right: 4 lines · 3 words");
  await expect
    .element(summary)
    .toHaveTextContent(
      "9 difference groups · 4 changed line pairs · 4 left-only lines · 5 right-only lines",
    );
  const detail = host?.querySelector('span[title*="Moved text"]');
  expect(detail?.getAttribute("title")).toContain("including blank lines");
  expect(detail?.getAttribute("title")).toContain(
    "Moved text can count on both sides at different positions.",
  );
  await expect.element(summary).not.toHaveTextContent("removed");
  await expect.element(summary).not.toHaveTextContent("added");
});
