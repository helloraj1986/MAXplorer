import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { api, normalizeError } from "../../lib/api";
import { useExplorerStore } from "../../state/explorerStore";
import { useMediaStore } from "../../state/mediaStore";
import { streamRowLabel } from "./streams";
import { DEFAULT_MEDIA_CATALOGS, type MediaCatalogMeta, type RankedStream } from "./types";

/**
 * Media workspace (phase 1): discover view backed by real Stremio addon
 * catalogs. Renders Cinemeta's trending movies and popular series with real
 * poster art. Playback, streams and the addon manager arrive in later phases.
 */
export function MediaWorkspace() {
  const manifest = useMediaStore((state) => state.manifest);
  const manifestLoading = useMediaStore((state) => state.manifestLoading);
  const manifestError = useMediaStore((state) => state.manifestError);
  const catalogs = useMediaStore((state) => state.catalogs);
  const closeWorkspace = useMediaStore((state) => state.closeWorkspace);
  const loadCatalog = useMediaStore((state) => state.loadCatalog);
  const selectMeta = useMediaStore((state) => state.selectMeta);
  const selected = useMediaStore((state) => state.selected);
  const streams = useMediaStore((state) => state.streams);
  const streamsLoading = useMediaStore((state) => state.streamsLoading);
  const streamsError = useMediaStore((state) => state.streamsError);
  const clearSelection = useMediaStore((state) => state.clearSelection);

  const rows = useMemo(() => {
    const wanted = DEFAULT_MEDIA_CATALOGS.map((entry) => `${entry.type}:${entry.id}`);
    const live = catalogs.filter((catalog) =>
      wanted.includes(`${catalog.type}:${catalog.id}`),
    );
    return wanted
      .map((key) => live.find((catalog) => `${catalog.type}:${catalog.id}` === key))
      .filter((catalog) => catalog !== undefined);
  }, [catalogs]);

  return (
    <section className="media-workspace" aria-label="Media">
      <header className="media-topbar">
        <div className="media-brand">
          <span className="media-brand-mark" aria-hidden="true" />
          <span>Media</span>
          <span className={`media-status ${manifest ? "ok" : "off"}`}>
            {manifest ? `${manifest.name} connected` : manifestLoading ? "Connecting…" : "Offline"}
          </span>
        </div>
        <button
          type="button"
          className="media-close"
          onClick={() => {
            clearSelection();
            closeWorkspace();
          }}
          aria-label="Close media"
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="media-scroll">
        {selected ? (
          <StreamsSheet
            meta={selected}
            streams={streams}
            loading={streamsLoading}
            error={streamsError}
            onClose={clearSelection}
          />
        ) : null}

        {manifestError ? (
          <div className="media-error" role="alert">
            <p>Couldn't reach the catalog addon.</p>
            <p className="media-error-detail">{manifestError}</p>
            <button
              type="button"
              className="media-retry"
              onClick={() => {
                for (const catalog of DEFAULT_MEDIA_CATALOGS) {
                  void loadCatalog(catalog.type, catalog.id, catalog.name);
                }
              }}
            >
              Retry
            </button>
          </div>
        ) : null}

        {rows.map((catalog) => (
          <div className="media-row" key={`${catalog.type}:${catalog.id}`}>
            <div className="media-row-head">
              <h3>{catalog.name}</h3>
              <span className="media-row-sub">
                {manifest?.name ?? "Cinemeta"} · catalog {catalog.id}
              </span>
            </div>
            {catalog.loading && catalog.metas.length === 0 ? (
              <div className="media-strip" aria-busy="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="media-card" key={index}>
                    <div className="media-poster media-poster-skeleton" />
                    <div className="media-skeleton-line" />
                  </div>
                ))}
              </div>
            ) : catalog.error ? (
              <p className="media-row-error">{catalog.error}</p>
            ) : (
              <div className="media-strip">
                {catalog.metas.map((meta) => (
                  <MediaCard key={meta.id} meta={meta} onSelect={() => selectMeta(meta)} />
                ))}
              </div>
            )}
          </div>
        ))}

        {rows.length === 0 && !manifestError ? (
          <p className="media-empty">Loading catalogs…</p>
        ) : null}
      </div>
    </section>
  );
}

