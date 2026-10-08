import type * as monaco from "monaco-editor";
import type { DiffLine } from "../../types";
import type { YellowRange } from "../splice";
import type { Side } from "../../stores/appStore";

const LINE_CHANGED_CLASS = "diff-line-changed";
const LINE_YELLOW_CLASS = "diff-line-yellow";
const SEGMENT_CHANGED_CLASS = "diff-segment-changed";

function isLineYellow(lineNum: number, ranges: YellowRange[]): boolean {
  for (const r of ranges) {
    if (lineNum >= r.start && lineNum < r.end) return true;
  }
  return false;
}

export function buildDecorations(
  lines: DiffLine[],
  yellowRanges: YellowRange[],
  side: Side,
  monacoApi: typeof monaco,
): monaco.editor.IModelDeltaDecoration[] {
  const out: monaco.editor.IModelDeltaDecoration[] = [];

  for (const line of lines) {
    const num = side === "left" ? line.left_num : line.right_num;
    if (num === null) continue;

    const yellow = isLineYellow(num, yellowRanges);
    const sideHasContent =
      side === "left"
        ? line.kind === "Replace" || line.kind === "Delete"
        : line.kind === "Replace" || line.kind === "Insert";

    if (yellow) {
      out.push({
        range: new monacoApi.Range(num, 1, num, 1),
        options: {
          isWholeLine: true,
          className: LINE_YELLOW_CLASS,
          linesDecorationsClassName: "diff-line-yellow-accent",
        },
      });
      continue;
    }

    if (sideHasContent) {
      out.push({
        range: new monacoApi.Range(num, 1, num, 1),
        options: { isWholeLine: true, className: LINE_CHANGED_CLASS },
      });

      if (line.kind === "Replace") {
        const segments = side === "left" ? line.left : line.right;
        if (segments) {
          let col = 1;
          for (const seg of segments) {
            const len = seg.text.length;
            if (seg.changed && len > 0) {
              // `className` (not `inlineClassName`): the highlight has to live
              // in the overlay layer, below the selection. An inline class
              // would put an opaque background on the text span itself, on
              // top of the selection highlight. See globals.css.
              out.push({
                range: new monacoApi.Range(num, col, num, col + len),
                options: { className: SEGMENT_CHANGED_CLASS },
              });
            }
            col += len;
          }
        }
      }
    }
  }

  return out;
}
