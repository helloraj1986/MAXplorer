import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { FileArea } from "./FileArea";
import { DetailsPane } from "./DetailsPane";
import { DualPaneWorkspace } from "./DualPaneWorkspace";
import { PaneDivider } from "./PaneDivider";
import { PreviewPane } from "./PreviewPane";
import { useElementSize } from "../hooks/useElementSize";
import { useExplorerStore } from "../state/explorerStore";

import type { PaneId } from "../lib/types";

const MIN_PREVIEW_WIDTH = 240;
const MAX_PREVIEW_WIDTH = 2400;
const MIN_PANE_AREA = 300;
const MIN_PREVIEW_HEIGHT = 160;
const MAX_PREVIEW_HEIGHT = 1400;
const AUTO_COLLAPSE_WIDTH = 720;

function singlePane(focusPaneId: PaneId | null) {
  return (
    <div className="workspace single-workspace">
      <div className="file-pane">
        <FileArea paneId={focusPaneId ?? "left"} />
      </div>
    </div>
  );
}

function panesNode(dualPane: boolean, focusPaneId: PaneId | null) {
  if (dualPane) {
    return <DualPaneWorkspace focusPaneId={focusPaneId} />;
  }
  return singlePane(focusPaneId);
}

/**
 * One flex layout for sidebar, browsing panes, details, and preview. The
 * preview is a sibling region, not a second browser: it shares the store,
 * selection, theme tokens, and divider implementation with the panes.
 */
