import { create } from "zustand";
import { api, normalizeError } from "../lib/api";
import {
  CINEMETA_ADDON_URL,
  DEFAULT_MEDIA_CATALOGS,
  DEFAULT_STREAM_ADDON_URL,
  type MediaCatalogMeta,
  type MediaManifest,
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
  /** Phase 3: in-app player source. */
  playerSource: { url: string; title: string } | null;

  openWorkspace: () => Promise<void>;
  closeWorkspace: () => void;
  loadManifest: () => Promise<void>;
  loadCatalog: (type: string, id: string, name: string) => Promise<void>;
  selectMeta: (meta: MediaCatalogMeta) => void;
  clearSelection: () => void;
  loadStreams: (meta: MediaCatalogMeta) => Promise<void>;
  openPlayer: (url: string, title: string) => void;
  closePlayer: () => void;
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

  async openWorkspace() {
    set({ workspaceOpen: true });
    if (!get().manifest && !get().manifestLoading) {
      await get().loadManifest();
    }
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
    set({ selected: null, streams: [], streamsLoading: false, streamsError: null });
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
    set({ playerSource: { url, title } });
  },

  closePlayer() {
    set({ playerSource: null });
  },
}));
