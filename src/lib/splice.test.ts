import { describe, it, expect } from "vitest";
import {
  detectTerminator,
  shiftYellowRanges,
  spliceLines,
  splitLines,
} from "./splice";

describe("detectTerminator", () => {
  it("detects LF", () => {
    expect(detectTerminator("a\nb\n")).toBe("\n");
  });
  it("detects CRLF", () => {
    expect(detectTerminator("a\r\nb\r\n")).toBe("\r\n");
  });
  it("defaults to LF when ambiguous", () => {
    expect(detectTerminator("a")).toBe("\n");
    expect(detectTerminator("")).toBe("\n");
  });
});

describe("splitLines", () => {
  it("splits LF with trailing newline", () => {
    expect(splitLines("a\nb\n")).toEqual({
      lines: ["a", "b"],
      trailingTerminator: true,
    });
  });
  it("splits LF without trailing newline", () => {
    expect(splitLines("a\nb")).toEqual({
      lines: ["a", "b"],
      trailingTerminator: false,
    });
  });
  it("splits CRLF with trailing terminator", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual({
      lines: ["a", "b"],
      trailingTerminator: true,
    });
  });
  it("handles empty input", () => {
    expect(splitLines("")).toEqual({ lines: [], trailingTerminator: false });
  });
  it("handles a single terminator", () => {
    expect(splitLines("\n")).toEqual({ lines: [""], trailingTerminator: true });
  });
});

describe("spliceLines", () => {
  it("replaces a single line", () => {
    // lines: 1="a", 2="b", 3="c"; replace line 2 → 1-indexed [2,3)
    expect(spliceLines("a\nb\nc\n", 2, 3, ["B"], "\n")).toBe("a\nB\nc\n");
  });
  it("inserts at end (empty range after last line)", () => {
    expect(spliceLines("a\nb\n", 3, 3, ["c"], "\n")).toBe("a\nb\nc\n");
  });
  it("deletes a range", () => {
    expect(spliceLines("a\nb\nc\n", 2, 3, [], "\n")).toBe("a\nc\n");
  });
  it("preserves CRLF", () => {
    expect(spliceLines("a\r\nb\r\n", 2, 3, ["B"], "\r\n")).toBe("a\r\nB\r\n");
  });
  it("preserves no-trailing-newline input", () => {
    expect(spliceLines("a\nb", 2, 3, ["B"], "\n")).toBe("a\nB");
  });
  it("replaces multiple lines with a single line", () => {
    expect(spliceLines("a\nb\nc\nd\n", 2, 4, ["X"], "\n")).toBe("a\nX\nd\n");
  });
  it("inserts multiple lines", () => {
    expect(spliceLines("a\nd\n", 2, 2, ["b", "c"], "\n")).toBe("a\nb\nc\nd\n");
  });
});

describe("shiftYellowRanges", () => {
  it("leaves ranges before the edit untouched", () => {
    const existing = [{ start: 1, end: 2 }];
    const shifted = shiftYellowRanges(existing, {
      start: 5,
      end: 6,
      replacementCount: 1,
    });
    expect(shifted).toEqual([{ start: 1, end: 2 }]);
  });
  it("shifts ranges after the edit by delta", () => {
    const existing = [{ start: 10, end: 12 }];
    // replace lines 5..6 (1 line) with 3 new lines → delta = 3 - 1 = 2
    const shifted = shiftYellowRanges(existing, {
      start: 5,
      end: 6,
      replacementCount: 3,
    });
    expect(shifted).toEqual([{ start: 12, end: 14 }]);
  });
  it("drops ranges overlapping the edit", () => {
    const existing = [
      { start: 3, end: 6 },
      { start: 5, end: 6 },
    ];
    const shifted = shiftYellowRanges(existing, {
      start: 4,
      end: 7,
      replacementCount: 2,
    });
    expect(shifted).toEqual([]);
  });
  it("handles deletion (replacementCount = 0)", () => {
    const existing = [{ start: 10, end: 11 }];
    const shifted = shiftYellowRanges(existing, {
      start: 5,
      end: 7,
      replacementCount: 0,
    });
    expect(shifted).toEqual([{ start: 8, end: 9 }]);
  });
});
