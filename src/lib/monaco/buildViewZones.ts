import type { DiffLine } from "../../types";
import type { Side } from "../../stores/appStore";

export interface PixelViewZoneSpec {
  afterLineNumber: number;
  heightInPx: number;
}

export interface AlignedViewZones {
  left: PixelViewZoneSpec[];
  right: PixelViewZoneSpec[];
}

/** Give each diff row enough room for both sides' wrapped text. Heights are
 * indexed by model line number minus one and exclude existing view zones. */
export function buildAlignedViewZones(
  lines: DiffLine[],
  leftLineHeights: readonly number[],
  rightLineHeights: readonly number[],
): AlignedViewZones {
  const zones: AlignedViewZones = { left: [], right: [] };
  let lastLeftLine = 0;
  let lastRightLine = 0;

  const addPadding = (
    side: Side,
    afterLineNumber: number,
    heightInPx: number,
  ) => {
    if (heightInPx <= 0) return;
    const sideZones = zones[side];
    const previous = sideZones[sideZones.length - 1];
    if (previous?.afterLineNumber === afterLineNumber) {
      previous.heightInPx += heightInPx;
    } else {
      sideZones.push({ afterLineNumber, heightInPx });
    }
  };

  const alignRow = (leftNumber: number | null, rightNumber: number | null) => {
    const leftHeight =
      leftNumber === null ? 0 : (leftLineHeights[leftNumber - 1] ?? 0);
    const rightHeight =
      rightNumber === null ? 0 : (rightLineHeights[rightNumber - 1] ?? 0);
    if (leftNumber !== null) lastLeftLine = leftNumber;
    if (rightNumber !== null) lastRightLine = rightNumber;
    const rowHeight = Math.max(leftHeight, rightHeight);
    addPadding("left", lastLeftLine, rowHeight - leftHeight);
    addPadding("right", lastRightLine, rowHeight - rightHeight);
  };

  for (const line of lines) alignRow(line.left_num, line.right_num);

  // Monaco retains an empty model line after a trailing newline, including
  // one for an empty file. The backend's diff omits that implicit line. Give
  // both panes matching EOF space so they also have equal scroll ranges.
  while (
    lastLeftLine < leftLineHeights.length ||
    lastRightLine < rightLineHeights.length
  ) {
    alignRow(
      lastLeftLine < leftLineHeights.length ? lastLeftLine + 1 : null,
      lastRightLine < rightLineHeights.length ? lastRightLine + 1 : null,
    );
  }

  return zones;
}
