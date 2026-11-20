import { useEffect, useMemo, useRef, useState } from "react";
import { api, normalizeError } from "../../lib/api";
import { logDiagnostic } from "../../lib/diagnostics";
import { useExplorerStore } from "../../state/explorerStore";
import { useMediaStore } from "../../state/mediaStore";
import { streamRowLabel } from "./streams";
import { PlayerOverlay } from "./PlayerOverlay";
import { MediaShell } from "./MediaShell";
import { MediaHero } from "./MediaHero";
import { MediaCarousel } from "./MediaCarousel";
import { allMetas, continueWatching } from "./board";
import { MediaIcon } from "./icons";
import {
  CINEMETA_ADDON_URL,
  DEFAULT_MEDIA_CATALOGS,
  DEFAULT_STREAM_ADDON_URL,
  type MediaCatalogMeta,
  type RankedStream,
} from "./types";

/**
 * Media workspace — the board (hero + poster rows) plus the streams panel and
 * the native player.
 *
 * Chrome comes from `MediaShell` (rail + top bar, docs/MEDIA_UI_SPEC.md §2);
 * this component is the content slot, implemented to spec §3 (WP2): a full-bleed
 * hero that bleeds under the floating top bar, `MediaCarousel` rows of
 * `MediaPosterCard`s, and Continue watching first, fed by the progress stub
 * store. The detail screen is still a slide-over until WP3 extracts it.
 *
 * Playback is handled by the native libmpv engine (see `PlayerOverlay`), so
 * torrent rows play the MKV/AC3/DTS releases the webview cannot decode.
 */
