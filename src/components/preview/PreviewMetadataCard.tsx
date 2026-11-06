import { useMemo } from "react";
import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { TagIndicators } from "../TagIndicators";
import { useExplorerStore } from "../../state/explorerStore";
import { formatDate, formatSize, typeName } from "../../lib/format";
import type { FileEntry, PreviewMetadata } from "../../lib/types";

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="preview-meta-row">
      <span className="preview-meta-label">{label}</span>
      <span className="preview-meta-value" title={value}>
        {value}
      </span>
    </div>
  );
}

export function PreviewMetadataCard({
  entry,
  metadata,
  thumbnail,
  note,
  compact = false,
}: {
  entry: FileEntry;
  metadata: PreviewMetadata;
  thumbnail?: string | null;
  note?: string | null;
  compact?: boolean;
}) {
  const openEntry = useExplorerStore((state) => state.openEntry);
  const openQuickLook = useExplorerStore((state) => state.openQuickLook);
  const activePane = useExplorerStore((state) => state.activePane);
  const tagIds = useExplorerStore((state) => state.tagIdsForPath(entry.path));
  const tags = useExplorerStore((state) => state.tags);
  const tagNames = useMemo(
    () => tagIds.map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean) as string[],
    [tagIds, tags],
  );
  const resolution =
    metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : null;
  const duration =
    metadata.duration != null
      ? `${Math.floor(metadata.duration / 60)}:${String(Math.floor(metadata.duration % 60)).padStart(2, "0")}`
      : null;

  return (
    <div className={`preview-info-card ${compact ? "compact" : ""}`}>
      <div className="preview-info-visual">
        {thumbnail ? (
          <img src={thumbnail} alt="" draggable={false} />
        ) : (
          <FileTypeIcon entry={entry} size={compact ? 62 : 82} thumbnail />
        )}
      </div>
      <div className="preview-info-heading">
        <strong title={entry.path}>{metadata.name || entry.name}</strong>
        <span>{metadata.kind || typeName(entry)}</span>
        <TagIndicators path={entry.path} />
      </div>
      {note ? <p className="preview-note">{note}</p> : null}
      <div className="preview-info-meta">
        <Row label="Size" value={metadata.size != null ? formatSize(metadata.size) : null} />
        <Row label="Where" value={metadata.path} />
        <Row label="Modified" value={formatDate(metadata.modified)} />
        <Row label="Created" value={formatDate(metadata.created)} />
        <Row label="Kind" value={metadata.kind} />
        <Row label="Resolution" value={resolution} />
        <Row label="Duration" value={duration} />
        <Row label="Codecs" value={metadata.codecs.join(", ")} />
        <Row label="Pages" value={metadata.pageCount ? String(metadata.pageCount) : null} />
        <Row label="Tags" value={tagNames.length ? tagNames.join(", ") : null} />
        {metadata.isNetworkVolume ? <Row label="Source" value="Network volume" /> : null}
      </div>
      <div className="preview-info-actions">
        <button
          type="button"
          className="preview-action primary"
          onClick={() => void openEntry(entry, activePane)}
        >
          <Icon name="open" size={13} />
          Open
        </button>
        {metadata.quickLookSupported && !entry.isDir ? (
          <button
            type="button"
            className="preview-action"
            onClick={() => void openQuickLook([entry.path])}
          >
            <Icon name="eye" size={13} />
            Quick Look
          </button>
        ) : null}
      </div>
    </div>
  );
}
