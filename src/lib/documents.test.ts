import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore, type FileTabBuffer } from "../stores/appStore";
import {
  checkOpenDocuments,
  reloadDocument,
  resolveSaveConflict,
  saveDocumentSide,
} from "./documents";
import {
  readFileText,
  saveDocument,
  fileVersion,
  saveFileDialog,
} from "./tauri";
vi.mock("./tauri", () => ({
  readFileText: vi.fn(),
  saveDocument: vi.fn(),
  fileVersion: vi.fn(),
  saveFileDialog: vi.fn(),
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
  vi.mocked(confirm).mockResolvedValue(true);
  vi.mocked(saveFileDialog).mockResolvedValue(null);
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    tabs: [
      {
        id: "t",
        kind: "file-compare",
        leftFilePath: "/a",
        rightFilePath: "/b",
        displayName: "a ↔ b",
      },
    ],
    activeTabId: "t",
    fileTabs: {},
    saveConflict: null,
    operating: false,
  });
  useAppStore.getState().initFileTab("t");
  useAppStore.getState().setFileTabBuffer("t", "left", buffer());
});
describe("document service", () => {
  it("preserves the displayed alias path during an ordinary save", async () => {
    useAppStore.setState({
      tabs: [
        {
          id: "t",
          kind: "file-compare",
          leftFilePath: "/alias/a.md",
          rightFilePath: "/b",
          displayName: "a.md ↔ b",
        },
      ],
    });
    vi.mocked(saveDocument).mockResolvedValue({
      kind: "saved",
      disk_version: "v2",
      mtime_ms: 200,
    });

    await saveDocumentSide("t", "left");

    expect(saveDocument).toHaveBeenCalledWith("/a", "local", false, "v1");
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      leftFilePath: "/alias/a.md",
      displayName: "a.md ↔ b",
    });
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/a",
      dirty: false,
      diskVersion: "v2",
    });
  });

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
        reason: "changed",
        disk_version: "external1",
        message: "changed",
      })
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "changed",
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
  it("recreates a missing file only after the explicit recreate choice", async () => {
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFile",
        disk_version: null,
        message: "Missing file",
      })
      .mockResolvedValueOnce({
        kind: "saved",
        disk_version: "recreated",
        mtime_ms: 200,
      });
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).toEqual({
        path: "/a",
        message: "Missing file",
        reason: "missingFile",
        side: "left",
      }),
    );
    resolveSaveConflict("recreate");
    await task;
    expect(saveDocument).toHaveBeenNthCalledWith(2, "/a", "local", false, null);
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      dirty: false,
      diskStale: false,
      diskText: "local",
      diskVersion: "recreated",
    });
  });

  it.each([
    ["missingFile", "overwrite"],
    ["missingFile", "reload"],
    ["missingFolder", "overwrite"],
    ["missingFolder", "reload"],
    ["missingFolder", "recreate"],
  ] as const)(
    "rejects the inappropriate %s choice %s",
    async (reason, choice) => {
      vi.mocked(saveDocument).mockResolvedValue({
        kind: "conflict",
        reason,
        disk_version: null,
        message: "Missing",
      });
      const task = saveDocumentSide("t", "left");
      await vi.waitFor(() =>
        expect(useAppStore.getState().saveConflict?.reason).toBe(reason),
      );
      resolveSaveConflict(choice);
      await task;
      expect(saveDocument).toHaveBeenCalledTimes(1);
      expect(readFileText).not.toHaveBeenCalled();
      expect(saveFileDialog).not.toHaveBeenCalled();
      expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
        canonicalPath: "/a",
        text: "local",
        diskText: "old",
        dirty: true,
      });
    },
  );

  it.each(["changed", "missingFile", "missingFolder"] as const)(
    "saves a %s conflict elsewhere without resetting editor identity",
    async (reason) => {
      vi.mocked(saveDocument)
        .mockResolvedValueOnce({
          kind: "conflict",
          reason,
          disk_version: reason === "changed" ? "external-version" : null,
          message: "Save conflict",
        })
        .mockResolvedValueOnce({
          kind: "saved",
          disk_version: "new-file",
          mtime_ms: 200,
        });
      vi.mocked(saveFileDialog).mockResolvedValue("/existing/new.md");
      vi.mocked(fileVersion).mockResolvedValue(null);
      const task = saveDocumentSide("t", "left");
      await vi.waitFor(() =>
        expect(useAppStore.getState().saveConflict?.reason).toBe(reason),
      );
      resolveSaveConflict("saveAs");
      await task;
      expect(saveFileDialog).toHaveBeenCalledWith("/a");
      expect(saveDocument).toHaveBeenNthCalledWith(
        2,
        "/existing/new.md",
        "local",
        false,
        null,
      );
      expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
        canonicalPath: "/existing/new.md",
        documentId: "doc",
        revision: 0,
        dirty: false,
        diskText: "local",
        diskVersion: "new-file",
        saving: false,
      });
      expect(useAppStore.getState().tabs[0]).toMatchObject({
        leftFilePath: "/existing/new.md",
        rightFilePath: "/b",
        displayName: "new.md ↔ b",
      });
    },
  );

  it("keeps the original path and edits when Save As is cancelled", async () => {
    vi.mocked(saveDocument).mockResolvedValue({
      kind: "conflict",
      reason: "missingFolder",
      disk_version: null,
      message: "Missing folder",
    });
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict?.reason).toBe("missingFolder"),
    );
    resolveSaveConflict("saveAs");
    await task;
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(fileVersion).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/a",
      text: "local",
      diskText: "old",
      dirty: true,
      saving: false,
    });
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      leftFilePath: "/a",
    });
  });

  it("keeps the original buffer and path after a failed Save As write", async () => {
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFolder",
        disk_version: null,
        message: "Missing folder",
      })
      .mockRejectedValueOnce(new Error("Cannot save there"));
    vi.mocked(saveFileDialog).mockResolvedValue("/existing/new.md");
    vi.mocked(fileVersion).mockResolvedValue(null);
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).not.toBeNull(),
    );
    resolveSaveConflict("saveAs");
    await task;
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/a",
      text: "local",
      diskText: "old",
      dirty: true,
      saving: false,
      operationError: "Cannot save there",
    });
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      leftFilePath: "/a",
    });
  });

  it("retains edits made while Save As writes the submitted snapshot", async () => {
    const disk = deferred<{
      kind: "saved";
      disk_version: string;
      mtime_ms: number;
    }>();
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFile",
        disk_version: null,
        message: "Missing file",
      })
      .mockReturnValueOnce(disk.promise);
    vi.mocked(saveFileDialog).mockResolvedValue("/existing/new.md");
    vi.mocked(fileVersion).mockResolvedValue(null);
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).not.toBeNull(),
    );
    resolveSaveConflict("saveAs");
    await vi.waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(2));
    useAppStore.getState().setFileTabBufferText("t", "left", "newer", null);
    disk.resolve({ kind: "saved", disk_version: "new-file", mtime_ms: 200 });
    await task;
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/existing/new.md",
      documentId: "doc",
      revision: 1,
      text: "newer",
      diskText: "local",
      dirty: true,
    });
  });

  it("does not write a replaced document after its Save As picker resolves", async () => {
    const selection = deferred<string | null>();
    vi.mocked(saveDocument).mockResolvedValue({
      kind: "conflict",
      reason: "missingFolder",
      disk_version: null,
      message: "Missing folder",
    });
    vi.mocked(saveFileDialog).mockReturnValue(selection.promise);
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).not.toBeNull(),
    );
    resolveSaveConflict("saveAs");
    await vi.waitFor(() => expect(saveFileDialog).toHaveBeenCalled());
    useAppStore.getState().setFileTabBuffer("t", "left", {
      ...buffer(),
      documentId: "replacement",
      canonicalPath: "/replacement",
    });
    selection.resolve("/existing/new.md");
    await task;
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(fileVersion).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      documentId: "replacement",
      canonicalPath: "/replacement",
      diskVersion: "v1",
    });
  });

  it("cancels a pending conflict when its document closes", async () => {
    vi.mocked(saveDocument).mockResolvedValue({
      kind: "conflict",
      reason: "missingFile",
      disk_version: null,
      message: "Missing file",
    });
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).not.toBeNull(),
    );
    useAppStore.getState().closeTab("t");
    await task;
    expect(useAppStore.getState().saveConflict).toBeNull();
    expect(useAppStore.getState().fileTabs.t).toBeUndefined();
    expect(saveDocument).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit overwrite decision for an existing Save As target", async () => {
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFolder",
        disk_version: null,
        message: "Missing folder",
      })
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "changed",
        disk_version: "target-new",
        message: "Destination changed",
      })
      .mockResolvedValueOnce({
        kind: "saved",
        disk_version: "saved-target",
        mtime_ms: 200,
      });
    vi.mocked(saveFileDialog).mockResolvedValue("/existing/new.md");
    vi.mocked(fileVersion).mockResolvedValue("target-before");
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict?.reason).toBe("missingFolder"),
    );
    resolveSaveConflict("saveAs");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).toMatchObject({
        path: "/existing/new.md",
        reason: "changed",
        side: "left",
        isSaveAs: true,
      }),
    );
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      leftFilePath: "/a",
    });
    expect(fileVersion).not.toHaveBeenCalled();
    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(saveDocument).toHaveBeenNthCalledWith(
      2,
      "/existing/new.md",
      "local",
      false,
      null,
    );
    resolveSaveConflict("overwrite");
    await task;
    expect(saveDocument).toHaveBeenNthCalledWith(
      2,
      "/existing/new.md",
      "local",
      false,
      null,
    );
    expect(saveDocument).toHaveBeenNthCalledWith(
      3,
      "/existing/new.md",
      "local",
      false,
      "target-new",
    );
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/existing/new.md",
      diskVersion: "saved-target",
      dirty: false,
    });
  });

  it("preserves a file that appears at the Save As target while the picker is open", async () => {
    const selection = deferred<string | null>();
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFolder",
        disk_version: null,
        message: "Missing folder",
      })
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "changed",
        disk_version: "newly-created-file",
        message: "Destination already exists",
      });
    vi.mocked(saveFileDialog).mockReturnValue(selection.promise);
    vi.mocked(fileVersion).mockResolvedValue("newly-created-file");
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict?.reason).toBe("missingFolder"),
    );
    resolveSaveConflict("saveAs");
    await vi.waitFor(() => expect(saveFileDialog).toHaveBeenCalled());
    selection.resolve("/existing/new.md");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).toMatchObject({
        path: "/existing/new.md",
        reason: "changed",
        isSaveAs: true,
      }),
    );
    expect(fileVersion).not.toHaveBeenCalled();
    expect(saveDocument).toHaveBeenNthCalledWith(
      2,
      "/existing/new.md",
      "local",
      false,
      null,
    );
    resolveSaveConflict("cancel");
    await task;
    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/a",
      text: "local",
      diskText: "old",
      dirty: true,
    });
  });

  it("offers recovery again when Save As selects the same unavailable folder", async () => {
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFolder",
        disk_version: null,
        message: "Missing folder",
      })
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFolder",
        disk_version: null,
        message: "Still missing",
      });
    vi.mocked(saveFileDialog).mockResolvedValue("/a");
    vi.mocked(fileVersion).mockResolvedValue(null);
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict?.message).toBe(
        "Missing folder",
      ),
    );
    resolveSaveConflict("saveAs");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict?.message).toBe(
        "Still missing",
      ),
    );
    resolveSaveConflict("cancel");
    await task;
    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/a",
      dirty: true,
      operationError: null,
    });
  });

  it("reloads a changed Save As destination instead of the original missing file", async () => {
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFolder",
        disk_version: null,
        message: "Missing folder",
      })
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "changed",
        disk_version: "target-new",
        message: "Destination changed",
      });
    vi.mocked(saveFileDialog).mockResolvedValue("/existing/new.md");
    vi.mocked(fileVersion).mockResolvedValue("target-before");
    vi.mocked(readFileText).mockResolvedValue({
      text: "destination content",
      bom: false,
      canonical_path: "/existing/new.md",
      disk_version: "target-new",
      mtime_ms: 200,
      size: 19,
    });
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict?.reason).toBe("missingFolder"),
    );
    resolveSaveConflict("saveAs");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict?.reason).toBe("changed"),
    );
    resolveSaveConflict("reload");
    await task;
    expect(readFileText).toHaveBeenCalledWith("/existing/new.md");
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/existing/new.md",
      text: "destination content",
      diskText: "destination content",
      diskVersion: "target-new",
      dirty: false,
    });
    expect(useAppStore.getState().fileTabs.t.left!.documentId).not.toBe("doc");
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      leftFilePath: "/existing/new.md",
    });
  });

  it("does not change a replacement document when a Save As write finishes", async () => {
    const disk = deferred<{
      kind: "saved";
      disk_version: string;
      mtime_ms: number;
    }>();
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFile",
        disk_version: null,
        message: "Missing file",
      })
      .mockReturnValueOnce(disk.promise);
    vi.mocked(saveFileDialog).mockResolvedValue("/existing/new.md");
    vi.mocked(fileVersion).mockResolvedValue(null);
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).not.toBeNull(),
    );
    resolveSaveConflict("saveAs");
    await vi.waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(2));
    useAppStore.getState().setFileTabBuffer("t", "left", {
      ...buffer(),
      documentId: "replacement",
      canonicalPath: "/replacement",
    });
    disk.resolve({
      kind: "saved",
      disk_version: "saved-target",
      mtime_ms: 200,
    });
    await task;
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/replacement",
      documentId: "replacement",
      diskVersion: "v1",
      diskText: "old",
      dirty: true,
    });
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      leftFilePath: "/a",
    });
  });

  it("queues subsequent edits against the new path after Save As succeeds", async () => {
    const disk = deferred<{
      kind: "saved";
      disk_version: string;
      mtime_ms: number;
    }>();
    vi.mocked(saveDocument)
      .mockResolvedValueOnce({
        kind: "conflict",
        reason: "missingFile",
        disk_version: null,
        message: "Missing file",
      })
      .mockReturnValueOnce(disk.promise)
      .mockResolvedValueOnce({
        kind: "saved",
        disk_version: "saved-newer",
        mtime_ms: 300,
      });
    vi.mocked(saveFileDialog).mockResolvedValue("/existing/new.md");
    vi.mocked(fileVersion).mockResolvedValue(null);
    const first = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).not.toBeNull(),
    );
    resolveSaveConflict("saveAs");
    await vi.waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(2));
    useAppStore.getState().setFileTabBufferText("t", "left", "newer", null);
    const second = saveDocumentSide("t", "left");
    expect(saveDocument).toHaveBeenCalledTimes(2);
    disk.resolve({
      kind: "saved",
      disk_version: "saved-target",
      mtime_ms: 200,
    });
    await Promise.all([first, second]);
    expect(saveDocument).toHaveBeenNthCalledWith(
      3,
      "/existing/new.md",
      "newer",
      false,
      "saved-target",
    );
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      canonicalPath: "/existing/new.md",
      text: "newer",
      diskText: "newer",
      dirty: false,
      diskVersion: "saved-newer",
    });
  });

  it("blocks recovery retries when a filesystem operation starts", async () => {
    vi.mocked(saveDocument).mockResolvedValue({
      kind: "conflict",
      reason: "missingFile",
      disk_version: null,
      message: "Missing file",
    });
    const task = saveDocumentSide("t", "left");
    await vi.waitFor(() =>
      expect(useAppStore.getState().saveConflict).not.toBeNull(),
    );
    useAppStore.setState({ operating: true });
    resolveSaveConflict("recreate");
    await task;
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().fileTabs.t.left).toMatchObject({
      dirty: true,
      operationError:
        "A filesystem operation is running. Save again after it finishes.",
    });
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
  it("keeps unsaved edits and skips the disk read when reload is cancelled", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const before = {
      ...buffer(),
      diskStale: true,
      yellowRanges: [{ start: 1, end: 2 }],
    };
    useAppStore.getState().setFileTabBuffer("t", "left", before);

    await reloadDocument("t", "left");

    expect(confirm).toHaveBeenCalledWith("Discard changes on this side?", {
      title: "Reload left file from disk",
      kind: "warning",
      okLabel: "Discard and reload",
      cancelLabel: "Cancel",
    });
    expect(readFileText).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileTabs.t.left).toBe(before);
  });
  it("preserves unsaved edits and reports a failed reload on its own side", async () => {
    const leftBefore = useAppStore.getState().fileTabs.t.left;
    const rightBefore = {
      ...buffer(),
      documentId: "right-doc",
      canonicalPath: "/b",
      diskStale: true,
      yellowRanges: [{ start: 1, end: 2 }],
    };
    useAppStore.getState().setFileTabBuffer("t", "right", rightBefore);
    const message =
      "This file could not be found. It may have been moved or deleted.";
    vi.mocked(readFileText).mockRejectedValue(new Error(message));

    await reloadDocument("t", "right");

    expect(confirm).toHaveBeenCalledWith("Discard changes on this side?", {
      title: "Reload right file from disk",
      kind: "warning",
      okLabel: "Discard and reload",
      cancelLabel: "Cancel",
    });
    expect(readFileText).toHaveBeenCalledWith("/b");
    expect(useAppStore.getState().fileTabs.t.right).toEqual({
      ...rightBefore,
      operationError: message,
    });
    expect(useAppStore.getState().fileTabs.t.left).toBe(leftBefore);
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
