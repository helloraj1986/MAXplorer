import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "./Icon";
import { FileGlyph } from "./FileGlyph";
import { useExplorerStore } from "../state/explorerStore";
import { api, assetUrl } from "../lib/api";
import { formatDate, formatSize, isImageEntry, isTextEntry, typeName } from "../lib/format";
import type { PaneId, TextPreview } from "../lib/types";

export function PreviewPane({ paneId = "left" }: { paneId?: PaneId }) {
  const activeTab = useExplorerStore(
    (state) => state.panes[paneId].tabs.find((tab) => tab.id === state.panes[paneId].activeTabId),
  );
  const selected = useExplorerStore(
    useShallow((state) => state.selectedEntries(paneId)),
  );
  const openEntry = useExplorerStore((state) => state.openEntry);
  const [textPreview, setTextPreview] = useState<TextPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const entry = selected.length === 1 ? selected[0] : null;

  useEffect(() => {
    setTextPreview(null);
    setPreviewError(null);
    if (!entry || entry.isDir || !isTextEntry(entry)) return;
    let cancelled = false;
    void api
      .readTextPreview(entry.path, 128 * 1024)
      .then((preview) => {
        if (!cancelled) setTextPreview(preview);
      })
      .catch((error) => {
        if (!cancelled) setPreviewError(error?.message ?? "Preview unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [entry?.path, entry?.isDir]);

  return (
    <aside className="preview-pane" aria-label="Preview pane">
      <div className="preview-header">
        <span>Preview</span>
        {entry ? (
          <button type="button" className="preview-open" onClick={() => void openEntry(entry, paneId)}>
            <Icon name="open" size={13} />
            Open
          </button>
        ) : null}
      </div>
      {!entry ? (
        <div className="preview-empty">
          <Icon name="eye" size={34} />
          <p>{selected.length > 1 ? "Multiple items selected" : "Select a file to preview it"}</p>
        </div>
      ) : (
        <div className="preview-content">
          <div className="preview-title" title={entry.path}>
            {entry.name}
          </div>
          <div className="preview-subtitle">{typeName(entry)}</div>
          {entry.isDir ? (
            <div className="preview-body folder-preview">
              <FileGlyph entry={entry} size={112} />
              <p>Folder preview</p>
            </div>
          ) : isImageEntry(entry) && !entry.isSymlink ? (
            <div className="preview-body image-preview">
              <img src={assetUrl(entry.path)} alt={entry.name} draggable={false} />
            </div>
          ) : isTextEntry(entry) ? (
            <div className="preview-body text-preview">
              {previewError ? (
                <p className="preview-error">{previewError}</p>
              ) : textPreview ? (
                textPreview.binary ? (
                  <p>This file contains binary content.</p>
                ) : (
                  <>
                    <pre>{textPreview.text}</pre>
                    {textPreview.truncated ? <div className="preview-truncated">Preview truncated</div> : null}
                  </>
                )
              ) : (
                <div className="preview-loading">
                  <Icon name="spinner" size={18} className="spin" />
                  Loading preview...
                </div>
              )}
            </div>
          ) : (
            <div className="preview-body unsupported-preview">
              <FileGlyph entry={entry} size={112} thumbnail />
              <p>No preview is available for this file type.</p>
            </div>
          )}
          <div className="preview-meta">
            <div>
              <span>Date modified</span>
              <strong>{formatDate(entry.modified)}</strong>
            </div>
            {!entry.isDir ? (
              <div>
                <span>Size</span>
                <strong>{formatSize(entry.size)}</strong>
              </div>
            ) : null}
            <div>
              <span>Path</span>
              <strong title={entry.path}>{entry.path}</strong>
            </div>
          </div>
        </div>
      )}
      <span className="sr-only">{activeTab?.location}</span>
    </aside>
  );
}
