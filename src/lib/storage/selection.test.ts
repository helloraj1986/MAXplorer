import { describe, expect, it } from "vitest";
import {
  addPicks,
  canSelectDuplicate,
  pickFromRecommendation,
  recommendationSelection,
  removePicks,
  summarizeSelection,
  togglePick,
} from "./selection";
import type { CleanupRecommendation, StoragePick } from "./types";

function pick(path: string, size: number, risk?: StoragePick["risk"]): StoragePick {
  return {
    path,
    name: path.split("/").pop() ?? path,
    size,
    isDirectory: false,
    modified: 1,
    category: "other",
    risk,
    source: "file",
  };
}

describe("storage selection accounting", () => {
  it("counts a folder once when a descendant file is also selected", () => {
    const summary = summarizeSelection([
      pick("/Users/me/Downloads", 900),
      pick("/Users/me/Downloads/large.dmg", 400),
      pick("/Users/me/Movies", 100),
    ]);
    expect(summary.count).toBe(2);
    expect(summary.skipped).toHaveLength(1);
    expect(summary.totalBytes).toBe(1000);
  });

  it("does not double-count duplicate paths", () => {
    const summary = summarizeSelection([pick("/a/file.bin", 10), pick("/a/file.bin", 10)]);
    expect(summary.count).toBe(1);
    expect(summary.totalBytes).toBe(10);
  });

  it("summarizes the highest risk without inflating the total", () => {
    const summary = summarizeSelection([
      pick("/a", 20, "high"),
      pick("/b", 30, "review"),
      pick("/c", 50, "low"),
    ]);
    expect(summary.highRisk).toBe(1);
    expect(summary.reviewRisk).toBe(1);
    expect(summary.lowRisk).toBe(1);
    expect(summary.totalBytes).toBe(100);
  });

  it("prevents selecting every copy in a duplicate group", () => {
    expect(canSelectDuplicate(["/a", "/b"], [], "/a").allowed).toBe(true);
    expect(canSelectDuplicate(["/a", "/b"], ["/a"], "/b").allowed).toBe(false);
    expect(canSelectDuplicate(["/a", "/b"], ["/a"], "/a").allowed).toBe(true);
    expect(canSelectDuplicate(["/a", "/b"], [], "/c").allowed).toBe(false);
  });

  it("adds, toggles, and removes picks idempotently", () => {
    let picks = addPicks([], [pick("/a", 1), pick("/a", 1)]);
    expect(picks).toHaveLength(1);
    picks = togglePick(picks, pick("/a", 1));
    expect(picks).toHaveLength(0);
    picks = addPicks([], [pick("/a", 1), pick("/b", 2)]);
    picks = removePicks(picks, ["/a"]);
    expect(picks.map((item) => item.path)).toEqual(["/b"]);
  });

  it("deduplicates recommendations that overlap", () => {
    const recommendations: CleanupRecommendation[] = [
      {
        id: "1",
        kind: "applicationCaches",
        title: "Caches",
        reason: "test",
        path: "/Users/me/Library/Caches",
        size: 500,
        recoverableBytes: 500,
        risk: "review",
        action: "trash",
        isDirectory: true,
        category: "caches",
        modified: 1,
        reversible: true,
        note: null,
      },
      {
        id: "2",
        kind: "largeDownload",
        title: "Download",
        reason: "test",
        path: "/Users/me/Library/Caches/big.bin",
        size: 200,
        recoverableBytes: 200,
        risk: "review",
        action: "trash",
        isDirectory: false,
        category: "downloads",
        modified: 1,
        reversible: true,
        note: null,
      },
    ];
    const summary = recommendationSelection(recommendations);
    expect(summary.count).toBe(1);
    expect(summary.totalBytes).toBe(500);
    expect(pickFromRecommendation(recommendations[1]).source).toBe("recommendation");
  });
});
