import { useEffect, useMemo, useRef, useState } from "react";
import { api, normalizeError } from "../../lib/api";
import { logDiagnostic } from "../../lib/diagnostics";
import { useExplorerStore } from "../../state/explorerStore";
import { useMediaStore } from "../../state/mediaStore";
import { PlayerOverlay } from "./PlayerOverlay";
import { MediaShell } from "./MediaShell";
import { MediaHero } from "./MediaHero";
import { MediaCarousel } from "./MediaCarousel";
import { allMetas, continueWatching } from "./board";
import { MediaDetail, type DetailAction } from "./MediaDetail";
import { StreamsPanel } from "./StreamsPanel";
import { formatSize } from "./format";
import {
  CINEMETA_ADDON_URL,
  DEFAULT_MEDIA_CATALOGS,
  DEFAULT_STREAM_ADDON_URL,
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
  const streamFilter = useMediaStore((state) => state.streamFilter);
  const setStreamFilter = useMediaStore((state) => state.setStreamFilter);
  const reloadStreams = useMediaStore((state) => state.loadStreams);
  const clearSelection = useMediaStore((state) => state.clearSelection);
  const debridConfig = useMediaStore((state) => state.debridConfig);
  const diagnostics = useMediaStore((state) => state.playerDiagnostics);
  const watchProgress = useMediaStore((state) => state.watchProgress);
  const screen = useMediaStore((state) => state.screen);
  const openPlayer = useMediaStore((state) => state.openPlayer);
  const streamTorrent = useMediaStore((state) => state.streamTorrent);
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

  /**
   * Detail screen primary button. `startSeconds` is the library position when the
   * title is mid-watch, `null` for the start; playback uses the top-ranked
   * stream, exactly like clicking the first row of the streams panel.
   */
  const playSelected = (startSeconds: number | null) => {
    if (!selected) return;
    const top = streams[0];
    if (!top) {
      toast({
        title: "No sources yet",
        detail: streamsLoading
          ? `Still resolving sources for ${selected.name ?? selected.id}…`
          : `No sources were found for ${selected.name ?? selected.id}.`,
        tone: "info",
      });
      return;
    }
    const title = top.facts.release ?? top.label;
    const hash = top.stream.infoHash ?? null;
    const start = startSeconds ?? undefined;
    if (top.direct && top.stream.url) {
      openPlayer(top.stream.url, title, selected.id, top.qualityBadge, start);
      return;
    }
    if (hash) {
      void streamTorrent(hash, title, selected.id, top.qualityBadge, start);
      return;
    }
    toast({
      title: "Nothing to play",
      detail: "The top source has neither a direct URL nor a torrent hash.",
      tone: "error",
    });
  };

  /** Detail-screen action row: nothing here writes yet (library is roadmap WP6). */
  const handleDetailAction = (action: DetailAction) => {
    const roadmap: Record<DetailAction, string> = {
      library: "My Library arrives with the library roadmap item.",
      watched: "Marking titles watched arrives with the library roadmap item.",
      like: "Likes need a profile store — roadmap item 6.",
      heart: "Favourites need a profile store — roadmap item 6.",
      share: "Sharing a title arrives with the library roadmap item.",
    };
    toast({
      title: action === "library" ? "My Library is on the roadmap" : "Not saved yet",
      detail: `${roadmap[action]} Nothing was written for ${selected?.name ?? selected?.id ?? "this title"}.`,
      tone: "info",
    });
  };

  // Player mode is a full-window takeover and the player chrome is transparent
  // over the video: nothing else may stay mounted behind it (the streams panel
  // and the detail screen would show through the picture).
  if (screen === "player") {
    return <PlayerOverlay />;
  }

  // Detail + streams panel (spec §4): the panel is docked at ≥ 1600 px and a
  // slide-over below it — both are the same component, placement is CSS.
  if (selected) {
    return (
      <MediaShell>
        <PlayerOverlay />
        <main className="media-main media-main-detail">
          <MediaDetail meta={selected} onClose={clearSelection} onAction={handleDetailAction} progress={watchProgress[selected.id]} onPlay={playSelected} />
          <StreamsPanel
            meta={selected}
            streams={streams}
            loading={streamsLoading}
            error={streamsError}
            filter={streamFilter}
            onFilterChange={setStreamFilter}
            onClose={clearSelection}
            onRetry={() => void reloadStreams(selected)}
          />
        </main>
      </MediaShell>
    );
  }

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

/** Logged when the workspace hits a problem the user should be able to report. */
export function logMediaDiagnostic(message: string): void {
  logDiagnostic("info", message, "media.workspace");
}

/** Re-exported so the board's addon chips and the manifest agree on the source. */
export const MEDIA_SOURCES = { metadata: CINEMETA_ADDON_URL, streams: DEFAULT_STREAM_ADDON_URL };
