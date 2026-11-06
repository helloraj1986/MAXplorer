/**
 * Geometry helpers for the dual-pane divider.
 *
 * Keeping these pure makes the pointer/keyboard behaviour testable without a
 * browser and ensures the component and its regression tests share exactly the
 * same clamping rules.
 */

/** Preferred minimum pane width, in logical pixels. */
export const MIN_PANE_WIDTH = 300;
/** Below this the split still works, but only on genuinely tiny windows. */
export const ABSOLUTE_MIN_PANE_WIDTH = 80;
/** Default interactive target around the visible line. */
export const DEFAULT_DIVIDER_HIT_AREA = 14;

export interface RatioBounds {
  min: number;
  max: number;
}

/**
 * Converts pixel constraints into a valid ratio range for a container.
 *
 * The 0.18–0.82 store clamp is a safety net, while `MIN_PANE_WIDTH` keeps panes
 * usable on normal window sizes. On windows too narrow for two full-size panes
 * the minimum shrinks gracefully instead of making the divider jump or vanish.
 */
export function ratioBounds(
  containerWidth: number,
  minPaneWidth = MIN_PANE_WIDTH,
  dividerWidth = DEFAULT_DIVIDER_HIT_AREA,
): RatioBounds {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return { min: 0.18, max: 0.82 };
  }
  const usable = Math.max(1, containerWidth - dividerWidth);
  const requestedMinimum = Math.min(minPaneWidth, Math.max(ABSOLUTE_MIN_PANE_WIDTH, usable / 2 - 1));
  const edge = Math.min(0.45, requestedMinimum / usable);
  return { min: Math.max(0.18, edge), max: Math.min(0.82, 1 - edge) };
}

/** Clamps a ratio to the supplied bounds, tolerating non-finite input. */
export function clampRatioToBounds(value: number, bounds: RatioBounds): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * Ratio for a pointer position.
 *
 * `ratio` is expressed against the space between the panes (container width
 * minus the divider's interactive width), so the rendered divider centre lands
 * directly under the pointer.
 */
export function ratioAtPointer(
  clientX: number,
  container: Pick<DOMRect, "left" | "width">,
  bounds: RatioBounds,
  dividerWidth = DEFAULT_DIVIDER_HIT_AREA,
): number {
  const usable = container.width - dividerWidth;
  if (!Number.isFinite(clientX) || usable <= 0) return 0.5;
  return clampRatioToBounds((clientX - container.left - dividerWidth / 2) / usable, bounds);
}

/** Vertical equivalent of `ratioAtPointer`, used by bottom preview layouts. */
export function ratioAtPointerY(
  clientY: number,
  container: Pick<DOMRect, "top" | "height">,
  bounds: RatioBounds,
  dividerHeight = DEFAULT_DIVIDER_HIT_AREA,
): number {
  const usable = container.height - dividerHeight;
  if (!Number.isFinite(clientY) || usable <= 0) return 0.5;
  return clampRatioToBounds((clientY - container.top - dividerHeight / 2) / usable, bounds);
}

/** Applies a keyboard delta, supporting Home/End and reset semantics. */
export function keyboardRatio(
  current: number,
  key: string,
  bounds: RatioBounds,
  step = 0.03,
  largeStep = 0.1,
  shift = false,
): number | null {
  const delta = shift ? largeStep : step;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampRatioToBounds(current - delta, bounds);
    case "ArrowRight":
    case "ArrowUp":
      return clampRatioToBounds(current + delta, bounds);
    case "Home":
      return bounds.min;
    case "End":
      return bounds.max;
    case "Enter":
    case " ":
      return clampRatioToBounds(0.5, bounds);
    default:
      return null;
  }
}

/** Pixel width of the left pane for a content ratio. */
export function leftPaneWidth(containerWidth: number, ratio: number, dividerWidth: number): number {
  const usable = Math.max(0, containerWidth - dividerWidth);
  return usable * clampRatioToBounds(ratio, { min: 0, max: 1 });
}
