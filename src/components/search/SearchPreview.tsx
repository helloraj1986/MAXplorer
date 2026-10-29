import { useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { api, assetUrl, isTauri } from "../../lib/api";
import { useSearchStore } from "../../state/searchStore";
import { formatDate, formatSize, parentPath, typeName } from "../../lib/format";
import type { TextPreview } from "../../lib/types";
import type { SearchHit } from "../../lib/search/types";

function highlightExcerpt(text: string, terms: string[]): React.ReactNode {
  if (!terms.length) return text;
  const escaped = terms
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!escaped) return text;
  return text.split(new RegExp(`(${escaped})`, "gi")).map((part, index) =>
    terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? <mark key={index}>{part}</mark> : part,
  );
}

export function SearchPreview({ hit }: { hit: SearchHit }) {
  const openHit = useSearchStore((state) => state.openHit);
  const revealHit = useSearchStore((state) => state.revealHit);
  const setPreviewOpen = useSearchStore((state) => state.setPreviewOpen);
  const interpretation = useSearchStore((state) => state.interpretation);
  const searchTerms = useMemo(
    () => [...(interpretation?.terms ?? []), ...(interpretation?.contentTerms ?? [])],
    [interpretation],
  );
  const [preview, setPreview] = useState<TextPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extension = (hit.entry.extension ?? "").toLowerCase();
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "tif", "tiff", "svg"].includes(extension);
  const isVideo = ["mp4", "mov", "m4v", "webm", "mkv", "avi"].includes(extension);
  const isAudio = ["mp3", "m4a", "wav", "aac", "flac", "ogg", "aiff"].includes(extension);
  const isTextLike = [
    "txt", "md", "markdown", "json", "xml", "html", "htm", "css", "scss", "js", "jsx", "ts", "tsx",
    "rs", "py", "rb", "go", "java", "c", "h", "cpp", "hpp", "cs", "swift", "kt", "sh", "zsh",
    "bash", "toml", "yaml", "yml", "ini", "cfg", "csv", "tsv", "log", "sql",
  ].includes(extension);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!isTauri || hit.entry.isDir || !isTextLike) return;
    let disposed = false;
    setLoading(true);
    void api
      .readTextPreview(hit.entry.path, 128 * 1024)
      .then((result) => {
        if (!disposed) setPreview(result);
      })
      .catch((cause) => {
        if (!disposed) setError(cause?.message ?? "This file could not be previewed.");
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [hit.entry.path, hit.entry.isDir, isTextLike]);

  return (
    <aside className="search-preview" aria-label="Search result preview">
      <div className="search-preview-header">
        <span>Preview</span>
        <button type="button" aria-label="Close preview" onClick={() => setPreviewOpen(false)}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="search-preview-scroll">
        <div className="search-preview-hero">
          <FileTypeIcon entry={hit.entry} size={96} thumbnail />
        </div>
        <h2 className="search-preview-name" title={hit.entry.name}>
          {hit.entry.name}
        </h2>
        <div className="search-preview-actions">
          <button type="button" className="search-small-button" onClick={() => void openHit(hit)}>
            <Icon name="open" size={12} />
            Open
          </button>
          <button type="button" className="search-small-button" onClick={() => void revealHit(hit.entry.path)}>
            <Icon name="search" size={12} />
            Reveal in Finder
          </button>
        </div>

        {isImage ? (
          <div className="search-preview-media">
            <img src={assetUrl(hit.entry.path)} alt={hit.entry.name} loading="lazy" />
          </div>
        ) : isVideo ? (
          <div className="search-preview-media">
            <video src={assetUrl(hit.entry.path)} controls preload="metadata" />
          </div>
        ) : isAudio ? (
          <div className="search-preview-media search-preview-audio">
            <Icon name="audio" size={32} />
            <audio src={assetUrl(hit.entry.path)} controls preload="metadata" />
          </div>
        ) : extension === "pdf" ? (
          <div className="search-preview-media search-preview-pdf">
            <object data={assetUrl(hit.entry.path)} type="application/pdf" aria-label={`PDF preview of ${hit.entry.name}`}>
              <div className="search-preview-fallback">
                <Icon name="pdf" size={28} />
                <p>PDF preview is unavailable in this webview.</p>
                <button type="button" className="search-small-button" onClick={() => void openHit(hit)}>
                  Open in the default app
                </button>
              </div>
            </object>
          </div>
        ) : isTextLike ? (
          <div className="search-preview-excerpt">
            {loading ? (
              <p className="search-muted">
                <Icon name="spinner" size={12} className="spin" /> Reading an excerpt...
              </p>
            ) : error ? (
              <p className="search-muted">{error}</p>
            ) : preview?.binary ? (
              <p className="search-muted">This file contains binary data and is not displayed as text.</p>
            ) : preview?.text ? (
              <>
                <pre>{highlightExcerpt(preview.text, searchTerms)}</pre>
                {preview.truncated ? <p className="search-muted">Excerpt limited to 128 KB.</p> : null}
              </>
            ) : (
              <p className="search-muted">No readable text excerpt is available.</p>
            )}
          </div>
        ) : (
          <div className="search-preview-fallback">
            <Icon name={hit.entry.isDir ? "folder" : "file"} size={28} />
            <p>
              {hit.entry.isDir
                ? "This is a folder. Open it to browse its contents."
                : "A safe preview is not available for this file type. Open it with its default application."}
            </p>
          </div>
        )}

        <dl className="search-preview-meta">
          <div>
            <dt>Kind</dt>
            <dd>{typeName(hit.entry)}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{hit.entry.isDir ? "Folder" : formatSize(hit.entry.size)}</dd>
          </div>
          <div>
            <dt>Modified</dt>
            <dd>{formatDate(hit.entry.modified)}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(hit.entry.created)}</dd>
          </div>
          <div>
            <dt>Accessed</dt>
            <dd>{formatDate(hit.entry.accessed)}</dd>
          </div>
          <div className="wide">
            <dt>Location</dt>
            <dd title={parentPath(hit.entry.path) ?? ""}>{parentPath(hit.entry.path) ?? hit.entry.path}</dd>
          </div>
          <div className="wide">
            <dt>Full path</dt>
            <dd title={hit.entry.path}>{hit.entry.path}</dd>
          </div>
          <div>
            <dt>Index</dt>
            <dd>{hit.indexed ? "Indexed metadata" : "Live scan"}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{hit.source === "spotlight" ? "Spotlight" : hit.source === "filesystem" ? "Filesystem" : "MAXplorer index"}</dd>
          </div>
        </dl>

        {hit.explanation ? (
          <div className="search-preview-why">
            <h3>Why this result</h3>
            <p>{hit.explanation}</p>
          </div>
        ) : null}
        {hit.snippet ? (
          <div className="search-preview-why">
            <h3>Matching excerpt</h3>
            <p>{highlightExcerpt(hit.snippet, searchTerms)}</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
