import { afterEach, describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import { createRoot, type Root } from "react-dom/client";
import {
  MonacoDiffPane,
  applyMonacoEdit,
} from "../../src/components/MonacoDiffPane";
import { useAppStore, type FileTabBuffer } from "../../src/stores/appStore";

vi.mock("../../src/lib/persistence", () => ({
  savePaths: vi.fn(),
  saveComparisonMode: vi.fn(),
}));
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let host: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  root?.unmount();
  root = null;
  editor?.dispose();
  editor = null;
  for (const model of monaco.editor.getModels()) model.dispose();
  host?.remove();
});
function create(text: string) {
  host = document.createElement("div");
  host.style.width = "600px";
  host.style.height = "300px";
  document.body.append(host);
  editor = monaco.editor.create(host, {
    value: text,
    language: "plaintext",
    automaticLayout: true,
  });
  return editor;
}
describe("real Monaco merge behavior", () => {
  it.each([
    ["a\nb\n", 2, 3, ["c"], "a\nc\n"],
    ["a\nb", 2, 3, ["c"], "a\nc"],
    ["a", 2, 2, ["b"], "a\nb"],
    ["", 1, 1, ["x"], "x"],
    ["a\r\nb\r\n", 2, 3, [], "a\r\n"],
  ] as const)(
    "preserves EOF semantics and supports undo/redo: %s",
    async (text, start, end, replacement, next) => {
      const ed = create(text);
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      applyMonacoEdit(ed, monaco, start, end, [...replacement], eol);
      expect(ed.getValue()).toBe(next);
      await ed.getModel()!.undo();
      expect(ed.getValue()).toBe(text);
      await ed.getModel()!.redo();
      expect(ed.getValue()).toBe(next);
    },
  );
  it("keeps typed edits and merge edits in separate undo steps", async () => {
    const ed = create("a\nb\n");
    ed.executeEdits("typing", [
      { range: new monaco.Range(1, 2, 1, 2), text: "typed" },
    ]);
    applyMonacoEdit(ed, monaco, 2, 3, ["merged"], "\n");
    expect(ed.getValue()).toBe("atyped\nmerged\n");
    await ed.getModel()!.undo();
    expect(ed.getValue()).toBe("atyped\nb\n");
    await ed.getModel()!.undo();
    expect(ed.getValue()).toBe("a\nb\n");
  });
  it("retains the document model and undo through a tab unmount/remount", async () => {
    const buf: FileTabBuffer = {
      documentId: "browser-doc",
      revision: 0,
      canonicalPath: "/a",
      diskVersion: "v1",
      bom: false,
      saving: false,
      operationError: null,
      text: "a\nb",
      diskText: "a\nb",
      mtimeMs: 0,
      terminator: "\n",
      dirty: false,
      diskStale: false,
      yellowRanges: [],
    };
    useAppStore.getState().initFileTab("browser-tab");
    useAppStore.getState().setFileTabBuffer("browser-tab", "left", buf);
    host = document.createElement("div");
    host.style.width = "600px";
    host.style.height = "300px";
    document.body.append(host);
    const mount = () => {
      root = createRoot(host!);
      root.render(
        <MonacoDiffPane
          modelKey={buf.documentId}
          side="left"
          text={useAppStore.getState().fileTabs["browser-tab"].left!.text}
          path="a.txt"
          lines={[]}
          yellowRanges={[]}
          readOnly={false}
          onEditorReady={(ed) => {
            editor = ed;
          }}
          onEditorDispose={() => {
            editor = null;
          }}
          onScroll={() => {}}
          onContentSizeChange={() => {}}
          onModelEdit={(text, edit) =>
            useAppStore
              .getState()
              .setFileTabBufferText("browser-tab", "left", text, edit)
          }
        />,
      );
    };
    mount();
    await vi.waitFor(() => expect(editor).not.toBeNull());
    applyMonacoEdit(editor!, monaco, 2, 3, ["merged"], "\n");
    const model = editor!.getModel()!;
    root!.unmount();
    root = null;
    expect(model.isDisposed()).toBe(false);
    mount();
    await vi.waitFor(() => expect(editor).not.toBeNull());
    expect(editor!.getModel()).toBe(model);
    expect(editor!.getValue()).toBe("a\nmerged");
    await model.undo();
    expect(editor!.getValue()).toBe("a\nb");
    root!.unmount();
    root = null;
    useAppStore
      .getState()
      .setTabFilePath("browser-tab", "left", "/replacement");
    expect(model.isDisposed()).toBe(true);
  });
});
