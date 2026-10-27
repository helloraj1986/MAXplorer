import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, isTauri, normalizeError } from "../lib/api";
import { copyTextToClipboard, pathsAsText } from "../lib/clipboard";
import {
  basename,
  breadcrumbs,
  formatCount,
  formatDate,
  formatSize,
  joinPath,
  parentPath,
  plural,
  totalSize,
  typeName,
} from "../lib/format";
import { backHistory, canGoBack, canGoForward, forwardHistory, pushHistory } from "../lib/history";
import { loadPersisted, savePersisted } from "../lib/persistence";
import { filterEntries, sortEntries } from "../lib/sort";
import {
  pruneSelection,
  rangeSelection,
  selectAll as selectAllPaths,
  selectionStats,
  toggleSelection,
} from "../lib/selection";
import { closeOtherTabs, closeTab, createTab, createTabFrom, cycleTab, duplicateTab } from "../lib/tabs";
import type {
  AppError,
  ClipboardState,
  ConflictPolicy,
  ContextMenuState,
  DialogState,
  FileEntry,
  FolderStats,
  GroupBy,
  Location,
  OperationState,
  OperationResult,
  PersistedState,
  PlatformInfo,
  Properties,
  RecentItem,
  SortDirection,
  SortKey,
  TabState,
  ThemeMode,
  ToastMessage,
  ViewMode,
} from "../lib/types";
import { HOME_LOCATION } from "../lib/types";

interface ExplorerState {
  platform: PlatformInfo | null;
  locations: Location[];
  tabs: TabState[];
  activeTabId: string;
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDirection: SortDirection;
  groupBy: GroupBy;
  showHidden: boolean;
  showExtensions: boolean;
  detailsPane: boolean;
  previewPane: boolean;
  theme: ThemeMode;
  columnWidths: Record<string, number>;
  sidebarWidth: number;
  pinned: string[];
  recents: RecentItem[];
  clipboard: ClipboardState | null;
  contextMenu: ContextMenuState | null;
  dialog: DialogState | null;
  operation: OperationState | null;
  toasts: ToastMessage[];
  initialized: boolean;
  initializing: boolean;
  fatalError: AppError | null;

  initialize: () => Promise<void>;
  toast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
  toastError: (error: unknown) => void;

  activeTab: () => TabState;
  currentFolder: () => string;
  currentEntries: () => FileEntry[];
  selectedEntries: () => FileEntry[];
  isPinned: (path: string) => boolean;

  navigate: (path: string, options?: { history?: boolean; force?: boolean }) => Promise<boolean>;
  openEntry: (entry: FileEntry) => Promise<void>;
  openInNewTab: (path: string) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  goUp: () => Promise<void>;
  refresh: () => Promise<void>;
  addRecent: (path: string, isDir: boolean, modified?: number | null) => void;
  clearRecents: () => void;

  newTab: (location?: string) => Promise<void>;
  duplicateActiveTab: () => void;
  activateTab: (id: string) => Promise<void>;
  closeActiveTab: () => Promise<void>;
  closeTabById: (id: string) => Promise<void>;
  closeOtherTabs: (id: string) => void;
  cycleActiveTab: (direction: 1 | -1) => Promise<void>;
  reorderTab: (from: number, to: number) => void;

  setSelection: (paths: string[], anchorPath?: string | null) => void;
  toggleAt: (entry: FileEntry) => void;
  selectRangeTo: (entry: FileEntry, additive: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;

  setViewMode: (mode: ViewMode) => void;
  setSort: (key: SortKey) => void;
  setSortExplicit: (key: SortKey, direction: SortDirection) => void;
  setGroupBy: (groupBy: GroupBy) => void;
  setShowHidden: (show: boolean) => Promise<void>;
  setShowExtensions: (show: boolean) => void;
  setDetailsPane: (show: boolean) => void;
  setPreviewPane: (show: boolean) => void;
  setTheme: (theme: ThemeMode) => void;
  setColumnWidth: (key: string, width: number) => void;
  setSidebarWidth: (width: number) => void;

  setSearchQuery: (query: string) => void;
  runSearch: () => Promise<void>;
  clearSearch: () => void;

  copySelection: () => void;
  cutSelection: () => void;
  paste: () => Promise<void>;
  executePaste: (policy: ConflictPolicy, paths?: string[], destination?: string, mode?: "copy" | "cut") => Promise<void>;
  copyAsPath: () => Promise<void>;
  deleteSelection: (permanent?: boolean) => void;
  confirmDelete: (paths: string[], permanent: boolean) => Promise<void>;
  promptRename: () => void;
  renameTo: (path: string, newName: string) => Promise<string>;
  promptNewFolder: () => Promise<void>;
  promptNewTextFile: () => Promise<void>;
  createShortcut: () => Promise<void>;
  duplicateSelection: () => Promise<void>;
  sendSelectionTo: (destination: string, mode?: "copy" | "cut") => Promise<void>;
  moveOrCopyPaths: (paths: string[], destination: string, mode: "copy" | "cut") => Promise<void>;
  revealSelection: () => Promise<void>;
  openTerminalHere: () => Promise<void>;
  openProperties: (path?: string) => Promise<void>;
  openWithDialog: (path?: string) => Promise<void>;
  pinPath: (path: string) => void;
  unpinPath: (path: string) => void;
  shareSelection: () => Promise<void>;

  showContextMenu: (menu: ContextMenuState) => void;
  hideContextMenu: () => void;
  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;
  updatePropertiesDialog: (patch: Partial<Extract<DialogState, { kind: "properties" }>>) => void;
  setOperation: (operation: OperationState | null) => void;
}

function patchTab(tabs: TabState[], id: string, patch: Partial<TabState>): TabState[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab));
}

