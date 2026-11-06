import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { api } from "../../lib/api";
import { formatSize, parentPath } from "../../lib/format";
import { useExplorerStore } from "../../state/explorerStore";
import type { ArchiveEntry, ArchiveListing, FileEntry } from "../../lib/types";

function ratio(listing: ArchiveListing): string {
  if (!listing.totalSize || !listing.compressedSize) return "";
  const percent = Math.max(0, Math.min(100, Math.round((listing.compressedSize / listing.totalSize) * 100)));
  return `${percent}% compressed`;
}

function depthOf(entry: ArchiveEntry): number {
  const parts = entry.name.split("/").filter(Boolean);
  return Math.max(0, parts.length - (entry.isDir ? 1 : 0));
}

function baseName(name: string): string {
  return name.split("/").filter(Boolean).pop() ?? name;
}

export function PreviewArchive({
  entry,
  listing,
}: {
  entry: FileEntry;
  listing: ArchiveListing;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useExplorerStore((state) => state.toast);
  const toastError = useExplorerStore((state) => state.toastError);
  const refresh = useExplorerStore((state) => state.refresh);
  const activePane = useExplorerStore((state) => state.activePane);
  const openDialog = useExplorerStore((state) => state.openDialog);

  const rows = useMemo(
    () =>
      [...listing.entries].sort((left, right) => {
        if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
        return left.name.localeCompare(right.name);
      }),
    [listing.entries],
  );

  const extract = async (destination: string) => {
    setBusy(true);
    try {
      const result = await api.previewExtractArchive(entry.path, destination);
      toast({
        title: "Archive extracted",
        detail: result,
        tone: "success",
      });
      await refresh(activePane);
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const extractHere = () => {
    const destination = parentPath(entry.path);
    if (destination) void extract(destination);
  };

  const extractTo = () => {
    openDialog({
      kind: "prompt",
      title: "Extract archive",
      label: "Destination folder",
      initialValue: parentPath(entry.path) ?? "",
      confirmLabel: "Extract",
      onConfirm: (value) => extract(value),
    });
  };

  return (
    <div className="preview-archive-renderer">
      <div className="preview-renderer-toolbar" role="toolbar" aria-label="Archive controls">
        <span className="preview-tool-label">{listing.format} archive</span>
        <span className="preview-tool-divider" />
        <button
          type="button"
          className="preview-action"
          onClick={extractHere}
          disabled={busy || listing.encrypted}
          title="Extract into the current folder"
        >
          <Icon name="downloads" size={13} />
          Extract Here
        </button>
        <button
          type="button"
          className="preview-action"
          onClick={extractTo}
          disabled={busy || listing.encrypted}
          title="Choose a destination folder"
        >
          <Icon name="folderOpen" size={13} />
          Extract To...
        </button>
      </div>
      {listing.encrypted ? (
        <p className="preview-note warning">
          This archive is encrypted. Open it with a dedicated tool to enter a password.
        </p>
      ) : null}
      <div className="preview-archive-summary">
        <span>{rows.length} items</span>
        <span>{formatSize(listing.totalSize)} uncompressed</span>
        <span>{formatSize(listing.compressedSize)} compressed</span>
        <span>{ratio(listing)}</span>
      </div>
      <div className="preview-archive-list" role="list" aria-label="Archive contents">
        {rows.length === 0 ? (
          <div className="preview-empty-state compact">
            <Icon name="archive" size={28} />
            <p>This archive has no readable index entries.</p>
          </div>
        ) : (
          rows.map((item, index) => (
            <div
              className={`preview-archive-row ${item.isDir ? "folder" : ""}`}
              key={`${item.name}-${index}`}
              role="listitem"
              style={{ paddingLeft: 8 + depthOf(item) * 13 }}
              title={item.name}
            >
              <span className="preview-archive-icon">
                {item.isDir ? (
                  <Icon name="folder" size={14} />
                ) : (
                  <FileTypeIcon
                    entry={{
                      ...entry,
                      name: baseName(item.name),
                      extension: baseName(item.name).split(".").pop()?.toLowerCase() ?? null,
                      isDir: false,
                    }}
                    size={14}
                  />
                )}
              </span>
              <span className="preview-archive-name">{baseName(item.name)}</span>
              <span className="preview-archive-size">{item.isDir ? "" : formatSize(item.size)}</span>
              <span className="preview-archive-method">{item.isDir ? "" : item.method}</span>
            </div>
          ))
        )}
      </div>
      <div className="preview-renderer-footer">
        {listing.truncated ? <span>Listing truncated for performance</span> : null}
        <span className="preview-muted">Contents are listed without extracting to disk.</span>
      </div>
    </div>
  );
}
