import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_MIN_PANE_WIDTH,
  MIN_PANE_WIDTH,
  clampRatioToBounds,
  keyboardRatio,
  leftPaneWidth,
  ratioAtPointer,
  ratioBounds,
} from "./divider";

describe("divider geometry", () => {
  it("keeps both panes at least the preferred width on normal windows", () => {
    const bounds = ratioBounds(1200, MIN_PANE_WIDTH, 14);
    expect(bounds.min).toBeCloseTo(MIN_PANE_WIDTH / 1186, 5);
    expect(bounds.max).toBeCloseTo(1 - MIN_PANE_WIDTH / 1186, 5);
    expect(bounds.min).toBeLessThan(bounds.max);
  });

  it("shrinks the floor gracefully on very narrow windows", () => {
    const bounds = ratioBounds(800, MIN_PANE_WIDTH, 14);
    expect(bounds.min).toBeLessThan(0.45);
    expect(bounds.max).toBeGreaterThan(0.55);
    expect(bounds.min).toBeGreaterThan(0);
    expect(bounds.max).toBeLessThan(1);
  });

  it("still produces usable bounds at extreme sizes", () => {
    const fallback = ratioBounds(0, MIN_PANE_WIDTH, 14);
    expect(fallback).toEqual({ min: 0.18, max: 0.82 });

    const narrow = ratioBounds(120, MIN_PANE_WIDTH, 14);
    expect(narrow.min).toBe(0.45);
    expect(narrow.max).toBe(0.55);
    expect(narrow.min).toBeLessThan(narrow.max);

    const tiny = ratioBounds(80, MIN_PANE_WIDTH, 14);
    expect(tiny.min).toBeGreaterThanOrEqual(0.18);
    expect(tiny.max).toBeLessThanOrEqual(0.82);
    expect(tiny.min).toBeLessThan(tiny.max);
  });

  it("clamps pointer positions against the available content width", () => {
    const bounds = { min: 0.2, max: 0.8 };
    expect(ratioAtPointer(500, { left: 0, width: 1000 }, bounds, 14)).toBeCloseTo(0.5, 2);
    expect(ratioAtPointer(-50, { left: 0, width: 1000 }, bounds, 14)).toBe(0.2);
    expect(ratioAtPointer(2000, { left: 0, width: 1000 }, bounds, 14)).toBe(0.8);
  });

  it("computes the left pane width so the divider centre follows the pointer", () => {
    const width = 1000;
    const divider = 14;
    const left = leftPaneWidth(width, 0.5, divider);
    expect(left).toBe(493);
    expect(left + divider + left).toBe(width);
    expect(leftPaneWidth(width, -1, divider)).toBe(0);
    expect(leftPaneWidth(width, 2, divider)).toBe(986);
  });

  it("respects custom minimum pane widths", () => {
    const bounds = ratioBounds(1000, 240, 12);
    expect(bounds.min).toBeCloseTo(240 / 988, 4);
  });
});

describe("divider keyboard behaviour", () => {
  const bounds = { min: 0.2, max: 0.8 };

  it("moves by a step with arrow keys and a larger step with Shift", () => {
    expect(keyboardRatio(0.5, "ArrowLeft", bounds)).toBeCloseTo(0.47, 5);
    expect(keyboardRatio(0.5, "ArrowRight", bounds)).toBeCloseTo(0.53, 5);
    expect(keyboardRatio(0.5, "ArrowRight", bounds, 0.03, 0.1, true)).toBeCloseTo(0.6, 5);
  });

  it("clamps at the ends and supports Home/End/reset", () => {
    expect(keyboardRatio(0.2, "ArrowLeft", bounds)).toBe(0.2);
    expect(keyboardRatio(0.8, "ArrowRight", bounds)).toBe(0.8);
    expect(keyboardRatio(0.4, "Home", bounds)).toBe(0.2);
    expect(keyboardRatio(0.4, "End", bounds)).toBe(0.8);
    expect(keyboardRatio(0.7, "Enter", bounds)).toBe(0.5);
    expect(keyboardRatio(0.7, " ", bounds)).toBe(0.5);
  });

  it("ignores unrelated keys", () => {
    expect(keyboardRatio(0.5, "a", bounds)).toBeNull();
    expect(keyboardRatio(0.5, "Escape", bounds)).toBeNull();
  });

  it("never lets a keyboard step cross the pane minimums", () => {
    expect(clampRatioToBounds(0.01, bounds)).toBe(0.2);
    expect(clampRatioToBounds(0.99, bounds)).toBe(0.8);
    expect(ABSOLUTE_MIN_PANE_WIDTH).toBeLessThan(MIN_PANE_WIDTH);
  });
});
