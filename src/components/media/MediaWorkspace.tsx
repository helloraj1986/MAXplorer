import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { api, normalizeError } from "../../lib/api";
import { logDiagnostic } from "../../lib/diagnostics";
import { useExplorerStore } from "../../state/explorerStore";
import { useMediaStore } from "../../state/mediaStore";
import { streamRowLabel } from "./streams";
import { PlayerOverlay } from "./PlayerOverlay";
import { DEFAULT_MEDIA_CATALOGS, type MediaCatalogMeta, type RankedStream } from "./types";

/**
 * Media workspace — laid out to the approved concept
 * (`maxplorer-media/Maxplorer Media UI Concept.html`): title bar, left rail,
 * hero + pinned-addons rail, poster rows, and the streams panel.
 *
 * Playback is handled by the native libmpv engine (see `PlayerOverlay`), so
 * torrent rows play the MKV/AC3/DTS releases the webview cannot decode.
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
  const debridConfig = useMediaStore((state) => state.debridConfig);
  const diagnostics = useMediaStore((state) => state.playerDiagnostics);

  const rows = useMemo(() => {
    const wanted = DEFAULT_MEDIA_CATALOGS.map((entry) => `${entry.type}:${entry.id}`);
    const live = catalogs.filter((catalog) => wanted.includes(`${catalog.type}:${catalog.id}`));
    return wanted
      .map((key) => live.find((catalog) => `${catalog.type}:${catalog.id}` === key))
      .filter((catalog) => catalog !== undefined);
  }, [catalogs]);

  // Hero item: the first poster-bearing meta across the loaded rows.
  const featured = useMemo(() => {
    for (const row of rows) {
      const meta = row.metas.find((entry) => entry.background || entry.poster);
      if (meta) return meta;
    }
    return null;
  }, [rows]);

  const itemCount = rows.reduce((total, row) => total + row.metas.length, 0);
  const engineOk = Boolean(diagnostics?.available && diagnostics?.embeddingSupported);
  const engineLabel = !diagnostics
    ? "engine: checking…"
    : engineOk
      ? `engine: libmpv ${diagnostics.apiVersion ?? ""}`.trim()
      : "engine: unavailable";

  return (
    <section className="media-workspace" aria-label="Media">
      <PlayerOverlay />
      <header className="media-titlebar">
        <div className="media-brand">
          <span className="media-brand-mark" aria-hidden="true" />
          <span>MAXplorer</span>
          <small>Media</small>
        </div>
        <div className="media-omni" aria-hidden="true">
          <span className="media-omni-icon">⌕</span>
          <span>Search movies, shows, addons…</span>
          <kbd>⌘K</kbd>
        </div>
        <span className={`media-status ${manifest ? "ok" : "off"}`}>
          {manifest ? `${manifest.name} connected` : manifestLoading ? "Connecting…" : "Offline"}
        </span>
        <span className="media-pill">{itemCount} titles</span>
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

      <div className="media-body">
        <nav className="media-side" aria-label="Media sections">
          <h4>Media</h4>
          <button type="button" className="media-nav on" aria-current="page">
            <span className="media-nav-ic" aria-hidden="true">◈</span>
            <span>Discover</span>
          </button>
          <button type="button" className="media-nav" disabled title="Arrives with Library & sync">
            <span className="media-nav-ic" aria-hidden="true">↻</span>
            <span>Continue</span>
          </button>
          <button type="button" className="media-nav" disabled title="Arrives with Library & sync">
            <span className="media-nav-ic" aria-hidden="true">★</span>
            <span>Library</span>
          </button>
          <button type="button" className="media-nav" disabled title="Arrives with the addon manager">
            <span className="media-nav-ic" aria-hidden="true">▤</span>
            <span>Catalogs</span>
          </button>

          <h4>Addons</h4>
          <button type="button" className="media-nav" disabled title="Arrives with the addon manager">
            <span className="media-nav-ic" aria-hidden="true">◉</span>
            <span>Installed</span>
            <span className="media-nav-count">{manifest ? 1 : 0}</span>
          </button>
          <button type="button" className="media-nav" disabled title="Arrives with the addon manager">
            <span className="media-nav-ic" aria-hidden="true">✦</span>
            <span>Discover addons</span>
          </button>

          <h4>Sources</h4>
          <button type="button" className="media-nav" disabled>
            <span className="media-nav-ic" aria-hidden="true">☰</span>
            <span>Cinemeta</span>
          </button>
          <button type="button" className="media-nav" disabled>
            <span className="media-nav-ic" aria-hidden="true">▤</span>
            <span>Torrentio</span>
          </button>

          <div className="media-side-foot">
            <div>
              <span className={`media-dot ${manifest ? "ok" : "warn"}`} />
              catalog: {manifest ? "connected" : manifestLoading ? "connecting" : "offline"}
            </div>
            <div>
              <span className={`media-dot ${engineOk ? "ok" : "warn"}`} />
              {engineLabel}
            </div>
            <div>
              <span className={`media-dot ${debridConfig ? "ok" : "warn"}`} />
              debrid: {debridConfig ? debridConfig.provider : "off (optional)"}
            </div>
          </div>
        </nav>

        <main className="media-main">
          <div className="media-crumb">
            <b>Discover</b> › {manifest?.name ?? "Cinemeta"}
          </div>

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

          {diagnostics && !engineOk ? (
            <div className="media-error media-error-inline" role="status">
              <p>In-app playback is unavailable — files the webview cannot decode won't play.</p>
              <p className="media-error-detail">{diagnostics.detail}</p>
            </div>
          ) : null}

          <section className="media-featured">
            {featured ? (
              <article
                className="media-hero"
                style={
                  featured.background || featured.poster
                    ? {
                        backgroundImage: `linear-gradient(180deg, rgba(6,7,8,.30) 20%, rgba(6,7,8,.88) 100%), url(${featured.background ?? featured.poster})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              >
                <div className="media-hero-tags">
                  <span className="media-tag">Featured</span>
                  {featured.type ? <span className="media-tag ghost">{featured.type}</span> : null}
                  {featured.releaseInfo ? (
                    <span className="media-tag ghost">{featured.releaseInfo}</span>
                  ) : null}
                </div>
                <h1>{featured.name ?? featured.id}</h1>
                <div className="media-hero-meta">
                  {featured.imdbRating ? (
                    <span className="media-star">★ {featured.imdbRating}</span>
                  ) : null}
                  <span>via {manifest?.name ?? "Cinemeta"} · Torrentio streams</span>
                </div>
                <div className="media-btnrow">
                  <button
                    type="button"
                    className="media-btn primary"
                    onClick={() => selectMeta(featured)}
                  >
                    ▶ Streams
                  </button>
                </div>
              </article>
            ) : (
              <article className="media-hero media-hero-empty">
                <h1>Discover</h1>
                <div className="media-hero-meta">
                  <span>Loading catalogs from {manifest?.name ?? "Cinemeta"}…</span>
                </div>
              </article>
            )}

            <aside className="media-addonrail">
              <h4>Pinned addons</h4>
              <div className="media-addon">
                <span className="media-addon-logo" style={{ background: "#8fb8f5" }}>Ci</span>
                <div>
                  <div className="media-addon-t">Cinemeta</div>
                  <div className="media-addon-s">Metadata · posters · catalogs</div>
                </div>
                <span className={`media-addon-n ${manifest ? "ok" : "off"}`}>
                  {manifest ? "READY" : "OFF"}
                </span>
              </div>
              <div className="media-addon">
                <span className="media-addon-logo" style={{ background: "#7bd389" }}>T</span>
                <div>
                  <div className="media-addon-t">Torrentio</div>
                  <div className="media-addon-s">Torrents &amp; debrid streams</div>
                </div>
                <span className="media-addon-n ok">READY</span>
              </div>
              <div className="media-addon">
                <span className="media-addon-logo" style={{ background: "#f0b6c8" }}>OS</span>
                <div>
                  <div className="media-addon-t">OpenSubtitles</div>
                  <div className="media-addon-s">Subtitles · later phase</div>
                </div>
                <span className="media-addon-n off">OFF</span>
              </div>
              <div className="media-addon">
                <span className="media-addon-logo" style={{ background: "#ffd479" }}>TX</span>
                <div>
                  <div className="media-addon-t">Trakt</div>
                  <div className="media-addon-s">Scrobbling · later phase</div>
                </div>
                <span className="media-addon-n off">OFF</span>
              </div>
            </aside>
          </section>

          {rows.map((catalog) => (
            <section className="media-row" key={`${catalog.type}:${catalog.id}`}>
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
            </section>
          ))}

          {rows.length === 0 && !manifestError ? (
            <p className="media-empty">Loading catalogs…</p>
          ) : null}

          {selected ? (
            <StreamsPanel
              meta={selected}
              streams={streams}
              loading={streamsLoading}
              error={streamsError}
              onClose={clearSelection}
            />
          ) : null}
        </main>
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
        <div className="media-poster-wrap">
          <img
            className="media-poster"
            src={meta.poster}
            alt=""
            loading="lazy"
            draggable={false}
          />
          {meta.imdbRating || meta.releaseInfo ? (
            <span className="media-poster-badges">
              {meta.imdbRating ? <span className="media-badge">★{meta.imdbRating}</span> : null}
              {meta.releaseInfo ? <span className="media-badge hd">{meta.releaseInfo}</span> : null}
            </span>
          ) : null}
        </div>
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

function StreamsPanel({
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
        <h2>
          {title}
          <span className="media-detail-year">{subtitle}</span>
        </h2>
        <button type="button" className="media-close" onClick={onClose} aria-label="Close streams">
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
        Sorted by <b>quality → direct/cached → size</b>. ▶ Play opens the embedded player (plays
        any file — MKV, HEVC, AC3/DTS), ↗ External opens VLC/IINA/mpv, and ▶ Stream runs the
        built-in torrent engine with no debrid needed.
      </p>
    </section>
  );
}

function StreamRow({ ranked }: { ranked: RankedStream }) {
  const toast = useExplorerStore((state) => state.toast);
  const openPlayer = useMediaStore((state) => state.openPlayer);
  const streamTorrent = useMediaStore((state) => state.streamTorrent);
  const engine = useMediaStore((state) => state.engine);
  const [playing, setPlaying] = useState(false);
  const direct = Boolean(ranked.stream.url && !ranked.stream.infoHash);
  const hash = ranked.stream.infoHash ?? null;
  const resolving = engine?.phase === "resolving" && engine.infoHash === hash;
  const progressPct = resolving && engine?.progress ? Math.round(engine.progress * 100) : null;
  const engineError =
    engine?.phase === "error" && engine.infoHash === hash ? engine.error ?? "Unknown error" : null;
  const lastError = useRef<string | null>(null);

  // The engine reports failures asynchronously (invalid hash, no peers); the row
  // would otherwise sit silent, so surface the first error of each run.
  useEffect(() => {
    if (engineError && lastError.current !== engineError) {
      lastError.current = engineError;
      toast({ title: "Torrent stream failed", detail: engineError, tone: "error" });
    }
    if (!engineError) lastError.current = null;
  }, [engineError, toast]);

  const playExternal = async () => {
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
      <span className="media-stream-size">{formatSize(ranked.sizeBytes)}</span>
      <span className="media-stream-actions">
        {direct ? (
          <>
            <button
              type="button"
              className="media-play"
              onClick={() => openPlayer(ranked.stream.url as string, ranked.label)}
              aria-label={`Play ${ranked.label} in the app`}
            >
              ▶ Play
            </button>
            <button
              type="button"
              className="media-play media-play-external"
              onClick={() => void playExternal()}
              disabled={playing}
              aria-label={`Play ${ranked.label} in external player`}
              title="Open in external player (VLC/IINA/mpv)"
            >
              {playing ? "…" : "↗ External"}
            </button>
          </>
        ) : hash ? (
          <button
            type="button"
            className="media-play"
            disabled={resolving}
            onClick={() => void streamTorrent(hash, ranked.label)}
            aria-label={`Stream ${ranked.label} over torrent engine`}
            title="Streams over the embedded torrent engine (local-first, no debrid needed)"
          >
            {resolving ? (progressPct !== null ? `${progressPct}%` : "…") : "▶ Stream"}
          </button>
        ) : null}
      </span>
    </li>
  );
}

/** Human-readable release size for the streams panel. */
export function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Logged when the workspace hits a problem the user should be able to report. */
export function logMediaDiagnostic(message: string): void {
  logDiagnostic("info", message, "media.workspace");
}
