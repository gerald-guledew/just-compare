import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, type FileTabBuffer } from "../stores/appStore";
import {
  checkOpenDocuments,
  reloadDocument,
  resolveSaveConflict,
  saveDocumentSide,
} from "./documents";
import { readFileText, saveDocument, fileVersion } from "./tauri";
vi.mock("./tauri", () => ({
  readFileText: vi.fn(),
  saveDocument: vi.fn(),
  fileVersion: vi.fn(),
}));
vi.mock("./persistence", () => ({
  savePaths: vi.fn(),
  saveComparisonMode: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));
function buffer(): FileTabBuffer {
  return {
    documentId: "doc",
    revision: 0,
    canonicalPath: "/a",
    diskVersion: "v1",
    bom: false,
    saving: false,
    operationError: null,
    text: "local",
    diskText: "old",
    mtimeMs: 100,
    terminator: "\n",
    dirty: true,
    diskStale: false,
    yellowRanges: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState({ fileTabs: {}, saveConflict: null, operating: false });
  useAppStore.getState().initFileTab("t");
  useAppStore.getState().setFileTabBuffer("t", "left", buffer());
});
describe("document service", () => {
  it("coalesces repeated saves and keeps subsequent edits dirty", async () => {
    const disk = deferred<{
      kind: "saved";
      disk_version: string;
      mtime_ms: number;
    }>();
    vi.mocked(saveDocument).mockReturnValue(disk.promise);
    const first = saveDocumentSide("t", "left"),
      second = saveDocumentSide("t", "left");
    expect(first).toBe(second);
    await vi.waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    useAppStore.getState().setFileTabBufferText("t", "left", "newer", null);
    disk.resolve({ kind: "saved", disk_version: "v2", mtime_ms: 200 });
    await first;
    expect(useAppStore.getState().fileTabs.t.left!.diskText).toBe("local");
    expect(useAppStore.getState().fileTabs.t.left!.dirty).toBe(true);
  });
  it("ignores completion for a changed path/document", async () => {
    const disk = deferred<{
      kind: "saved";
      disk_version: string;
      mtime_ms: number;
    }>();
    vi.mocked(saveDocument).mockReturnValue(disk.promise);
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() => expect(saveDocument).toHaveBeenCalled());
    useAppStore.getState().setFileTabBuffer("t", "left", {
      ...buffer(),
      documentId: "replacement",
      canonicalPath: "/b",
    });
    disk.resolve({ kind: "saved", disk_version: "v2", mtime_ms: 200 });
    await task;
    expect(useAppStore.getState().fileTabs.t.left!.diskVersion).toBe("v1");
  });
  it("shows failures without clearing unsaved edits", async () => {
    vi.mocked(saveDocument).mockRejectedValue("permission denied");
    await saveDocumentSide("t", "left");
    const buf = useAppStore.getState().fileTabs.t.left!;
    expect(buf.dirty).toBe(true);
    expect(buf.saving).toBe(false);
    expect(buf.operationError).toBe("permission denied");
  });
  it("requires a decision for each new external conflict", async () => {
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        disk_version: "external1",
        message: "changed",
      })
      .mockResolvedValueOnce({
        kind: "conflict",
        disk_version: "external2",
        message: "changed again",
      });
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).not.toBeNull(),
    );
    resolveSaveConflict("overwrite");
    await vi.waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveDocument).mock.calls[1][3]).toBe("external1");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict?.message).toBe(
        "changed again",
      ),
    );
    resolveSaveConflict("cancel");
    await task;
    expect(useAppStore.getState().fileTabs.t.left!.dirty).toBe(true);
  });
  it("marks dirty buffers stale even when disk timestamps go backward", async () => {
    vi.mocked(fileVersion).mockResolvedValue("changed-with-old-timestamp");
    await checkOpenDocuments();
    expect(useAppStore.getState().fileTabs.t.left!.diskStale).toBe(true);
  });
  it("reloads through the document service with fresh identity, version, and newline metadata", async () => {
    vi.mocked(readFileText).mockResolvedValue({
      text: "new\r\ncontent\r\n",
      bom: true,
      canonical_path: "/a",
      disk_version: "v2",
      mtime_ms: 900,
      size: 14,
    });
    const before = useAppStore.getState().fileTabs.t.left!;
    useAppStore.getState().setFileTabBuffer("t", "left", {
      ...before,
      dirty: false,
      diskStale: true,
      yellowRanges: [{ start: 1, end: 2 }],
    });
    await reloadDocument("t", "left", false);
    const after = useAppStore.getState().fileTabs.t.left!;
    expect(after.text).toBe("new\r\ncontent\r\n");
    expect(after.diskText).toBe(after.text);
    expect(after.documentId).not.toBe(before.documentId);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.diskVersion).toBe("v2");
    expect(after.bom).toBe(true);
    expect(after.terminator).toBe("\r\n");
    expect(after.dirty).toBe(false);
    expect(after.diskStale).toBe(false);
    expect(after.yellowRanges).toEqual([]);
  });
  it("does not let reload overwrite edits made while reading", async () => {
    useAppStore
      .getState()
      .setFileTabBuffer("t", "left", { ...buffer(), dirty: false });
    const read = deferred<Awaited<ReturnType<typeof readFileText>>>();
    vi.mocked(readFileText).mockReturnValue(read.promise);
    const task = reloadDocument("t", "left", false);
    useAppStore.getState().setFileTabBufferText("t", "left", "new edit", null);
    read.resolve({
      text: "disk",
      bom: false,
      canonical_path: "/a",
      disk_version: "v2",
      mtime_ms: 1,
      size: 4,
    });
    await task;
    expect(useAppStore.getState().fileTabs.t.left!.text).toBe("new edit");
  });
});
