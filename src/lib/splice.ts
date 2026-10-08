export type Terminator = "\n" | "\r\n";

export interface YellowRange {
  start: number; // 1-indexed, inclusive
  end: number; // 1-indexed, exclusive
}

export function detectTerminator(text: string): Terminator {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function splitLines(text: string): {
  lines: string[];
  trailingTerminator: boolean;
} {
  if (text.length === 0) {
    return { lines: [], trailingTerminator: false };
  }

  const lines = text.split(/\r\n|\n/);
  // Empty final element means the input ended with a terminator.
  const trailingTerminator = lines[lines.length - 1] === "";
  if (trailingTerminator) {
    lines.pop();
  }
  return { lines, trailingTerminator };
}

export function spliceLines(
  text: string,
  start1: number,
  end1: number,
  replacement: string[],
  terminator: Terminator,
): string {
  const { lines, trailingTerminator } = splitLines(text);
  const startIdx = Math.max(0, Math.min(start1 - 1, lines.length));
  const endIdx = Math.max(startIdx, Math.min(end1 - 1, lines.length));

  const next = [...lines.slice(0, startIdx), ...replacement, ...lines.slice(endIdx)];

  if (next.length === 0) {
    return trailingTerminator ? "" : "";
  }

  const joined = next.join(terminator);
  return trailingTerminator ? joined + terminator : joined;
}

export function shiftYellowRanges(
  existing: YellowRange[],
  edit: { start: number; end: number; replacementCount: number },
): YellowRange[] {
  const delta = edit.replacementCount - (edit.end - edit.start);
  const out: YellowRange[] = [];
  for (const r of existing) {
    if (r.end <= edit.start) {
      out.push(r);
    } else if (r.start >= edit.end) {
      out.push({ start: r.start + delta, end: r.end + delta });
    }
    // else: overlaps the edit — drop; the caller appends the new replacement range.
  }
  return out;
}
