import { describe, expect, it } from "vitest";
import { computeDiffBlocks } from "./diffBlocks";
import type { DiffLine, DiffLineKind, DiffSegment } from "../types";

function line(
  kind: DiffLineKind,
  leftNum: number | null,
  rightNum: number | null,
  leftText: string | null = null,
  rightText: string | null = null,
): DiffLine {
  const seg = (text: string): DiffSegment[] => [
    { text, changed: kind !== "Equal" },
  ];
  return {
    kind,
    left_num: leftNum,
    right_num: rightNum,
    left: leftText === null ? null : seg(leftText),
    right: rightText === null ? null : seg(rightText),
  };
}

describe("computeDiffBlocks", () => {
  it("returns no blocks for empty input", () => {
    expect(computeDiffBlocks([])).toEqual([]);
  });

  it("returns no blocks when all lines are Equal", () => {
    const lines = [
      line("Equal", 1, 1, "a", "a"),
      line("Equal", 2, 2, "b", "b"),
    ];
    expect(computeDiffBlocks(lines)).toEqual([]);
  });

  it("produces one block for a single-line Replace in the middle", () => {
    const lines = [
      line("Equal", 1, 1, "a", "a"),
      line("Replace", 2, 2, "old", "new"),
      line("Equal", 3, 3, "c", "c"),
    ];
    const blocks = computeDiffBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      startIndex: 1,
      endIndex: 2,
      leftTargetStart: 2,
      leftTargetEnd: 3,
      rightTargetStart: 2,
      rightTargetEnd: 3,
      leftText: ["old"],
      rightText: ["new"],
    });
  });

  it("collapses a contiguous Delete+Insert run into one block", () => {
    const lines = [
      line("Equal", 1, 1, "a", "a"),
      line("Delete", 2, null, "gone", null),
      line("Insert", null, 2, null, "added"),
      line("Equal", 3, 3, "c", "c"),
    ];
    const blocks = computeDiffBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      startIndex: 1,
      endIndex: 3,
      leftTargetStart: 2,
      leftTargetEnd: 3,
      rightTargetStart: 2,
      rightTargetEnd: 3,
      leftText: ["gone"],
      rightText: ["added"],
    });
  });

  it("produces two separate blocks when non-Equal runs are split by an Equal", () => {
    const lines = [
      line("Replace", 1, 1, "x", "X"),
      line("Equal", 2, 2, "b", "b"),
      line("Replace", 3, 3, "y", "Y"),
    ];
    const blocks = computeDiffBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      startIndex: 0,
      endIndex: 1,
      leftTargetStart: 1,
      leftTargetEnd: 2,
    });
    expect(blocks[1]).toMatchObject({
      startIndex: 2,
      endIndex: 3,
      leftTargetStart: 3,
      leftTargetEnd: 4,
    });
  });

  it("anchors a pure Insert to the next Equal line's left_num (zero-width left target)", () => {
    const lines = [
      line("Insert", null, 1, null, "new"),
      line("Equal", 1, 2, "a", "a"),
    ];
    const blocks = computeDiffBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      leftTargetStart: 1,
      leftTargetEnd: 1,
      rightTargetStart: 1,
      rightTargetEnd: 2,
      leftText: [],
      rightText: ["new"],
    });
  });

  it("anchors a pure Delete to the next Equal line's right_num (zero-width right target)", () => {
    const lines = [
      line("Delete", 1, null, "gone", null),
      line("Equal", 2, 1, "a", "a"),
    ];
    const blocks = computeDiffBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      leftTargetStart: 1,
      leftTargetEnd: 2,
      rightTargetStart: 1,
      rightTargetEnd: 1,
      leftText: ["gone"],
      rightText: [],
    });
  });

  it("falls back to totalLines+1 for a pure Insert at end of file", () => {
    const lines = [
      line("Equal", 1, 1, "a", "a"),
      line("Insert", null, 2, null, "new"),
    ];
    const blocks = computeDiffBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      leftTargetStart: 2,
      leftTargetEnd: 2,
      rightTargetStart: 2,
      rightTargetEnd: 3,
      leftText: [],
    });
  });

  it("concatenates multi-segment text with no separator", () => {
    const multiSeg: DiffLine = {
      kind: "Replace",
      left_num: 1,
      right_num: 1,
      left: [
        { text: "hello ", changed: false },
        { text: "WORLD", changed: true },
      ],
      right: [
        { text: "hello ", changed: false },
        { text: "world", changed: true },
      ],
    };
    const blocks = computeDiffBlocks([multiSeg]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].leftText).toEqual(["hello WORLD"]);
    expect(blocks[0].rightText).toEqual(["hello world"]);
  });

  it("derives totalLines from the MAX left_num/right_num, not the last-seen", () => {
    // Out-of-order numbering: last Equal has left_num=5 but an earlier
    // line has left_num=12. The trailing Insert must anchor to max+1=13.
    const lines = [
      line("Equal", 12, 12, "a", "a"),
      line("Equal", 5, 5, "b", "b"),
      line("Insert", null, 6, null, "new"),
    ];
    const blocks = computeDiffBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].leftTargetStart).toBe(13);
    expect(blocks[0].leftTargetEnd).toBe(13);
  });
});
