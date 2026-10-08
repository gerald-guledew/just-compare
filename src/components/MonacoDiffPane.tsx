import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import type { DiffLine } from "../types";
import { spliceLines } from "../lib/splice";
import type { YellowRange } from "../lib/splice";
import type { BufferEdit, Side } from "../stores/appStore";
import { buildViewZones } from "../lib/monaco/buildViewZones";
import { buildDecorations } from "../lib/monaco/buildDecorations";
import { languageFromPath } from "../lib/monaco/languageFromExt";
import { MONACO_LIGHT_THEME } from "../lib/monaco/setup";

interface MonacoDiffPaneProps {
  modelKey: string;
  side: Side;
  text: string;
  path: string;
  lines: DiffLine[];
  yellowRanges: YellowRange[];
  readOnly: boolean;
  onEditorReady: (
    editor: monaco.editor.IStandaloneCodeEditor,
    monacoApi: typeof monaco,
  ) => void;
  onEditorDispose: () => void;
  onScroll: (e: monaco.IScrollEvent) => void;
  onContentSizeChange: () => void;
  onModelEdit?: (newText: string, edit: BufferEdit | null) => void;
  onRequestSave?: () => void;
}

/** Convert Monaco's IModelContentChange[] (one event may contain many changes,
 *  e.g. find-and-replace-all or multi-cursor) into a single BufferEdit suitable
 *  for shiftYellowRanges. Returns null if there are zero or >1 changes —
 *  callers drop yellow ranges in that case rather than risk a wrong shift. */
function changesToBufferEdit(
  changes: readonly monaco.editor.IModelContentChange[],
): BufferEdit | null {
  if (changes.length !== 1) return null;
  const c = changes[0];
  // Monaco range is line/col 1-indexed inclusive on both ends. Our line-range
  // convention is start inclusive / end exclusive, both 1-indexed. So end =
  // range.endLineNumber + 1 even when the deleted region is whole-line.
  const start = c.range.startLineNumber;
  const end = c.range.endLineNumber + 1;
  // replacement line count: empty string ⇒ 0, otherwise count of \n + 1 if the
  // text doesn't end with \n. shiftYellowRanges treats replacementCount as the
  // number of lines occupying the post-edit range.
  let replacementCount = 0;
  if (c.text.length > 0) {
    let nl = 0;
    for (let i = 0; i < c.text.length; i++) {
      if (c.text.charCodeAt(i) === 10) nl++;
    }
    replacementCount = c.text.endsWith("\n") ? nl : nl + 1;
  }
  return { start, end, replacementCount };
}

