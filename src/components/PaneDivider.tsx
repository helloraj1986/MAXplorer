import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { keyboardRatio, ratioAtPointer, ratioAtPointerY } from "../lib/divider";

interface PaneDividerProps {
  /** Current effective split ratio, used for the accessible value. */
  ratio: number;
  minRatio: number;
  maxRatio: number;
  /** Interactive width in logical pixels; the visible line stays slim. */
  hitAreaWidth: number;
  /** The element whose width defines the split. */
  containerRef: RefObject<HTMLElement | null>;
  onRatioChange: (ratio: number) => void;
  onReset?: () => void;
  disabled?: boolean;
  label?: string;
  /** Vertical dividers split left/right; horizontal dividers split top/bottom. */
  orientation?: "vertical" | "horizontal";
  className?: string;
}

/**
 * Accessible, theme-aware divider between the two file panes.
 *
 * The element is the invisible hit area (12–28px). A child renders the visible
 * 1–8px line, so the file lists keep their space while the pointer target stays
 * comfortable. All colours, widths, grip behaviour and the active-pane
 * indicator come from theme tokens — this component contains no hard-coded
 * palette values.
 */
export function PaneDivider({
  ratio,
  minRatio,
  maxRatio,
  hitAreaWidth,
  containerRef,
  onRatioChange,
  onReset,
  disabled = false,
  label = "Resize panes",
  orientation = "vertical",
  className,
}: PaneDividerProps) {
  const [dragging, setDragging] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const boundsRef = useRef({ min: minRatio, max: maxRatio });
  boundsRef.current = { min: minRatio, max: maxRatio };

  const stopDragging = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  // Never leave window listeners, capture or the body class behind.
  useEffect(() => stopDragging, [stopDragging]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || cleanupRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    // The divider is a layout control: it must never select a file row, start a
    // native drag, or let the pointer select text while resizing.
    event.preventDefault();
    event.stopPropagation();

    const rect = container.getBoundingClientRect();
    const divider = event.currentTarget;
    const pointerId = event.pointerId;
    const bounds = boundsRef.current;

    try {
      divider.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture can fail if the pointer is already gone; the window
      // listeners below still keep the drag alive.
    }

    setDragging(true);
    document.body.classList.add(orientation === "horizontal" ? "resizing-panes-horizontal" : "resizing-panes");

    const move = (moveEvent: PointerEvent) => {
      onRatioChange(
        orientation === "horizontal"
          ? ratioAtPointerY(moveEvent.clientY, rect, bounds, hitAreaWidth)
          : ratioAtPointer(moveEvent.clientX, rect, bounds, hitAreaWidth),
      );
    };

    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        if (divider.hasPointerCapture?.(pointerId)) divider.releasePointerCapture(pointerId);
      } catch {
        // The element may have been removed mid-drag (pane collapse).
      }
      document.body.classList.remove("resizing-panes", "resizing-panes-horizontal");
      setDragging(false);
      cleanupRef.current = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") finish();
    };

    cleanupRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    document.addEventListener("visibilitychange", onVisibility);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = keyboardRatio(
      ratio,
      event.key,
      boundsRef.current,
      0.03,
      0.1,
      event.shiftKey,
    );
    if (next === null) return;
    // Stop file-list navigation shortcuts (arrows, Home, End, Space) from
    // firing while the divider owns focus.
    event.preventDefault();
    event.stopPropagation();
    if ((event.key === "Enter" || event.key === " ") && onReset) {
      onReset();
    } else {
      onRatioChange(next);
    }
  };

  const percent = Math.round(ratio * 100);
  return (
    <div
      className={`pane-divider ${orientation === "horizontal" ? "horizontal" : ""} ${className ?? ""} ${dragging ? "is-dragging" : ""}`}
      style={{ "--pane-divider-hit-area": `${hitAreaWidth}px` } as CSSProperties}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={Math.round(minRatio * 100)}
      aria-valuemax={Math.round(maxRatio * 100)}
      aria-valuenow={percent}
      aria-valuetext={
        orientation === "horizontal"
          ? `${percent}% pane area, ${100 - percent}% preview`
          : `${percent}% left pane, ${100 - percent}% right pane`
      }
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      title={
        orientation === "horizontal"
          ? "Drag to resize the preview. Use arrow keys; double-click or press Enter to reset."
          : "Drag to resize. Use arrow keys; double-click or press Enter to reset."
      }
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => {
        if (!disabled) onReset?.();
      }}
    >
      <span className="pane-divider-line" aria-hidden="true" />
      <span className="pane-divider-grip" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
