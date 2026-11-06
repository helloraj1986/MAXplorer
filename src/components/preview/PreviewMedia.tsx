import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { PreviewMetadataCard } from "./PreviewMetadataCard";
import { api, assetUrl } from "../../lib/api";
import { formatSize } from "../../lib/format";
import { useExplorerStore } from "../../state/explorerStore";
import type { FileEntry, PreviewMetadata, PreviewThumbnail } from "../../lib/types";

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function PreviewMedia({
  entry,
  metadata,
}: {
  entry: FileEntry;
  metadata: PreviewMetadata;
}) {
  const autoPlay = useExplorerStore((state) => state.preview.autoPlayMedia);
  const [thumbnail, setThumbnail] = useState<PreviewThumbnail | null>(null);
  const [failed, setFailed] = useState(false);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const isVideo = metadata.contentTypeTree.includes("public.movie") ||
    ["mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "flv", "mpg", "mpeg"].includes(
      (metadata.extension ?? "").toLowerCase(),
    );

  useEffect(() => {
    let cancelled = false;
    setThumbnail(null);
    setFailed(false);
    void api
      .previewThumbnail(entry.path, 900)
      .then((value) => {
        if (!cancelled) setThumbnail(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  // Only one media element may play at a time, and playback stops when the
  // window is no longer visible. Unmounting releases the AVPlayer behind the
  // native <video>/<audio> element.
  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    const onPlay = () => {
      document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((other) => {
        if (other !== element) other.pause();
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") element.pause();
    };
    const onBlur = () => element.pause();
    element.addEventListener("play", onPlay);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    if (autoPlay) {
      void element.play().catch(() => undefined);
    }
    return () => {
      element.removeEventListener("play", onPlay);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [autoPlay, entry.path]);

  if (failed) {
    return (
      <PreviewMetadataCard
        entry={entry}
        metadata={metadata}
        thumbnail={thumbnail?.dataUrl ?? null}
        note="This media format cannot be played in the preview. The file was not modified or opened."
      />
    );
  }

  const resolution =
    metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : null;
  const duration = formatDuration(metadata.duration);

  return (
    <div className="preview-media-renderer">
      <div className={`preview-media-stage ${isVideo ? "video" : "audio"}`}>
        {isVideo ? (
          <video
            ref={mediaRef as RefObject<HTMLVideoElement>}
            src={assetUrl(entry.path)}
            poster={thumbnail?.dataUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="preview-video"
            aria-label={`Video preview: ${entry.name}`}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="preview-audio-card">
            <FileTypeIcon entry={entry} size={78} />
            <div className="preview-audio-title" title={entry.path}>
              {entry.name}
            </div>
            <audio
              ref={mediaRef as RefObject<HTMLAudioElement>}
              src={assetUrl(entry.path)}
              controls
              preload="metadata"
              className="preview-audio"
              aria-label={`Audio preview: ${entry.name}`}
              onError={() => setFailed(true)}
            />
          </div>
        )}
      </div>
      <div className="preview-renderer-footer">
        <span>{metadata.kind}</span>
        {duration ? <span>{duration}</span> : null}
        {resolution ? <span>{resolution}</span> : null}
        {metadata.codecs.length ? <span>{metadata.codecs.join(", ")}</span> : null}
        {metadata.size != null ? <span>{formatSize(metadata.size)}</span> : null}
      </div>
      <div className="preview-media-hint">
        <Icon name="info" size={12} />
        <span>Playback pauses when the preview closes or the window is hidden.</span>
      </div>
    </div>
  );
}
