import { create } from "zustand";
import { api, isTauri, normalizeError } from "../lib/api";
import { basename, formatCount } from "../lib/format";
import { useExplorerStore } from "./explorerStore";
import {
  buildSearchRequest,
  chipsFor,
  interpretQuery,
  normalizeFilterChange,
  removeChip as removeFilterChip,
  scopeRoots,
  type InterpretContext,
  type InterpretedQuery,
} from "../lib/search/interpreter";
import {
  addHistory,
  addSavedSearch,
  clearSearchHistory,
  deleteSavedSearch,
  loadSavedSearches,
  loadSearchHistory,
  loadSearchSettings,
  pruneHistory,
  renameSavedSearch,
  saveSavedSearches,
  saveSearchHistory,
  saveSearchSettings,
  toggleSavedSearchPin,
} from "../lib/search/history";
import {
  DEFAULT_SEARCH_FILTERS,
  DEFAULT_SEARCH_SETTINGS,
  type DuplicateResponse,
  type IndexStatus,
  type SavedSearch,
  type SearchChip,
  type SearchFilters,
  type SearchHistoryEntry,
  type SearchHit,
  type SearchScopeId,
  type SearchSettings,
  type SearchSort,
  type SearchSortDirection,
  type SearchStats,
  type SearchView,
} from "../lib/search/types";

export interface SearchColumnState {
  location: boolean;
  created: boolean;
  accessed: boolean;
  relevance: boolean;
}

interface SearchState {
  open: boolean;
  workspaceOpen: boolean;
  query: string;
  interpretation: InterpretedQuery | null;
  filters: SearchFilters;
  scope: SearchScopeId;
  customRoots: string[];
  results: SearchHit[];
  stats: SearchStats | null;
  loading: boolean;
  phase: string;
  error: string | null;
  queryId: number;
  selectedPath: string | null;
  selectedPaths: string[];
  anchorPath: string | null;
  view: SearchView;
  sort: SearchSort;
  sortDirection: SearchSortDirection;
  previewOpen: boolean;
  filtersOpen: boolean;
  columns: SearchColumnState;
  history: SearchHistoryEntry[];
  savedSearches: SavedSearch[];
  settings: SearchSettings;
  indexStatus: IndexStatus | null;
  indexLoading: boolean;
  duplicates: DuplicateResponse | null;
  duplicatesLoading: boolean;
  listenersAttached: boolean;

  initialize: () => Promise<void>;
  openOverlay: (query?: string) => void;
  closeOverlay: () => void;
  openWorkspace: () => void;
  closeWorkspace: () => void;
  setQuery: (query: string) => void;
  scheduleSearch: (delay?: number) => void;
  runSearchNow: () => Promise<void>;
  cancelPending: () => void;
  applyFilters: (patch: Partial<SearchFilters>) => void;
  setContentTerms: (terms: string[]) => void;
  setExcludeTerms: (terms: string[]) => void;
  setScope: (scope: SearchScopeId) => void;
  setCustomRoots: (roots: string[]) => void;
  removeChip: (chip: SearchChip) => void;
  clearFilters: () => void;
  toggleView: (view: SearchView) => void;
  setSort: (sort: SearchSort, direction?: SearchSortDirection) => void;
  setPreviewOpen: (open: boolean) => void;
  setFiltersOpen: (open: boolean) => void;
  toggleColumn: (column: keyof SearchColumnState) => void;
  selectHit: (path: string, additive?: boolean) => void;
  selectMany: (paths: string[]) => void;
  openHit: (hit: SearchHit) => Promise<void>;
  revealHit: (path: string) => Promise<void>;
  revealInMaxplorer: (path: string, paneId?: "left" | "right") => Promise<void>;
  commitSearch: () => void;
  reuseHistory: (entry: SearchHistoryEntry) => void;
  deleteHistoryEntry: (id: string) => void;
  clearHistory: () => void;
  saveCurrentSearch: (name: string) => void;
  runSavedSearch: (search: SavedSearch) => void;
  renameSaved: (id: string, name: string) => void;
  deleteSaved: (id: string) => void;
  pinSaved: (id: string) => void;
  updateSettings: (patch: Partial<SearchSettings>) => void;
  loadIndexStatus: () => Promise<void>;
  setIndexPaused: (paused: boolean) => Promise<void>;
  setContentEnabled: (enabled: boolean) => Promise<void>;
  setContentLimit: (bytes: number) => Promise<void>;
  addIndexLocation: (path: string) => Promise<void>;
  removeIndexLocation: (path: string) => Promise<void>;
  rebuildIndex: () => Promise<void>;
  clearIndex: () => Promise<void>;
  pruneIndex: () => Promise<void>;
  optimizeIndex: () => Promise<void>;
  retryExtractions: () => Promise<void>;
  runDuplicateSearch: () => Promise<void>;
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let pendingQueryId = 0;
let activeRequestId = 0;
let listenersStarted = false;
const MAX_RESULTS = 800;
/**
 * A search may never leave the interface spinning. If the backend has not
 * reported completion by this deadline the store stops waiting, keeps whatever
 * results arrived, and tells the user what happened.
 */
const SEARCH_WATCHDOG_MS = 12_000;

function clearWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function contextLocations(): Array<{ id: string; name: string; path: string }> {
  const explorer = useExplorerStore.getState();
  const seen = new Set<string>();
  const locations: Array<{ id: string; name: string; path: string }> = [];
  const add = (id: string, name: string, path: string) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    locations.push({ id, name, path });
  };
  for (const location of explorer.locations) {
    add(location.id, location.name, location.path);
  }
  for (const recent of explorer.recents) {
    add(`recent:${recent.path}`, recent.name, recent.path);
  }
  return locations;
}

