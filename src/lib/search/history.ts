import {
  DEFAULT_SEARCH_FILTERS,
  DEFAULT_SEARCH_SETTINGS,
  type SavedSearch,
  type SearchFilters,
  type SearchHistoryEntry,
  type SearchKind,
  type SearchScopeId,
  type SearchSettings,
} from "./types";

export const SEARCH_HISTORY_KEY = "maxplorer.search.history.v1";
export const SEARCH_SAVED_KEY = "maxplorer.search.saved.v1";
export const SEARCH_SETTINGS_KEY = "maxplorer.search.settings.v1";

const SCOPES = new Set<SearchScopeId>([
  "current",
  "currentRecursive",
  "home",
  "selected",
  "indexed",
  "external",
  "custom",
]);

const KINDS = new Set<SearchKind>([
  "folder",
  "document",
  "pdf",
  "image",
  "video",
  "audio",
  "archive",
  "code",
  "app",
  "sheet",
  "slides",
  "text",
  "font",
  "executable",
  "file",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dateRange(value: unknown) {
  if (!isRecord(value)) return null;
  const after = numberOrNull(value.after);
  const before = numberOrNull(value.before);
  if (after == null && before == null) return null;
  return {
    after,
    before,
    label: typeof value.label === "string" ? value.label : undefined,
  };
}

/** Tolerant parser for filters saved by older builds or partially corrupted data. */
export function parseSearchFilters(value: unknown): SearchFilters {
  if (!isRecord(value)) return { ...DEFAULT_SEARCH_FILTERS };
  const kinds = stringArray(value.kinds).filter((kind): kind is SearchKind => KINDS.has(kind as SearchKind));
  return {
    ...DEFAULT_SEARCH_FILTERS,
    kinds,
    extensions: stringArray(value.extensions).map((extension) => extension.replace(/^\./, "").toLowerCase()),
    minSize: numberOrNull(value.minSize),
    maxSize: numberOrNull(value.maxSize),
    modified: dateRange(value.modified),
    created: dateRange(value.created),
    accessed: dateRange(value.accessed),
    contentMode:
      value.contentMode === "name" || value.contentMode === "content" || value.contentMode === "both"
        ? value.contentMode
        : "both",
    matchMode:
      value.matchMode === "any" || value.matchMode === "phrase" || value.matchMode === "all"
        ? value.matchMode
        : "all",
    caseSensitive: value.caseSensitive === true,
    includeHidden: value.includeHidden === true,
    noExtension: value.noExtension === true,
    emptyFolders: value.emptyFolders === true,
    duplicatesOnly: value.duplicatesOnly === true,
    locations: stringArray(value.locations),
  };
}

export function parseHistory(raw: string | null): SearchHistoryEntry[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is SearchHistoryEntry =>
          isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.query === "string" &&
          typeof item.at === "number" &&
          SCOPES.has(item.scope as SearchScopeId),
      )
      .map((item) => ({
        ...item,
        filters: item.filters ? parseSearchFilters(item.filters) : undefined,
      }))
      .slice(0, 200);
  } catch {
    return [];
  }
}

export function serializeHistory(entries: SearchHistoryEntry[]): string {
  return JSON.stringify(entries.slice(0, 200));
}

export function addHistory(
  entries: SearchHistoryEntry[],
  entry: SearchHistoryEntry,
  settings: SearchSettings,
  now = Date.now(),
): SearchHistoryEntry[] {
  if (!settings.historyEnabled) return [];
  const query = entry.query.trim();
  if (!query) return entries;
  const next = [
    { ...entry, query },
    ...entries.filter((item) => item.query.toLowerCase() !== query.toLowerCase()),
  ].slice(0, Math.max(1, settings.maxHistory));
  return pruneHistory(next, settings, now);
}

export function pruneHistory(
  entries: SearchHistoryEntry[],
  settings: SearchSettings,
  now = Date.now(),
): SearchHistoryEntry[] {
  const cutoff = now - Math.max(1, settings.retentionDays) * 24 * 60 * 60 * 1000;
  return entries
    .filter((entry) => entry.at >= cutoff)
    .slice(0, Math.max(1, settings.maxHistory));
}

