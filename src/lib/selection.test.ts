import { describe, expect, it } from "vitest";
import type { FileEntry } from "./types";
import {
  normalizeSelection,
  pruneSelection,
  pruneSelectionState,
  rangeSelection,
  selectionStats,
  toggleSelection,
} from "./selection";
import { sortEntries } from "./sort";

function entry(name: string, size = 100, isDir = false, directory = "/tmp"): FileEntry {
  return {
    name,
    path: `${directory}/${name}`,
    isDir,
    isSymlink: false,
    size,
    modified: null,
    created: null,
    accessed: null,
    extension: null,
    isHidden: false,
    isReadOnly: false,
    target: null,
  };
}

describe("selection", () => {
  const entries = [entry("a"), entry("b"), entry("c"), entry("d", 500)];

  it("selects a range from the anchor", () => {
    const result = rangeSelection(entries, ["/tmp/a"], "/tmp/a", "/tmp/c", false);
    expect(result.selection).toEqual(["/tmp/a", "/tmp/b", "/tmp/c"]);
  });

  it("selects the same range in the reverse direction", () => {
    const result = rangeSelection(entries, ["/tmp/c"], "/tmp/c", "/tmp/a", false);
    expect(result.selection).toEqual(["/tmp/a", "/tmp/b", "/tmp/c"]);
    expect(result.anchorPath).toBe("/tmp/c");
  });

  it("keeps the original anchor through repeated Shift-clicks", () => {
    const first = rangeSelection(entries, ["/tmp/a"], "/tmp/a", "/tmp/c", false);
    const second = rangeSelection(entries, first.selection, first.anchorPath, "/tmp/b", false);
    expect(second.selection).toEqual(["/tmp/a", "/tmp/b"]);
    expect(second.anchorPath).toBe("/tmp/a");
  });

  it("adds a range to an existing selection when additive", () => {
    const result = rangeSelection(entries, ["/tmp/d"], "/tmp/b", "/tmp/c", true);
    expect(result.selection).toEqual(["/tmp/d", "/tmp/b", "/tmp/c"]);
  });

  it("toggles individual items", () => {
    const added = toggleSelection([], "/tmp/a");
    expect(added.selection).toEqual(["/tmp/a"]);
    const removed = toggleSelection(added.selection, "/tmp/a");
    expect(removed.selection).toEqual([]);
  });

  it("removes only the toggled item from a mixed selection", () => {
    const mixed = [entry("a"), entry("Folder", 0, true), entry("b")];
    const removed = toggleSelection(
      ["/tmp/a", "/tmp/Folder", "/tmp/b"],
      "/tmp/Folder",
    );
    expect(removed.selection).toEqual(["/tmp/a", "/tmp/b"]);
    expect(mixed.some((item) => item.path === removed.anchorPath)).toBe(true);
  });

  it("deduplicates paths and ignores empty identifiers", () => {
    expect(normalizeSelection(["/tmp/a", "", "/tmp/a", "/tmp/b"])).toEqual([
      "/tmp/a",
      "/tmp/b",
    ]);
  });

  it("keeps same-named files from different folders distinct", () => {
    const first = entry("report.txt", 10, false, "/left");
    const second = entry("report.txt", 20, false, "/right");
    const result = rangeSelection(
      [first, second],
      [first.path],
      first.path,
      second.path,
      false,
    );
    expect(result.selection).toEqual([first.path, second.path]);
    expect(new Set(result.selection).size).toBe(2);
  });

  it("uses the displayed sort order for range selection", () => {
    const unsorted = [entry("b"), entry("a"), entry("c")];
    const displayed = sortEntries(unsorted, "name", "asc");
    const result = rangeSelection(displayed, ["/tmp/a"], "/tmp/a", "/tmp/c", false);
    expect(result.selection).toEqual(["/tmp/a", "/tmp/b", "/tmp/c"]);
    const descending = sortEntries(unsorted, "name", "desc");
    const reverse = rangeSelection(descending, ["/tmp/c"], "/tmp/c", "/tmp/a", false);
    expect(reverse.selection).toEqual(["/tmp/c", "/tmp/b", "/tmp/a"]);
  });

  it("prunes selections that no longer exist", () => {
    expect(pruneSelection(entries, ["/tmp/a", "/tmp/missing"])).toEqual(["/tmp/a"]);
  });

  it("prunes a deleted anchor and re-anchors to a visible selection", () => {
    const result = pruneSelectionState(entries, ["/tmp/missing", "/tmp/b"], "/tmp/missing");
    expect(result.selection).toEqual(["/tmp/b"]);
    expect(result.anchorPath).toBe("/tmp/b");
  });

  it("computes count and bytes", () => {
    const stats = selectionStats(entries, ["/tmp/a", "/tmp/d"]);
    expect(stats.count).toBe(2);
    expect(stats.bytes).toBe(600);
  });
});
