import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { api, assetUrl } from "../../lib/api";
import { formatSize } from "../../lib/format";
import { useExplorerStore } from "../../state/explorerStore";
import type { FileEntry, PreviewMetadata, PreviewThumbnail } from "../../lib/types";

export function PreviewImage({
  entry,
  metadata,
}: {
  entry: FileEntry;
  metadata: PreviewMetadata;
}) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fit, setFit] = useState(true);
  const [failed, setFailed] = useState(false);
  const [fallback, setFallback] = useState<PreviewThumbnail | null>(null);
  const [fallbackState, setFallbackState] = useState<"idle" | "loading" | "none" | "ready">("idle");
  const openEntry = useExplorerStore((state) => state.openEntry);
  const activePane = useExplorerStore((state) => state.activePane);
  const stageRef = useRef<HTMLDivElement>(null);
  const canFullscreen =
    typeof document !== "undefined" && Boolean(document.fullscreenEnabled);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setFit(true);
    setFailed(false);
    setFallback(null);
    setFallbackState("idle");
  }, [entry.path]);

  useEffect(() => {
    if (!failed) return;
    let cancelled = false;
    setFallbackState("loading");
    void api
      .previewThumbnail(entry.path, 1600)
      .then((thumbnail) => {
        if (cancelled) return;
        if (thumbnail.dataUrl) {
          setFallback(thumbnail);
          setFallbackState("ready");
        } else {
          setFallbackState("none");
        }
      })
      .catch(() => {
        if (!cancelled) setFallbackState("none");
      });
    return () => {
      cancelled = true;
    };
  }, [entry.path, failed]);

  const source = failed && fallback?.dataUrl ? fallback.dataUrl : assetUrl(entry.path);
  const dimensions = useMemo(() => {
    if (metadata.width && metadata.height) return `${metadata.width} × ${metadata.height}`;
    if (fallback?.width && fallback.height) return `${fallback.width} × ${fallback.height}`;
    return null;
  }, [fallback, metadata.height, metadata.width]);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stage.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  const zoomBy = (factor: number) => {
    setFit(false);
    setZoom((value) => Math.max(0.1, Math.min(8, value * factor)));
  };

  return (
    <div className="preview-image-renderer">
      <div className="preview-renderer-toolbar" role="toolbar" aria-label="Image controls">
        <button type="button" className="preview-tool" onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out">
          <Icon name="zoomOut" size={14} />
        </button>
        <span className="preview-tool-value" aria-live="polite">
          {fit ? "Fit" : `${Math.round(zoom * 100)}%`}
        </span>
        <button type="button" className="preview-tool" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
          <Icon name="zoomIn" size={14} />
        </button>
        <button
          type="button"
          className={`preview-tool ${fit ? "active" : ""}`}
          onClick={() => setFit(true)}
          title="Fit in window"
          aria-label="Fit in window"
        >
          <Icon name="fullscreen" size={14} />
        </button>
        <button
          type="button"
          className={`preview-tool ${!fit && zoom === 1 ? "active" : ""}`}
          onClick={() => {
            setFit(false);
            setZoom(1);
          }}
          title="Actual size"
          aria-label="Actual size"
        >
          1:1
        </button>
        <span className="preview-tool-divider" />
        <button
          type="button"
          className="preview-tool"
          onClick={() => setRotation((value) => (value + 270) % 360)}
          title="Rotate counter-clockwise"
          aria-label="Rotate counter-clockwise"
        >
          <Icon name="rotateCcw" size={14} />
        </button>
        <button
          type="button"
          className="preview-tool"
          onClick={() => setRotation((value) => (value + 90) % 360)}
          title="Rotate clockwise"
          aria-label="Rotate clockwise"
        >
          <Icon name="rotateCw" size={14} />
        </button>
        {canFullscreen ? (
          <button
            type="button"
            className="preview-tool"
            onClick={toggleFullscreen}
            title="Fullscreen"
            aria-label="Fullscreen"
          >
            <Icon name="maximize" size={14} />
          </button>
        ) : null}
      </div>
      <div
        className={`preview-image-stage ${fit ? "fit" : "actual"}`}
        ref={stageRef}
        onDoubleClick={() => setFit((value) => !value)}
        title="Double-click to switch between fit and actual size"
      >
        {failed && fallbackState === "none" ? (
          <div className="preview-empty-state compact">
            <Icon name="image" size={30} />
            <p>This image format cannot be rendered in the preview.</p>
            <button
              type="button"
              className="preview-action"
              onClick={() => void openEntry(entry, activePane)}
            >
              <Icon name="open" size={13} />
              Open with default app
            </button>
          </div>
        ) : (
          <img
            src={source}
            alt={entry.name}
            draggable={false}
            onError={() => setFailed(true)}
            style={
              fit
                ? { transform: `rotate(${rotation}deg)` }
                : {
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    maxWidth: "none",
                    maxHeight: "none",
                  }
            }
          />
        )}
      </div>
      <div className="preview-renderer-footer">
        <span>{dimensions ?? metadata.kind}</span>
        {metadata.size != null ? <span>{formatSize(metadata.size)}</span> : null}
        {rotation ? <span>Rotated {rotation}°</span> : null}
        {failed && fallback?.dataUrl ? <span className="preview-muted">Quick Look preview</span> : null}
      </div>
    </div>
  );
}
