import { useEffect, useRef, useState } from "react";
import type * as monaco from "monaco-editor";
import type { DiffLine } from "../types";
import {
  buildAlignedViewZones,
  type PixelViewZoneSpec,
} from "../lib/monaco/buildViewZones";

function sameZones(
  previous: readonly PixelViewZoneSpec[],
  next: readonly PixelViewZoneSpec[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every(
      (zone, index) =>
        zone.afterLineNumber === next[index].afterLineNumber &&
        zone.heightInPx === next[index].heightInPx,
    )
  );
}

function measureLineHeights(
  editor: monaco.editor.IStandaloneCodeEditor,
): number[] {
  const model = editor.getModel();
  if (!model) return [];
  return Array.from({ length: model.getLineCount() }, (_, index) => {
    const number = index + 1;
    // Both offsets contain earlier zones. The bottom excludes zones after
    // this line, so subtraction measures only its wrapped view lines.
    return (
      editor.getBottomForLineNumber(number) - editor.getTopForLineNumber(number)
    );
  });
}

/** Own alignment zones for both editors and keep paired diff rows level when
 * wrapping, edits, fonts, or pane width changes alter their rendered heights. */
export function useDiffAlignment(
  leftEditor: monaco.editor.IStandaloneCodeEditor | null,
  rightEditor: monaco.editor.IStandaloneCodeEditor | null,
  lines: DiffLine[],
  wordWrap: boolean,
): void {
  const linesRef = useRef(lines);
  const scheduleRef = useRef<(() => void) | null>(null);
  const [, setRevision] = useState(0);

  // Keep existing zones until their replacement is ready. Removing them on
  // every diff update could clamp the scroll position near the end of a file.
  useEffect(() => {
    linesRef.current = lines;
    scheduleRef.current?.();
  }, [lines, wordWrap]);

  useEffect(() => {
    if (!leftEditor || !rightEditor) return;
    let stopped = false;
    let changingZones = false;
    let frame: number | null = null;
    const disposedEditors = new Set<monaco.editor.IStandaloneCodeEditor>();
    const state = new Map([
      [
        leftEditor,
        { ids: [] as string[], specs: [] as PixelViewZoneSpec[], valid: false },
      ],
      [
        rightEditor,
        { ids: [] as string[], specs: [] as PixelViewZoneSpec[], valid: false },
      ],
    ]);

    const apply = (
      editor: monaco.editor.IStandaloneCodeEditor,
      specs: PixelViewZoneSpec[],
    ): boolean => {
      const previous = state.get(editor)!;
      if (previous.valid && sameZones(previous.specs, specs)) return false;
      editor.changeViewZones((accessor) => {
        for (const id of previous.ids) accessor.removeZone(id);
        previous.ids = specs.map((spec) => {
          const domNode = document.createElement("div");
          domNode.className = "diff-view-zone";
          return accessor.addZone({ ...spec, domNode });
        });
      });
      previous.specs = specs;
      previous.valid = true;
      return true;
    };

    const refresh = () => {
      frame = null;
      if (stopped || disposedEditors.size > 0) return;
      const currentLines = linesRef.current;
      const zones = currentLines.length
        ? buildAlignedViewZones(
            currentLines,
            measureLineHeights(leftEditor),
            measureLineHeights(rightEditor),
          )
        : { left: [], right: [] };
      changingZones = true;
      try {
        const leftChanged = apply(leftEditor, zones.left);
        const rightChanged = apply(rightEditor, zones.right);
        // Moving padding can leave total content height unchanged. Refresh
        // the parent and its geometry readers after both panes are aligned,
        // even when Monaco does not emit another content-size event.
        if (leftChanged || rightChanged)
          setRevision((revision) => revision + 1);
      } finally {
        changingZones = false;
      }
    };

    const schedule = () => {
      if (stopped || changingZones || frame !== null) return;
      frame = requestAnimationFrame(refresh);
    };
    scheduleRef.current = schedule;
    const subscriptions = [leftEditor, rightEditor].flatMap((editor) => [
      editor.onDidLayoutChange(schedule),
      editor.onDidContentSizeChange(schedule),
      editor.onDidChangeConfiguration(schedule),
      editor.onDidChangeModelContent((event) => {
        // Monaco relocates zones during line edits and resets them when the
        // model is flushed. Their cached positions then need replacing even
        // when the resulting padding heights happen to be unchanged.
        if (
          event.isFlush ||
          event.changes.some(
            (change) =>
              change.range.startLineNumber !== change.range.endLineNumber ||
              change.text.includes("\n"),
          )
        ) {
          state.get(editor)!.valid = false;
        }
        schedule();
      }),
      editor.onDidChangeModel(() => {
        state.get(editor)!.valid = false;
        schedule();
      }),
      editor.onDidDispose(() => disposedEditors.add(editor)),
    ]);
    schedule();

    return () => {
      stopped = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (scheduleRef.current === schedule) scheduleRef.current = null;
      for (const subscription of subscriptions) subscription.dispose();
      for (const [editor, previous] of state) {
        if (disposedEditors.has(editor) || previous.ids.length === 0) continue;
        editor.changeViewZones((accessor) => {
          for (const id of previous.ids) accessor.removeZone(id);
        });
      }
    };
  }, [leftEditor, rightEditor]);
}
