import type { DiffLine } from "../types";

export interface DocumentStats {
  lines: number;
  words: number;
}

/** Count editor rows and words, with contractions kept together and hyphens split. */
export function documentStats(text: string): DocumentStats {
  let lines = 1;
  for (let index = 0; index < text.length; index++) {
    const character = text.charCodeAt(index);
    if (character === 13) {
      lines++;
      if (text.charCodeAt(index + 1) === 10) index++;
    } else if (character === 10) {
      lines++;
    }
  }

  // Combining marks belong to the preceding letter or number. Markdown
  // punctuation does not count as a word, including standalone apostrophes.
  const wordPattern =
    /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
  let words = 0;
  while (wordPattern.exec(text) !== null) words++;

  return { lines, words };
}

export interface DiffStats {
  changed: number;
  leftOnly: number;
  rightOnly: number;
  blocks: number;
}

/** Count existing diff rows, treating each replacement as one changed pair. */
export function diffStats(lines: DiffLine[]): DiffStats {
  const stats: DiffStats = {
    changed: 0,
    leftOnly: 0,
    rightOnly: 0,
    blocks: 0,
  };
  let insideBlock = false;
  for (const line of lines) {
    if (line.kind === "Equal") {
      insideBlock = false;
      continue;
    }
    if (!insideBlock) {
      stats.blocks++;
      insideBlock = true;
    }
    switch (line.kind) {
      case "Replace":
        stats.changed++;
        break;
      case "Delete":
        stats.leftOnly++;
        break;
      case "Insert":
        stats.rightOnly++;
        break;
    }
  }
  return stats;
}