function findTab(tabs: TabState[], id: string): TabState | undefined {
  return tabs.find((tab) => tab.id === id);
}

function activeOf(state: ExplorerState): TabState {
  return findTab(state.tabs, state.activeTabId) ?? state.tabs[0];
}

function currentFolderOf(state: ExplorerState): string {
  const tab = activeOf(state);
  if (tab.location === HOME_LOCATION) return state.platform?.home ?? "/";
  return tab.location;
}

function currentEntriesOf(state: ExplorerState): FileEntry[] {
  const tab = activeOf(state);
  return tab.searchResults ?? tab.entries;
}

function selectedEntriesOf(state: ExplorerState): FileEntry[] {
  const entries = currentEntriesOf(state);
  const selected = new Set(activeOf(state).selection);
  return entries.filter((entry) => selected.has(entry.path));
}

function uniqueName(entries: FileEntry[], base: string, extension = ""): string {
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
  const candidate = (index: number) =>
    index === 0 ? `${base}${extension}` : `${base} (${index + 1})${extension}`;
  for (let index = 0; index < 1000; index += 1) {
    const name = candidate(index);
    if (!names.has(name.toLowerCase())) return name;
  }
  return `${base}${extension}`;
}

function operationSummary(results: OperationResult[]): {
  completed: number;
  skipped: number;
  failed: number;
  message: string;
} {
  const completed = results.filter((result) => result.status === "completed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const parts: string[] = [];
  if (completed) parts.push(`${completed} ${plural(completed, "item")} completed`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  return { completed, skipped, failed, message: parts.join(", ") };
}

function recentFor(path: string, isDir: boolean, modified: number | null = null): RecentItem {
  return {
    path,
    name: basename(path) || path,
    isDir,
    modified,
    visitedAt: Date.now(),
  };
}

function addRecentTo(state: ExplorerState, path: string, isDir: boolean, modified: number | null = null): RecentItem[] {
  const item = recentFor(path, isDir, modified);
  const recents = [item, ...state.recents.filter((recent) => recent.path !== path)];
  return recents.slice(0, 20);
}

let toastCounter = 0;
let persistenceStarted = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  platform: null,
  locations: [],
  tabs: [],
  activeTabId: "",
  viewMode: "details",
  sortKey: "name",
  sortDirection: "asc",
  groupBy: "none",
  showHidden: false,
  showExtensions: true,
  detailsPane: false,
  previewPane: false,
  theme: "system",
  columnWidths: { name: 272, date: 144, type: 120, size: 80, location: 260 },
  sidebarWidth: 204,
  pinned: [],
  recents: [],
  clipboard: null,
  contextMenu: null,
  dialog: null,
  operation: null,
  toasts: [],
  initialized: false,
  initializing: false,
  fatalError: null,

  activeTab: () => activeOf(get()),
  currentFolder: () => currentFolderOf(get()),
  currentEntries: () => currentEntriesOf(get()),
  selectedEntries: () => selectedEntriesOf(get()),
  isPinned: (path) => get().pinned.includes(path),

  async initialize() {
    if (get().initializing || get().initialized) return;
    set({ initializing: true });
    try {
      const [platform, locations, initialPath] = await Promise.all([
        api.getPlatformInfo(),
        api.getSidebarLocations(),
        api.getInitialPath().catch(() => null),
      ]);
      const persisted = loadPersisted();
      let tabs: TabState[];
      let activeTabId: string;
      let viewMode: ViewMode = "details";
      let sortKey: SortKey = "name";
      let sortDirection: SortDirection = "asc";
      let groupBy: GroupBy = "none";
      let showHidden = false;
      let showExtensions = true;
      let detailsPane = false;
      let previewPane = false;
      let theme: ThemeMode = "system";
      let columnWidths: Record<string, number> = { name: 272, date: 144, type: 120, size: 80, location: 260 };
      let sidebarWidth = 204;
      let pinned: string[] = [];
      let recents: RecentItem[] = [];

      if (persisted) {
        tabs = persisted.tabs.map((tab) =>
          createTabFrom(tab.location, tab.history, tab.historyIndex, tab.id),
        );
        activeTabId = persisted.activeTabId;
        viewMode = persisted.viewMode;
        sortKey = persisted.sortKey;
        sortDirection = persisted.sortDirection;
        groupBy = persisted.groupBy;
        showHidden = persisted.showHidden;
        showExtensions = persisted.showExtensions;
        detailsPane = persisted.detailsPane;
        previewPane = persisted.previewPane;
        if (detailsPane && previewPane) previewPane = false;
        theme = persisted.theme;
        columnWidths = persisted.columnWidths;
        sidebarWidth = persisted.sidebarWidth;
        pinned = persisted.pinned;
        recents = persisted.recents;
      } else {
        const tab = createTab(HOME_LOCATION);
        tabs = [tab];
        activeTabId = tab.id;
      }

      if (initialPath) {
        const resolved = await api.resolvePath(initialPath).catch(() => initialPath);
        const tab = createTab(resolved);
        tabs = [tab];
        activeTabId = tab.id;
        viewMode = "details";
        detailsPane = false;
        previewPane = false;
      }

      set({
        platform,
        locations,
        tabs,
        activeTabId,
        viewMode,
        sortKey,
        sortDirection,
        groupBy,
        showHidden,
        showExtensions,
        detailsPane,
        previewPane,
        theme,
        columnWidths,
        sidebarWidth,
        pinned,
        recents,
        initialized: true,
        initializing: false,
      });
      startPersistence();
      const tab = findTab(tabs, activeTabId);
      if (tab && tab.location !== HOME_LOCATION) {
        await get().refresh();
      }
    } catch (error) {
      const normalized = normalizeError(error);
      set({
        initializing: false,
        initialized: true,
        fatalError: normalized,
      });
    }
  },

  toast(toast) {
    toastCounter += 1;
    const id = `toast-${toastCounter}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-4) }));
    window.setTimeout(() => get().dismissToast(id), toast.tone === "error" ? 7600 : 4200);
  },
  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
  toastError(error) {
    const normalized = normalizeError(error);
    get().toast({ title: normalized.message, tone: "error", detail: normalized.path ?? undefined });
  },

  async navigate(path, options = {}) {
    const state = get();
    const tab = activeOf(state);
    if (!path) return false;
    if (tab.location === path && !options.force) return true;
    let resolved = path;
    if (path !== HOME_LOCATION) {
      try {
        resolved = await api.resolvePath(path);
      } catch (error) {
        get().toastError(error);
        return false;
      }
      const exists = await api.pathExists(resolved).catch(() => false);
      if (!exists) {
        get().toast({
          title: "This path can't be found.",
          detail: resolved,
          tone: "error",
        });
        return false;
      }
    }
    const historyState =
      options.history === false
        ? { history: tab.history, index: tab.historyIndex }
        : pushHistory(tab.history, tab.historyIndex, resolved);
    set((current) => ({
      tabs: patchTab(current.tabs, tab.id, {
        location: resolved,
        history: historyState.history,
        historyIndex: historyState.index,
        selection: [],
        anchorPath: null,
        searchQuery: "",
        searchResults: null,
        searchLoading: false,
        searchError: null,
        entries: resolved === HOME_LOCATION ? [] : current.tabs.find((item) => item.id === tab.id)?.entries ?? [],
        listingFor: resolved === HOME_LOCATION ? null : null,
        loading: resolved !== HOME_LOCATION,
        error: null,
      }),
      contextMenu: null,
      recents: resolved === HOME_LOCATION ? current.recents : addRecentTo(current, resolved, true),
    }));
    if (resolved !== HOME_LOCATION) {
      await get().refresh();
    }
    return true;
  },

  async openEntry(entry) {
    const isApplicationBundle = entry.isDir && entry.name.toLowerCase().endsWith(".app");
    if (entry.isDir && !isApplicationBundle) {
      await get().navigate(entry.path);
      return;
    }
    try {
      await api.openPath(entry.path);
      set((state) => ({
        recents: addRecentTo(state, entry.path, isApplicationBundle, entry.modified),
      }));
    } catch (error) {
      get().toastError(error);
    }
  },

  async openInNewTab(path) {
    await get().newTab(path);
  },

  async goBack() {
    const state = get();
    const tab = activeOf(state);
    if (!canGoBack(tab.history, tab.historyIndex)) return;
    const next = backHistory(tab.history, tab.historyIndex);
    if (!next) return;
    const location = next.history[next.index];
    set((current) => ({
      tabs: patchTab(current.tabs, tab.id, {
        location,
        history: next.history,
        historyIndex: next.index,
        selection: [],
        anchorPath: null,
        searchQuery: "",
        searchResults: null,
        loading: location !== HOME_LOCATION,
        error: null,
      }),
    }));
    if (location !== HOME_LOCATION) await get().refresh();
  },

  async goForward() {
    const state = get();
    const tab = activeOf(state);
    if (!canGoForward(tab.history, tab.historyIndex)) return;
    const next = forwardHistory(tab.history, tab.historyIndex);
    if (!next) return;
    const location = next.history[next.index];
    set((current) => ({
      tabs: patchTab(current.tabs, tab.id, {
        location,
        history: next.history,
        historyIndex: next.index,
        selection: [],
        anchorPath: null,
        searchQuery: "",
        searchResults: null,
        loading: location !== HOME_LOCATION,
        error: null,
      }),
    }));
    if (location !== HOME_LOCATION) await get().refresh();
  },

  async goUp() {
    const folder = currentFolderOf(get());
    if (folder === HOME_LOCATION) return;
    const parent = parentPath(folder);
    if (!parent) return;
    await get().navigate(parent);
  },

  async refresh() {
    const state = get();
    const tab = activeOf(state);
    if (tab.location === HOME_LOCATION) {
      set((current) => ({
        tabs: patchTab(current.tabs, tab.id, {
          entries: [],
          listingFor: HOME_LOCATION,
          loading: false,
          error: null,
          truncated: false,
          readErrors: 0,
        }),
      }));
      return;
    }
    if (tab.searchResults !== null && tab.searchQuery.trim()) {
      await get().runSearch();
      return;
    }
    const requestLocation = tab.location;
    set((current) => ({
      tabs: patchTab(current.tabs, tab.id, { loading: true, error: null }),
    }));
    try {
      const listing = await api.listDirectory(requestLocation, state.showHidden);
      set((current) => {
        const target = findTab(current.tabs, tab.id);
        if (!target || target.location !== requestLocation) return current;
        return {
          tabs: patchTab(current.tabs, tab.id, {
            entries: listing.entries,
            listingFor: listing.path,
            loading: false,
            error: null,
            truncated: listing.truncated,
            readErrors: listing.readErrors,
            selection: pruneSelection(listing.entries, target.selection),
            anchorPath: target.anchorPath,
          }),
        };
      });
    } catch (error) {
      const normalized = normalizeError(error);
      set((current) => {
        const target = findTab(current.tabs, tab.id);
        if (!target || target.location !== requestLocation) return current;
        return {
          tabs: patchTab(current.tabs, tab.id, {
            loading: false,
            error: normalized,
            entries: [],
            listingFor: requestLocation,
          }),
        };
      });
    }
  },

  addRecent(path, isDir, modified = null) {
    set((state) => ({ recents: addRecentTo(state, path, isDir, modified) }));
  },
  clearRecents() {
    set({ recents: [] });
  },

  async newTab(location = HOME_LOCATION) {
    const state = get();
    const tab = createTab(location);
    set({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      contextMenu: null,
    });
    if (location !== HOME_LOCATION) await get().refresh();
  },

  duplicateActiveTab() {
    const state = get();
    const copy = duplicateTab(activeOf(state));
    set({ tabs: [...state.tabs, copy], activeTabId: copy.id });
    void get().refresh();
  },

  async activateTab(id) {
    const state = get();
    if (!findTab(state.tabs, id)) return;
    set({ activeTabId: id, contextMenu: null });
    const tab = findTab(state.tabs, id);
    if (tab && tab.location !== HOME_LOCATION && (!tab.listingFor || tab.listingFor !== tab.location)) {
      await get().refresh();
    }
  },

  async closeActiveTab() {
    const state = get();
    const result = closeTab(state.tabs, state.activeTabId, state.activeTabId);
    if (result.closedLast) {
      if (isTauri) {
        getCurrentWindow()
          .close()
          .catch((error) => get().toastError(error));
      }
      return;
    }
    set({ tabs: result.tabs, activeTabId: result.activeId });
    const tab = findTab(result.tabs, result.activeId);
    if (tab && tab.location !== HOME_LOCATION && (!tab.listingFor || tab.listingFor !== tab.location)) {
      await get().refresh();
    }
  },

  async closeTabById(id) {
    const state = get();
    const result = closeTab(state.tabs, state.activeTabId, id);
    if (result.closedLast) {
      await get().closeActiveTab();
      return;
    }
    set({ tabs: result.tabs, activeTabId: result.activeId });
    const tab = findTab(result.tabs, result.activeId);
    if (tab && tab.location !== HOME_LOCATION && (!tab.listingFor || tab.listingFor !== tab.location)) {
      await get().refresh();
    }
  },

  closeOtherTabs(id) {
    const state = get();
    const result = closeOtherTabs(state.tabs, state.activeTabId, id);
    set({ tabs: result.tabs, activeTabId: result.activeId });
  },

  async cycleActiveTab(direction) {
    const state = get();
    const id = cycleTab(state.tabs, state.activeTabId, direction);
    if (id !== state.activeTabId) await get().activateTab(id);
  },

  reorderTab(from, to) {
    set((state) => {
      if (from === to || from < 0 || to < 0 || from >= state.tabs.length || to >= state.tabs.length) {
        return state;
      }
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { tabs };
    });
  },

  setSelection(paths, anchorPath = null) {
    const state = get();
    set({
      tabs: patchTab(state.tabs, state.activeTabId, {
        selection: paths,
        anchorPath: anchorPath ?? (paths.length ? paths[paths.length - 1] : null),
      }),
    });
  },
  toggleAt(entry) {
    const state = get();
    const tab = activeOf(state);
    const result = toggleSelection(tab.selection, entry.path);
    set({
      tabs: patchTab(state.tabs, tab.id, {
        selection: result.selection,
        anchorPath: result.anchorPath,
      }),
    });
  },
  selectRangeTo(entry, additive) {
    const state = get();
    const tab = activeOf(state);
    const result = rangeSelection(currentEntriesOf(state), tab.selection, tab.anchorPath, entry.path, additive);
    set({
      tabs: patchTab(state.tabs, tab.id, {
        selection: result.selection,
        anchorPath: result.anchorPath,
      }),
    });
  },
  selectAll() {
    const state = get();
    set({
      tabs: patchTab(state.tabs, state.activeTabId, {
        selection: selectAllPaths(currentEntriesOf(state)),
        anchorPath: null,
      }),
    });
  },
  clearSelection() {
    const state = get();
    set({
      tabs: patchTab(state.tabs, state.activeTabId, { selection: [], anchorPath: null }),
    });
  },

  setViewMode(mode) {
    set({ viewMode: mode });
  },
  setSort(key) {
    set((state) =>
      state.sortKey === key
        ? { sortDirection: state.sortDirection === "asc" ? "desc" : "asc" }
        : { sortKey: key, sortDirection: "asc" },
    );
  },
  setSortExplicit(key, direction) {
    set({ sortKey: key, sortDirection: direction });
  },
  setGroupBy(groupBy) {
    set({ groupBy });
  },
  async setShowHidden(show) {
    set({ showHidden: show });
    const tab = activeOf(get());
    if (tab.searchResults) {
      await get().runSearch();
    } else {
      await get().refresh();
    }
  },
  setShowExtensions(showExtensions) {
    set({ showExtensions });
  },
  setDetailsPane(show) {
    set({ detailsPane: show, previewPane: show ? false : get().previewPane });
  },
  setPreviewPane(show) {
    set({ previewPane: show, detailsPane: show ? false : get().detailsPane });
  },
  setTheme(theme) {
    set({ theme });
  },
  setColumnWidth(key, width) {
    set((state) => ({ columnWidths: { ...state.columnWidths, [key]: width } }));
  },
  setSidebarWidth(width) {
    set({ sidebarWidth: Math.max(160, Math.min(360, width)) });
  },

  setSearchQuery(query) {
    const state = get();
    const tab = activeOf(state);
    if (tab.searchLoading) {
      void api.cancelSearch(tab.searchRequestId).catch(() => undefined);
    }
    if (!query.trim()) {
      set({
        tabs: patchTab(state.tabs, tab.id, {
          searchQuery: "",
          searchResults: null,
          searchLoading: false,
          searchError: null,
          searchRequestId: tab.searchRequestId + 1,
        }),
      });
      return;
    }
    set({
      tabs: patchTab(state.tabs, tab.id, {
        searchQuery: query,
        searchResults: null,
        searchLoading: false,
        searchError: null,
        searchRequestId: tab.searchRequestId + 1,
      }),
    });
  },

  async runSearch() {
    const state = get();
    const tab = activeOf(state);
    const query = tab.searchQuery.trim();
    if (!query) return;
    if (tab.searchLoading) {
      await api.cancelSearch(tab.searchRequestId).catch(() => undefined);
    }
    const requestId = tab.searchRequestId + 1;
    const root = tab.location === HOME_LOCATION ? state.platform?.home ?? "/" : tab.location;
    set((current) => ({
      tabs: patchTab(current.tabs, tab.id, {
        searchLoading: true,
        searchError: null,
        searchRequestId: requestId,
        selection: [],
        anchorPath: null,
      }),
    }));
    try {
      const result = await api.searchFiles(root, query, state.showHidden, 500, requestId);
      set((current) => {
        const target = findTab(current.tabs, tab.id);
        if (!target || target.searchRequestId !== requestId || target.location !== tab.location) {
          return current;
        }
        return {
          tabs: patchTab(current.tabs, tab.id, {
            searchLoading: false,
            searchResults: result.entries,
            searchError: result.cancelled ? "Search was cancelled." : null,
            searchTruncated: result.truncated,
            searchScanned: result.scanned,
          }),
        };
      });
    } catch (error) {
      const normalized = normalizeError(error);
      set((current) => {
        const target = findTab(current.tabs, tab.id);
        if (!target || target.searchRequestId !== requestId) return current;
        return {
          tabs: patchTab(current.tabs, tab.id, {
            searchLoading: false,
            searchError: normalized.message,
            searchResults: [],
          }),
        };
      });
    }
  },

  clearSearch() {
    const state = get();
    const tab = activeOf(state);
    if (tab.searchLoading) void api.cancelSearch(tab.searchRequestId).catch(() => undefined);
    set({
      tabs: patchTab(state.tabs, tab.id, {
        searchQuery: "",
        searchResults: null,
        searchLoading: false,
        searchError: null,
      }),
    });
  },

  copySelection() {
    const entries = selectedEntriesOf(get());
    if (!entries.length) return;
    set({
      clipboard: {
        mode: "copy",
        paths: entries.map((entry) => entry.path),
        names: entries.map((entry) => entry.name),
      },
      contextMenu: null,
    });
  },

  cutSelection() {
    const entries = selectedEntriesOf(get());
    if (!entries.length) return;
    set({
      clipboard: {
        mode: "cut",
        paths: entries.map((entry) => entry.path),
        names: entries.map((entry) => entry.name),
      },
      contextMenu: null,
    });
  },

  async paste() {
    const state = get();
    if (!state.clipboard) return;
    const tab = activeOf(state);
    if (tab.location === HOME_LOCATION) {
      get().toast({ title: "Choose a folder before pasting.", tone: "info" });
      return;
    }
    if (state.clipboard.mode === "cut") {
      const sameFolder = state.clipboard.paths.every((path) => parentPath(path) === tab.location);
      if (sameFolder) {
        set({ clipboard: null });
        get().toast({ title: "The items are already in this folder.", tone: "info" });
        return;
      }
    }
    const entries = await api
      .listDirectory(tab.location, state.showHidden)
      .then((listing) => listing.entries)
      .catch(() => tab.entries);
    const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
    const conflicts = state.clipboard.names.filter((name) => names.has(name.toLowerCase()));
    if (conflicts.length) {
      get().openDialog({
        kind: "conflict",
        title: "There is already a file with the same name in this folder",
        message: "Choose how to handle the name conflict.",
        conflicts,
        onChoose: async (policy) => {
          get().closeDialog();
          if (policy === "error") return;
          await get().executePaste(policy);
        },
      });
      return;
    }
    await get().executePaste("error");
  },

  async executePaste(policy, paths, destination, mode) {
    const state = get();
    const clipboard = state.clipboard;
    const sourcePaths = paths ?? clipboard?.paths ?? [];
    const modeValue = mode ?? clipboard?.mode ?? "copy";
    if (!sourcePaths.length) return;
    const target = destination ?? currentFolderOf(state);
    if (target === HOME_LOCATION) return;
    set({ operation: { title: modeValue === "cut" ? "Moving items..." : "Copying items..." } });
    try {
      const results =
        modeValue === "cut"
          ? await api.movePaths(sourcePaths, target, policy)
          : await api.copyPaths(sourcePaths, target, policy);
      const summary = operationSummary(results);
      if (summary.failed) {
        const firstError = results.find((result) => result.status === "failed")?.error;
        get().toast({
          title: summary.failed === 1 ? "One item couldn't be processed." : `${summary.failed} items couldn't be processed.`,
          detail: firstError ?? undefined,
          tone: "error",
        });
      } else {
        get().toast({
          title: modeValue === "cut" ? "Items moved" : "Items copied",
          detail: summary.message,
          tone: "success",
        });
      }
      if (modeValue === "cut") set({ clipboard: null });
      await get().refresh();
    } catch (error) {
      get().toastError(error);
    } finally {
      set({ operation: null });
    }
  },

  async copyAsPath() {
    const paths = selectedEntriesOf(get()).map((entry) => entry.path);
    if (!paths.length) return;
    const success = await copyTextToClipboard(pathsAsText(paths));
    get().toast({
      title: success ? "Path copied to clipboard" : "Couldn't copy the path",
      detail: paths.length === 1 ? paths[0] : `${paths.length} paths`,
      tone: success ? "success" : "error",
    });
    set({ contextMenu: null });
  },

  deleteSelection(permanent = false) {
    const entries = selectedEntriesOf(get());
    if (!entries.length) return;
    const count = entries.length;
    const names = entries.slice(0, 3).map((entry) => entry.name).join(", ");
    get().openDialog({
      kind: "confirm",
      title: permanent ? "Permanently delete?" : "Delete these items?",
      message: permanent
        ? `This will permanently delete ${count === 1 ? names : `${count} items`}. This can't be undone.`
        : `Move ${count === 1 ? names : `${count} items`} to the Trash?`,
      detail: count > 3 ? `${names}, and ${count - 3} more` : undefined,
      confirmLabel: permanent ? "Delete permanently" : "Delete",
      destructive: true,
      onConfirm: async () => {
        get().closeDialog();
        await get().confirmDelete(entries.map((entry) => entry.path), permanent);
      },
    });
  },

  async confirmDelete(paths, permanent) {
    set({ operation: { title: permanent ? "Deleting items..." : "Moving items to Trash..." } });
    try {
      const results = await api.deletePaths(paths, permanent);
      const summary = operationSummary(results);
      if (summary.failed) {
        get().toast({
          title: "Some items couldn't be deleted.",
          detail: results.find((result) => result.status === "failed")?.error ?? undefined,
          tone: "error",
        });
      } else {
        get().toast({
          title: permanent ? "Items deleted" : "Items moved to Trash",
          detail: summary.message,
          tone: "success",
        });
      }
      get().clearSelection();
      await get().refresh();
    } catch (error) {
      get().toastError(error);
    } finally {
      set({ operation: null });
    }
  },

  promptRename() {
    const entries = selectedEntriesOf(get());
    if (entries.length !== 1) return;
    const entry = entries[0];
    get().openDialog({
      kind: "prompt",
      title: "Rename",
      label: "New name",
      initialValue: entry.name,
      confirmLabel: "Rename",
      selectStem: true,
      onConfirm: async (value) => {
        await get().renameTo(entry.path, value);
        get().closeDialog();
      },
    });
    set({ contextMenu: null });
  },

  async renameTo(path, newName) {
    const newPath = await api.renamePath(path, newName);
    await get().refresh();
    get().setSelection([newPath], newPath);
    get().toast({ title: "Renamed", detail: newName, tone: "success" });
    return newPath;
  },

  async promptNewFolder() {
    const state = get();
    if (activeOf(state).location === HOME_LOCATION) return;
    const folder = currentFolderOf(state);
    const name = uniqueName(currentEntriesOf(state), "New folder");
    try {
      const entry = await api.createFolder(folder, name);
      await get().refresh();
      get().setSelection([entry.path], entry.path);
      get().openDialog({
        kind: "prompt",
        title: "New folder",
        label: "Folder name",
        initialValue: entry.name,
        confirmLabel: "Create",
        selectStem: true,
        onConfirm: async (value) => {
          if (value.trim() && value !== entry.name) {
            await get().renameTo(entry.path, value);
          }
          get().closeDialog();
        },
      });
    } catch (error) {
      get().toastError(error);
    }
  },

  async promptNewTextFile() {
    const state = get();
    if (activeOf(state).location === HOME_LOCATION) return;
    const folder = currentFolderOf(state);
    const name = uniqueName(currentEntriesOf(state), "New Text Document", ".txt");
    try {
      const entry = await api.createTextFile(folder, name, "");
      await get().refresh();
      get().setSelection([entry.path], entry.path);
      get().openDialog({
        kind: "prompt",
        title: "New text document",
        label: "File name",
        initialValue: entry.name,
        confirmLabel: "Create",
        selectStem: true,
        onConfirm: async (value) => {
          if (value.trim() && value !== entry.name) {
            await get().renameTo(entry.path, value);
          }
          get().closeDialog();
        },
      });
    } catch (error) {
      get().toastError(error);
    }
  },

  async createShortcut() {
    const entries = selectedEntriesOf(get());
    if (!entries.length) return;
    let created = 0;
    const usedNames = new Set(currentEntriesOf(get()).map((entry) => entry.name.toLowerCase()));
    for (const entry of entries) {
      const parent = parentPath(entry.path);
      if (!parent) continue;
      const base = `${entry.name} - Shortcut`;
      let name = base;
      let suffix = 2;
      while (usedNames.has(name.toLowerCase())) {
        name = `${base} (${suffix})`;
        suffix += 1;
      }
      usedNames.add(name.toLowerCase());
      try {
        await api.createSymlink(parent, name, entry.path);
        created += 1;
      } catch (error) {
        get().toastError(error);
        break;
      }
    }
    if (created) {
      get().toast({
        title: created === 1 ? "Shortcut created" : `${created} shortcuts created`,
        tone: "success",
      });
      await get().refresh();
    }
    set({ contextMenu: null });
  },

  async duplicateSelection() {
    const entries = selectedEntriesOf(get());
    if (!entries.length) return;
    set({ operation: { title: "Duplicating items..." } });
    try {
      const results = await api.duplicatePaths(entries.map((entry) => entry.path));
      const summary = operationSummary(results);
      get().toast({
        title: summary.failed ? "Some items couldn't be duplicated." : "Items duplicated",
        detail: summary.message,
        tone: summary.failed ? "error" : "success",
      });
      await get().refresh();
    } catch (error) {
      get().toastError(error);
    } finally {
      set({ operation: null });
    }
  },

  async sendSelectionTo(destination, mode = "cut") {
    const entries = selectedEntriesOf(get());
    if (!entries.length) return;
    await get().moveOrCopyPaths(entries.map((entry) => entry.path), destination, mode);
    set({ contextMenu: null });
  },

  async moveOrCopyPaths(paths, destination, mode) {
    const filtered =
      mode === "cut" ? paths.filter((path) => parentPath(path) !== destination) : paths;
    if (!filtered.length) {
      get().toast({ title: "The items are already in this folder.", tone: "info" });
      return;
    }
    set({ operation: { title: mode === "cut" ? "Moving items..." : "Copying items..." } });
    try {
      const results =
        mode === "cut"
          ? await api.movePaths(filtered, destination, "rename")
          : await api.copyPaths(filtered, destination, "rename");
      const summary = operationSummary(results);
      get().toast({
        title: summary.failed ? "Some items couldn't be processed." : mode === "cut" ? "Items moved" : "Items copied",
        detail: summary.message,
        tone: summary.failed ? "error" : "success",
      });
      await get().refresh();
    } catch (error) {
      get().toastError(error);
    } finally {
      set({ operation: null });
    }
  },

  async revealSelection() {
    const entry = selectedEntriesOf(get())[0];
    const target = entry?.path ?? currentFolderOf(get());
    try {
      await api.revealPath(target);
    } catch (error) {
      get().toastError(error);
    }
    set({ contextMenu: null });
  },

  async openTerminalHere() {
    const target = currentFolderOf(get());
    try {
      await api.openTerminal(target);
    } catch (error) {
      get().toastError(error);
    }
    set({ contextMenu: null });
  },

  async openProperties(path) {
    const target = path ?? selectedEntriesOf(get())[0]?.path ?? currentFolderOf(get());
    set({
      contextMenu: null,
      dialog: { kind: "properties", path: target, properties: null, stats: null, loading: true, error: null },
    });
    try {
      const properties = await api.getProperties(target);
      get().updatePropertiesDialog({ properties, loading: false });
      if (properties.isDir) {
        const stats = await api.getFolderStats(target).catch(() => null);
        get().updatePropertiesDialog({ stats });
      }
    } catch (error) {
      get().updatePropertiesDialog({ loading: false, error: normalizeError(error).message });
    }
  },

  async openWithDialog(path) {
    const target = path ?? selectedEntriesOf(get())[0]?.path;
    if (!target) return;
    set({ contextMenu: null, dialog: { kind: "openWith", path: target, applications: [], loading: true } });
    try {
      const applications = await api.listApplications();
      set((state) => ({
        dialog:
          state.dialog?.kind === "openWith"
            ? { ...state.dialog, applications, loading: false }
            : state.dialog,
      }));
    } catch {
      set((state) => ({
        dialog:
          state.dialog?.kind === "openWith"
            ? { ...state.dialog, loading: false }
            : state.dialog,
      }));
    }
  },

  pinPath(path) {
    set((state) => ({
      pinned: state.pinned.includes(path) ? state.pinned : [...state.pinned, path],
    }));
  },
  unpinPath(path) {
    set((state) => ({ pinned: state.pinned.filter((item) => item !== path) }));
  },

  async shareSelection() {
    const entries = selectedEntriesOf(get());
    if (!entries.length) return;
    const paths = entries.map((entry) => entry.path);
    const success = await copyTextToClipboard(pathsAsText(paths));
    get().toast({
      title: success ? "Share is not available in this build" : "Couldn't copy the item path",
      detail: success
        ? "The path was copied instead. Use Reveal in Finder to open the macOS share sheet."
        : undefined,
      tone: success ? "info" : "error",
      actionLabel: success ? "Reveal in Finder" : undefined,
      onAction: success ? () => void get().revealSelection() : undefined,
    });
    set({ contextMenu: null });
  },

  showContextMenu(menu) {
    set({ contextMenu: menu });
  },
  hideContextMenu() {
    set({ contextMenu: null });
  },
  openDialog(dialog) {
    set({ dialog, contextMenu: null });
  },
  closeDialog() {
    set({ dialog: null });
  },
  updatePropertiesDialog(patch) {
    set((state) => ({
      dialog: state.dialog?.kind === "properties" ? { ...state.dialog, ...patch } : state.dialog,
    }));
  },
  setOperation(operation) {
    set({ operation });
  },
}));

