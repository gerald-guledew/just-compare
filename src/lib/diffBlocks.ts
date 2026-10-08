import type { DiffLine, DiffSegment } from "../types";

export interface DiffBlock {
  startIndex: number;
  endIndex: number;
  leftTargetStart: number;
  leftTargetEnd: number;
  rightTargetStart: number;
  rightTargetEnd: number;
  leftText: string[];
  rightText: string[];
}

function concatSegments(segs: DiffSegment[] | null): string | null {
  if (!segs) return null;
  return segs.map((s) => s.text).join("");
}

function findInsertAnchor(
  lines: DiffLine[],
  blockEndIndex: number,
  side: "left" | "right",
  totalLines: number,
): number {
  for (let k = blockEndIndex; k < lines.length; k++) {
    if (lines[k].kind === "Equal") {
      const num = side === "left" ? lines[k].left_num : lines[k].right_num;
      if (num !== null) return num;
    }
  }
  return totalLines + 1;
}

export function computeDiffBlocks(lines: DiffLine[]): DiffBlock[] {
  let leftTotal = 0;
  let rightTotal = 0;
  for (const l of lines) {
    if (l.left_num !== null && l.left_num > leftTotal) leftTotal = l.left_num;
    if (l.right_num !== null && l.right_num > rightTotal) rightTotal = l.right_num;
  }

  const blocks: DiffBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind === "Equal") {
      i++;
      continue;
    }
    const startIndex = i;
    while (i < lines.length && lines[i].kind !== "Equal") i++;
    const endIndex = i;

    let leftFirst: number | null = null;
    let leftLast: number | null = null;
    let rightFirst: number | null = null;
    let rightLast: number | null = null;
    const leftText: string[] = [];
    const rightText: string[] = [];

    for (let j = startIndex; j < endIndex; j++) {
      const l = lines[j];
      if (l.left_num !== null) {
        if (leftFirst === null) leftFirst = l.left_num;
        leftLast = l.left_num;
        const t = concatSegments(l.left);
        if (t !== null) leftText.push(t);
      }
      if (l.right_num !== null) {
        if (rightFirst === null) rightFirst = l.right_num;
        rightLast = l.right_num;
        const t = concatSegments(l.right);
        if (t !== null) rightText.push(t);
      }
    }

    const leftTargetStart =
      leftFirst !== null
        ? leftFirst
        : findInsertAnchor(lines, endIndex, "left", leftTotal);
    const leftTargetEnd =
      leftLast !== null ? leftLast + 1 : leftTargetStart;

    const rightTargetStart =
      rightFirst !== null
        ? rightFirst
        : findInsertAnchor(lines, endIndex, "right", rightTotal);
    const rightTargetEnd =
      rightLast !== null ? rightLast + 1 : rightTargetStart;

    blocks.push({
      startIndex,
      endIndex,
      leftTargetStart,
      leftTargetEnd,
      rightTargetStart,
      rightTargetEnd,
      leftText,
      rightText,
    });
  }
  return blocks;
}