export function PreviewWorkspace() {
  const dualPane = useExplorerStore((state) => state.dualPane);
  const detailsPane = useExplorerStore((state) => state.detailsPane);
  const preview = useExplorerStore((state) => state.preview);
  const activePane = useExplorerStore((state) => state.activePane);
  const setPreviewRatio = useExplorerStore((state) => state.setPreviewRatio);
  const setPreviewHeightRatio = useExplorerStore((state) => state.setPreviewHeightRatio);
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [overlayPreview, setOverlayPreview] = useState(false);

  useEffect(() => {
    if (width === 0 || width >= AUTO_COLLAPSE_WIDTH) setOverlayPreview(false);
    if (!preview.visible) setOverlayPreview(false);
  }, [preview.visible, width]);

  const autoCollapsed =
    preview.visible && width > 0 && width < AUTO_COLLAPSE_WIDTH;

  // On narrow windows the preview stops reserving layout width. Below the next
  // threshold the inactive pane is also folded away, preserving the active pane
  // and all of its tabs/state in the store.
  const focusPaneId: PaneId | null =
    dualPane &&
    (preview.focusMode || (width > 0 && width < AUTO_COLLAPSE_WIDTH)) &&
    (preview.visible || width < AUTO_COLLAPSE_WIDTH)
      ? activePane
      : null;

  // A slightly wider target than the dual-pane divider: users naturally grab
  // the preview edge, which sits a few pixels beyond the visible line.
  const dividerWidth = 22;
  const usableWidth = Math.max(1, width - dividerWidth);
  const usableHeight = Math.max(1, height - dividerWidth);

  const maxPreviewWidth = Math.max(
    MIN_PREVIEW_WIDTH,
    Math.min(MAX_PREVIEW_WIDTH, usableWidth * 0.6, usableWidth - MIN_PANE_AREA),
  );
  const activeWidthRatio =
    (dualPane ? preview.ratio : preview.singleRatio) ??
    Math.max(0.18, Math.min(0.6, preview.width / 1024));
  const previewWidth = Math.max(
    MIN_PREVIEW_WIDTH,
    Math.min(maxPreviewWidth, Math.round(usableWidth * activeWidthRatio)),
  );

  const maxPreviewHeight = Math.max(
    MIN_PREVIEW_HEIGHT,
    Math.min(MAX_PREVIEW_HEIGHT, usableHeight * 0.6, usableHeight - MIN_PANE_AREA),
  );
  const activeHeightRatio =
    (dualPane ? preview.heightRatio : preview.singleHeightRatio) ?? 0.3;
  const previewHeight = Math.max(
    MIN_PREVIEW_HEIGHT,
    Math.min(maxPreviewHeight, Math.round(usableHeight * activeHeightRatio)),
  );

  const horizontalBounds = useMemo(() => {
    if (usableWidth <= 1) return { min: 0.15, max: 0.85 };
    const minimum = Math.min(0.5, MIN_PREVIEW_WIDTH / usableWidth);
    const maximum = Math.max(minimum, Math.min(0.8, maxPreviewWidth / usableWidth));
    return { min: minimum, max: maximum };
  }, [maxPreviewWidth, usableWidth]);

  const rightBounds = useMemo(() => {
    if (usableWidth <= 1) return { min: 0.15, max: 0.85 };
    const minimum = Math.max(0.15, 1 - maxPreviewWidth / usableWidth);
    const maximum = Math.max(minimum, 1 - MIN_PREVIEW_WIDTH / usableWidth);
    return { min: Math.min(0.85, minimum), max: Math.min(0.92, maximum) };
  }, [maxPreviewWidth, usableWidth]);

  const bottomBounds = useMemo(() => {
    if (usableHeight <= 1) return { min: 0.15, max: 0.85 };
    const minimum = Math.max(0.15, 1 - maxPreviewHeight / usableHeight);
    const maximum = Math.max(minimum, 1 - MIN_PREVIEW_HEIGHT / usableHeight);
    return { min: Math.min(0.85, minimum), max: Math.min(0.92, maximum) };
  }, [maxPreviewHeight, usableHeight]);

  const layout = preview.visible && !autoCollapsed ? preview.position : "none";
  const previewElement = <PreviewPane />;
  const panes = panesNode(dualPane, focusPaneId);

  return (
    <div
      className={`preview-workspace preview-${layout} ${autoCollapsed ? "preview-auto-collapsed" : ""}`}
      ref={ref}
    >
      {layout === "left" ? (
        <>
          <div className="preview-slot" style={{ width: previewWidth }}>
            {previewElement}
          </div>
          <PaneDivider
            orientation="vertical"
            label="Resize preview and file panes"
            ratio={Math.min(horizontalBounds.max, Math.max(horizontalBounds.min, previewWidth / usableWidth))}
            minRatio={horizontalBounds.min}
            maxRatio={horizontalBounds.max}
            hitAreaWidth={dividerWidth}
            containerRef={ref}
            onRatioChange={(ratio) => setPreviewRatio(ratio, ratio * usableWidth)}
            onReset={() => {
              const reset = dualPane ? 0.28 : 0.4;
              setPreviewRatio(reset, reset * usableWidth);
            }}
            disabled={width === 0}
            className="preview-splitter"
          />
          <div className="workspace-panes">
            {panes}
            {detailsPane && !dualPane ? <DetailsPane /> : null}
          </div>
        </>
      ) : null}

      {layout === "right" ? (
        <>
          <div className="workspace-panes">
            {panes}
            {detailsPane && !dualPane ? <DetailsPane /> : null}
          </div>
          <PaneDivider
            orientation="vertical"
            label="Resize preview and file panes"
            ratio={Math.min(rightBounds.max, Math.max(rightBounds.min, 1 - previewWidth / usableWidth))}
            minRatio={rightBounds.min}
            maxRatio={rightBounds.max}
            hitAreaWidth={dividerWidth}
            containerRef={ref}
            onRatioChange={(ratio) => setPreviewRatio(1 - ratio, (1 - ratio) * usableWidth)}
            onReset={() => {
              const reset = dualPane ? 0.28 : 0.4;
              setPreviewRatio(reset, reset * usableWidth);
            }}
            disabled={width === 0}
            className="preview-splitter"
          />
          <div className="preview-slot" style={{ width: previewWidth }}>
            {previewElement}
          </div>
        </>
      ) : null}

      {layout === "bottom" ? (
        <>
          <div className="workspace-panes">
            {panes}
            {detailsPane && !dualPane ? <DetailsPane /> : null}
          </div>
          <PaneDivider
            orientation="horizontal"
            label="Resize preview and file panes"
            ratio={Math.min(bottomBounds.max, Math.max(bottomBounds.min, 1 - previewHeight / usableHeight))}
            minRatio={bottomBounds.min}
            maxRatio={bottomBounds.max}
            hitAreaWidth={dividerWidth}
            containerRef={ref}
            onRatioChange={(ratio) =>
              setPreviewHeightRatio(1 - ratio, (1 - ratio) * usableHeight)
            }
            onReset={() => {
              const reset = dualPane ? 0.3 : 0.36;
              setPreviewHeightRatio(reset, reset * usableHeight);
            }}
            disabled={height === 0}
            className="preview-splitter"
          />
          <div className="preview-slot bottom" style={{ height: previewHeight }}>
            {previewElement}
          </div>
        </>
      ) : null}

      {layout === "none" ? (
        <div className="workspace-panes">
          {panes}
          {detailsPane && !dualPane ? <DetailsPane /> : null}
        </div>
      ) : null}

      {autoCollapsed && !overlayPreview ? (
        <button
          type="button"
          className="preview-auto-restore"
          title="Open the preview as an overlay in this narrow window"
          aria-label="Open the preview as an overlay in this narrow window"
          onClick={() => setOverlayPreview(true)}
        >
          <Icon name="eye" size={14} />
          <span>Preview</span>
        </button>
      ) : null}

      {autoCollapsed && overlayPreview ? (
        <div className="preview-overlay" role="dialog" aria-label="Preview pane">
          {previewElement}
        </div>
      ) : null}
    </div>
  );
}
