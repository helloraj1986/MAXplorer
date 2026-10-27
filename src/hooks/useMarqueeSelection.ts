import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useExplorerStore } from "../state/explorerStore";

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function intersects(rect: DOMRect, marquee: MarqueeRect): boolean {
  return !(
    rect.right < marquee.left ||
    rect.left > marquee.left + marquee.width ||
    rect.bottom < marquee.top ||
    rect.top > marquee.top + marquee.height
  );
}

export function useMarqueeSelection(): {
  rect: MarqueeRect | null;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
} {
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const active = useRef(false);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-path]")) return;
    const container = event.currentTarget;
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;
    active.current = true;

    const move = (moveEvent: PointerEvent) => {
      if (!active.current) return;
      const deltaX = moveEvent.clientX - origin.x;
      const deltaY = moveEvent.clientY - origin.y;
      if (!moved && Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return;
      moved = true;
      const marquee: MarqueeRect = {
        left: Math.min(origin.x, moveEvent.clientX),
        top: Math.min(origin.y, moveEvent.clientY),
        width: Math.abs(deltaX),
        height: Math.abs(deltaY),
      };
      setRect(marquee);
      const selected: string[] = [];
      container.querySelectorAll<HTMLElement>("[data-path]").forEach((element) => {
        if (intersects(element.getBoundingClientRect(), marquee) && element.dataset.path) {
          selected.push(element.dataset.path);
        }
      });
      useExplorerStore.getState().setSelection(selected, selected[selected.length - 1] ?? null);
    };

    const up = () => {
      active.current = false;
      setRect(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) {
        useExplorerStore.getState().clearSelection();
        container.focus();
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  return { rect, onPointerDown };
}
