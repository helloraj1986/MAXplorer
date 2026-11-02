import { Icon } from "../Icon";
import { useExplorerStore } from "../../state/explorerStore";
import { PreviewMetadataCard } from "./PreviewMetadataCard";
import type { FileEntry, PreviewMetadata, PreviewThumbnail } from "../../lib/types";

export function PreviewQuickLook({
  entry,
  metadata,
  thumbnail,
}: {
  entry: FileEntry;
  metadata: PreviewMetadata;
  thumbnail: PreviewThumbnail;
}) {
  const openQuickLook = useExplorerStore((state) => state.openQuickLook);
  return (
    <div className="preview-quicklook-renderer">
      <button
        type="button"
        className="preview-thumbnail-button"
        onClick={() => void openQuickLook([entry.path])}
        title="Open Quick Look"
        aria-label={`Open Quick Look for ${entry.name}`}
      >
        {thumbnail.dataUrl ? (
          <img src={thumbnail.dataUrl} alt="" draggable={false} />
        ) : (
          <Icon name="file" size={54} />
        )}
        <span className="preview-thumbnail-hint">
          <Icon name="eye" size={12} />
          Quick Look
        </span>
      </button>
      <PreviewMetadataCard entry={entry} metadata={metadata} compact />
    </div>
  );
}
