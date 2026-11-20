import { useState } from "react";
import { MediaIcon } from "./icons";
import { heroBackdrop, heroMetaLine } from "./board";
import type { MediaCatalogMeta } from "./types";

/**
 * Board hero (docs/MEDIA_UI_SPEC.md §3.1) — full-bleed backdrop, logo art with a
 * text fallback, meta line with the gold IMDb pill, 2-line synopsis clamp, the
 * accent Watch pill and the library/episodes circles.
 *
 * The hero bleeds under the floating top bar: it is the first thing in
 * `.media-main`, which no longer carries a compensating top padding.
 */
export function MediaHero({
  meta,
  onWatch,
  onLibrary,
  onEpisodes,
}: {
  meta: MediaCatalogMeta;
  onWatch: () => void;
  onLibrary?: () => void;
  onEpisodes?: () => void;
}) {
  const title = meta.name ?? meta.id;
  const line = heroMetaLine(meta);
  const backdrop = heroBackdrop(meta);
  const [logoBroken, setLogoBroken] = useState(false);
  const showLogo = Boolean(meta.logo) && !logoBroken;
  const isSeries = meta.type === "series";

  return (
    <section className="media-hero" aria-label={`Featured: ${title}`}>
      {backdrop ? (
        <div
          className="media-hero-backdrop"
          style={{ backgroundImage: `url(${backdrop})` }}
          aria-hidden="true"
        />
      ) : null}
      <div className="media-hero-scrim" aria-hidden="true" />

      <div className="media-hero-body">
        {showLogo ? (
          <img
            className="media-hero-logo"
            src={meta.logo as string}
            alt={title}
            draggable={false}
            onError={() => setLogoBroken(true)}
          />
        ) : (
          <h1 className="media-hero-title">{title}</h1>
        )}

        <div className="media-hero-meta">
          {line.parts.map((part) => (
            <span key={part}>{part}</span>
          ))}
          {line.imdb ? (
            <span className="media-hero-imdb" title="IMDb rating">
              IMDb
            </span>
          ) : null}
          {line.genres ? <span className="media-hero-genres">{line.genres}</span> : null}
        </div>

        {meta.description ? <p className="media-hero-synopsis">{meta.description}</p> : null}

        <div className="media-hero-actions">
          <button type="button" className="media-hero-watch" onClick={onWatch}>
            <MediaIcon name="play" size={18} strokeWidth={0} />
            <span>Watch</span>
          </button>

          <button
            type="button"
            className="media-hero-circle"
            aria-label="Add to library"
            title={
              onLibrary
                ? "Add to library"
                : "My Library arrives with the library roadmap item"
            }
            onClick={onLibrary}
            aria-disabled={onLibrary ? undefined : true}
          >
            <MediaIcon name="library" size={20} />
          </button>

          {isSeries && onEpisodes ? (
            <button
              type="button"
              className="media-hero-circle"
              aria-label="Episodes"
              title="Episodes"
              onClick={onEpisodes}
            >
              <MediaIcon name="episodes" size={20} />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
