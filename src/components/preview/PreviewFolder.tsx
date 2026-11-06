import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { FolderIcon } from "../icons/FolderIcon";
import { useExplorerStore } from "../../state/explorerStore";
import { formatCount, formatDate, formatSize, plural } from "../../lib/format";
import type { FileEntry, FolderPreview, PreviewMetadata } from "../../lib/types";

export function PreviewFolder({
  entry,
  metadata,
  folder,
}: {
  entry: FileEntry;
  metadata: PreviewMetadata;
  folder: FolderPreview;
}) {
  const revealInPane = useExplorerStore((state) => state.revealInPane);
  const openEntry = useExplorerStore((state) => state.openEntry);
  const activePane = useExplorerStore((state) => state.activePane);

  return (
    <div className="preview-folder-renderer">
      <div className="preview-folder-hero">
        <FolderIcon size={84} />
        <div className="preview-folder-heading">
          <strong title={entry.path}>{metadata.name || entry.name}</strong>
          <span>{metadata.kind || "Folder"}</span>
          <span className="preview-muted">{formatDate(metadata.modified)}</span>
        </div>
        <button
          type="button"
          className="preview-action primary"
          onClick={() => void openEntry(entry, activePane)}
        >
          <Icon name="folderOpen" size={13} />
          Open
        </button>
      </div>
      <div className="preview-folder-stats">
        <div>
          <span>Items</span>
          <strong>{formatCount(folder.itemCount)}</strong>
        </div>
        <div>
          <span>Size</span>
          <strong>{formatSize(folder.totalSize)}</strong>
        </div>
        <div>
          <span>Folders</span>
          <strong>{formatCount(folder.folders)}</strong>
        </div>
        <div>
          <span>Files</span>
          <strong>{formatCount(folder.files)}</strong>
        </div>
      </div>
      {folder.truncated || folder.cancelled ? (
        <p className="preview-note">
          {folder.cancelled
            ? "Size calculation was cancelled. Showing a partial result."
            : "This folder is very large. Size totals were capped for performance."}
        </p>
      ) : null}
      <div className="preview-folder-list" role="list" aria-label="Folder contents">
        {folder.entries.length === 0 ? (
          <div className="preview-empty-state compact">
            <Icon name="folder" size={28} />
            <p>This folder is empty.</p>
          </div>
        ) : (
          folder.entries.map((item) => (
            <button
              type="button"
              className="preview-folder-row"
              key={item.path}
              role="listitem"
              title={item.path}
              onClick={() => void revealInPane(item.path, activePane)}
            >
              <FileTypeIcon entry={item} size={17} />
              <span className="preview-folder-name">{item.name}</span>
              <span className="preview-muted">
                {item.isDir ? "Folder" : formatSize(item.size)}
              </span>
            </button>
          ))
        )}
      </div>
      <div className="preview-renderer-footer">
        <span>{formatCount(folder.itemCount)} {plural(folder.itemCount, "item")} in this folder</span>
      </div>
    </div>
  );
}
