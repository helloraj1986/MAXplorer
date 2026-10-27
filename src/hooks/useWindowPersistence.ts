import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { isTauri } from "../lib/api";
import { WINDOW_STORAGE_KEY } from "../lib/persistence";

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useWindowPersistence(): void {
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handle = getCurrentWindow();

    const save = async () => {
      if (disposed) return;
      try {
        const [size, position, scale] = await Promise.all([
          handle.innerSize(),
          handle.outerPosition(),
          handle.scaleFactor(),
        ]);
        const bounds: WindowBounds = {
          x: Math.round(position.x / scale),
          y: Math.round(position.y / scale),
          width: Math.round(size.width / scale),
          height: Math.round(size.height / scale),
        };
        window.localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify(bounds));
      } catch {
        // Window state is best-effort and not required for operation.
      }
    };

    const scheduleSave = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void save(), 300);
    };

    const restore = async () => {
      try {
        const raw = window.localStorage.getItem(WINDOW_STORAGE_KEY);
        if (!raw) return;
        const bounds = JSON.parse(raw) as WindowBounds;
        if (
          typeof bounds.width !== "number" ||
          typeof bounds.height !== "number" ||
          bounds.width < 760 ||
          bounds.height < 520
        ) {
          return;
        }
        const maxWidth = window.screen.availWidth;
        const maxHeight = window.screen.availHeight;
        const width = Math.min(bounds.width, Math.max(760, maxWidth - 24));
        const height = Math.min(bounds.height, Math.max(520, maxHeight - 48));
        const x = Math.max(0, Math.min(bounds.x ?? 0, maxWidth - 120));
        const y = Math.max(0, Math.min(bounds.y ?? 0, maxHeight - 80));
        await handle.setSize(new LogicalSize(width, height));
        if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
          await handle.setPosition(new LogicalPosition(x, y));
        }
      } catch {
        // Ignore invalid or disallowed window bounds.
      }
    };

    void restore();
    void handle.onResized(scheduleSave).then((cleanup) => {
      unlistenResize = cleanup;
    });
    void handle.onMoved(scheduleSave).then((cleanup) => {
      unlistenMove = cleanup;
    });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unlistenResize?.();
      unlistenMove?.();
    };
  }, []);
}
