import { describe, expect, it } from "vitest";
import type { DiffLine } from "../../types";
import { buildAlignedViewZones } from "./buildViewZones";

function row(left: number | null, right: number | null): DiffLine {
  return {
    kind: left === null ? "Insert" : right === null ? "Delete" : "Replace",
    left_num: left,
    right_num: right,
    left: left === null ? null : [{ text: "left", changed: true }],
    right: right === null ? null : [{ text: "right", changed: true }],
  };
}

describe("buildAlignedViewZones", () => {
  it("pads shorter wrapped rows before the next pair", () => {
    expect(
      buildAlignedViewZones([row(1, 1), row(2, 2)], [60, 20], [20, 80]),
    ).toEqual({
      left: [{ afterLineNumber: 2, heightInPx: 60 }],
      right: [{ afterLineNumber: 1, heightInPx: 40 }],
    });
  });

  it("combines wrapping compensation with following missing rows", () => {
    expect(
      buildAlignedViewZones(
        [row(1, 1), row(2, null), row(3, null), row(4, 2)],
        [60, 80, 40, 20],
        [20, 20],
      ),
    ).toEqual({
      left: [],
      right: [{ afterLineNumber: 1, heightInPx: 160 }],
    });
  });

  it("pads wrapped insertions before the first real line and at EOF", () => {
    expect(
      buildAlignedViewZones(
        [row(null, 1), row(1, 2), row(null, 3)],
        [20],
        [60, 20, 100],
      ),
    ).toEqual({
      left: [
        { afterLineNumber: 0, heightInPx: 60 },
        { afterLineNumber: 1, heightInPx: 100 },
      ],
      right: [],
    });
  });

  it("accounts for Monaco's implicit trailing empty line", () => {
    expect(buildAlignedViewZones([row(1, 1)], [60, 20], [60])).toEqual({
      left: [],
      right: [{ afterLineNumber: 1, heightInPx: 20 }],
    });
  });

  it("keeps empty-file and nonempty-file scroll ranges equal", () => {
    expect(
      buildAlignedViewZones([row(null, 1), row(null, 2)], [20], [60, 20]),
    ).toEqual({
      left: [{ afterLineNumber: 0, heightInPx: 80 }],
      right: [{ afterLineNumber: 2, heightInPx: 20 }],
    });
  });

  it("preserves row starts and total height across mixed wrapped hunks", () => {
    const lines = [
      row(null, 1),
      row(1, 2),
      row(2, null),
      row(3, 3),
      row(null, 4),
      row(4, 5),
      row(5, null),
    ];
    const left = [20, 60, 80, 40, 100, 20];
    const right = [80, 60, 20, 40, 100];
    const zones = buildAlignedViewZones(lines, left, right);
    const top = (heights: number[], side: "left" | "right", number: number) =>
      heights.slice(0, number - 1).reduce((sum, height) => sum + height, 0) +
      zones[side]
        .filter((zone) => zone.afterLineNumber < number)
        .reduce((sum, zone) => sum + zone.heightInPx, 0);

    for (const line of lines) {
      if (line.left_num !== null && line.right_num !== null) {
        expect(top(left, "left", line.left_num)).toBe(
          top(right, "right", line.right_num),
        );
      }
    }
    const total = (heights: number[], side: "left" | "right") =>
      heights.reduce((sum, height) => sum + height, 0) +
      zones[side].reduce((sum, zone) => sum + zone.heightInPx, 0);
    expect(total(left, "left")).toBe(total(right, "right"));
  });

  it("needs no padding for equally tall rows", () => {
    expect(
      buildAlignedViewZones([row(1, 1), row(2, 2)], [20, 60], [20, 60]),
    ).toEqual({ left: [], right: [] });
  });
});
