import { describe, expect, it } from "vitest";
import type { FileEntry } from "./types";
import { pruneSelection, rangeSelection, selectionStats, toggleSelection } from "./selection";

function entry(name: string, size = 100): FileEntry {
  return {
    name,
    path: `/tmp/${name}`,
    isDir: false,
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

  it("prunes selections that no longer exist", () => {
    expect(pruneSelection(entries, ["/tmp/a", "/tmp/missing"])).toEqual(["/tmp/a"]);
  });

  it("computes count and bytes", () => {
    const stats = selectionStats(entries, ["/tmp/a", "/tmp/d"]);
    expect(stats.count).toBe(2);
    expect(stats.bytes).toBe(600);
  });
});