export function MonacoDiffPane({
  modelKey,
  side,
  text,
  path,
  lines,
  yellowRanges,
  readOnly,
  onEditorReady,
  onEditorDispose,
  onScroll,
  onContentSizeChange,
  onModelEdit,
  onRequestSave,
}: MonacoDiffPaneProps) {
  // Editor + monaco API live in useState (not useRef) so effects re-run when
  // they become available. @monaco-editor/react mounts asynchronously, so the
  // initial render's effects fire before handleMount; using a ref would leave
  // them silently no-oping forever.
  const [editor, setEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [monacoApi, setMonacoApi] = useState<typeof monaco | null>(null);
  const viewZoneIdsRef = useRef<string[]>([]);
  const decorationIdsRef = useRef<string[]>([]);
  // Set true around any external setValue (reload-from-disk, prop refresh) so
  // the resulting onDidChangeModelContent event doesn't loop back into the
  // store as a "user edit." onDidChangeModelContent fires synchronously from
  // applyEdits/setValue, so a single-shot flag is sufficient.
  const suppressEditRef = useRef(false);
  const onModelEditRef = useRef(onModelEdit);
  useEffect(() => {
    onModelEditRef.current = onModelEdit;
  }, [onModelEdit]);
  const onRequestSaveRef = useRef(onRequestSave);
  useEffect(() => {
    onRequestSaveRef.current = onRequestSave;
  }, [onRequestSave]);

  const handleMount: OnMount = (ed, m) => {
    setEditor(ed);
    setMonacoApi(m);
    onEditorReady(ed, m);

    const scrollSub = ed.onDidScrollChange((e) => onScroll(e));
    const sizeSub = ed.onDidContentSizeChange(() => onContentSizeChange());
    const editSub = ed.onDidChangeModelContent((e) => {
      if (suppressEditRef.current) {
        suppressEditRef.current = false;
        return;
      }
      const cb = onModelEditRef.current;
      if (!cb) return;
      const model = ed.getModel();
      if (!model) return;
      cb(model.getValue(), changesToBufferEdit(e.changes));
    });

    // Monaco intercepts Cmd/Ctrl+S (registered as `editor.action.save`, no-op
    // in standalone). Without our own command, the global window listener in
    // App.tsx never sees the keydown when the editor has focus.
    ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
      onRequestSaveRef.current?.();
    });

    const dispose = ed.onDidDispose(() => {
      scrollSub.dispose();
      sizeSub.dispose();
      editSub.dispose();
      dispose.dispose();
      onEditorDispose();
    });
  };

  // Sync model text. Typed edits update the store, which feeds back here, but
  // by the time React re-renders the model already holds the typed value, so
  // model.getValue() === text and we early-return — no setValue, no
  // change-event loop. setValue only fires on external resets (reload-from-
  // disk, file path change), where we set suppressEditRef so the resulting
  // onDidChangeModelContent isn't echoed back into the store.
  useEffect(() => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (model.getValue() === text) return;
    const prevTop = editor.getScrollTop();
    const prevLeft = editor.getScrollLeft();
    suppressEditRef.current = true;
    model.setValue(text);
    editor.setScrollTop(prevTop);
    editor.setScrollLeft(prevLeft);
  }, [editor, text]);

  // Sync language from file extension.
  useEffect(() => {
    if (!editor || !monacoApi) return;
    const model = editor.getModel();
    if (!model) return;
    const lang = languageFromPath(path);
    if (model.getLanguageId() !== lang) {
      monacoApi.editor.setModelLanguage(model, lang);
    }
  }, [editor, monacoApi, path]);

  // Apply view zones (alignment padding). Driven by `lines` only — once typing
  // means `text` updates per-keystroke, including it here would re-run on every
  // character (zones are O(lines)). The diff debounce + `lines` dep already
  // refresh zones whenever the diff settles.
  useEffect(() => {
    if (!editor) return;
    const zones = buildViewZones(lines, side);
    editor.changeViewZones((accessor) => {
      for (const id of viewZoneIdsRef.current) accessor.removeZone(id);
      viewZoneIdsRef.current = zones.map((z) => {
        const domNode = document.createElement("div");
        domNode.className = "diff-view-zone";
        return accessor.addZone({
          afterLineNumber: z.afterLineNumber,
          heightInLines: z.heightInLines,
          domNode,
        });
      });
    });
  }, [editor, lines, side]);

  // Apply decorations (red bg, yellow bg, inline word highlights). Same
  // reasoning as view zones: drive by lines/yellowRanges, not text.
  useEffect(() => {
    if (!editor || !monacoApi) return;
    const decorations = buildDecorations(lines, yellowRanges, side, monacoApi);
    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      decorations,
    );
  }, [editor, monacoApi, lines, yellowRanges, side]);

  return (
    <Editor
      height="100%"
      width="100%"
      path={`justcompare://document/${modelKey}`}
      keepCurrentModel
      defaultValue={text}
      defaultLanguage={languageFromPath(path)}
      theme={MONACO_LIGHT_THEME}
      onMount={handleMount}
      options={{
        readOnly,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
        automaticLayout: true,
        wordWrap: "off",
        fontSize: 13,
        lineNumbersMinChars: 4,
        glyphMargin: false,
        folding: false,
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
        overviewRulerLanes: 0,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        // By default Monaco pushes the content down by the find widget's
        // height when it opens at the top of the file. That shift happens in
        // one pane only, so every row would sit 33px lower than its partner
        // on the other side for as long as the widget is open.
        find: { addExtraSpaceOnTop: false },
      }}
    />
  );
}

/** Apply a precise line-range edit to a Monaco editor's model. Used by merge
 *  buttons so we don't pay the cost of setValue on every block copy. */
export function applyMonacoEdit(
  editor: monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof monaco,
  startLine: number,
  endLine: number,
  replacement: string[],
  terminator: "\n" | "\r\n",
) {
  const model = editor.getModel();
  if (!model) return;
  const original = model.getValue();
  const next = spliceLines(
    original,
    startLine,
    endLine,
    replacement,
    terminator,
  );
  // Replace only the changed character interval. This handles EOF and missing
  // trailing newlines without asking Monaco to clamp an out-of-range line.
  let start = 0;
  while (
    start < original.length &&
    start < next.length &&
    original[start] === next[start]
  )
    start++;
  let oldEnd = original.length,
    newEnd = next.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    original[oldEnd - 1] === next[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  if (start === oldEnd && start === newEnd) return;
  const from = model.getPositionAt(start),
    to = model.getPositionAt(oldEnd);
  editor.pushUndoStop();
  editor.executeEdits("justcompare.merge", [
    {
      range: new monacoApi.Range(
        from.lineNumber,
        from.column,
        to.lineNumber,
        to.column,
      ),
      text: next.slice(start, newEnd),
      forceMoveMarkers: true,
    },
  ]);
  editor.pushUndoStop();
}
