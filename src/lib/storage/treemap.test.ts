import { describe, expect, it } from "vitest";
import { layoutTreemap, treemapHitTest } from "./treemap";

describe("squarified treemap layout", () => {
  it("fills the rectangle in proportion to item sizes", () => {
    const rects = layoutTreemap(
      [
        { id: "a", label: "A", size: 60 },
        { id: "b", label: "B", size: 30 },
        { id: "c", label: "C", size: 10 },
      ],
      400,
      300,
    );
    expect(rects).toHaveLength(3);
    const totalArea = rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    expect(totalArea).toBeCloseTo(400 * 300, 0);
    const a = rects.find((rect) => rect.id === "a")!;
    expect((a.width * a.height) / totalArea).toBeCloseTo(0.6, 1);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(400.01);
      expect(rect.y + rect.height).toBeLessThanOrEqual(300.01);
    }
  });

  it("ignores zero-sized items and empty dimensions", () => {
    expect(layoutTreemap([{ id: "a", label: "A", size: 0 }], 100, 100)).toEqual([]);
    expect(layoutTreemap([{ id: "a", label: "A", size: 10 }], 0, 100)).toEqual([]);
  });

  it("handles many items without leaving the bounds or producing NaN", () => {
    const items = Array.from({ length: 250 }, (_, index) => ({
      id: `item-${index}`,
      label: `Item ${index}`,
      size: 1 + ((index * 37) % 100),
    }));
    const rects = layoutTreemap(items, 800, 480);
    expect(rects).toHaveLength(items.length);
    for (const rect of rects) {
      expect(Number.isFinite(rect.x)).toBe(true);
      expect(Number.isFinite(rect.y)).toBe(true);
      expect(Number.isFinite(rect.width)).toBe(true);
      expect(Number.isFinite(rect.height)).toBe(true);
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });

  it("hit-tests the last painted rectangle", () => {
    const rects = layoutTreemap(
      [
        { id: "a", label: "A", size: 1 },
        { id: "b", label: "B", size: 1 },
      ],
      100,
      100,
    );
    const target = rects[rects.length - 1];
    expect(treemapHitTest(rects, target.x + 1, target.y + 1)?.id).toBe(target.id);
    expect(treemapHitTest(rects, -5, -5)).toBeNull();
  });
});
