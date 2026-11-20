import { useEffect, useState } from "react";
import { MediaIcon } from "./icons";
import { initialOf, isNew, progressRatio, seasonLabel } from "./board";
import type { MediaCatalogMeta, WatchProgress } from "./types";

/**
 * Poster card (docs/MEDIA_UI_SPEC.md §3.3) — 0.7-ratio art, in-art progress bar,
 * quality/`NEW` badges, hover play overlay.
 *
 * Focus is owned by the carousel (roving tabindex), so the card only reports
 * clicks/Enter and takes the `tabIndex` it is handed. `onSelect` opens the
 * detail screen.
 */
export function MediaPosterCard({
  meta,
  progress,
  onSelect,
  tabIndex = 0,
  onFocus,
  nodeRef,
}: {
  meta: MediaCatalogMeta;
  progress?: WatchProgress;
  onSelect: () => void;
  tabIndex?: number;
  onFocus?: () => void;
  /** Lets the owning carousel collect nodes for roving focus. */
  nodeRef?: (node: HTMLElement | null) => void;
}) {
  const title = meta.name ?? meta.id;
  const ratio = progressRatio(progress);
  const badge = qualityBadge(meta);
  const fresh = isNew(meta.released);
  const season = seasonLabel(progress);
  const [broken, setBroken] = useState(false);

  // A new poster means the previous failure no longer applies (react reuses the
  // component when rows share ids).
  useEffect(() => setBroken(false), [meta.poster]);

  return (
    <article
      className="media-card"
      role="button"
      tabIndex={tabIndex}
      aria-label={`Show streams for ${title}`}
      ref={nodeRef}
      onFocus={onFocus}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="media-card-art">
        {meta.poster && !broken ? (
          <img
            className="media-card-poster"
            src={meta.poster}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="media-card-fallback" aria-hidden="true">
            {initialOf(title)}
          </span>
        )}

        {(badge || fresh) && (
          <span className="media-card-badges">
            {badge ? <span className={`media-badge ${badge.tone}`}>{badge.text}</span> : null}
            {fresh ? <span className="media-badge new">NEW</span> : null}
          </span>
        )}

        {season ? <span className="media-card-season">{season}</span> : null}

        {/* In-art progress: 26 px above the art's bottom edge (spec §3.3). */}
        {ratio !== null ? (
          <span
            className="media-card-progress"
            role="progressbar"
            aria-label={`${title} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
          >
            <span className="media-card-progress-fill" style={{ width: `${ratio * 100}%` }} />
          </span>
        ) : null}

        <span className="media-card-overlay" aria-hidden="true">
          <span className="media-card-play">
            <MediaIcon name="play" size={22} strokeWidth={0} />
          </span>
        </span>
      </div>

      <p className="media-card-caption">{title}</p>
    </article>
  );
}

/**
 * Quality pill from metadata. Cinemeta does not report a quality for catalog
 * items, so this stays empty there rather than inventing one (spec §3.3 says
 * "if known from the metadata").
 */
export function qualityBadge(meta: MediaCatalogMeta): { text: string; tone: string } | null {
  const raw = (meta as { quality?: string | null }).quality;
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes("4K") || upper.includes("2160")) return { text: "4K", tone: "uhd" };
  if (upper.includes("1080")) return { text: "1080p", tone: "hd" };
  if (upper.includes("720") || upper.includes("480")) return { text: upper, tone: "low" };
  return { text: upper, tone: "hd" };
}
