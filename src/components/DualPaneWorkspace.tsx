import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { PaneTabStrip } from "./PaneTabs";
import { NavigationBar } from "./NavigationBar";
import { FileArea } from "./FileArea";
import { useExplorerStore } from "../state/explorerStore";
import { basename } from "../lib/format";
import type { PaneId } from "../lib/types";

/** Smallest usable pane before the divider stops moving. */
const MIN_PANE_WIDTH = 300;

function PaneShell({ paneId }: { paneId: PaneId }) {
  const activePane = useExplorerStore((state) => state.activePane);
  const setActivePane = useExplorerStore((state) => state.setActivePane);
  const setPaneCollapsed = useExplorerStore((state) => state.setPaneCollapsed);

  return (
    <section
      className={`pane-shell ${activePane === paneId ? "active" : ""}`}
      data-pane={paneId}
      aria-label={`${paneId === "left" ? "Left" : "Right"} pane`}
      onPointerDownCapture={() => setActivePane(paneId)}
      onFocusCapture={() => setActivePane(paneId)}
    >
      <NavigationBar paneId={paneId} />
      <PaneTabStrip paneId={paneId} onCollapse={() => setPaneCollapsed(paneId, true)} />
      <div className="pane-content">
        <FileArea paneId={paneId} />
      </div>
    </section>
  );
}

function CollapsedPane({ paneId }: { paneId: PaneId }) {
  const setPaneCollapsed = useExplorerStore((state) => state.setPaneCollapsed);
  const setActivePane = useExplorerStore((state) => state.setActivePane);
  const folder = useExplorerStore((state) => state.currentFolder(paneId));
  const restore = () => {
    setActivePane(paneId);
    setPaneCollapsed(paneId, false);
  };
  return (
    <div
      className="pane-rail"
      title={`Restore ${paneId} pane (${folder})`}
      onClick={restore}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          restore();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <button
        type="button"
        className="pane-expand"
        aria-label={`Restore ${paneId} pane`}
        onClick={(event) => {
          event.stopPropagation();
          restore();
        }}
      >
        <Icon name={paneId === "left" ? "chevronRight" : "chevronLeft"} size={13} />
      </button>
      <span className="pane-rail-label">{basename(folder) || folder}</span>
    </div>
  );
}

/**
 * Side-by-side workspace. The split ratio is clamped in the store, the divider
 * supports pointer, keyboard, and double-click reset, and either pane can be
 * collapsed without losing its tabs or view preferences. Dragging also stops
 * once the shrinking pane would get too narrow for its toolbar and columns.
 */
export function DualPaneWorkspace() {
  const splitRatio = useExplorerStore((state) => state.splitRatio);
  const setSplitRatio = useExplorerStore((state) => state.setSplitRatio);
  const leftCollapsed = useExplorerStore((state) => state.panes.left.collapsed);
  const rightCollapsed = useExplorerStore((state) => state.panes.right.collapsed);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const bothVisible = !leftCollapsed && !rightCollapsed;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setContainerWidth(container.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Keep both panes usable: the store floor is a ratio, which is far too narrow
  // on a small window, so the divider also respects a pixel minimum.
  const edge = containerWidth > 0 ? Math.min(0.45, MIN_PANE_WIDTH / containerWidth) : 0;
  const minRatio = Math.max(0.18, edge);
  const maxRatio = Math.min(0.82, 1 - edge);
  const clampRatio = (ratio: number) => Math.min(maxRatio, Math.max(minRatio, ratio));

  useEffect(() => {
    if (!bothVisible || minRatio > maxRatio) return;
    if (splitRatio < minRatio || splitRatio > maxRatio) {
      setSplitRatio(Math.min(maxRatio, Math.max(minRatio, splitRatio)));
    }
  }, [bothVisible, minRatio, maxRatio, splitRatio, setSplitRatio]);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!bothVisible || event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const splitter = event.currentTarget;
    // Keep receiving moves/up even when the pointer leaves the divider or window.
    try {
      splitter.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail when the pointer is already gone; window
      // listeners below still handle the drag.
    }
    const move = (moveEvent: PointerEvent) => {
      if (!rect.width) return;
      setSplitRatio(clampRatio((moveEvent.clientX - rect.left) / rect.width));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (splitter.hasPointerCapture(event.pointerId)) {
        splitter.releasePointerCapture(event.pointerId);
      }
      document.body.classList.remove("resizing-panes");
    };
    document.body.classList.add("resizing-panes");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onSplitterKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSplitRatio(clampRatio(splitRatio - 0.03));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSplitRatio(clampRatio(splitRatio + 0.03));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSplitRatio(minRatio);
    } else if (event.key === "End") {
      event.preventDefault();
      setSplitRatio(maxRatio);
    } else if (event.key === "Enter") {
      event.preventDefault();
      setSplitRatio(clampRatio(0.5));
    }
  };

  return (
    <div className="workspace dual-pane" ref={containerRef}>
      {leftCollapsed ? (
        <CollapsedPane paneId="left" />
      ) : (
        <div
          className="dual-pane-slot left"
          style={
            bothVisible
              ? {
                  // The left slot owns the width; the right slot absorbs the rest.
                  // Growing here would push the divider past the pointer position.
                  flexBasis: `calc(${splitRatio * 100}% - 3px)`,
                  flexGrow: 0,
                  flexShrink: 0,
                }
              : undefined
          }
        >
          <PaneShell paneId="left" />
        </div>
      )}
      {bothVisible ? (
        <div
          className="pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          aria-valuemin={Math.round(minRatio * 100)}
          aria-valuemax={Math.round(maxRatio * 100)}
          aria-valuenow={Math.round(splitRatio * 100)}
          tabIndex={0}
          title="Drag to resize panes. Double-click to reset."
          onPointerDown={startResize}
          onDoubleClick={() => setSplitRatio(0.5)}
          onKeyDown={onSplitterKey}
        >
          <span className="pane-splitter-grip" aria-hidden="true" />
        </div>
      ) : null}
      {rightCollapsed ? (
        <CollapsedPane paneId="right" />
      ) : (
        <div className="dual-pane-slot right">
          <PaneShell paneId="right" />
        </div>
      )}
    </div>
  );
}
