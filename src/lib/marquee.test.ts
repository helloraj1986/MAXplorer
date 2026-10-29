import { describe, expect, it } from "vitest";
import {
  marqueeSelection,
  mergeSelection,
  normalizeMarqueeRect,
  rectsIntersect,
  samePaths,
} from "./marquee";

const rows = [
  { path: "/tmp/a", rect: { left: 0, top: 0, width: 200, height: 30 } },
  { path: "/tmp/b", rect: { left: 0, top: 31, width: 200, height: 30 } },
  { path: "/tmp/c", rect: { left: 0, top: 62, width: 200, height: 30 } },
];

describe("marquee geometry", () => {
  it("normalizes a rectangle dragged in every direction", () => {
    for (const current of [
      { x: 100, y: 50 },
      { x: -100, y: 50 },
      { x: 100, y: -50 },
      { x: -100, y: -50 },
    ]) {
      expect(normalizeMarqueeRect({ x: 10, y: 10 }, current)).toEqual({
        left: Math.min(10, current.x),
        top: Math.min(10, current.y),
        width: Math.abs(current.x - 10),
        height: Math.abs(current.y - 10),
      });
    }
  });

  it("selects every intersecting row regardless of drag direction", () => {
    const forward = normalizeMarqueeRect({ x: 5, y: 4 }, { x: 500, y: 65 });
    const reverse = normalizeMarqueeRect({ x: 500, y: 65 }, { x: 5, y: 4 });
    expect(marqueeSelection(rows, forward)).toEqual(["/tmp/a", "/tmp/b", "/tmp/c"]);
    expect(marqueeSelection(rows, reverse)).toEqual(["/tmp/a", "/tmp/b", "/tmp/c"]);
  });

  it("does not select rows that only touch the marquee edge", () => {
    expect(rectsIntersect(
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 10, top: 0, width: 10, height: 10 },
    )).toBe(false);
  });

  it("keeps selection order stable and avoids duplicate paths", () => {
    expect(mergeSelection(["/tmp/a", "/tmp/c"], ["/tmp/c", "/tmp/b"])).toEqual([
      "/tmp/a",
      "/tmp/c",
      "/tmp/b",
    ]);
    expect(samePaths(["/tmp/a"], ["/tmp/a"])).toBe(true);
    expect(samePaths(["/tmp/a"], ["/tmp/a", "/tmp/b"])).toBe(false);
  });
});
