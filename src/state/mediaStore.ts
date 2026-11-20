import { create } from "zustand";
import { api, normalizeError } from "../lib/api";
import {
  CINEMETA_ADDON_URL,
  DEFAULT_MEDIA_CATALOGS,
  type MediaCatalogMeta,
  type MediaManifest,
} from "../components/media/types";

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

  openWorkspace: () => Promise<void>;
  closeWorkspace: () => void;
  loadManifest: () => Promise<void>;
  loadCatalog: (type: string, id: string, name: string) => Promise<void>;
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
}));
