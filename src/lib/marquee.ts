/** Geometry helpers for rubber-band selection. */

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Minimum movement before a press becomes a marquee drag. */
export const MARQUEE_THRESHOLD = 4;

export function pointDistance(origin: Point, current: Point): number {
  return Math.hypot(current.x - origin.x, current.y - origin.y);
}

export function normalizeMarqueeRect(origin: Point, current: Point): MarqueeRect {
  return {
    left: Math.min(origin.x, current.x),
    top: Math.min(origin.y, current.y),
    width: Math.abs(current.x - origin.x),
    height: Math.abs(current.y - origin.y),
  };
}

/** Half-open intersection: touching edges do not count as an overlap. */
export function rectsIntersect(left: RectLike, right: RectLike): boolean {
  return (
    left.left < right.left + right.width &&
    left.left + left.width > right.left &&
    left.top < right.top + right.height &&
    left.top + left.height > right.top
  );
}

export function marqueeSelection<T extends { path: string; rect: RectLike }>(
  items: readonly T[],
  marquee: MarqueeRect,
): string[] {
  const selected: string[] = [];
  for (const item of items) {
    if (rectsIntersect(item.rect, marquee)) {
      selected.push(item.path);
    }
  }
  return selected;
}

export function mergeSelection(base: readonly string[], added: readonly string[]): string[] {
  if (!base.length) return added.slice();
  const result = base.slice();
  const seen = new Set(result);
  for (const path of added) {
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

export function samePaths(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
