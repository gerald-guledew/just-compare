import { afterEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
import { SaveConflictDialog } from "../../src/components/SaveConflictDialog";
import type { SaveConflictChoice } from "../../src/lib/documents";
import type { SaveConflictRequest } from "../../src/stores/appStore";
import "../../src/styles/globals.css";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let previousControl: HTMLButtonElement | null = null;

function mount(
  reason: SaveConflictRequest["reason"],
  side: "left" | "right" = "left",
  isSaveAs = false,
) {
  previousControl = document.createElement("button");
  previousControl.textContent = "Previous control";
  document.body.append(previousControl);
  previousControl.focus();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onResolve = vi.fn<(choice: SaveConflictChoice) => void>();
  const onParentKey = vi.fn();
  root.render(
    <div onKeyDown={onParentKey}>
      <SaveConflictDialog
        request={{
          path: "/samples/comparison/edited-file.md",
          message: "Save conflict",
          reason,
          side,
          isSaveAs,
        }}
        onResolve={onResolve}
      />
    </div>,
  );
  return { onResolve, onParentKey };
}

function cancelButton() {
  const element = host?.querySelector<HTMLButtonElement>("button");
  if (!element) throw new Error("Expected a cancel button");
  return element;
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  previousControl?.remove();
  previousControl = null;
});

it("identifies an existing Save As destination before replacing it", async () => {
  const { onResolve } = mount("changed", "left", true);
  const dialog = page.getByRole("dialog", {
    name: "Left save destination already exists",
  });
  await expect.element(dialog).toBeVisible();
  await expect
    .element(dialog)
    .toHaveTextContent("A file already exists at this save location.");
  await page.getByRole("button", { name: "Open disk version" }).click();
  expect(onResolve).toHaveBeenLastCalledWith("reload");
  await page.getByRole("button", { name: "Overwrite", exact: true }).click();
  expect(onResolve).toHaveBeenLastCalledWith("overwrite");
});

const cases: {
  reason: SaveConflictRequest["reason"];
  title: string;
  description: string;
  choices: [string, SaveConflictChoice][];
}[] = [
  {
    reason: "changed",
    title: "Left file changed on disk",
    description: "The file was changed outside JustCompare.",
    choices: [
      ["Cancel", "cancel"],
      ["Reload from disk", "reload"],
      ["Save as…", "saveAs"],
      ["Overwrite", "overwrite"],
    ],
  },
  {
    reason: "missingFile",
    title: "Left file is missing",
    description: "The file no longer exists at this path.",
    choices: [
      ["Cancel", "cancel"],
      ["Save as…", "saveAs"],
      ["Recreate file", "recreate"],
    ],
  },
  {
    reason: "missingFolder",
    title: "Cannot save left file",
    description: "The original folder is no longer available.",
    choices: [
      ["Cancel", "cancel"],
      ["Save as…", "saveAs"],
    ],
  },
];

it.each(cases)(
  "offers safe recovery choices for $reason and dispatches each selected action",
  async ({ reason, title, description, choices }) => {
    const { onResolve } = mount(reason);
    const dialog = page.getByRole("dialog", { name: title });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog).toHaveTextContent(description);
    await expect
      .element(dialog)
      .toHaveTextContent("Your edits are kept if you cancel.");
    expect(
      [...host!.querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(choices.map(([label]) => label));
    for (const [name, choice] of choices) {
      await page.getByRole("button", { name, exact: true }).click();
      expect(onResolve).toHaveBeenLastCalledWith(choice);
    }
    expect(onResolve).toHaveBeenCalledTimes(choices.length);
  },
);

it.each(cases)(
  "focuses Cancel and keeps keyboard navigation inside the $reason prompt",
  async ({ reason, choices }) => {
    mount(reason);
    await vi.waitFor(() => expect(document.activeElement).toBe(cancelButton()));
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement?.textContent).toBe(choices.at(-1)?.[0]);
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(cancelButton());
  },
);

it("names the affected side, cancels on Escape and restores the previous focus", async () => {
  const { onResolve } = mount("missingFile", "right");
  await expect
    .element(page.getByRole("dialog", { name: "Right file is missing" }))
    .toBeVisible();
  await vi.waitFor(() => expect(document.activeElement).toBe(cancelButton()));
  await userEvent.keyboard("{Escape}");
  expect(onResolve).toHaveBeenCalledExactlyOnceWith("cancel");
  root?.unmount();
  root = null;
  expect(document.activeElement).toBe(previousControl);
});

it("blocks app save and close shortcuts while recovery is awaiting a choice", async () => {
  const { onResolve, onParentKey } = mount("changed");
  await vi.waitFor(() => expect(document.activeElement).toBe(cancelButton()));
  for (const modifier of ["ctrlKey", "metaKey"] as const) {
    for (const key of ["w", "s"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        [modifier]: true,
        bubbles: true,
        cancelable: true,
      });
      cancelButton().dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  }
  expect(onParentKey).not.toHaveBeenCalled();
  expect(onResolve).not.toHaveBeenCalled();
});