function context(): InterpretContext {
  const explorer = useExplorerStore.getState();
  const currentFolder = explorer.currentFolder();
  const selectedFolders = explorer
    .selectedEntries()
    .filter((entry) => entry.isDir)
    .map((entry) => entry.path);
  return {
    home: explorer.platform?.home ?? "",
    currentFolder,
    locations: contextLocations(),
    selectedFolders,
    largeFileBytes: DEFAULT_SEARCH_SETTINGS.largeFileBytes,
  };
}

function resolvedRoots(state: Pick<SearchState, "scope" | "customRoots" | "indexStatus">): string[] {
  const explorer = useExplorerStore.getState();
  const home = explorer.platform?.home ?? "";
  const indexedLocations = (state.indexStatus?.locations ?? []).map((location) => ({
    id: location.path,
    name: location.name,
    path: location.path,
  }));
  if (!indexedLocations.length) {
    for (const location of explorer.locations) {
      if (location.isVolume && location.path !== home) continue;
      indexedLocations.push({ id: location.id, name: location.name, path: location.path });
    }
    if (!indexedLocations.some((location) => location.path === home) && home) {
      indexedLocations.push({ id: "home", name: "Home", path: home });
    }
  }
  const externalLocations = explorer.locations
    .filter((location) => location.isVolume && location.path !== "/" && location.path !== home)
    .map((location) => ({ id: location.id, name: location.name, path: location.path }));
  const selectedFolders = explorer
    .selectedEntries()
    .filter((entry) => entry.isDir)
    .map((entry) => entry.path);
  return scopeRoots({
    scope: state.scope,
    currentFolder: explorer.currentFolder(),
    home,
    indexedLocations,
    externalLocations,
    selectedFolders,
    customRoots: state.customRoots,
  });
}

function filtersActive(filters: SearchFilters): boolean {
  return (
    filters.kinds.length > 0 ||
    filters.extensions.length > 0 ||
    filters.minSize != null ||
    filters.maxSize != null ||
    Boolean(filters.modified || filters.created || filters.accessed) ||
    filters.noExtension ||
    filters.emptyFolders ||
    filters.includeHidden ||
    filters.locations.length > 0
  );
}

function mergeHits(existing: SearchHit[], incoming: SearchHit[]): SearchHit[] {
  const byPath = new Map<string, SearchHit>();
  for (const hit of existing) byPath.set(hit.entry.path, hit);
  for (const hit of incoming) {
    const current = byPath.get(hit.entry.path);
    if (!current || hit.score > current.score || (hit.indexed && !current.indexed)) {
      byPath.set(hit.entry.path, hit);
    }
  }
  return [...byPath.values()].sort((left, right) => right.score - left.score || (right.entry.modified ?? 0) - (left.entry.modified ?? 0));
}

