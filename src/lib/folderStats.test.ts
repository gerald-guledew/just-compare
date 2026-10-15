import { describe, expect, it } from "vitest";
import type { ComparisonEntry, ComparisonStatus, FileEntry } from "../types";
import { folderStats } from "./folderStats";

function file(isDirectory = false): FileEntry {
  return {
    name: isDirectory ? "folder" : "file.txt",
    relative_path: isDirectory ? "folder" : "file.txt",
    is_directory: isDirectory,
    size: isDirectory ? 0 : 10,
    modified: 1,
    children: null,
  };
}

function entry(
  status: ComparisonStatus,
  children: ComparisonEntry[] | null = null,
): ComparisonEntry {
  const isDirectory = status.startsWith("Directory");
  return {
    left:
      status === "RightOnly" || status === "DirectoryRightOnly"
        ? null
        : file(isDirectory),
    right:
      status === "LeftOnly" || status === "DirectoryLeftOnly"
        ? null
        : file(isDirectory),
    status,
    children,
  };
}

describe("folderStats", () => {
  it.each([null, []])("returns zero totals for %j", (entries) => {
    expect(folderStats(entries)).toEqual({
      identical: 0,
      metadata: 0,
      modified: { files: 0, folders: 0 },
      leftOnly: { files: 0, folders: 0 },
      rightOnly: { files: 0, folders: 0 },
      total: { files: 0, folders: 0 },
    });
  });

  it("separates file statuses from one-sided directories", () => {
    expect(
      folderStats([
        entry("Identical"),
        entry("MetadataMatch"),
        entry("Modified"),
        entry("LeftOnly"),
        entry("RightOnly"),
        entry("DirectoryBoth", []),
        entry("DirectoryLeftOnly", []),
        entry("DirectoryRightOnly", []),
      ]),
    ).toEqual({
      identical: 1,
      metadata: 1,
      modified: { files: 1, folders: 0 },
      leftOnly: { files: 1, folders: 1 },
      rightOnly: { files: 1, folders: 1 },
      total: { files: 5, folders: 3 },
    });
  });

  it("counts all nested files and folders without relying on expansion flags", () => {
    expect(
      folderStats([
        entry("DirectoryLeftOnly", [
          entry("LeftOnly"),
          entry("DirectoryLeftOnly", [entry("LeftOnly"), entry("LeftOnly")]),
        ]),
        entry("DirectoryBoth", [
          entry("DirectoryRightOnly", [entry("RightOnly")]),
          entry("MetadataMatch"),
        ]),
      ]),
    ).toEqual({
      identical: 0,
      metadata: 1,
      modified: { files: 0, folders: 0 },
      leftOnly: { files: 3, folders: 2 },
      rightOnly: { files: 1, folders: 1 },
      total: { files: 5, folders: 4 },
    });
  });

  it.each([true, false])(
    "counts a file/folder mismatch once when folder is on left: %s",
    (leftFolder) => {
      const mismatch: ComparisonEntry = {
        status: "Modified",
        left: file(leftFolder),
        right: file(!leftFolder),
        children: [entry(leftFolder ? "LeftOnly" : "RightOnly")],
      };
      const counts = folderStats([mismatch]);
      expect(counts.modified).toEqual({ files: 0, folders: 1 });
      expect(counts.total).toEqual({ files: 1, folders: 1 });
      expect(counts[leftFolder ? "leftOnly" : "rightOnly"]).toEqual({
        files: 1,
        folders: 0,
      });
    },
  );

  it("does not double-count entries stored in the source file metadata", () => {
    const folder = entry("DirectoryBoth", [entry("Identical")]);
    if (folder.left) folder.left.children = [file()];
    if (folder.right) folder.right.children = [file()];
    expect(folderStats([folder]).total).toEqual({ files: 1, folders: 1 });
    expect(folderStats([folder]).identical).toBe(1);
  });
});