function MediaCard({ meta, onSelect }: { meta: MediaCatalogMeta; onSelect: () => void }) {
  const title = meta.name ?? meta.id;
  const metaBits = [meta.releaseInfo, meta.imdbRating ? `★ ${meta.imdbRating}` : null]
    .filter((bit): bit is string => Boolean(bit))
    .join(" · ");
  return (
    <article
      className="media-card"
      tabIndex={0}
      role="button"
      aria-label={`Show streams for ${title}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {meta.poster ? (
        <img
          className="media-poster"
          src={meta.poster}
          alt=""
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div className="media-poster media-poster-fallback">
          <span>{title}</span>
        </div>
      )}
      <p className="media-card-title">{title}</p>
      {metaBits ? <p className="media-card-meta">{metaBits}</p> : null}
    </article>
  );
}

function StreamsSheet({
  meta,
  streams,
  loading,
  error,
  onClose,
}: {
  meta: MediaCatalogMeta;
  streams: RankedStream[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const title = meta.name ?? meta.id;
  const subtitle = [
    meta.releaseInfo,
    meta.type === "series" ? "Series" : "Movie",
    meta.imdbRating ? `★ ${meta.imdbRating}` : null,
  ]
    .filter((bit): bit is string => Boolean(bit))
    .join(" · ");
  return (
    <section className="media-detail" aria-label={`${title} streams`}>
      <div className="media-detail-head">
        <h2>{title}</h2>
        <span className="media-detail-sub">{subtitle}</span>
        <button
          type="button"
          className="media-close"
          onClick={onClose}
          aria-label="Close streams"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {meta.description ? <p className="media-detail-desc">{meta.description}</p> : null}
      {loading ? (
        <p className="media-empty" aria-busy="true">
          Resolving streams from Torrentio…
        </p>
      ) : error ? (
        <p className="media-row-error" role="alert">
          Couldn't resolve streams: {error}
        </p>
      ) : streams.length === 0 ? (
        <p className="media-empty">No streams found for this title.</p>
      ) : (
        <ol className="media-stream-list">
          {streams.map((ranked, index) => (
            <StreamRow key={`${ranked.label}-${index}`} ranked={ranked} />
          ))}
        </ol>
      )}
      <p className="media-detail-hint">
        Streams are ranked by quality, direct/debrid links, then size. Torrent links need the
        stream engine (Phase 4) before they can play.
      </p>
    </section>
  );
}

function StreamRow({ ranked }: { ranked: RankedStream }) {
  const toast = useExplorerStore((state) => state.toast);
  const [playing, setPlaying] = useState(false);
  const direct = Boolean(ranked.stream.url && !ranked.stream.infoHash);
  const play = async () => {
    if (!direct || playing) return;
    setPlaying(true);
    try {
      const result = await api.playMediaStream(ranked.stream.url as string);
      toast({
        title: "Playing in external player",
        detail: `Player: ${result.player} · ${ranked.label}`,
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Playback failed",
        detail: normalizeError(error).message,
        tone: "error",
      });
    } finally {
      setPlaying(false);
    }
  };
  return (
    <li className="media-stream-row">
      <span className={`media-stream-quality ${ranked.qualityRank >= 6 ? "uhd" : ""}`}>
        {ranked.qualityBadge ?? "N/A"}
      </span>
      <span className="media-stream-desc">{streamRowLabel(ranked)}</span>
      <span className="media-stream-flags">
        {ranked.flags.map((flag) => (
          <span key={flag.text} className={`media-flag media-flag-${flag.tone}`}>
            {flag.text}
          </span>
        ))}
      </span>
      {direct ? (
        <button
          type="button"
          className="media-play"
          onClick={() => void play()}
          disabled={playing}
          aria-label={`Play ${ranked.label} in external player`}
        >
          {playing ? "…" : "▶ Play"}
        </button>
      ) : (
        <span
          className="media-flag"
          title="Torrent streams need the Phase 4 stream engine"
          aria-label={`Torrent stream, playback requires the Phase 4 engine`}
        >
          🔒 Engine
        </span>
      )}
    </li>
  );
}
