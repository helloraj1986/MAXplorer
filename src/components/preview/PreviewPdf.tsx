import { useCallback, useRef } from "react";
import { Icon } from "../Icon";
import { assetUrl } from "../../lib/api";
import { useExplorerStore } from "../../state/explorerStore";
import { formatSize } from "../../lib/format";
import type { FileEntry, PreviewMetadata } from "../../lib/types";

/**
 * WKWebView renders PDFs with macOS PDFKit natively when given the asset URL.
 * The surrounding chrome is MAXplorer's; the document itself is not rasterised
 * or reimplemented in JavaScript.
 */
export function PreviewPdf({
  entry,
  metadata,
}: {
  entry: FileEntry;
  metadata: PreviewMetadata;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const openEntry = useExplorerStore((state) => state.openEntry);
  const openQuickLook = useExplorerStore((state) => state.openQuickLook);
  const activePane = useExplorerStore((state) => state.activePane);
  const canFullscreen =
    typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const fullscreen = useCallback(() => {
    frameRef.current?.parentElement?.requestFullscreen?.().catch(() => undefined);
  }, []);

  return (
    <div className="preview-pdf-renderer">
      <div className="preview-renderer-toolbar" role="toolbar" aria-label="PDF controls">
        <span className="preview-tool-label">
          {metadata.pageCount ? `${metadata.pageCount} pages` : "PDF document"}
        </span>
        <span className="preview-tool-divider" />
        <button
          type="button"
          className="preview-tool"
          title="Open in default app"
          aria-label="Open in default app"
          onClick={() => void openEntry(entry, activePane)}
        >
          <Icon name="open" size={14} />
        </button>
        <button
          type="button"
          className="preview-tool"
          title="Quick Look"
          aria-label="Quick Look"
          onClick={() => void openQuickLook([entry.path])}
        >
          <Icon name="eye" size={14} />
        </button>
        {canFullscreen ? (
          <button
            type="button"
            className="preview-tool"
            title="Fullscreen"
            aria-label="Fullscreen"
            onClick={fullscreen}
          >
            <Icon name="maximize" size={14} />
          </button>
        ) : null}
      </div>
      <div className="preview-pdf-stage">
        <iframe
          ref={frameRef}
          src={assetUrl(entry.path)}
          title={`PDF preview: ${entry.name}`}
          className="preview-pdf-frame"
        />
      </div>
      <div className="preview-renderer-footer">
        <span>{metadata.kind}</span>
        {metadata.size != null ? <span>{formatSize(metadata.size)}</span> : null}
        <span className="preview-muted">Use the document controls to zoom, search, select text, and print.</span>
      </div>
    </div>
  );
}
