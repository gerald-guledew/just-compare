import { describe, expect, it } from "vitest";
import type { DiffLine, DiffLineKind } from "../types";
import { diffStats, documentStats } from "./fileStats";

function diffLine(kind: DiffLineKind, text = ""): DiffLine {
  return {
    kind,
    left_num: kind === "Insert" ? null : 1,
    right_num: kind === "Delete" ? null : 1,
    left: kind === "Insert" ? null : [{ text, changed: kind !== "Equal" }],
    right: kind === "Delete" ? null : [{ text, changed: kind !== "Equal" }],
  };
}

describe("documentStats", () => {
  it("counts an empty editor as one row with no words", () => {
    expect(documentStats("")).toEqual({ lines: 1, words: 0 });
  });

  it.each([
    ["one\ntwo", 2],
    ["one\r\ntwo", 2],
    ["one\rtwo", 2],
    ["one\r\ntwo\nthree\rfour", 4],
  ])("counts logical editor rows in %j", (text, lines) => {
    expect(documentStats(text).lines).toBe(lines);
  });

  it.each(["one\n", "one\r\n", "one\r"])(
    "includes the empty row after a trailing line break in %j",
    (text) => {
      expect(documentStats(text)).toEqual({ lines: 2, words: 1 });
    },
  );

  it("counts consecutive blank rows without adding words", () => {
    expect(documentStats("\r\n\n\r\n \t")).toEqual({ lines: 4, words: 0 });
  });

  it("keeps straight and curly apostrophes inside a contraction", () => {
    expect(documentStats("don't we’re O'Reilly 'quoted' ’quoted’")).toEqual({
      lines: 1,
      words: 5,
    });
  });

  it("counts Unicode letters, combining accents, and numbers", () => {
    expect(documentStats("café cafe\u0301 Māori Ελληνικά 東京 2026")).toEqual({
      lines: 1,
      words: 6,
    });
  });

  it("ignores punctuation, Markdown markers, and standalone combining marks", () => {
    expect(documentStats("# ** __ --- > []() ‘ ’ ' ... 😀 \u0301")).toEqual({
      lines: 1,
      words: 0,
    });
    expect(documentStats("## **About the role**\n- Apply now!")).toEqual({
      lines: 2,
      words: 5,
    });
  });

  it("counts hyphenated components separately", () => {
    expect(documentStats("side-by-side re-check").words).toBe(5);
  });
});

describe("diffStats", () => {
  it("returns zero totals for no diff rows or only equal rows", () => {
    const expected = { changed: 0, leftOnly: 0, rightOnly: 0, blocks: 0 };
    expect(diffStats([])).toEqual(expected);
    expect(diffStats([diffLine("Equal"), diffLine("Equal")])).toEqual(expected);
  });

  it("counts replacements once and groups adjacent changes into blocks", () => {
    expect(
      diffStats([
        diffLine("Replace"),
        diffLine("Delete"),
        diffLine("Insert"),
        diffLine("Replace"),
        diffLine("Equal"),
        diffLine("Insert"),
        diffLine("Equal"),
        diffLine("Delete"),
      ]),
    ).toEqual({ changed: 2, leftOnly: 2, rightOnly: 2, blocks: 3 });
  });

  it("does not count equal rows as differences between change blocks", () => {
    expect(
      diffStats([
        diffLine("Equal"),
        diffLine("Replace"),
        diffLine("Equal"),
        diffLine("Equal"),
        diffLine("Replace"),
        diffLine("Equal"),
      ]),
    ).toEqual({ changed: 2, leftOnly: 0, rightOnly: 0, blocks: 2 });
  });

  it("counts a whitespace-only line change without inventing words", () => {
    expect(diffStats([diffLine("Replace", " \t")])).toEqual({
      changed: 1,
      leftOnly: 0,
      rightOnly: 0,
      blocks: 1,
    });
    expect(documentStats(" \t").words).toBe(0);
  });

  it("uses diff row kinds regardless of inline changed segment fragments", () => {
    const replacement: DiffLine = {
      kind: "Replace",
      left_num: 1,
      right_num: 1,
      left: [
        { text: "engineer", changed: false },
        { text: "s", changed: true },
      ],
      right: [{ text: "engineer", changed: false }],
    };
    expect(diffStats([replacement])).toEqual({
      changed: 1,
      leftOnly: 0,
      rightOnly: 0,
      blocks: 1,
    });
    expect(documentStats("engineers").words).toBe(1);
    expect(documentStats("engineer").words).toBe(1);
  });
});
