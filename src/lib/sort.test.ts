import { describe, expect, it } from "vitest";
import type { FileEntry } from "./types";
import { groupEntries, sortEntries } from "./sort";

function entry(name: string, options: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    path: `/tmp/${name}`,
    isDir: false,
    isSymlink: false,
    size: 100,
    modified: new Date(2026, 9, 20).getTime(),
    created: null,
    accessed: null,
    extension: name.split(".").pop() ?? null,
    isHidden: false,
    isReadOnly: false,
    target: null,
    ...options,
  };
}

describe("sortEntries", () => {
  it("keeps folders before files for ascending name sort", () => {
    const entries = [entry("b.txt"), entry("Zeta", { isDir: true }), entry("a.txt")];
    const sorted = sortEntries(entries, "name", "asc").map((item) => item.name);
    expect(sorted).toEqual(["Zeta", "a.txt", "b.txt"]);
  });

  it("sorts folders before files for descending name sort", () => {
    const entries = [entry("b.txt"), entry("Zeta", { isDir: true }), entry("a.txt")];
    const sorted = sortEntries(entries, "name", "desc").map((item) => item.name);
    expect(sorted).toEqual(["Zeta", "b.txt", "a.txt"]);
  });

  it("sorts by size without mutating the input", () => {
    const entries = [entry("large.bin", { size: 9000 }), entry("small.bin", { size: 10 })];
    const sorted = sortEntries(entries, "size", "asc");
    expect(sorted.map((item) => item.name)).toEqual(["small.bin", "large.bin"]);
    expect(entries.map((item) => item.name)).toEqual(["large.bin", "small.bin"]);
  });
});

describe("groupEntries", () => {
  it("groups by Windows-like categories", () => {
    const groups = groupEntries(
      [
        entry("Folder", { isDir: true }),
        entry("notes.pdf"),
        entry("photo.png"),
        entry("song.mp3"),
        entry("clip.mp4"),
        entry("archive.zip"),
        entry("app.exe"),
      ],
      "type",
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Folders",
      "Documents",
      "Pictures",
      "Music",
      "Videos",
      "Compressed",
      "Applications",
    ]);
  });

  it("returns one unlabeled group when grouping is off", () => {
    const groups = groupEntries([entry("a")], "none");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("");
  });
});
