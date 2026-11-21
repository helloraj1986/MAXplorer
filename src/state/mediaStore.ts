import { create } from "zustand";
import { api, normalizeError } from "../lib/api";
import { logDiagnostic } from "../lib/diagnostics";
import {
  CINEMETA_ADDON_URL,
  DEFAULT_MEDIA_CATALOGS,
  DEFAULT_STREAM_ADDON_URL,
  type LibraryEntry,
  type MediaCatalogMeta,
  type MediaManifest,
  type NativePlayerDiagnostics,
  type NativePlayerStatus,
  type NativePlayerTick,
  type WatchProgress,
} from "../components/media/types";
import { rankStreams } from "../components/media/streams";
import { CONTINUE_MAX_RATIO, CONTINUE_MIN_RATIO } from "../components/media/board";
import type { RankedStream, StreamFilter } from "../components/media/types";

export interface MediaCatalogState {
  type: string;
  id: string;
  name: string;
  metas: MediaCatalogMeta[];
  loading: boolean;
  error: string | null;
}

/** Which media screen the shell is showing (docs/MEDIA_UI_SPEC.md §6). */
export type MediaScreen = "board" | "detail" | "player";

export interface MediaState {
  workspaceOpen: boolean;
  screen: MediaScreen;
  /** Top-bar search text. WP2 wires it to the loaded catalogs (spec §12.5). */
  searchQuery: string;
  /**
   * Watch progress keyed by meta id. Hydrated from `library.json` when the
   * workspace opens (Phase 1) and written back through `media_library_record`;
   * the in-memory copy is the optimistic view between writes.
   */
  watchProgress: Record<string, WatchProgress>;
  /** True once `media_library_get` has answered (or failed) this session. */
  libraryReady: boolean;
  manifest: MediaManifest | null;
  manifestLoading: boolean;
  manifestError: string | null;
  catalogs: MediaCatalogState[];
  connected: boolean;
  /** Phase 2: stream resolution for the selected item. */
  selected: MediaCatalogMeta | null;
  streams: RankedStream[];
  streamsLoading: boolean;
  streamsError: string | null;
  /** Streams-panel filter (spec §4.3) — client-side, never a refetch. */
  streamFilter: StreamFilter;
  /** Phase 3/4c: in-app player source (native libmpv surface). */
  playerSource: {
    url: string;
    title: string;
    metaId?: string;
    /** Poster for the audio-only stage art (WP4a). */
    poster?: string | null;
    /** Stream quality badge (`4K`, `1080p`) for the player's codec chip. */
    quality?: string | null;
    /** Resume position: seek on FILE_LOADED, reveal the surface after the seek. */
    startSeconds?: number | null;
  } | null;
  /** Live state reported by the libmpv engine. */
  playerStatus: NativePlayerStatus | null;
  /** Whether the native engine is usable on this machine. */
  playerDiagnostics: NativePlayerDiagnostics | null;
  /** Phase 4b: torrent engine flow for the selected torrent stream. */
  engine: {
    infoHash: string;
    baseUrl: string;
    phase: "resolving" | "ready" | "error";
    error?: string;
    progress?: number;
    /** Connected peers. */
    peers?: number;
    /** Peers discovered in the swarm. */
    peersSeen?: number;
    /** MB/s from the torrent engine. */
    speed?: number;
    /** librqbit state: initializing | live | paused | error */
    state?: string;
  } | null;
  /** Phase 4 (debrid): debrid configuration. */
  debridConfig: { provider: "realdebrid" | "torbox"; apiKey: string } | null;

  openWorkspace: () => Promise<void>;
  setScreen: (screen: MediaScreen) => void;
  setSearchQuery: (query: string) => void;
  setStreamFilter: (filter: StreamFilter) => void;
  recordProgress: (metaId: string, position: number, duration: number) => void;
  /** Hydrates `watchProgress` from `library.json` (Phase 1). */
  loadLibrary: () => Promise<void>;
  closeWorkspace: () => void;
  loadManifest: () => Promise<void>;
  loadCatalog: (type: string, id: string, name: string) => Promise<void>;
  selectMeta: (meta: MediaCatalogMeta) => void;
  clearSelection: () => void;
  loadStreams: (meta: MediaCatalogMeta) => Promise<void>;
  openPlayer: (
    url: string,
    title: string,
    metaId?: string,
    quality?: string | null,
    startSeconds?: number,
  ) => void;
  closePlayer: () => void;
  setPlayerStatus: (status: NativePlayerStatus | null) => void;
  /** Merge the coalesced 250 ms metrics tick into the current status. */
  patchPlayerStatus: (tick: NativePlayerTick) => void;
  loadPlayerDiagnostics: () => Promise<void>;
  streamTorrent: (
    infoHash: string,
    title: string,
    metaId?: string,
    quality?: string | null,
    startSeconds?: number,
  ) => Promise<void>;
  refreshEngineStats: () => Promise<void>;
  loadDebridConfig: () => Promise<void>;
  saveDebridConfig: (config: { provider: "realdebrid" | "torbox"; apiKey: string }) => Promise<void>;
  clearDebridConfig: () => Promise<void>;
}