export function selectVisibleEntries(state: ExplorerState): FileEntry[] {
  const tab = activeOf(state);
  const entries = tab.searchResults ?? tab.entries;
  return filterEntries(sortEntries(entries, state.sortKey, state.sortDirection), "");
}

export function selectSelectionStats(state: ExplorerState): {
  count: number;
  bytes: number;
  entries: FileEntry[];
} {
  return selectionStats(currentEntriesOf(state), activeOf(state).selection);
}

export function selectBreadcrumbs(state: ExplorerState): ReturnType<typeof breadcrumbs> {
  return breadcrumbs(
    activeOf(state).location === HOME_LOCATION ? HOME_LOCATION : activeOf(state).location,
    state.platform?.computerLabel ?? "This PC",
    HOME_LOCATION,
  );
}

export function selectStatusText(state: ExplorerState): string {
  const tab = activeOf(state);
  if (tab.location === HOME_LOCATION) return "Home";
  const entries = tab.searchResults ?? tab.entries;
  const stats = selectionStats(entries, tab.selection);
  const total = entries.length;
  const itemLabel = `${formatCount(total)} ${plural(total, "item")}`;
  if (stats.count === 0) return itemLabel;
  const size = stats.bytes > 0 ? ` ${formatSize(stats.bytes)}` : "";
  return `${itemLabel} | ${formatCount(stats.count)} ${plural(stats.count, "item")} selected${size}`;
}

export function selectLocationLabel(state: ExplorerState): string {
  const tab = activeOf(state);
  if (tab.location === HOME_LOCATION) return "Home";
  return basename(tab.location) || tab.location;
}

export function startPersistence(): void {
  if (persistenceStarted) return;
  persistenceStarted = true;
  useExplorerStore.subscribe((state) => {
    if (!state.initialized) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const snapshot: PersistedState = {
        version: 1,
        tabs: state.tabs.map((tab) => ({
          id: tab.id,
          location: tab.location,
          history: tab.history,
          historyIndex: tab.historyIndex,
        })),
        activeTabId: state.activeTabId,
        viewMode: state.viewMode,
        sortKey: state.sortKey,
        sortDirection: state.sortDirection,
        groupBy: state.groupBy,
        showHidden: state.showHidden,
        showExtensions: state.showExtensions,
        detailsPane: state.detailsPane,
        previewPane: state.previewPane,
        theme: state.theme,
        columnWidths: state.columnWidths,
        sidebarWidth: state.sidebarWidth,
        pinned: state.pinned,
        recents: state.recents,
      };
      savePersisted(snapshot);
    }, 250);
  });
}
