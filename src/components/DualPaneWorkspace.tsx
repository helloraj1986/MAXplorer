import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { PaneTabStrip } from "./PaneTabs";
import { NavigationBar } from "./NavigationBar";
import { FileArea } from "./FileArea";
import { PaneDivider } from "./PaneDivider";
import { usePaneDividerTheme } from "../hooks/usePaneDividerTheme";
import { useExplorerStore } from "../state/explorerStore";
import { basename } from "../lib/format";
import { clampRatioToBounds, leftPaneWidth, ratioBounds } from "../lib/divider";
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
export function DualPaneWorkspace({ focusPaneId = null }: { focusPaneId?: PaneId | null }) {
  const splitRatio = useExplorerStore((state) => state.splitRatio);
  const setSplitRatio = useExplorerStore((state) => state.setSplitRatio);
  const leftCollapsed = useExplorerStore((state) => state.panes.left.collapsed);
  const rightCollapsed = useExplorerStore((state) => state.panes.right.collapsed);
  const divider = usePaneDividerTheme();
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

  // Keep both panes usable without overwriting the user's preferred split. The
  // rendered ratio is clamped, but the store keeps the saved value so a
  // transient narrow window does not permanently reset the layout.
  const bounds = ratioBounds(containerWidth, undefined, divider.hitAreaWidth);
  const effectiveRatio = clampRatioToBounds(splitRatio, bounds);
  const leftWidth = containerWidth > 0 ? leftPaneWidth(containerWidth, effectiveRatio, divider.hitAreaWidth) : null;

  const changeRatio = (next: number) => setSplitRatio(clampRatioToBounds(next, bounds));
  const resetRatio = () => setSplitRatio(clampRatioToBounds(0.5, bounds));

  // "Focus + Preview" and very narrow windows show the active pane only. The
  // inactive pane keeps its tabs, history, and selection in the store and is
  // restored as soon as the preview closes or the window grows.
  if (focusPaneId) {
    return (
      <div className="workspace dual-pane focus-preview">
        <PaneShell paneId={focusPaneId} />
      </div>
    );
  }

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
                  flexBasis: leftWidth === null ? `${effectiveRatio * 100}%` : `${leftWidth}px`,
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
        <PaneDivider
          ratio={effectiveRatio}
          minRatio={bounds.min}
          maxRatio={bounds.max}
          hitAreaWidth={divider.hitAreaWidth}
          containerRef={containerRef}
          onRatioChange={changeRatio}
          onReset={resetRatio}
          disabled={containerWidth === 0}
        />
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