const CATALOG_LIMIT = 12;

/**
 * The catalog meta for a progress key, so `recordProgress` can store the
 * type/name/poster the Continue-watching card needs without a catalog fetch.
 * Falls back to whatever the store already knows for that id.
 */
function progressMeta(metaId: string, get: () => MediaState): MediaCatalogMeta | null {
  const state = get();
  if (state.selected?.id === metaId) return state.selected;
  for (const catalog of state.catalogs) {
    const hit = catalog.metas.find((meta) => meta.id === metaId);
    if (hit) return hit;
  }
  const known = state.watchProgress[metaId];
  if (known?.name || known?.poster || known?.type) {
    return { id: metaId, name: known.name, poster: known.poster, type: known.type };
  }
  return null;
}

/** `library.json` stores RFC-3339; the board sorts on epoch millis. */
function parseUpdatedAt(raw: LibraryEntry["updatedAt"]): number {
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function trimMetas(metas: MediaCatalogMeta[]): MediaCatalogMeta[] {
  return metas.slice(0, CATALOG_LIMIT);
}

export const useMediaStore = create<MediaState>((set, get) => ({
  workspaceOpen: false,
  screen: "board",
  searchQuery: "",
  watchProgress: {},
  libraryReady: false,
  manifest: null,
  manifestLoading: false,
  manifestError: null,
  catalogs: [],
  connected: false,
  selected: null,
  streams: [],
  streamsLoading: false,
  streamsError: null,
  streamFilter: "all",
  playerSource: null,
  playerStatus: null,
  playerDiagnostics: null,
  debridConfig: null,
  engine: null,

  async openWorkspace() {
    set({ workspaceOpen: true });
    if (!get().manifest && !get().manifestLoading) {
      await get().loadManifest();
    }
    void get().loadLibrary();
    void get().loadDebridConfig();
    void get().loadPlayerDiagnostics();
  },

  closeWorkspace() {
    set({ workspaceOpen: false, screen: "board" });
  },

  setScreen(screen) {
    set({ screen });
  },

  setSearchQuery(query) {
    set({ searchQuery: query });
  },

  setStreamFilter(filter) {
    set({ streamFilter: filter });
  },

  /**
   * Stores a playback position. Phase 1: optimistic local update plus a write
   * through `media_library_record`; the backend copy is the truth on the next
   * workspace open.
   *
   * Nothing is written for a zero-length or nonsense position, and a position
   * outside the 2 %–95 % window never creates an entry — it removes one that is
   * already there (a finished title leaves the Continue-watching row).
   */
  recordProgress(metaId, position, duration) {
    if (!metaId || !(duration > 0) || !(position > 0) || !Number.isFinite(position)) return;
    const clamped = Math.min(position, duration);
    const ratio = clamped / duration;
    const key = metaId;
    if (!(ratio > CONTINUE_MIN_RATIO && ratio < CONTINUE_MAX_RATIO)) {
      if (get().watchProgress[key]) {
        set((state) => {
          const next = { ...state.watchProgress };
          delete next[key];
          return { watchProgress: next };
        });
        void api.libraryRemove(key).catch((error) => {
          logDiagnostic(
            "warn",
            `removing finished library entry ${key} failed: ${normalizeError(error).message}`,
            "media.library",
          );
        });
      }
      return;
    }

    const meta = progressMeta(key, get);
    const existing = get().watchProgress[key];
    set((state) => ({
      watchProgress: {
        ...state.watchProgress,
        [key]: {
          position: clamped,
          duration,
          updatedAt: Date.now(),
          season: existing?.season,
          episode: existing?.episode,
          type: meta?.type ?? existing?.type,
          name: meta?.name ?? existing?.name,
          poster: meta?.poster ?? existing?.poster,
        },
      },
    }));

    void api
      .libraryRecord({
        metaId: key,
        positionSec: clamped,
        durationSec: duration,
        type: meta?.type ?? existing?.type ?? null,
        name: meta?.name ?? existing?.name ?? null,
        poster: meta?.poster ?? existing?.poster ?? null,
        season: existing?.season ?? null,
        episode: existing?.episode ?? null,
      })
      .catch((error) => {
        logDiagnostic(
          "warn",
          `library record for ${key} failed: ${normalizeError(error).message}`,
          "media.library",
        );
      });
  },

  /**
   * Hydrates watch progress from `library.json`. Episode keys
   * (`tt<id>:<season>:<episode>`) aggregate onto the show id — the board card is
   * one per show and the most recent episode wins, while each episode keeps its
   * own position in the file.
   */
  async loadLibrary() {
    try {
      const snapshot = await api.libraryGet();
      const progress: Record<string, WatchProgress> = {};
      for (const [key, entry] of Object.entries(snapshot.entries ?? {})) {
        const showId = key.split(":")[0];
        const updatedAt = parseUpdatedAt(entry.updatedAt);
        const existing = progress[showId];
        if (existing && existing.updatedAt > updatedAt) continue;
        progress[showId] = {
          position: entry.positionSec,
          duration: entry.durationSec,
          updatedAt,
          season: entry.season ?? undefined,
          episode: entry.episode ?? undefined,
          type: entry.type ?? undefined,
          name: entry.name ?? undefined,
          poster: entry.poster ?? undefined,
        };
      }
      set({ watchProgress: progress, libraryReady: true });
      logDiagnostic(
        "info",
        `library hydrated: ${Object.keys(snapshot.entries ?? {}).length} entries (version ${snapshot.version})`,
        "media.library",
      );
    } catch (error) {
      set({ libraryReady: true });
      logDiagnostic(
        "warn",
        `library could not be read: ${normalizeError(error).message}`,
        "media.library",
      );
    }
  },

  async loadManifest() {
    set({ manifestLoading: true, manifestError: null });
    try {
      const manifest = await api.getAddonManifest(CINEMETA_ADDON_URL);
      set({ manifest, manifestLoading: false, connected: true });
      // Load the default discover rows once the addon is known to respond.
      for (const catalog of DEFAULT_MEDIA_CATALOGS) {
        void get().loadCatalog(catalog.type, catalog.id, catalog.name);
      }
    } catch (error) {
      set({
        manifestLoading: false,
        manifestError: normalizeError(error).message,
        connected: false,
      });
    }
  },

  async loadCatalog(type, id, name) {
    const existing = get().catalogs.find((item) => item.id === id && item.type === type);
    if (existing?.loading) return;
    set((state) => ({
      catalogs: [
        ...state.catalogs.filter((item) => !(item.id === id && item.type === type)),
        { type, id, name, metas: existing?.metas ?? [], loading: true, error: null },
      ],
    }));
    try {
      const response = await api.getMediaCatalog(CINEMETA_ADDON_URL, type, id);
      const metas = trimMetas(response.metas);
      set((state) => ({
        catalogs: state.catalogs.map((item) =>
          item.type === type && item.id === id ? { ...item, metas, loading: false, error: null } : item,
        ),
      }));
    } catch (error) {
      set((state) => ({
        catalogs: state.catalogs.map((item) =>
          item.type === type && item.id === id
            ? { ...item, loading: false, error: normalizeError(error).message }
            : item,
        ),
      }));
    }
  },

  selectMeta(meta) {
    // A different title starts from the unfiltered list.
    set({ selected: meta, screen: "detail", streamFilter: "all" });
    void get().loadStreams(meta);
  },

  clearSelection() {
    set({
      selected: null,
      streams: [],
      streamsLoading: false,
      streamsError: null,
      streamFilter: "all",
      engine: null,
      screen: "board",
    });
  },

  async loadStreams(meta) {
    set({ streamsLoading: true, streamsError: null, streams: [] });
    try {
      const response = await api.getMediaStreams(
        DEFAULT_STREAM_ADDON_URL,
        meta.type ?? "movie",
        meta.id,
      );
      set({ streams: rankStreams(response.streams), streamsLoading: false });
    } catch (error) {
      set({ streamsLoading: false, streamsError: normalizeError(error).message });
    }
  },

  openPlayer(url, title, metaId, quality, startSeconds) {
    set({
      playerSource: {
        url,
        title,
        metaId,
        // Poster rides along so the stage can show title art for an audio-only
        // source, where no native frame ever appears (spec §5.3).
        poster: get().selected?.poster ?? null,
        quality: quality ?? null,
        // Resume: the backend seeks on FILE_LOADED and only reveals the native
        // surface once the resumed frame is presented.
        startSeconds: startSeconds && startSeconds > 0.5 ? startSeconds : null,
      },
      playerStatus: null,
      screen: "player",
    });
  },

  closePlayer() {
    // Back to whichever screen launched playback: the detail view when a title
    // is still selected, otherwise the board.
    set({ playerSource: null, playerStatus: null, screen: get().selected ? "detail" : "board" });
    void api.playerClose().catch((error) => {
      logDiagnostic("warn", `closing the player failed: ${String(error)}`, "media.player");
    });
  },

  setPlayerStatus(status) {
    set({ playerStatus: status });
  },

  // 250 ms tick from the backend: merge the volatile metrics so the seek bar,
  // buffered span and speed/buffer pills advance without the engine having to
  // serialise (and the overlay re-render) the entire status at frame rate.
  patchPlayerStatus(tick) {
    const current = get().playerStatus;
    if (!current) return;
    set({
      playerStatus: {
        ...current,
        position: tick.position,
        duration: tick.duration > 0 ? tick.duration : current.duration,
        cachePercent: tick.cachePercent,
        cacheSeconds: tick.cacheSeconds,
        cacheSpeed: tick.cacheSpeed,
        pausedForCache: tick.pausedForCache,
      },
    });
  },

  async loadPlayerDiagnostics() {
    try {
      const diagnostics = await api.playerDiagnostics();
      set({ playerDiagnostics: diagnostics });
      logDiagnostic(
        diagnostics.available && diagnostics.embeddingSupported ? "info" : "warn",
        `native player: libmpv=${diagnostics.apiVersion ?? "none"} embedding=${diagnostics.embeddingSupported} — ${diagnostics.detail}`,
        "media.player",
      );
    } catch (error) {
      logDiagnostic("warn", `player diagnostics failed: ${String(error)}`, "media.player");
      set({ playerDiagnostics: null });
    }
  },

  async streamTorrent(infoHash, title, metaId, quality, startSeconds) {
    set({ engine: { infoHash, baseUrl: "", phase: "resolving" } });
    let baseUrl = "";
    try {
      const started = await api.startTorrent(infoHash);
      baseUrl = started.baseUrl;
    } catch (error) {
      set({ engine: { infoHash, baseUrl: "", phase: "error", error: normalizeError(error).message } });
      return;
    }
    // Poll until metadata resolves (DHT peer discovery can take a while).
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      try {
        const status = await api.torrentStatus(infoHash, baseUrl);
        set({
          engine: {
            infoHash,
            baseUrl,
            phase: "resolving",
            progress: status.progress,
            peers: status.peers,
            peersSeen: status.peersSeen,
            speed: status.downloadSpeed,
            state: status.state,
          },
        });
        // `streamUrl` is null until the torrent is live/paused: librqbit answers
        // HTTP 500 while it initializes, which used to show up as a blank player.
        if (status.streamable && status.streamUrl) {
          const label = status.name ?? title;
          set({
            engine: {
              infoHash,
              baseUrl,
              phase: "ready",
              progress: status.progress,
              peers: status.peers,
              peersSeen: status.peersSeen,
              speed: status.downloadSpeed,
              state: status.state,
            },
            playerSource: {
              url: status.streamUrl,
              title: label,
              metaId,
              poster: get().selected?.poster ?? null,
              quality: quality ?? null,
              startSeconds: startSeconds && startSeconds > 0.5 ? startSeconds : null,
            },
            // Torrent playback must enter the player screen too, otherwise the
            // media rail + top bar stay in the layout: the native surface is
            // positioned from the stage rect, so the video opens inset by the
            // 72 px rail and the app never goes immersive.
            screen: "player",
          });
          return;
        }
      } catch (error) {
        set({ engine: { infoHash, baseUrl, phase: "error", error: normalizeError(error).message } });
        return;
      }
    }
    set({
      engine: {
        infoHash,
        baseUrl,
        phase: "error",
        error: "No peers responded in time. The swarm may be slow — try again or use a debrid source.",
      },
    });
  },

  /** One poll of the active torrent's swarm stats (used by the player chrome). */
  async refreshEngineStats() {
    const engine = get().engine;
    if (!engine || !engine.baseUrl || engine.phase !== "ready") return;
    try {
      const status = await api.torrentStatus(engine.infoHash, engine.baseUrl, false);
      set({
        engine: {
          ...engine,
          progress: status.progress,
          peers: status.peers,
          peersSeen: status.peersSeen,
          speed: status.downloadSpeed,
          state: status.state,
        },
      });
    } catch {
      // Stats are best-effort; playback does not depend on them.
    }
  },

  async loadDebridConfig() {
    try {
      const config = await api.debridGetConfig();
      set({ debridConfig: config });
    } catch {
      set({ debridConfig: null });
    }
  },

  async saveDebridConfig(config) {
    await api.debridSaveConfig(config);
    set({ debridConfig: config });
  },

  async clearDebridConfig() {
    set({ debridConfig: null });
  },
}));