function updateHistory(entries: SearchHistoryEntry[], settings: SearchSettings): SearchHistoryEntry[] {
  saveSearchHistory(entries);
  return entries;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  open: false,
  workspaceOpen: false,
  query: "",
  interpretation: null,
  filters: { ...DEFAULT_SEARCH_FILTERS },
  scope: "indexed",
  customRoots: [],
  results: [],
  stats: null,
  loading: false,
  phase: "idle",
  error: null,
  queryId: 0,
  selectedPath: null,
  selectedPaths: [],
  anchorPath: null,
  view: "list",
  sort: "relevance",
  sortDirection: "desc",
  previewOpen: false,
  filtersOpen: true,
  columns: { location: true, created: false, accessed: false, relevance: true },
  history: [],
  savedSearches: [],
  settings: { ...DEFAULT_SEARCH_SETTINGS },
  indexStatus: null,
  indexLoading: false,
  duplicates: null,
  duplicatesLoading: false,
  listenersAttached: false,

  async initialize() {
    const settings = loadSearchSettings();
    const history = pruneHistory(loadSearchHistory(), settings);
    set({
      settings,
      history,
      savedSearches: loadSavedSearches(),
      scope: settings.defaultScope,
      view: settings.defaultView,
      customRoots: settings.customRoots,
    });
    if (!listenersStarted && isTauri) {
      listenersStarted = true;
      void api.onSearchProgress((progress) => {
        const state = get();
        if (progress.queryId !== state.queryId) return;
        if (progress.hits.length) {
          set({ results: mergeHits(state.results, progress.hits) });
        }
        if (progress.done && progress.stats) {
          clearWatchdog();
          set({ stats: progress.stats, loading: false, phase: "complete" });
        } else {
          set({ phase: progress.phase });
        }
      });
    }
    set({ listenersAttached: true });
    // Never count millions of index rows during launch. The search overlay,
    // workspace, and indexing dashboard request status when they are opened.
  },

  openOverlay(query) {
    const nextQuery = query ?? get().query;
    const nextInterpretation = query != null ? interpretQuery(query, context()) : get().interpretation;
    set((state) => ({
      open: true,
      query: nextQuery,
      interpretation: nextInterpretation,
      filters: query != null && nextInterpretation ? nextInterpretation.filters : state.filters,
    }));
    if (nextQuery.trim()) get().scheduleSearch(120);
    else get().cancelPending();
  },
  closeOverlay() {
    get().cancelPending();
    set({ open: false });
  },
  openWorkspace() {
    get().commitSearch();
    set({ open: false, workspaceOpen: true });
    get().scheduleSearch(0);
  },
  closeWorkspace() {
    get().cancelPending();
    set({ workspaceOpen: false });
  },

  setQuery(query) {
    const interpretation = interpretQuery(query, context());
    set({
      query,
      interpretation,
      filters: interpretation.filters,
      error: null,
    });
    if (!query.trim() && !filtersActive(interpretation.filters)) {
      get().cancelPending();
      set({ results: [], stats: null, loading: false, phase: "idle", error: null });
      return;
    }
    get().scheduleSearch();
  },

  scheduleSearch(delay = 140) {
    get().cancelPending();
    if (delay <= 0) {
      void get().runSearchNow();
      return;
    }
    searchTimer = setTimeout(() => {
      searchTimer = null;
      void get().runSearchNow();
    }, delay);
  },

  cancelPending() {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    clearWatchdog();
    if (activeRequestId) {
      const request = activeRequestId;
      activeRequestId = 0;
      if (isTauri) void api.cancelSearch(request).catch(() => undefined);
    }
    if (get().loading) set({ loading: false, phase: "idle" });
  },

  async runSearchNow() {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    const state = get();
    const interpretation = state.interpretation ?? interpretQuery(state.query, context());
    const scopeRootValues = resolvedRoots(state);
    const roots = state.filters.locations.length ? state.filters.locations : scopeRootValues;
    const hasFilters = filtersActive(state.filters);
    if (!interpretation.terms.length && !interpretation.contentTerms.length && !hasFilters) {
      set({ results: [], stats: null, loading: false, phase: "idle", error: null });
      return;
    }
    if (!roots.length) {
      set({
        results: [],
        loading: false,
        phase: "empty-scope",
        error: "This scope has no accessible locations. Choose another scope or add a custom location in the indexing settings.",
      });
      return;
    }
    pendingQueryId += 1;
    const queryId = pendingQueryId;
    activeRequestId = queryId;
    const indexReady =
      (state.indexStatus?.indexedFiles ?? 0) > 0 &&
      state.indexStatus?.activity !== "starting" &&
      state.indexStatus?.activity !== "indexing";
    // The live walk is a fallback, not a companion. It used to run on every
    // query because a permanently "partial" location never looked ready, which
    // doubled the cost of each keystroke.
    const includeLive = state.settings.includeLive && (state.scope !== "indexed" || !indexReady);
    const request = buildSearchRequest({
      queryId,
      interpretation,
      filters: state.filters,
      roots,
      includeHidden: state.filters.includeHidden,
      recursive: state.scope !== "current" || state.filters.locations.length > 0,
      includeLive,
      includeSpotlight: state.settings.includeSpotlight,
      sort: state.sort,
      sortDirection: state.sortDirection,
      limit: MAX_RESULTS,
    });
    set({
      queryId,
      loading: true,
      phase: "searching",
      error: null,
      selectedPaths: [],
      selectedPath: null,
      anchorPath: null,
    });
    clearWatchdog();
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      const current = get();
      if (current.queryId !== queryId || !current.loading) return;
      set({ loading: false, phase: "partial" });
      useExplorerStore.getState().toast({
        title: "Search is taking longer than expected",
        detail: "Partial results are shown. Refine the query or check the indexing dashboard.",
        tone: "info",
      });
    }, SEARCH_WATCHDOG_MS);
    if (!isTauri) {
      set({
        loading: false,
        phase: "idle",
        error: "Universal Search runs inside the MAXplorer desktop runtime.",
      });
      return;
    }
    try {
      const response = await api.universalSearch(request);
      if (get().queryId !== queryId) return;
      clearWatchdog();
      set((current) => {
        const paths = new Set(response.hits.map((hit) => hit.entry.path));
        const selectedPath =
          current.selectedPath && paths.has(current.selectedPath) ? current.selectedPath : null;
        return {
          results: response.hits,
          stats: response.stats,
          loading: false,
          phase: "complete",
          selectedPath,
          selectedPaths: current.selectedPaths.filter((path) => paths.has(path)),
        };
      });
    } catch (error) {
      if (get().queryId !== queryId) return;
      clearWatchdog();
      const normalized = normalizeError(error);
      set({
        loading: false,
        phase: "error",
        error: normalized.message,
      });
    } finally {
      if (activeRequestId === queryId) activeRequestId = 0;
    }
  },

  applyFilters(patch) {
    set((state) => ({ filters: normalizeFilterChange(state.filters, patch) }));
    if (patch.duplicatesOnly === true) {
      void get().runDuplicateSearch();
    } else {
      get().scheduleSearch();
    }
  },
  setContentTerms(terms) {
    const state = get();
    if (!state.interpretation) return;
    const clean = terms.map((term) => term.trim()).filter(Boolean);
    set({
      interpretation: { ...state.interpretation, contentTerms: clean },
      filters: { ...state.filters, contentMode: clean.length ? "both" : state.filters.contentMode },
    });
    get().scheduleSearch();
  },
  setExcludeTerms(terms) {
    const state = get();
    if (!state.interpretation) return;
    set({
      interpretation: {
        ...state.interpretation,
        excludeTerms: terms.map((term) => term.trim()).filter(Boolean),
      },
    });
    get().scheduleSearch();
  },
  setScope(scope) {
    set({ scope });
    get().updateSettings({ defaultScope: scope });
    get().scheduleSearch(0);
  },
  setCustomRoots(roots) {
    const customRoots = [...new Set(roots.filter(Boolean))];
    set({ customRoots, scope: customRoots.length ? "custom" : get().scope });
    get().updateSettings({ customRoots });
    get().scheduleSearch(0);
  },
  removeChip(chip) {
    const state = get();
    if (chip.id.startsWith("contains:")) {
      const interpretation = state.interpretation;
      if (!interpretation) return;
      const value = chip.id.slice("contains:".length);
      const next = {
        ...interpretation,
        contentTerms: interpretation.contentTerms.filter((term) => term !== value),
      };
      set({ interpretation: next, filters: { ...state.filters } });
      get().scheduleSearch();
      return;
    }
    if (chip.id.startsWith("exclude:")) {
      const interpretation = state.interpretation;
      if (!interpretation) return;
      const value = chip.id.slice("exclude:".length);
      set({
        interpretation: {
          ...interpretation,
          excludeTerms: interpretation.excludeTerms.filter((term) => term !== value),
        },
      });
      get().scheduleSearch();
      return;
    }
    set({ filters: removeFilterChip(state.filters, chip) });
    get().scheduleSearch();
  },
  clearFilters() {
    const interpretation = get().interpretation;
    set({ filters: interpretation ? interpretation.filters : { ...DEFAULT_SEARCH_FILTERS } });
    get().scheduleSearch();
  },
  toggleView(view) {
    set({ view });
    get().updateSettings({ defaultView: view });
  },
  setSort(sort, direction) {
    set((state) => ({
      sort,
      sortDirection: direction ?? (state.sort === sort && state.sortDirection === "desc" ? "asc" : "desc"),
    }));
    get().scheduleSearch(0);
  },
  setPreviewOpen(previewOpen) {
    set({ previewOpen });
  },
  setFiltersOpen(filtersOpen) {
    set({ filtersOpen });
  },
  toggleColumn(column) {
    set((state) => ({ columns: { ...state.columns, [column]: !state.columns[column] } }));
  },

  selectHit(path, additive = false) {
    set((state) => {
      if (additive) {
        const selected = state.selectedPaths.includes(path)
          ? state.selectedPaths.filter((item) => item !== path)
          : [...state.selectedPaths, path];
        return { selectedPaths: selected, selectedPath: selected[selected.length - 1] ?? null, anchorPath: path };
      }
      return { selectedPaths: [path], selectedPath: path, anchorPath: path };
    });
  },
  selectMany(paths) {
    set({ selectedPaths: paths, selectedPath: paths[paths.length - 1] ?? null });
  },

  async openHit(hit) {
    const isApplicationBundle =
      hit.entry.isDir && hit.entry.name.toLowerCase().endsWith(".app");
    if (hit.entry.isDir && !isApplicationBundle) {
      const explorer = useExplorerStore.getState();
      set({ workspaceOpen: false });
      await explorer.navigate(hit.entry.path);
      return;
    }
    if (!isTauri) return;
    try {
      await api.openPath(hit.entry.path);
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code === "not_found") {
        void api.removeSearchPath(hit.entry.path).catch(() => undefined);
        void get().runSearchNow();
      }
      useExplorerStore.getState().toastError(error);
    }
  },
  async revealInMaxplorer(path, paneId) {
    const explorer = useExplorerStore.getState();
    set({ open: false, workspaceOpen: false });
    await explorer.revealInPane(path, paneId);
  },

  async revealHit(path) {
    if (!isTauri) return;
    try {
      await api.revealPath(path);
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },

  commitSearch() {
    const state = get();
    if (!state.query.trim()) return;
    const entry: SearchHistoryEntry = {
      id: `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      query: state.query.trim(),
      scope: state.scope,
      filters: { ...state.filters },
      at: Date.now(),
    };
    set({ history: updateHistory(addHistory(state.history, entry, state.settings), state.settings) });
  },
  reuseHistory(entry) {
    set({ open: true, workspaceOpen: false });
    get().setQuery(entry.query);
    if (entry.filters) set({ filters: entry.filters });
    get().commitSearch();
    get().scheduleSearch(0);
  },
  deleteHistoryEntry(id) {
    set((state) => {
      const history = state.history.filter((entry) => entry.id !== id);
      saveSearchHistory(history);
      return { history };
    });
  },
  clearHistory() {
    clearSearchHistory();
    set({ history: [] });
  },

  saveCurrentSearch(name) {
    const state = get();
    const now = Date.now();
    const saved: SavedSearch = {
      id: `saved-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || state.query.trim() || "Saved search",
      query: state.query,
      filters: { ...state.filters },
      scope: state.scope,
      customRoots: [...state.customRoots],
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    const savedSearches = addSavedSearch(state.savedSearches, saved);
    saveSavedSearches(savedSearches);
    set({ savedSearches });
    useExplorerStore.getState().toast({ title: "Search saved", detail: saved.name, tone: "success" });
  },
  runSavedSearch(search) {
    const interpretation = interpretQuery(search.query, context());
    set({
      open: false,
      workspaceOpen: true,
      query: search.query,
      interpretation,
      filters: search.filters,
      scope: search.scope,
      customRoots: [...search.customRoots],
    });
    get().commitSearch();
    get().scheduleSearch(0);
  },
  renameSaved(id, name) {
    set((state) => {
      const savedSearches = renameSavedSearch(state.savedSearches, id, name);
      saveSavedSearches(savedSearches);
      return { savedSearches };
    });
  },
  deleteSaved(id) {
    set((state) => {
      const savedSearches = deleteSavedSearch(state.savedSearches, id);
      saveSavedSearches(savedSearches);
      return { savedSearches };
    });
  },
  pinSaved(id) {
    set((state) => {
      const savedSearches = toggleSavedSearchPin(state.savedSearches, id);
      saveSavedSearches(savedSearches);
      return { savedSearches };
    });
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    saveSearchSettings(settings);
    if (!settings.historyEnabled) clearSearchHistory();
    set((state) => ({
      settings,
      history: settings.historyEnabled ? pruneHistory(state.history, settings) : [],
    }));
  },

  async loadIndexStatus() {
    if (!isTauri) return;
    set({ indexLoading: true });
    try {
      const indexStatus = await api.getSearchIndexStatus();
      set({ indexStatus, indexLoading: false });
    } catch {
      set({ indexLoading: false });
    }
  },
  async setIndexPaused(paused) {
    if (!isTauri) return;
    try {
      set({ indexStatus: await api.setSearchIndexPaused(paused) });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },
  async setContentEnabled(enabled) {
    if (!isTauri) return;
    try {
      set({ indexStatus: await api.setSearchContentEnabled(enabled) });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },
  async setContentLimit(bytes) {
    if (!isTauri) return;
    try {
      set({ indexStatus: await api.setSearchContentLimit(bytes) });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },
  async addIndexLocation(path) {
    if (!isTauri) return;
    try {
      set({ indexStatus: await api.addSearchLocation(path) });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },
  async removeIndexLocation(path) {
    if (!isTauri) return;
    try {
      set({ indexStatus: await api.removeSearchLocation(path) });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },
  async rebuildIndex() {
    if (!isTauri) return;
    try {
      set({ indexStatus: await api.rebuildSearchIndex() });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },
  async clearIndex() {
    if (!isTauri) return;
    try {
      set({ indexStatus: await api.clearSearchIndex() });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },
  async retryExtractions() {
    if (!isTauri) return;
    try {
      set({ indexStatus: await api.retryFailedExtractions() });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },
  async pruneIndex() {
    if (!isTauri) return;
    try {
      const indexStatus = await api.pruneSearchIndex();
      set({ indexStatus });
      useExplorerStore.getState().toast({
        title: "Index cleaned",
        detail: `${formatCount(indexStatus.indexedFiles)} files remain indexed.`,
        tone: "success",
      });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },
  async optimizeIndex() {
    if (!isTauri) return;
    try {
      set({ indexStatus: await api.optimizeSearchIndex() });
      useExplorerStore.getState().toast({
        title: "Index compacted",
        detail: "The database was rewritten at its minimum size.",
        tone: "success",
      });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  },

  async runDuplicateSearch() {
    if (!isTauri) return;
    const state = get();
    const scopeRootValues = resolvedRoots(state);
    const roots = state.filters.locations.length ? state.filters.locations : scopeRootValues;
    if (!roots.length) {
      set({ error: "Choose a scope with accessible locations to find duplicates." });
      return;
    }
    set({ duplicatesLoading: true, error: null });
    try {
      const duplicates = await api.findDuplicates({
        queryId: Date.now(),
        roots,
        minSize: 1,
        includeSimilarNames: false,
        limit: 200,
      });
      set({ duplicates, duplicatesLoading: false });
    } catch (error) {
      set({ duplicatesLoading: false, error: normalizeError(error).message });
    }
  },
}));

export function searchChips(): SearchChip[] {
  const state = useSearchStore.getState();
  const interpretation = state.interpretation;
  return chipsFor(
    state.filters,
    interpretation?.terms ?? [],
    interpretation?.contentTerms ?? [],
    interpretation?.excludeTerms ?? [],
  );
}

export function scopeDisplayName(path: string): string {
  return basename(path) || path;
}
