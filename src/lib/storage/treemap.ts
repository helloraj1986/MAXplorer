export interface TreemapItem {
  id: string;
  label: string;
  size: number;
}

export interface TreemapRect extends TreemapItem {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScaledItem extends TreemapItem {
  area: number;
}

function worstRatio(row: ScaledItem[], side: number): number {
  if (!row.length || side <= 0) return Number.POSITIVE_INFINITY;
  const sum = row.reduce((total, item) => total + item.area, 0);
  if (sum <= 0) return Number.POSITIVE_INFINITY;
  const max = Math.max(...row.map((item) => item.area));
  const min = Math.min(...row.map((item) => item.area));
  if (min <= 0) return Number.POSITIVE_INFINITY;
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Squarified treemap layout. The implementation is deterministic, bounded by
 * the supplied rectangle, and never renders one DOM node per file: callers
 * paint the returned rectangles on a canvas and keep an accessible list beside
 * it. Items with zero or negative sizes are ignored.
 */
export function layoutTreemap(
  items: TreemapItem[],
  width: number,
  height: number,
): TreemapRect[] {
  if (width <= 0 || height <= 0) return [];
  const usable = items
    .filter((item) => Number.isFinite(item.size) && item.size > 0)
    .sort((left, right) => right.size - left.size || left.label.localeCompare(right.label));
  if (!usable.length) return [];
  const total = usable.reduce((sum, item) => sum + item.size, 0);
  if (total <= 0) return [];
  const scale = (width * height) / total;
  let remaining: ScaledItem[] = usable.map((item) => ({ ...item, area: item.size * scale }));
  let free: FreeRect = { x: 0, y: 0, width, height };
  const output: TreemapRect[] = [];

  while (remaining.length && free.width > 0.01 && free.height > 0.01) {
    const side = Math.min(free.width, free.height);
    const row: ScaledItem[] = [remaining[0]];
    let index = 1;
    while (index < remaining.length) {
      const next = remaining[index];
      if (worstRatio([...row, next], side) <= worstRatio(row, side)) {
        row.push(next);
        index += 1;
      } else {
        break;
      }
    }
    const rowArea = row.reduce((sum, item) => sum + item.area, 0);
    if (rowArea <= 0) break;
    if (free.width >= free.height) {
      const stripWidth = Math.min(free.width, rowArea / free.height);
      let y = free.y;
      for (const item of row) {
        const itemHeight = (item.area / rowArea) * free.height;
        output.push({
          id: item.id,
          label: item.label,
          size: item.size,
          x: free.x,
          y,
          width: stripWidth,
          height: itemHeight,
        });
        y += itemHeight;
      }
      free = {
        x: free.x + stripWidth,
        y: free.y,
        width: Math.max(0, free.width - stripWidth),
        height: free.height,
      };
    } else {
      const stripHeight = Math.min(free.height, rowArea / free.width);
      let x = free.x;
      for (const item of row) {
        const itemWidth = (item.area / rowArea) * free.width;
        output.push({
          id: item.id,
          label: item.label,
          size: item.size,
          x,
          y: free.y,
          width: itemWidth,
          height: stripHeight,
        });
        x += itemWidth;
      }
      free = {
        x: free.x,
        y: free.y + stripHeight,
        width: free.width,
        height: Math.max(0, free.height - stripHeight),
      };
    }
    remaining = remaining.slice(row.length);
  }
  return output;
}

export function treemapHitTest(
  rectangles: TreemapRect[],
  x: number,
  y: number,
): TreemapRect | null {
  for (let index = rectangles.length - 1; index >= 0; index -= 1) {
    const rect = rectangles[index];
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return rect;
    }
  }
  return null;
}
