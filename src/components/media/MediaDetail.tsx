import { useEffect, useState, type ReactNode } from "react";
import { MediaIcon } from "./icons";
import { formatTimeLeft, heroBackdrop, heroMetaLine, inContinueWindow } from "./board";
import type { MediaCatalogMeta, WatchProgress } from "./types";

/** The action row's buttons (spec §4.2 item 8). */
export type DetailAction = "library" | "watched" | "like" | "heart" | "share";

/**
 * Detail content column (docs/MEDIA_UI_SPEC.md §4.2, `crop-meta-block.png`).
 *
 * Tall dimmed backdrop, title art with a text fallback, meta line with the IMDb
 * pill, a 3-line synopsis, then the GENRES / CAST / DIRECTORS chip rows and the
 * action row. The streams panel is a sibling — this component never owns it.
 *
 * `Esc` returns to the board (spec §8: menus → chrome → player → detail → board).
 */
export function MediaDetail({
  meta,
  progress,
  onClose,
  onAction,
  onPlay,
}: {
  meta: MediaCatalogMeta;
  /** Watch progress for this title, from `library.json` (Phase 1). */
  progress?: WatchProgress;
  onClose: () => void;
  onAction?: (action: DetailAction) => void;
  /** Primary button: `null` starts from 0, a number resumes from that second. */
  onPlay?: (startSeconds: number | null) => void;
}) {
  const title = meta.name ?? meta.id;
  const line = heroMetaLine(meta);
  const backdrop = heroBackdrop(meta);
  const [logoBroken, setLogoBroken] = useState(false);
  const showLogo = Boolean(meta.logo) && !logoBroken;
  const genres = meta.genres ?? [];
  const cast = meta.cast ?? [];
  const directors = meta.director ?? [];
  // Resume only when the title is genuinely mid-watch (> 2 % and < 95 %): the
  // same window as the Continue-watching row, so the two can never disagree.
  const resumable = progress !== undefined && inContinueWindow(progress);
  const timeLeft = resumable && progress ? formatTimeLeft(progress.position, progress.duration) : null;
  const playLabel = resumable ? (timeLeft ? `Resume · ${timeLeft}` : "Resume") : "Watch";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      // Never steal Esc from a field or an open select popup.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const actions: { id: DetailAction; icon: "library" | "watched" | "like" | "heart" | "share"; label: string }[] = [
    { id: "library", icon: "library", label: "Add to library" },
    { id: "watched", icon: "watched", label: "Mark as watched" },
    { id: "like", icon: "like", label: "Like" },
    { id: "heart", icon: "heart", label: "Add to favourites" },
    { id: "share", icon: "share", label: "Share" },
  ];

  return (
    <section className="media-detail" aria-label={title}>
      {backdrop ? (
        <div
          className="media-detail-backdrop"
          style={{ backgroundImage: `url(${backdrop})` }}
          aria-hidden="true"
        />
      ) : null}
      <div className="media-detail-scrim" aria-hidden="true" />

      <div className="media-detail-body">
        {showLogo ? (
          <img
            className="media-detail-logo"
            src={meta.logo as string}
            alt={title}
            draggable={false}
            onError={() => setLogoBroken(true)}
          />
        ) : (
          <h1 className="media-detail-title">{title}</h1>
        )}

        <div className="media-detail-meta">
          {line.parts.map((part) => (
            <span key={part}>{part}</span>
          ))}
          {line.imdb ? (
            <span className="media-hero-imdb" title="IMDb rating">
              IMDb
            </span>
          ) : null}
        </div>

        {meta.description ? <p className="media-detail-synopsis">{meta.description}</p> : null}

        <div className="media-detail-rows">
          {genres.length > 0 ? (
            <DetailChipRow label="Genres">
              {genres.map((genre) => (
                <li key={genre} className="media-chip">
                  {genre}
                </li>
              ))}
            </DetailChipRow>
          ) : null}

          {cast.length > 0 ? (
            <DetailChipRow label="Cast">
              {cast.map((person) => (
                <li key={person} className="media-chip">
                  {person}
                </li>
              ))}
            </DetailChipRow>
          ) : null}

          {directors.length > 0 ? (
            <DetailChipRow label="Directors">
              {directors.map((person) => (
                <li key={person} className="media-chip">
                  {person}
                </li>
              ))}
            </DetailChipRow>
          ) : null}
        </div>

        <div className="media-detail-actions">
          {onPlay ? (
            <button
              type="button"
              className="media-hero-watch media-detail-watch"
              onClick={() => onPlay(resumable && progress ? progress.position : null)}
              title={
                resumable && progress
                  ? `Continue from ${Math.floor(progress.position / 60)} min`
                  : `Play ${title} from the start`
              }
            >
              <MediaIcon name="play" size={18} strokeWidth={0} />
              <span>{playLabel}</span>
            </button>
          ) : null}
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="media-detail-circle"
              aria-label={action.label}
              title={action.label}
              onClick={() => onAction?.(action.id)}
              aria-disabled={onAction ? undefined : true}
            >
              <MediaIcon name={action.icon} size={18} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function DetailChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="media-detail-row">
      <span className="media-detail-label">{label}</span>
      <ul className="media-chip-list" aria-label={label}>
        {children}
      </ul>
    </div>
  );
}