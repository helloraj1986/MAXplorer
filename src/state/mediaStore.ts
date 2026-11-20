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
} from "../components/media/types";
import { rankStreams } from "../components/media/streams";
import type { RankedStream } from "../components/media/types";

export interface MediaCatalogState {
  type: string;
  id: string;
  name: string;
  metas: MediaCatalogMeta[];
  loading: boolean;
  error: string | null;
}

export interface MediaState {
  workspaceOpen: boolean;
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
  /** Phase 3/4c: in-app player source (native libmpv surface). */
  playerSource: { url: string; title: string } | null;
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
    peers?: number;
  } | null;
  /** Phase 4 (debrid): debrid configuration. */
  debridConfig: { provider: "realdebrid" | "torbox"; apiKey: string } | null;

  openWorkspace: () => Promise<void>;
  closeWorkspace: () => void;
  loadManifest: () => Promise<void>;
  loadCatalog: (type: string, id: string, name: string) => Promise<void>;
  selectMeta: (meta: MediaCatalogMeta) => void;
  clearSelection: () => void;
  loadStreams: (meta: MediaCatalogMeta) => Promise<void>;
  openPlayer: (url: string, title: string) => void;
  closePlayer: () => void;
  setPlayerStatus: (status: NativePlayerStatus | null) => void;
  loadPlayerDiagnostics: () => Promise<void>;
  streamTorrent: (infoHash: string, title: string) => Promise<void>;
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
  manifest: null,
  manifestLoading: false,
  manifestError: null,
  catalogs: [],
  connected: false,
  selected: null,
  streams: [],
  streamsLoading: false,
  streamsError: null,
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
    set({ workspaceOpen: false });
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
    set({ selected: meta });
    void get().loadStreams(meta);
  },

  clearSelection() {
    set({ selected: null, streams: [], streamsLoading: false, streamsError: null, engine: null });
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

  openPlayer(url, title) {
    set({ playerSource: { url, title }, playerStatus: null });
  },

  closePlayer() {
    set({ playerSource: null, playerStatus: null });
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

  async streamTorrent(infoHash, title) {
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
        set({ engine: { infoHash, baseUrl, phase: "resolving", progress: status.progress, peers: status.peers } });
        if (status.streamUrl) {
          const label = status.name ?? title;
          set({
            engine: { infoHash, baseUrl, phase: "ready", progress: status.progress, peers: status.peers },
            playerSource: { url: status.streamUrl, title: label },
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