export function parseSavedSearches(raw: string | null): SavedSearch[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is SavedSearch =>
          isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.query === "string" &&
          typeof item.createdAt === "number" &&
          typeof item.updatedAt === "number",
      )
      .map((item) => ({
        ...item,
        filters: parseSearchFilters(item.filters),
        scope: SCOPES.has(item.scope) ? item.scope : "indexed",
        customRoots: stringArray(item.customRoots),
        pinned: item.pinned === true,
      }))
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function serializeSavedSearches(searches: SavedSearch[]): string {
  return JSON.stringify(searches.slice(0, 100));
}

export function addSavedSearch(
  searches: SavedSearch[],
  search: SavedSearch,
): SavedSearch[] {
  return [search, ...searches.filter((item) => item.id !== search.id)].slice(0, 100);
}

export function renameSavedSearch(
  searches: SavedSearch[],
  id: string,
  name: string,
  now = Date.now(),
): SavedSearch[] {
  return searches.map((search) =>
    search.id === id ? { ...search, name: name.trim() || search.name, updatedAt: now } : search,
  );
}

export function toggleSavedSearchPin(
  searches: SavedSearch[],
  id: string,
  now = Date.now(),
): SavedSearch[] {
  return searches.map((search) =>
    search.id === id ? { ...search, pinned: !search.pinned, updatedAt: now } : search,
  );
}

export function deleteSavedSearch(searches: SavedSearch[], id: string): SavedSearch[] {
  return searches.filter((search) => search.id !== id);
}

export function parseSearchSettings(raw: string | null): SearchSettings {
  if (!raw) return { ...DEFAULT_SEARCH_SETTINGS };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return { ...DEFAULT_SEARCH_SETTINGS };
    return {
      defaultScope: SCOPES.has(value.defaultScope as SearchScopeId)
        ? (value.defaultScope as SearchScopeId)
        : DEFAULT_SEARCH_SETTINGS.defaultScope,
      defaultView: value.defaultView === "grid" ? "grid" : "list",
      customRoots: stringArray(value.customRoots),
      historyEnabled: value.historyEnabled !== false,
      retentionDays:
        typeof value.retentionDays === "number" && value.retentionDays > 0
          ? Math.min(3650, value.retentionDays)
          : DEFAULT_SEARCH_SETTINGS.retentionDays,
      maxHistory:
        typeof value.maxHistory === "number" && value.maxHistory > 0
          ? Math.min(200, value.maxHistory)
          : DEFAULT_SEARCH_SETTINGS.maxHistory,
      includeLive: value.includeLive !== false,
      includeSpotlight: value.includeSpotlight !== false,
      semanticSearch: value.semanticSearch === true,
      visualSearch: value.visualSearch === true,
      largeFileBytes:
        typeof value.largeFileBytes === "number" && value.largeFileBytes > 0
          ? value.largeFileBytes
          : DEFAULT_SEARCH_SETTINGS.largeFileBytes,
    };
  } catch {
    return { ...DEFAULT_SEARCH_SETTINGS };
  }
}

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
    // Search history is a convenience; storage failures must not break search.
  }
}

export function loadSearchHistory(): SearchHistoryEntry[] {
  return parseHistory(read(SEARCH_HISTORY_KEY));
}

export function saveSearchHistory(entries: SearchHistoryEntry[]): void {
  write(SEARCH_HISTORY_KEY, serializeHistory(entries));
}

export function clearSearchHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function loadSavedSearches(): SavedSearch[] {
  return parseSavedSearches(read(SEARCH_SAVED_KEY));
}

export function saveSavedSearches(searches: SavedSearch[]): void {
  write(SEARCH_SAVED_KEY, serializeSavedSearches(searches));
}

export function loadSearchSettings(): SearchSettings {
  return parseSearchSettings(read(SEARCH_SETTINGS_KEY));
}

export function saveSearchSettings(settings: SearchSettings): void {
  write(SEARCH_SETTINGS_KEY, JSON.stringify(settings));
}
