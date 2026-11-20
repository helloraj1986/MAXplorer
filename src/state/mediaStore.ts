import { create } from "zustand";
import { api, normalizeError } from "../lib/api";
import { logDiagnostic } from "../lib/diagnostics";
import {
  CINEMETA_ADDON_URL,
  DEFAULT_MEDIA_CATALOGS,
  DEFAULT_STREAM_ADDON_URL,
  type MediaCatalogMeta,
  type MediaManifest,
  type NativePlayerDiagnostics,
  type NativePlayerStatus,
  type WatchProgress,
} from "../components/media/types";
import { rankStreams } from "../components/media/streams";
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
   * Watch progress keyed by meta id. WP2 stub store: the positions are real
   * (they come from mpv through `playerStatus`) but they live in memory only —
   * WP5 writes them to `library.json` and resumes from them.
   */
  watchProgress: Record<string, WatchProgress>;
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
  playerSource: { url: string; title: string; metaId?: string } | null;
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
  /** Records a playback position (WP2 stub store; WP5 persists it). */
  recordProgress: (metaId: string, position: number, duration: number) => void;
  closeWorkspace: () => void;
  loadManifest: () => Promise<void>;
  loadCatalog: (type: string, id: string, name: string) => Promise<void>;
  selectMeta: (meta: MediaCatalogMeta) => void;
  clearSelection: () => void;
  loadStreams: (meta: MediaCatalogMeta) => Promise<void>;
  openPlayer: (url: string, title: string, metaId?: string) => void;
  closePlayer: () => void;
  setPlayerStatus: (status: NativePlayerStatus | null) => void;
  loadPlayerDiagnostics: () => Promise<void>;
  streamTorrent: (infoHash: string, title: string, metaId?: string) => Promise<void>;
  refreshEngineStats: () => Promise<void>;
  loadDebridConfig: () => Promise<void>;
  saveDebridConfig: (config: { provider: "realdebrid" | "torbox"; apiKey: string }) => Promise<void>;
  clearDebridConfig: () => Promise<void>;
}

const CATALOG_LIMIT = 12;

function trimMetas(metas: MediaCatalogMeta[]): MediaCatalogMeta[] {
  return metas.slice(0, CATALOG_LIMIT);
}

export const useMediaStore = create<MediaState>((set, get) => ({
  workspaceOpen: false,
  screen: "board",
  searchQuery: "",
  watchProgress: {},
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
   * Stores a playback position. Nothing is written for a zero-length or
   * nonsense position: a half-open stream must not create a Continue-watching
   * entry that can never be resumed.
   */
  recordProgress(metaId, position, duration) {
    if (!metaId || !(duration > 0) || !(position > 0) || !Number.isFinite(position)) return;
    set((state) => ({
      watchProgress: {
        ...state.watchProgress,
        [metaId]: {
          position: Math.min(position, duration),
          duration,
          updatedAt: Date.now(),
          season: state.watchProgress[metaId]?.season,
          episode: state.watchProgress[metaId]?.episode,
        },
      },
    }));
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

  openPlayer(url, title, metaId) {
    set({ playerSource: { url, title, metaId }, playerStatus: null, screen: "player" });
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

  async streamTorrent(infoHash, title, metaId) {
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
            playerSource: { url: status.streamUrl, title: label, metaId },
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