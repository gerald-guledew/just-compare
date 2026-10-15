import { afterEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
import { PaneHeader } from "../../src/components/PaneHeader";
import { openFileDialog, openFolderDialog } from "../../src/lib/tauri";
import "../../src/styles/globals.css";

vi.mock("../../src/lib/tauri", () => ({
  openFileDialog: vi.fn().mockResolvedValue(null),
  openFolderDialog: vi.fn().mockResolvedValue(null),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mountHeader(
  path: string,
  kind: "file" | "folder",
  onPathCommit = vi.fn().mockResolvedValue(undefined),
) {
  host = document.createElement("div");
  host.style.width = "450px";
  document.body.append(host);
  root = createRoot(host);
  root.render(
    <PaneHeader
      side="left"
      path={path}
      itemKind={kind}
      onPathCommit={onPathCommit}
    />,
  );
  return onPathCommit;
}

function pathInput() {
  const input = host?.querySelector("input");
  if (!input) throw new Error("Expected a path input");
  return input;
}

async function expectPathEndVisible() {
  await vi.waitFor(() => {
    const input = pathInput();
    expect(input.scrollWidth).toBeGreaterThan(input.clientWidth);
    expect(input.scrollLeft).toBeGreaterThan(0);
    expect(
      input.scrollWidth - input.clientWidth - input.scrollLeft,
    ).toBeLessThan(3);
    expect(getComputedStyle(input).textAlign).toBe("right");
  });
}

async function expectPathFits() {
  await vi.waitFor(() => {
    const input = pathInput();
    expect(input.scrollWidth).toBe(input.clientWidth);
    expect(input.scrollLeft).toBe(0);
    expect(getComputedStyle(input).textAlign).toBe("left");
  });
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  vi.clearAllMocks();
});

it.each(["file", "folder"] as const)(
  "shows the end of long %s paths on load, replacement and resize",
  async (kind) => {
    const path = `/samples/shared-storage/team-documents/releases/archive/versions/engineering/${kind === "file" ? "OriginalProjectNotes.md" : "OriginalProjectReleaseArchive"}`;
    const onPathCommit = mountHeader(path, kind);
    await expectPathEndVisible();
    const input = pathInput();
    expect(getComputedStyle(input).textAlign).toBe("right");
    expect(getComputedStyle(input).direction).toBe("ltr");
    expect(input.title).toBe(path);
    const replacement = `${path}/longer-replacement-path`;
    root?.render(
      <PaneHeader
        side="left"
        path={replacement}
        itemKind={kind}
        onPathCommit={onPathCommit}
      />,
    );
    await vi.waitFor(() => expect(input.value).toBe(replacement));
    await expectPathEndVisible();
    if (!host) throw new Error("Expected a header host");
    host.style.width = "280px";
    await expectPathEndVisible();

    await page.getByRole("button", { name: `Choose left ${kind}` }).click();
    expect(
      kind === "file" ? openFileDialog : openFolderDialog,
    ).toHaveBeenCalledWith(replacement);
  },
);

it.each(["file", "folder"] as const)(
  "left-aligns %s paths that fit and restores that alignment after replacement",
  async (kind) => {
    const shortPath = kind === "file" ? "/tmp/example.md" : "/tmp/example";
    const onPathCommit = mountHeader(shortPath, kind);
    await expectPathFits();
    const input = pathInput();
    const longPath = `/samples/shared-storage/team-documents/releases/archive/versions/engineering/${kind === "file" ? "OriginalProjectNotes.md" : "OriginalProjectReleaseArchive"}`;
    root?.render(
      <PaneHeader
        side="left"
        path={longPath}
        itemKind={kind}
        onPathCommit={onPathCommit}
      />,
    );
    await vi.waitFor(() => expect(input.value).toBe(longPath));
    await expectPathEndVisible();
    root?.render(
      <PaneHeader
        side="left"
        path={shortPath}
        itemKind={kind}
        onPathCommit={onPathCommit}
      />,
    );
    await vi.waitFor(() => expect(input.value).toBe(shortPath));
    await expectPathFits();
  },
);

it("updates path alignment when the available width changes", async () => {
  mountHeader("/samples/project/PROJECT.md", "file");
  await expectPathFits();
  if (!host) throw new Error("Expected a header host");
  host.style.width = "180px";
  await expectPathEndVisible();
  host.style.width = "900px";
  await expectPathFits();
});

it("preserves left-to-right cursor editing and reveals the filename after blur", async () => {
  const path =
    "/samples/shared-storage/team-documents/releases/archive/versions/engineering/OriginalProjectNotes.md";
  const onPathCommit = mountHeader(path, "file");
  await expectPathEndVisible();
  const input = pathInput();
  const field = page.getByRole("textbox", { name: "Left file path" });
  await field.click();
  expect(getComputedStyle(input).textAlign).toBe("left");
  input.setSelectionRange(1, 1);
  await userEvent.keyboard("new-");
  const edited = "/new-" + path.slice(1);
  expect(input.value).toBe(edited);
  expect(input.selectionStart).toBe(5);
  expect(input.selectionEnd).toBe(5);

  if (!host) throw new Error("Expected a header host");
  host.style.width = "280px";
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(5);
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(onPathCommit).toHaveBeenCalledWith(edited));
  await expectPathEndVisible();
});