export function MediaWorkspace() {
  const manifest = useMediaStore((state) => state.manifest);
  const manifestLoading = useMediaStore((state) => state.manifestLoading);
  const manifestError = useMediaStore((state) => state.manifestError);
  const catalogs = useMediaStore((state) => state.catalogs);
  const loadCatalog = useMediaStore((state) => state.loadCatalog);
  const selectMeta = useMediaStore((state) => state.selectMeta);
  const selected = useMediaStore((state) => state.selected);
  const streams = useMediaStore((state) => state.streams);
  const streamsLoading = useMediaStore((state) => state.streamsLoading);
  const streamsError = useMediaStore((state) => state.streamsError);
  const clearSelection = useMediaStore((state) => state.clearSelection);
  const debridConfig = useMediaStore((state) => state.debridConfig);
  const diagnostics = useMediaStore((state) => state.playerDiagnostics);
  const watchProgress = useMediaStore((state) => state.watchProgress);
  const searchQuery = useMediaStore((state) => state.searchQuery);
  const toast = useExplorerStore((state) => state.toast);

  const rows = useMemo(() => {
    const wanted = DEFAULT_MEDIA_CATALOGS.map((entry) => `${entry.type}:${entry.id}`);
    const live = catalogs.filter((catalog) => wanted.includes(`${catalog.type}:${catalog.id}`));
    return wanted
      .map((key) => live.find((catalog) => `${catalog.type}:${catalog.id}` === key))
      .filter((catalog) => catalog !== undefined);
  }, [catalogs]);

  const metas = useMemo(() => allMetas(rows), [rows]);

  // Hero item: the first poster-bearing meta across the loaded rows.
  const featured = useMemo(() => {
    for (const row of rows) {
      const meta = row.metas.find((entry) => entry.background || entry.poster);
      if (meta) return meta;
    }
    return null;
  }, [rows]);

  // Continue watching comes first (spec §3.2), most recent first, and is hidden
  // while it is empty.
  const continueItems = useMemo(
    () => continueWatching(metas, watchProgress),
    [metas, watchProgress],
  );

  const query = searchQuery.trim().toLowerCase();
  const matches = useMemo(
    () => (query ? metas.filter((meta) => (meta.name ?? meta.id).toLowerCase().includes(query)) : []),
    [query, metas],
  );

  const engineOk = Boolean(diagnostics?.available && diagnostics?.embeddingSupported);
  const engineLabel = !diagnostics
    ? "engine: checking…"
    : engineOk
      ? `engine: libmpv ${diagnostics.apiVersion ?? ""}`.trim()
      : "engine: unavailable";

  const retryAll = () => {
    for (const catalog of DEFAULT_MEDIA_CATALOGS) {
      void loadCatalog(catalog.type, catalog.id, catalog.name);
    }
  };

  const streamAddonHost = hostOf(DEFAULT_STREAM_ADDON_URL);

  return (
    <MediaShell>
      <PlayerOverlay />
      <main className="media-main media-main-board">
        {manifestError ? (
          <div className="media-error media-board-banner" role="alert">
            <p>Couldn't reach the catalog addon.</p>
            <p className="media-error-detail">{manifestError}</p>
            <button type="button" className="media-retry" onClick={retryAll}>
              Retry
            </button>
          </div>
        ) : null}

        {diagnostics && !engineOk ? (
          <div className="media-error media-error-inline media-board-banner" role="status">
            <p>In-app playback is unavailable — files the webview cannot decode won't play.</p>
            <p className="media-error-detail">{diagnostics.detail}</p>
          </div>
        ) : null}

        {query ? (
          <div className="media-board-rows">
            <MediaCarousel
              heading={`Results for “${searchQuery.trim()}”`}
              items={matches}
              progress={watchProgress}
              onSelect={selectMeta}
            />
          </div>
        ) : (
          <>
            {featured ? (
              <MediaHero
                meta={featured}
                onWatch={() => selectMeta(featured)}
                onLibrary={() =>
                  toast({
                    title: "My Library is on the roadmap",
                    detail: `It arrives with the library item — nothing was saved for ${
                      featured.name ?? featured.id
                    }.`,
                    tone: "info",
                  })
                }
              />
            ) : (
              <section className="media-hero media-hero-empty" aria-label="Discover">
                <div className="media-hero-body">
                  <h1 className="media-hero-title">Discover</h1>
                  <p className="media-hero-synopsis">
                    Loading catalogs from {manifest?.name ?? "Cinemeta"}…
                  </p>
                </div>
              </section>
            )}

            <div className="media-board-rows">
              {continueItems.length > 0 ? (
                <MediaCarousel
                  heading="Continue watching"
                  items={continueItems}
                  progress={watchProgress}
                  onSelect={selectMeta}
                />
              ) : null}

              {rows.map((catalog) => (
                <MediaCarousel
                  key={`${catalog.type}:${catalog.id}`}
                  heading={catalog.name}
                  items={catalog.metas}
                  progress={watchProgress}
                  loading={catalog.loading}
                  error={catalog.error}
                  onRetry={() => void loadCatalog(catalog.type, catalog.id, catalog.name)}
                  onSelect={selectMeta}
                />
              ))}

              {rows.length === 0 && !manifestError ? (
                <p className="media-empty">Loading catalogs…</p>
              ) : null}
            </div>
          </>
        )}

        <div className="media-board-footer">
          <div className="media-addons" aria-label="Active addons">
            <span className={`media-addon-chip ${manifest ? "ok" : "off"}`}>
              <span className={`media-dot ${manifest ? "ok" : "warn"}`} />
              {manifest?.name ?? "Cinemeta"}
              {manifest ? " · metadata" : manifestLoading ? " · connecting" : " · offline"}
            </span>
            <span className="media-addon-chip ok">
              <span className="media-dot ok" />
              {streamAddonHost} · streams
            </span>
          </div>

          <div className="media-statusline" aria-label="Media engine status">
            <span>
              <span className={`media-dot ${engineOk ? "ok" : "warn"}`} /> {engineLabel}
            </span>
            <span>
              <span className={`media-dot ${debridConfig ? "ok" : "warn"}`} /> debrid:{" "}
              {debridConfig ? debridConfig.provider : "off (optional)"}
            </span>
          </div>
        </div>

        {selected ? (
          <div className="media-board-rows">
            <StreamsPanel
              meta={selected}
              streams={streams}
              loading={streamsLoading}
              error={streamsError}
              onClose={clearSelection}
            />
          </div>
        ) : null}
      </main>
    </MediaShell>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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
          <MediaIcon name="close" size={14} />
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
            <StreamRow
              key={`${ranked.label}-${index}`}
              ranked={ranked}
              metaId={meta.id}
            />
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

function StreamRow({ ranked, metaId }: { ranked: RankedStream; metaId: string }) {
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
      {resolving ? (
        <span className="media-stream-engine" aria-live="polite">
          {engine?.speed ? `↓ ${engine.speed.toFixed(1)} MB/s` : "↓ …"}
          {engine?.peers ? ` · ${engine.peers} peers` : ""}
        </span>
      ) : null}
      <span className="media-stream-actions">
        {direct ? (
          <>
            <button
              type="button"
              className="media-play"
              onClick={() => openPlayer(ranked.stream.url as string, ranked.label, metaId)}
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
            onClick={() => void streamTorrent(hash, ranked.label, metaId)}
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

/** Re-exported so the board's addon chips and the manifest agree on the source. */
export const MEDIA_SOURCES = { metadata: CINEMETA_ADDON_URL, streams: DEFAULT_STREAM_ADDON_URL };
