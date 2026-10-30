import { create } from "zustand";
import {
  createThemeIdentity,
  normalizeIconPack,
  normalizeThemeDesign,
  type IconPack,
  type ThemeDesign,
} from "../lib/appearance/model";
import { duplicateThemeDesign } from "../lib/appearance/presets";
import {
  DEFAULT_ICON_PACK_ID,
  mergeIconPacks,
  iconPackForId,
} from "../lib/appearance/iconPacks";
import {
  clearDraft as clearStoredDraft,
  loadAppearanceLibrary,
  loadDraft,
  saveAppearanceLibrary,
  saveDraft as saveStoredDraft,
  type ThemeDraft,
} from "../lib/appearance/storage";

interface AppearanceState {
  themes: ThemeDesign[];
  activeThemeId: string | null;
  iconPacks: IconPack[];
  activeIconPackId: string;
  draft: ThemeDraft | null;

  saveTheme: (design: ThemeDesign) => ThemeDesign | null;
  deleteTheme: (id: string) => void;
  duplicateTheme: (id: string) => ThemeDesign | null;
  renameTheme: (id: string, name: string) => void;
  setActiveTheme: (id: string | null) => void;
  importTheme: (design: ThemeDesign) => ThemeDesign | null;

  setActiveIconPack: (id: string) => void;
  importIconPack: (pack: IconPack) => IconPack | null;

  storeDraft: (draft: ThemeDraft) => void;
  discardDraft: () => void;
}

const initial = loadAppearanceLibrary();
const initialDraft = loadDraft();

function persist(state: Pick<AppearanceState, "themes" | "activeThemeId" | "iconPacks" | "activeIconPackId">): void {
  saveAppearanceLibrary({
    version: 1,
    themes: state.themes,
    activeThemeId: state.activeThemeId,
    customIconPacks: state.iconPacks.filter((pack) => !pack.builtIn),
    activeIconPackId: state.activeIconPackId,
  });
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  themes: initial.themes,
  activeThemeId: initial.activeThemeId,
  iconPacks: mergeIconPacks(initial.customIconPacks),
  activeIconPackId: initial.activeIconPackId,
  draft: initialDraft,

  saveTheme(design) {
    const normalized = normalizeThemeDesign(design);
    if (!normalized) return null;
    const existing = get().themes.find((theme) => theme.id === normalized.id);
    const themes = existing
      ? get().themes.map((theme) => (theme.id === normalized.id ? normalized : theme))
      : [...get().themes, normalized];
    const next = {
      themes,
      activeThemeId: normalized.id,
      iconPacks: get().iconPacks,
      activeIconPackId: get().activeIconPackId,
    };
    set({ themes, activeThemeId: normalized.id });
    persist(next);
    return normalized;
  },

  deleteTheme(id) {
    const themes = get().themes.filter((theme) => theme.id !== id);
    const activeThemeId = get().activeThemeId === id ? null : get().activeThemeId;
    const next = {
      themes,
      activeThemeId,
      iconPacks: get().iconPacks,
      activeIconPackId: get().activeIconPackId,
    };
    set({ themes, activeThemeId });
    persist(next);
  },

  duplicateTheme(id) {
    const source = get().themes.find((theme) => theme.id === id);
    if (!source) return null;
    const copy = duplicateThemeDesign(source);
    const themes = [...get().themes, copy];
    const next = {
      themes,
      activeThemeId: get().activeThemeId,
      iconPacks: get().iconPacks,
      activeIconPackId: get().activeIconPackId,
    };
    set({ themes });
    persist(next);
    return copy;
  },

  renameTheme(id, name) {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    const themes = get().themes.map((theme) =>
      theme.id === id ? { ...theme, name: clean, updatedAt: new Date().toISOString() } : theme,
    );
    const next = {
      themes,
      activeThemeId: get().activeThemeId,
      iconPacks: get().iconPacks,
      activeIconPackId: get().activeIconPackId,
    };
    set({ themes });
    persist(next);
  },

  setActiveTheme(id) {
    const activeThemeId = id && get().themes.some((theme) => theme.id === id) ? id : null;
    const next = {
      themes: get().themes,
      activeThemeId,
      iconPacks: get().iconPacks,
      activeIconPackId: get().activeIconPackId,
    };
    set({ activeThemeId });
    persist(next);
  },

  importTheme(design) {
    const normalized = normalizeThemeDesign(design);
    if (!normalized) return null;
    const collision = get().themes.some((theme) => theme.id === normalized.id);
    const nextDesign = collision
      ? (() => {
          const identity = createThemeIdentity(`${normalized.name} Imported`, Date.now(), "imp");
          return {
            ...normalized,
            id: identity.id,
            packageId: identity.packageId,
            name: `${normalized.name} (Imported)`,
            updatedAt: new Date().toISOString(),
          };
        })()
      : normalized;
    const themes = [...get().themes, nextDesign];
    const next = {
      themes,
      activeThemeId: nextDesign.id,
      iconPacks: get().iconPacks,
      activeIconPackId: get().activeIconPackId,
    };
    set({ themes, activeThemeId: nextDesign.id });
    persist(next);
    return nextDesign;
  },

  setActiveIconPack(id) {
    const exists = get().iconPacks.some((pack) => pack.id === id);
    const activeIconPackId = exists ? id : DEFAULT_ICON_PACK_ID;
    const next = {
      themes: get().themes,
      activeThemeId: get().activeThemeId,
      iconPacks: get().iconPacks,
      activeIconPackId,
    };
    set({ activeIconPackId });
    persist(next);
  },

  importIconPack(pack) {
    const normalized = normalizeIconPack({ ...pack, builtIn: false });
    if (!normalized) return null;
    const collision = get().iconPacks.some((candidate) => candidate.id === normalized.id);
    const nextPack: IconPack = collision
      ? {
          ...normalized,
          id: `${normalized.id}-import-${Date.now().toString(36).slice(-5)}`,
          name: `${normalized.name} (Imported)`,
        }
      : normalized;
    const iconPacks = [...get().iconPacks, nextPack];
    const next = {
      themes: get().themes,
      activeThemeId: get().activeThemeId,
      iconPacks,
      activeIconPackId: nextPack.id,
    };
    set({ iconPacks, activeIconPackId: nextPack.id });
    persist(next);
    return nextPack;
  },

  storeDraft(draft) {
    set({ draft });
    saveStoredDraft(draft);
  },

  discardDraft() {
    set({ draft: null });
    clearStoredDraft();
  },
}));

export function activeThemeFor(state: AppearanceState): ThemeDesign | null {
  return state.themes.find((theme) => theme.id === state.activeThemeId) ?? null;
}

export function iconPackForTheme(state: AppearanceState, theme: ThemeDesign | null): IconPack {
  const id = theme?.iconPackId ?? state.activeIconPackId;
  return iconPackForId(state.iconPacks, id);
}
