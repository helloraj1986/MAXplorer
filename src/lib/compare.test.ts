import { describe, expect, it } from "vitest";
import {
  comparisonCategory,
  comparisonCategoryLabel,
  comparisonIndicators,
  comparisonSummary,
  isComparisonDifference,
  visibleComparisonEntries,
} from "./compare";
import type { ComparisonEntry, FolderComparison } from "./types";

function entry(overrides: Partial<ComparisonEntry> = {}): ComparisonEntry {
  const name = overrides.name ?? "file.txt";
  return {
    name,
    leftPath: `/left/${name}`,
    rightPath: `/right/${name}`,
    leftSize: 10,
    rightSize: 10,
    leftModified: 1000,
    rightModified: 1000,
    isDir: false,
    sizeDiffers: false,
    modifiedDiffers: false,
    contentEqual: true,
    ...overrides,
  };
}

function comparison(entries: ComparisonEntry[]): FolderComparison {
  return {
    left: "/left",
    right: "/right",
    entries,
    leftOnly: entries.filter((item) => comparisonCategory(item) === "leftOnly").length,
    rightOnly: entries.filter((item) => comparisonCategory(item) === "rightOnly").length,
    different: entries.filter((item) =>
      ["size", "modified", "content"].includes(comparisonCategory(item)),
    ).length,
    identical: entries.filter((item) => comparisonCategory(item) === "identical").length,
    contentVerified: entries.filter((item) => item.contentEqual != null).length,
    cancelled: false,
    scanned: entries.length,
    errors: 0,
  };
}

describe("folder comparison helpers", () => {
  it("categorizes one-sided, differing, and identical entries", () => {
    expect(comparisonCategory(entry({ rightPath: null }))).toBe("leftOnly");
    expect(comparisonCategory(entry({ leftPath: null }))).toBe("rightOnly");
    expect(comparisonCategory(entry({ contentEqual: false }))).toBe("content");
    expect(comparisonCategory(entry({ sizeDiffers: true }))).toBe("size");
    expect(comparisonCategory(entry({ modifiedDiffers: true }))).toBe("modified");
    expect(comparisonCategory(entry())).toBe("identical");
  });

  it("prefers content differences over metadata differences", () => {
    expect(
      comparisonCategory(entry({ contentEqual: false, sizeDiffers: true, modifiedDiffers: true })),
    ).toBe("content");
  });

  it("exposes human-readable labels for every category", () => {
    expect(comparisonCategoryLabel("leftOnly")).toBe("Only in left");
    expect(comparisonCategoryLabel("rightOnly")).toBe("Only in right");
    expect(comparisonCategoryLabel("size")).toBe("Different size");
    expect(comparisonCategoryLabel("modified")).toBe("Different date");
    expect(comparisonCategoryLabel("content")).toBe("Different content");
    expect(comparisonCategoryLabel("identical")).toBe("Identical");
  });

  it("filters identical entries when differences-only is enabled", () => {
    const entries = [
      entry({ name: "same.txt" }),
      entry({ name: "changed.txt", sizeDiffers: true }),
      entry({ name: "left.txt", rightPath: null }),
    ];
    expect(visibleComparisonEntries(comparison(entries), false)).toHaveLength(3);
    expect(visibleComparisonEntries(comparison(entries), true).map((item) => item.name)).toEqual([
      "changed.txt",
      "left.txt",
    ]);
    expect(isComparisonDifference(entries[0])).toBe(false);
    expect(isComparisonDifference(entries[1])).toBe(true);
  });

  it("builds per-pane indicator maps and skips identical rows", () => {
    const result = comparison([
      entry({ name: "same.txt" }),
      entry({ name: "changed.txt", contentEqual: false }),
      entry({ name: "left.txt", rightPath: null }),
    ]);
    const indicators = comparisonIndicators(result);
    expect(indicators.left.get("/left/same.txt")).toBeUndefined();
    expect(indicators.left.get("/left/changed.txt")).toBe("content");
    expect(indicators.right.get("/right/changed.txt")).toBe("content");
    expect(indicators.left.get("/left/left.txt")).toBe("leftOnly");
    expect(indicators.right.get("/left/left.txt")).toBeUndefined();
    expect(comparisonIndicators(null).left.size).toBe(0);
  });

  it("summarizes counts for the comparison panel", () => {
    const result = comparison([
      entry({ name: "same.txt" }),
      entry({ name: "changed.txt", sizeDiffers: true }),
      entry({ name: "left.txt", rightPath: null }),
    ]);
    expect(comparisonSummary(result)).toBe(
      "1 only left | 0 only right | 1 different | 1 identical | 3 content checked",
    );
  });
});
