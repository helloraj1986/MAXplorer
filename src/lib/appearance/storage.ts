import {
  normalizeIconPack,
  normalizeThemeDesign,
  type IconPack,
  type ThemeCreatorMode,
  type ThemeDesign,
} from "./model";
import { DEFAULT_ICON_PACK_ID, mergeIconPacks } from "./iconPacks";

export const APPEARANCE_STORAGE_KEY = "maxplorer-appearance-v1";
export const APPEARANCE_DRAFT_KEY = "maxplorer-theme-draft-v1";

export interface StoredAppearanceLibrary {
  version: 1;
  themes: ThemeDesign[];
  activeThemeId: string | null;
  customIconPacks: IconPack[];
  activeIconPackId: string;
}

export interface ThemeDraft {
  version: 1;
  design: ThemeDesign;
  step: number;
  mode: ThemeCreatorMode;
  savedAt: number;
}

export const EMPTY_LIBRARY: StoredAppearanceLibrary = {
  version: 1,
  themes: [],
  activeThemeId: null,
  customIconPacks: [],
  activeIconPackId: DEFAULT_ICON_PACK_ID,
};

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota). The in-memory library
    // still works for the current session.
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

export function parseAppearanceLibrary(raw: string | null): StoredAppearanceLibrary {
  if (!raw) return { ...EMPTY_LIBRARY };
  try {
    const value = JSON.parse(raw) as Partial<StoredAppearanceLibrary> | null;
    if (!value || typeof value !== "object" || value.version !== 1) {
      return { ...EMPTY_LIBRARY };
    }
    const themes: ThemeDesign[] = [];
    const ids = new Set<string>();
    for (const candidate of Array.isArray(value.themes) ? value.themes.slice(0, 200) : []) {
      const theme = normalizeThemeDesign(candidate);
      if (!theme || ids.has(theme.id)) continue;
      themes.push(theme);
      ids.add(theme.id);
    }
    const customIconPacks: IconPack[] = [];
    const packIds = new Set(mergeIconPacks([]).map((pack) => pack.id));
    for (const candidate of Array.isArray(value.customIconPacks) ? value.customIconPacks.slice(0, 100) : []) {
      const pack = normalizeIconPack(candidate);
      if (!pack || packIds.has(pack.id)) continue;
      customIconPacks.push(pack);
      packIds.add(pack.id);
    }
    const activeThemeId =
      typeof value.activeThemeId === "string" && ids.has(value.activeThemeId)
        ? value.activeThemeId
        : null;
    const packIdsWithBuiltins = new Set(mergeIconPacks(customIconPacks).map((pack) => pack.id));
    const activeIconPackId =
      typeof value.activeIconPackId === "string" && packIdsWithBuiltins.has(value.activeIconPackId)
        ? value.activeIconPackId
        : DEFAULT_ICON_PACK_ID;
    return {
      version: 1,
      themes,
      activeThemeId,
      customIconPacks,
      activeIconPackId,
    };
  } catch {
    return { ...EMPTY_LIBRARY };
  }
}

export function loadAppearanceLibrary(): StoredAppearanceLibrary {
  return parseAppearanceLibrary(read(APPEARANCE_STORAGE_KEY));
}

export function saveAppearanceLibrary(library: StoredAppearanceLibrary): void {
  write(
    APPEARANCE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      themes: library.themes,
      activeThemeId: library.activeThemeId,
      customIconPacks: library.customIconPacks,
      activeIconPackId: library.activeIconPackId,
    }),
  );
}

export function parseDraft(raw: string | null): ThemeDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ThemeDraft> | null;
    if (!value || typeof value !== "object" || value.version !== 1) return null;
    const design = normalizeThemeDesign(value.design);
    if (!design) return null;
    const step = typeof value.step === "number" ? Math.min(6, Math.max(1, Math.round(value.step))) : 1;
    return {
      version: 1,
      design,
      step,
      mode: value.mode === "advanced" ? "advanced" : "simple",
      savedAt: typeof value.savedAt === "number" ? value.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function loadDraft(): ThemeDraft | null {
  return parseDraft(read(APPEARANCE_DRAFT_KEY));
}

export function saveDraft(draft: ThemeDraft): void {
  write(APPEARANCE_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
}

export function clearDraft(): void {
  remove(APPEARANCE_DRAFT_KEY);
}
