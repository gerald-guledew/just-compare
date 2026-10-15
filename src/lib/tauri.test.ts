import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openFileDialog, openFolderDialog, saveFileDialog } from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(open).mockResolvedValue(null);
  vi.mocked(save).mockResolvedValue(null);
});

describe("save picker", () => {
  it.each([
    {
      path: "/work/deleted/nested/file.md",
      parent: "/work",
      expected: "/work/file.md",
    },
    {
      path: "C:\\work\\deleted\\file.md",
      parent: "C:\\work",
      expected: "C:\\work\\file.md",
    },
    { path: "/deleted/file.md", parent: "/", expected: "/file.md" },
  ])(
    "keeps the filename while falling back to $parent",
    async ({ path, parent, expected }) => {
      vi.mocked(invoke).mockResolvedValue(parent);
      vi.mocked(save).mockResolvedValue(expected);
      expect(await saveFileDialog(path)).toBe(expected);
      expect(save).toHaveBeenCalledWith({
        title: "Save edited file as",
        defaultPath: expected,
      });
    },
  );

  it("keeps an existing file as the proposed save target", async () => {
    vi.mocked(invoke).mockResolvedValue("/work/file.md");
    await saveFileDialog("/work/file.md");
    expect(save).toHaveBeenCalledWith({
      title: "Save edited file as",
      defaultPath: "/work/file.md",
    });
  });

  it("keeps only the filename when optional path lookup is unavailable", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await saveFileDialog("/unavailable/parent/file.md");
    expect(save).toHaveBeenCalledWith({
      title: "Save edited file as",
      defaultPath: "file.md",
    });
  });

  it("returns cancellation without resolving an absent path", async () => {
    expect(await saveFileDialog()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({
      title: "Save edited file as",
      defaultPath: undefined,
    });
  });
});

describe.each([
  { kind: "file", directory: false, picker: openFileDialog },
  { kind: "folder", directory: true, picker: openFolderDialog },
])("$kind picker", ({ directory, picker }) => {
  it.each(["/work/removed/file.md", "/work/removed/nested-folder"])(
    "opens the existing ancestor returned for a missing path: %s",
    async (path) => {
      vi.mocked(invoke).mockResolvedValue("/work");
      vi.mocked(open).mockResolvedValue("/work/replacement.md");

      expect(await picker(path)).toBe("/work/replacement.md");

      expect(invoke).toHaveBeenCalledExactlyOnceWith("dialog_default_path", {
        path,
      });
      expect(open).toHaveBeenCalledExactlyOnceWith({
        directory,
        multiple: false,
        defaultPath: "/work",
      });
    },
  );

  it.each(["/work/existing.md", "/work/existing-folder"])(
    "preserves an existing default path returned by the backend: %s",
    async (path) => {
      vi.mocked(invoke).mockResolvedValue(path);

      await picker(path);

      expect(open).toHaveBeenCalledExactlyOnceWith({
        directory,
        multiple: false,
        defaultPath: path,
      });
    },
  );

  it("opens at the native default location when no ancestor is available", async () => {
    vi.mocked(invoke).mockResolvedValue(null);

    await picker("unavailable");

    expect(open).toHaveBeenCalledExactlyOnceWith({
      directory,
      multiple: false,
      defaultPath: undefined,
    });
  });

  it("returns null when the resolved picker is cancelled", async () => {
    vi.mocked(invoke).mockResolvedValue("/work");

    expect(await picker("/work/deleted")).toBeNull();
    expect(open).toHaveBeenCalledOnce();
  });

  it("skips path resolution when no current path is provided", async () => {
    await picker();

    expect(invoke).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledExactlyOnceWith({
      directory,
      multiple: false,
      defaultPath: undefined,
    });
  });

  it("waits for path resolution before opening the native picker", async () => {
    let resolvePath!: (path: string | null) => void;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolvePath = resolve;
      }),
    );

    const pendingPicker = picker("/work/deleted");
    expect(open).not.toHaveBeenCalled();
    resolvePath("/work");
    await pendingPicker;

    expect(open).toHaveBeenCalledExactlyOnceWith({
      directory,
      multiple: false,
      defaultPath: "/work",
    });
  });
});
