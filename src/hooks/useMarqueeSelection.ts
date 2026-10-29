import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useExplorerStore } from "../state/explorerStore";
import { hasAdditiveSelectionModifier } from "../lib/interaction";
import {
  MARQUEE_THRESHOLD,
  marqueeSelection,
  mergeSelection,
  normalizeMarqueeRect,
  pointDistance,
  samePaths,
  type MarqueeRect,
  type Point,
  type RectLike,
} from "../lib/marquee";
import type { PaneId } from "../lib/types";

export type { MarqueeRect } from "../lib/marquee";

const SCROLL_EDGE = 26;
const MAX_SCROLL_STEP = 22;

interface Gesture {
  paneId: PaneId;
  container: HTMLDivElement;
  originClient: Point;
  originContent: Point;
  lastClient: Point;
  additive: boolean;
  baseSelection: string[];
  moved: boolean;
  dirty: boolean;
  frame: number;
  detach: () => void;
}

function sameRect(left: MarqueeRect | null, right: MarqueeRect): boolean {
  return (
    left != null &&
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  );
}

function drawableRects(container: HTMLDivElement): Array<{ path: string; rect: RectLike }> {
  const items: Array<{ path: string; rect: RectLike }> = [];
  container.querySelectorAll<HTMLElement>("[data-path]").forEach((element) => {
    const path = element.dataset.path;
    if (!path) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    items.push({
      path,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  });
  return items;
}

function suggestsMarquee(event: ReactPointerEvent<HTMLDivElement>): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (
    target.closest(
      "[data-path], button, input, select, textarea, a, [contenteditable='true'], [role='separator'], [role='button'], [data-no-marquee]",
    )
  ) {
    return false;
  }
  const container = event.currentTarget;
  const rect = container.getBoundingClientRect();
  // Do not treat a press on the scrollbar as the start of a selection.
  if (
    event.clientX - rect.left >= container.clientWidth ||
    event.clientY - rect.top >= container.clientHeight
  ) {
    return false;
  }
  return true;
}

/**
 * Windows Explorer-style rubber-band selection for one file listing.
 *
 * Pointer positions are stored in scroll-content coordinates so the rectangle
 * stays anchored to the files while the listing auto-scrolls. Selected items
 * are still identified by their stable path, never by row index or DOM order.
 */
export function useMarqueeSelection(paneId?: PaneId): {
  marqueeRef: RefObject<HTMLDivElement>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
} {
  const marqueeRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<MarqueeRect | null>(null);
  const gesture = useRef<Gesture | null>(null);

  /**
   * The rectangle is painted imperatively. Pointer movement can therefore
   * update it at frame rate without re-rendering every row in the listing.
   */
  const publishRect = useCallback((next: MarqueeRect | null) => {
    const element = marqueeRef.current;
    if (next === null) {
      rectRef.current = null;
      if (element) element.hidden = true;
      return;
    }
    if (sameRect(rectRef.current, next)) return;
    rectRef.current = next;
    if (!element) return;
    element.hidden = false;
    element.style.left = `${next.left}px`;
    element.style.top = `${next.top}px`;
    element.style.width = `${next.width}px`;
    element.style.height = `${next.height}px`;
  }, []);

  const finish = useCallback((commit: boolean) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (active.frame) cancelAnimationFrame(active.frame);
    active.detach();
    if (!commit) {
      publishRect(null);
      return;
    }
    if (active.moved) {
      // The final position was already painted by the frame loop.
      publishRect(null);
      return;
    }
    if (!active.additive) {
      useExplorerStore.getState().clearSelection(active.paneId);
    }
    active.container.focus({ preventScroll: true });
    publishRect(null);
  }, [publishRect]);

  useEffect(() => {
    return () => {
      const active = gesture.current;
      if (!active) return;
      gesture.current = null;
      if (active.frame) cancelAnimationFrame(active.frame);
      active.detach();
    };
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || gesture.current) return;
      if (!suggestsMarquee(event)) return;

      const container = event.currentTarget;
      const state = useExplorerStore.getState();
      const id = paneId ?? state.activePane;
      const interfaceTheme = state.interfaceTheme;
      const additive = hasAdditiveSelectionModifier(event, interfaceTheme);
      const containerRect = container.getBoundingClientRect();
      const originClient = { x: event.clientX, y: event.clientY };
      const originContent = {
        x: event.clientX - containerRect.left - container.clientLeft + container.scrollLeft,
        y: event.clientY - containerRect.top - container.clientTop + container.scrollTop,
      };

      // Prevent the webview from starting a native text/image drag while the
      // user is drawing a selection rectangle.
      event.preventDefault();
      container.focus({ preventScroll: true });

      const active: Gesture = {
        paneId: id,
        container,
        originClient,
        originContent,
        lastClient: originClient,
        additive,
        baseSelection: additive ? state.activeTab(id).selection : [],
        moved: false,
        dirty: false,
        frame: 0,
        detach: () => undefined,
      };

      const update = () => {
        if (gesture.current !== active || !active.moved) return;
        const box = container.getBoundingClientRect();
        const scrollLeft = container.scrollLeft;
        const scrollTop = container.scrollTop;
        const currentContent = {
          x: active.lastClient.x - box.left - container.clientLeft + scrollLeft,
          y: active.lastClient.y - box.top - container.clientTop + scrollTop,
        };
        const nextRect = normalizeMarqueeRect(active.originContent, currentContent);
        publishRect(nextRect);

        // Intersections are computed in viewport coordinates, which keeps the
        // result correct regardless of where the scrolled container sits.
        const viewportRect: MarqueeRect = {
          left: nextRect.left + box.left + container.clientLeft - scrollLeft,
          top: nextRect.top + box.top + container.clientTop - scrollTop,
          width: nextRect.width,
          height: nextRect.height,
        };
        const intersecting = marqueeSelection(drawableRects(container), viewportRect);
        const nextSelection = active.additive
          ? mergeSelection(active.baseSelection, intersecting)
          : intersecting;
        const store = useExplorerStore.getState();
        const tab = store.activeTab(active.paneId);
        if (!samePaths(tab.selection, nextSelection)) {
          store.setSelection(nextSelection, nextSelection[0] ?? null, active.paneId);
        }
      };

      const autoScroll = (): boolean => {
        if (!active.moved) return false;
        const box = container.getBoundingClientRect();
        let delta = 0;
        if (active.lastClient.y < box.top + SCROLL_EDGE) {
          delta = -Math.ceil(
            ((box.top + SCROLL_EDGE - active.lastClient.y) / SCROLL_EDGE) * MAX_SCROLL_STEP,
          );
        } else if (active.lastClient.y > box.top + box.height - SCROLL_EDGE) {
          delta = Math.ceil(
            ((active.lastClient.y - (box.top + box.height - SCROLL_EDGE)) / SCROLL_EDGE) *
              MAX_SCROLL_STEP,
          );
        }
        if (!delta) return false;
        const before = container.scrollTop;
        container.scrollTop = before + delta;
        return container.scrollTop !== before;
      };

      const frame = () => {
        active.frame = 0;
        if (gesture.current !== active) return;
        const scrolled = autoScroll();
        if (active.dirty || scrolled) {
          active.dirty = false;
          update();
        }
        // Keep the loop alive only while auto-scrolling. Pointer movement and
        // container scrolling both schedule a fresh frame.
        if (scrolled) active.frame = requestAnimationFrame(frame);
      };

      const ensureFrame = () => {
        if (!active.frame) active.frame = requestAnimationFrame(frame);
      };

      const onMove = (moveEvent: PointerEvent) => {
        if (gesture.current !== active) return;
        active.lastClient = { x: moveEvent.clientX, y: moveEvent.clientY };
        if (!active.moved) {
          if (pointDistance(active.originClient, active.lastClient) < MARQUEE_THRESHOLD) return;
          active.moved = true;
        }
        active.dirty = true;
        ensureFrame();
      };

      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") finish(false);
      };
      const onScroll = () => {
        active.dirty = true;
        ensureFrame();
      };

      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("blur", onCancel);
        container.removeEventListener("scroll", onScroll);
      };

      active.detach = detach;
      gesture.current = active;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("blur", onCancel);
      container.addEventListener("scroll", onScroll, { passive: true });
    },
    [finish, paneId, publishRect],
  );

  return { marqueeRef, onPointerDown };
}
