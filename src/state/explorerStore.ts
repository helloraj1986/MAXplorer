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
import { loadPersisted, loadThemePreferences, savePersisted } from "../lib/persistence";
import { filterEntries, groupEntries, sortEntries } from "../lib/sort";
import {
  normalizeSelection,
  pruneSelectionState,
  rangeSelection,
  selectAll as selectAllPaths,
  selectionStats,
  toggleSelection,
} from "../lib/selection";
import { closeOtherTabs, closeTab, createTab, createTabFrom, cycleTab, duplicateTab } from "../lib/tabs";
import {
  DEFAULT_SHORTCUTS,
  activeTabOf,
  clampSplitRatio,
  createPane,
  deriveSyncAnchors,
  detectConflicts,
  isRecursiveTransfer,
  mapSynchronizedPath,
  normalizeAccelerator,
  otherPane,
  paneFolder,
  paneFromPersisted,
  panesFromPersisted,
  panesShowingSources,
  persistedPaneFromState,
  sameFolder as foldersMatch,
  type SyncAnchors,
} from "../lib/panes";
import { createTransferItem, summarizeResults } from "../lib/transfers";
import type {
  AppError,
  ClipboardState,
  ComparisonProgress,
  ConflictPolicy,
  ContextMenuState,
  DialogState,
  FileEntry,
  FolderComparisonState,
  FolderStats,
  GroupBy,
  InterfaceTheme,
  Location,
  OperationState,
  OperationResult,
  PaneId,
  PaneState,
  PersistedState,
  PlatformInfo,
  Properties,
  RecentItem,
  ShortcutMap,
  SortDirection,
  SortKey,
  TabState,
  ThemeMode,
  ToastMessage,
  TransferHistoryItem,
  TransferItem,
  TransferMode,
  TransferProgress,
  ViewMode,
} from "../lib/types";
import { HOME_LOCATION } from "../lib/types";
import { DEFAULT_INTERFACE_THEME } from "../lib/theme";

interface NavigatorOptions {
  history?: boolean;
  force?: boolean;
  paneId?: PaneId;
  skipSync?: boolean;
}

interface TransferOptions {
  sourcePane?: PaneId;
  destinationPane?: PaneId;
  conflict?: ConflictPolicy;
}

function toTransferMode(mode: "copy" | "cut"): TransferMode {
  return mode === "cut" ? "move" : "copy";
}

interface TransferRequestOptions {
  mode: TransferMode;
  sources: string[];
  destination: string;
  sourcePane: PaneId;
  destinationPane: PaneId;
  conflict: ConflictPolicy;
}

interface ExplorerState {
  platform: PlatformInfo | null;
  locations: Location[];
  panes: Record<PaneId, PaneState>;
  activePane: PaneId;
  dualPane: boolean;
  splitRatio: number;
  syncNavigation: boolean;
  syncAnchors: SyncAnchors | null;
  shortcuts: ShortcutMap;
  detailsPane: boolean;
  previewPane: boolean;
  theme: ThemeMode;
  interfaceTheme: InterfaceTheme;
  columnWidths: Record<string, number>;
  sidebarWidth: number;
  pinned: string[];
  recents: RecentItem[];
  clipboard: ClipboardState | null;
  contextMenu: ContextMenuState | null;
  dialog: DialogState | null;
  operation: OperationState | null;
  transfers: TransferItem[];
  transfersOpen: boolean;
  transferHistory: TransferHistoryItem[];
  comparison: FolderComparisonState | null;
  toasts: ToastMessage[];
  initialized: boolean;
  initializing: boolean;
  fatalError: AppError | null;

  initialize: () => Promise<void>;
  toast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
  toastError: (error: unknown) => void;

  pane: (paneId?: PaneId) => PaneState;
  activeTab: (paneId?: PaneId) => TabState;
  currentFolder: (paneId?: PaneId) => string;
  currentEntries: (paneId?: PaneId) => FileEntry[];
  selectedEntries: (paneId?: PaneId) => FileEntry[];
  isPinned: (path: string) => boolean;

  setActivePane: (paneId: PaneId) => void;
  toggleDualPane: () => void;
  setDualPane: (value: boolean) => void;
  setSplitRatio: (ratio: number) => void;
  setPaneCollapsed: (paneId: PaneId, collapsed: boolean) => void;
  setSyncNavigation: (enabled: boolean) => void;
  setShortcut: (action: keyof ShortcutMap, accelerator: string) => void;
  resetShortcuts: () => void;

  navigate: (path: string, options?: NavigatorOptions) => Promise<boolean>;
  openEntry: (entry: FileEntry, paneId?: PaneId) => Promise<void>;
  openInNewTab: (path: string, paneId?: PaneId) => Promise<void>;
  goBack: (paneId?: PaneId) => Promise<void>;
  goForward: (paneId?: PaneId) => Promise<void>;
  goUp: (paneId?: PaneId) => Promise<void>;
  refresh: (paneId?: PaneId) => Promise<void>;
  addRecent: (path: string, isDir: boolean, modified?: number | null) => void;
  clearRecents: () => void;

  newTab: (location?: string, paneId?: PaneId) => Promise<void>;
  duplicateActiveTab: (paneId?: PaneId) => void;
  activateTab: (id: string, paneId?: PaneId) => Promise<void>;
  closeActiveTab: (paneId?: PaneId) => Promise<void>;
  closeTabById: (id: string, paneId?: PaneId) => Promise<void>;
  closeOtherTabs: (id: string, paneId?: PaneId) => void;
  cycleActiveTab: (direction: 1 | -1, paneId?: PaneId) => Promise<void>;
  reorderTab: (from: number, to: number, paneId?: PaneId) => void;

  setSelection: (paths: string[], anchorPath?: string | null, paneId?: PaneId) => void;
  toggleAt: (entry: FileEntry, paneId?: PaneId) => void;
  selectRangeTo: (entry: FileEntry, additive: boolean, paneId?: PaneId) => void;
  selectAll: (paneId?: PaneId) => void;
  clearSelection: (paneId?: PaneId) => void;

  setViewMode: (mode: ViewMode, paneId?: PaneId) => void;
  setSort: (key: SortKey, paneId?: PaneId) => void;
  setSortExplicit: (key: SortKey, direction: SortDirection, paneId?: PaneId) => void;
  setGroupBy: (groupBy: GroupBy, paneId?: PaneId) => void;
  setShowHidden: (show: boolean, paneId?: PaneId) => Promise<void>;
  setShowExtensions: (show: boolean, paneId?: PaneId) => void;
  setDetailsPane: (show: boolean) => void;
  setPreviewPane: (show: boolean) => void;
  setTheme: (theme: ThemeMode) => void;
  setInterfaceTheme: (theme: InterfaceTheme) => void;
  setColumnWidth: (key: string, width: number) => void;
  setSidebarWidth: (width: number) => void;

  setSearchQuery: (query: string, paneId?: PaneId) => void;
  runSearch: (paneId?: PaneId) => Promise<void>;
  clearSearch: (paneId?: PaneId) => void;

  copySelection: (paneId?: PaneId) => void;
  cutSelection: (paneId?: PaneId) => void;
  paste: (paneId?: PaneId) => Promise<void>;
  executePaste: (
    policy: ConflictPolicy,
    paths?: string[],
    destination?: string,
    mode?: "copy" | "cut",
    paneId?: PaneId,
  ) => Promise<void>;
  copyAsPath: (paneId?: PaneId) => Promise<void>;
  copyPathsToClipboard: (paths: string[], mode?: "copy" | "cut") => void;
  copyToOtherPane: () => Promise<void>;
  moveToOtherPane: () => Promise<void>;
  transferToOtherPane: (mode: TransferMode) => Promise<void>;
  requestTransfer: (
    paths: string[],
    destination: string,
    mode: TransferMode,
    options?: TransferOptions,
  ) => Promise<void>;
  enqueueTransfer: (options: TransferRequestOptions) => string;
  pumpTransfers: () => Promise<void>;
  handleTransferProgress: (progress: TransferProgress) => void;
  cancelTransfer: (id: string) => Promise<void>;
  pauseTransfer: (id: string, paused: boolean) => Promise<void>;
  retryTransfer: (id: string) => Promise<void>;
  removeTransfer: (id: string) => void;
  clearFinishedTransfers: () => void;
  openTransfers: () => void;
  closeTransfers: () => void;

  startComparison: (verifyContent?: boolean) => Promise<void>;
  cancelComparison: () => Promise<void>;
  setComparisonFilter: (differencesOnly: boolean) => void;
  setComparisonOpen: (open: boolean) => void;
  closeComparison: () => void;

  deleteSelection: (permanent?: boolean, paneId?: PaneId) => void;
  confirmDelete: (paths: string[], permanent: boolean, paneId?: PaneId) => Promise<void>;
  promptRename: (paneId?: PaneId) => void;
  renameTo: (path: string, newName: string, paneId?: PaneId) => Promise<string>;
  promptNewFolder: (paneId?: PaneId) => Promise<void>;
  promptNewTextFile: (paneId?: PaneId) => Promise<void>;
  createShortcut: (paneId?: PaneId) => Promise<void>;
  duplicateSelection: (paneId?: PaneId) => Promise<void>;
  sendSelectionTo: (destination: string, mode?: "copy" | "cut", paneId?: PaneId) => Promise<void>;
  moveOrCopyPaths: (
    paths: string[],
    destination: string,
    mode: TransferMode,
    sourcePane?: PaneId,
    destinationPane?: PaneId,
  ) => Promise<void>;
  revealSelection: (paneId?: PaneId) => Promise<void>;
  revealInPane: (path: string, paneId?: PaneId) => Promise<boolean>;
  openTerminalHere: (paneId?: PaneId) => Promise<void>;
  openProperties: (path?: string) => Promise<void>;
  openWithDialog: (path?: string) => Promise<void>;
  pinPath: (path: string) => void;
  unpinPath: (path: string) => void;
  shareSelection: (paneId?: PaneId) => Promise<void>;

  showContextMenu: (menu: ContextMenuState) => void;
  hideContextMenu: () => void;
  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;
  updatePropertiesDialog: (patch: Partial<Extract<DialogState, { kind: "properties" }>>) => void;
  setOperation: (operation: OperationState | null) => void;
}

function patchPane(
  panes: Record<PaneId, PaneState>,
  paneId: PaneId,
  patch: Partial<PaneState>,
): Record<PaneId, PaneState> {
  return { ...panes, [paneId]: { ...panes[paneId], ...patch } };
}

function patchPaneTab(
  panes: Record<PaneId, PaneState>,
  paneId: PaneId,
  tabId: string,
  patch: Partial<TabState>,
): Record<PaneId, PaneState> {
  const pane = panes[paneId];
  return patchPane(panes, paneId, {
    tabs: pane.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
  });
}

function findTab(tabs: TabState[], id: string): TabState | undefined {
  return tabs.find((tab) => tab.id === id);
}

function paneOf(state: ExplorerState, paneId?: PaneId): PaneState {
  return state.panes[paneId ?? state.activePane];
}

function activeTabOfState(state: ExplorerState, paneId?: PaneId): TabState {
  return activeTabOf(paneOf(state, paneId));
}

function currentFolderOf(state: ExplorerState, paneId?: PaneId): string {
  const tab = activeTabOfState(state, paneId);
  if (tab.location === HOME_LOCATION) return state.platform?.home ?? "/";
  return tab.location;
}

function currentEntriesOf(state: ExplorerState, paneId?: PaneId): FileEntry[] {
  const tab = activeTabOfState(state, paneId);
  return tab.searchResults ?? tab.entries;
}

function tabFolderOf(state: ExplorerState, tab: TabState): string {
  return tab.location === HOME_LOCATION ? state.platform?.home ?? "/" : tab.location;
}

function findTabInFolder(
  state: ExplorerState,
  paneId: PaneId,
  folder: string,
): TabState | undefined {
  const pane = state.panes[paneId];
  const active = activeTabOf(pane);
  if (foldersMatch(tabFolderOf(state, active), folder)) return active;
  return pane.tabs.find((tab) => foldersMatch(tabFolderOf(state, tab), folder));
}

/**
 * The entries in the order the file views actually show them. Range selection
 * and Select All must use this order rather than the filesystem/listing order,
 * otherwise a Shift-click can select a different set from the one the user sees.
 */
function displayedEntriesOf(state: ExplorerState, paneId?: PaneId): FileEntry[] {
  const pane = paneOf(state, paneId);
  const sorted = sortEntries(currentEntriesOf(state, paneId), pane.sortKey, pane.sortDirection);
  return groupEntries(sorted, pane.groupBy).flatMap((group) => group.entries);
}

function selectedEntriesOf(state: ExplorerState, paneId?: PaneId): FileEntry[] {
  const entries = currentEntriesOf(state, paneId);
  const selected = new Set(activeTabOfState(state, paneId).selection);
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

function addRecentTo(
  state: ExplorerState,
  path: string,
  isDir: boolean,
  modified: number | null = null,
): RecentItem[] {
  const item = recentFor(path, isDir, modified);
  const recents = [item, ...state.recents.filter((recent) => recent.path !== path)];
  return recents.slice(0, 20);
}

let toastCounter = 0;
let persistenceStarted = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queueRunning = false;
let comparisonCounter = 0;
let listenersStarted = false;

const initialPreferences = loadThemePreferences();

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  platform: null,
  locations: [],
  panes: {
    left: createPane(HOME_LOCATION),
    right: createPane(HOME_LOCATION),
  },
  activePane: "left",
  dualPane: false,
  splitRatio: 0.5,
  syncNavigation: false,
  syncAnchors: null,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  detailsPane: false,
  previewPane: false,
  theme: initialPreferences.theme,
  interfaceTheme: initialPreferences.interfaceTheme,
  columnWidths: { name: 272, date: 144, type: 120, size: 80, location: 260 },
  sidebarWidth: 204,
  pinned: [],
  recents: [],
  clipboard: null,
  contextMenu: null,
  dialog: null,
  operation: null,
  transfers: [],
  transfersOpen: false,
  transferHistory: [],
  comparison: null,
  toasts: [],
  initialized: false,
  initializing: false,
  fatalError: null,

  pane: (paneId) => paneOf(get(), paneId),
  activeTab: (paneId) => activeTabOfState(get(), paneId),
  currentFolder: (paneId) => currentFolderOf(get(), paneId),
  currentEntries: (paneId) => currentEntriesOf(get(), paneId),
  selectedEntries: (paneId) => selectedEntriesOf(get(), paneId),
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
      const home = platform.home || "/";
      let panes = panesFromPersisted(persisted, home);
      let activePane: PaneId = persisted?.activePane === "right" ? "right" : "left";
      let dualPane = persisted?.dualPane ?? false;
      let splitRatio = persisted?.splitRatio ?? 0.5;
      let syncNavigation = persisted?.syncNavigation ?? false;
      let detailsPane = false;
      let previewPane = false;
      let theme: ThemeMode = "system";
      let interfaceTheme: InterfaceTheme = DEFAULT_INTERFACE_THEME;
      let columnWidths: Record<string, number> = {
        name: 272,
        date: 144,
        type: 120,
        size: 80,
        location: 260,
      };
      let sidebarWidth = 204;
      let pinned: string[] = [];
      let recents: RecentItem[] = [];
      let shortcuts: ShortcutMap = { ...DEFAULT_SHORTCUTS };
      let transferHistory: TransferHistoryItem[] = [];

      if (persisted) {
        detailsPane = persisted.detailsPane;
        previewPane = persisted.previewPane;
        if (detailsPane && previewPane) previewPane = false;
        theme = persisted.theme;
        interfaceTheme = persisted.interfaceTheme;
        columnWidths = persisted.columnWidths;
        sidebarWidth = persisted.sidebarWidth;
        pinned = persisted.pinned;
        recents = persisted.recents;
        shortcuts = persisted.shortcuts;
        transferHistory = persisted.transferHistory;
      }

      if (initialPath) {
        const resolved = await api.resolvePath(initialPath).catch(() => initialPath);
        panes = {
          ...panes,
          left: createPane(resolved),
        };
        activePane = "left";
      }

      // Single-pane mode always shows the left pane, and a collapsed pane can't
      // own keyboard focus because its file list is not mounted.
      if (!dualPane) {
        activePane = "left";
      } else if (panes[activePane].collapsed) {
        activePane = otherPane(activePane);
      }

      const syncAnchors =
        syncNavigation && dualPane
          ? deriveSyncAnchors(paneFolder(panes.left, home), paneFolder(panes.right, home))
          : null;

      set({
        platform,
        locations,
        panes,
        activePane,
        dualPane,
        splitRatio: clampSplitRatio(splitRatio),
        syncNavigation,
        syncAnchors,
        shortcuts,
        detailsPane,
        previewPane,
        theme,
        interfaceTheme,
        columnWidths,
        sidebarWidth,
        pinned,
        recents,
        transferHistory,
        initialized: true,
        initializing: false,
      });
      startPersistence();
      if (!listenersStarted) {
        listenersStarted = true;
        void api.onTransferProgress((progress) => get().handleTransferProgress(progress));
        void api.onCompareProgress((progress: ComparisonProgress) => {
          const comparison = get().comparison;
          if (!comparison || comparison.requestId !== progress.requestId) return;
          set({
            comparison: {
              ...comparison,
              scanned: progress.scanned,
              total: progress.total,
              current: progress.current,
              cancelled: comparison.cancelled || progress.cancelled,
            },
          });
        });
      }
      await Promise.all([
        get().refresh("left"),
        get().refresh("right"),
      ]);
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
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-5) }));
    window.setTimeout(() => get().dismissToast(id), toast.tone === "error" ? 7600 : 4200);
  },
  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
  toastError(error) {
    const normalized = normalizeError(error);
    get().toast({ title: normalized.message, tone: "error", detail: normalized.path ?? undefined });
  },

  setActivePane(paneId) {
    if (get().activePane === paneId) return;
    set({ activePane: paneId, contextMenu: null });
  },
  toggleDualPane() {
    get().setDualPane(!get().dualPane);
  },
  setDualPane(value) {
    const state = get();
    if (state.dualPane === value) return;
    if (!value) {
      set({
        dualPane: false,
        activePane: "left",
        comparison: null,
        // Re-entering dual-pane mode should always show both panes.
        panes: {
          left: { ...state.panes.left, collapsed: false },
          right: { ...state.panes.right, collapsed: false },
        },
      });
      return;
    }
    const anchors = state.syncNavigation
      ? deriveSyncAnchors(
          paneFolder(state.panes.left, state.platform?.home),
          paneFolder(state.panes.right, state.platform?.home),
        )
      : null;
    set({ dualPane: true, syncAnchors: anchors });
    void get().refresh("right");
  },
  setSplitRatio(ratio) {
    set({ splitRatio: clampSplitRatio(ratio) });
  },
  setPaneCollapsed(paneId, collapsed) {
    const state = get();
    if (!state.dualPane) return;
    const panes = patchPane(state.panes, paneId, { collapsed });
    if (collapsed) {
      panes[otherPane(paneId)] = { ...panes[otherPane(paneId)], collapsed: false };
    }
    set({
      panes,
      // A collapsed pane has no file list, so focus moves to the visible pane.
      activePane:
        collapsed && state.activePane === paneId ? otherPane(paneId) : state.activePane,
    });
  },
  setSyncNavigation(enabled) {
    const state = get();
    if (!enabled) {
      set({ syncNavigation: false, syncAnchors: null });
      return;
    }
    const anchors = deriveSyncAnchors(
      paneFolder(state.panes.left, state.platform?.home),
      paneFolder(state.panes.right, state.platform?.home),
    );
    set({ syncNavigation: true, syncAnchors: anchors });
    if (!state.dualPane) {
      get().toast({
        title: "Synchronized navigation is on",
        detail: "Turn on dual-pane mode to use it. The mapping is created from the two folders.",
        tone: "info",
      });
    } else if (!anchors) {
      get().toast({
        title: "Navigation will stay independent",
        detail: "The panes have no valid relative mapping yet. Move both panes into related folders, then toggle it off and on.",
        tone: "info",
      });
    }
  },
  setShortcut(action, accelerator) {
    set((state) => ({
      shortcuts: {
        ...state.shortcuts,
        [action]: normalizeAccelerator(accelerator, DEFAULT_SHORTCUTS[action]),
      },
    }));
  },
  resetShortcuts() {
    set({ shortcuts: { ...DEFAULT_SHORTCUTS } });
  },

  async navigate(path, options = {}) {
    const state = get();
    const paneId = options.paneId ?? state.activePane;
    const tab = activeTabOfState(state, paneId);
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
      panes: patchPaneTab(current.panes, paneId, tab.id, {
        location: resolved,
        history: historyState.history,
        historyIndex: historyState.index,
        selection: [],
        anchorPath: null,
        searchQuery: "",
        searchResults: null,
        searchLoading: false,
        searchError: null,
        entries: resolved === HOME_LOCATION ? [] : findTab(current.panes[paneId].tabs, tab.id)?.entries ?? [],
        listingFor: null,
        loading: resolved !== HOME_LOCATION,
        error: null,
      }),
      contextMenu: null,
      recents: resolved === HOME_LOCATION ? current.recents : addRecentTo(current, resolved, true),
    }));
    if (resolved !== HOME_LOCATION) {
      await get().refresh(paneId);
    }

    const after = get();
    if (
      after.syncNavigation &&
      after.dualPane &&
      !options.skipSync &&
      after.syncAnchors &&
      resolved !== HOME_LOCATION
    ) {
      const other = otherPane(paneId);
      const sourceAnchor = paneId === "left" ? after.syncAnchors.left : after.syncAnchors.right;
      const targetAnchor = paneId === "left" ? after.syncAnchors.right : after.syncAnchors.left;
      const mapped = mapSynchronizedPath(sourceAnchor, targetAnchor, resolved);
      if (mapped && mapped !== currentFolderOf(after, other)) {
        const exists = await api.pathExists(mapped).catch(() => false);
        if (exists) {
          await get().navigate(mapped, { paneId: other, skipSync: true });
        }
      }
    }
    return true;
  },

  async openEntry(entry, paneId) {
    const isApplicationBundle = entry.isDir && entry.name.toLowerCase().endsWith(".app");
    if (entry.isDir && !isApplicationBundle) {
      await get().navigate(entry.path, { paneId });
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

  async openInNewTab(path, paneId) {
    await get().newTab(path, paneId);
  },

  async goBack(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    if (!canGoBack(tab.history, tab.historyIndex)) return;
    const next = backHistory(tab.history, tab.historyIndex);
    if (!next) return;
    const location = next.history[next.index];
    set((current) => ({
      panes: patchPaneTab(current.panes, id, tab.id, {
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
    if (location !== HOME_LOCATION) await get().refresh(id);
  },

  async goForward(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    if (!canGoForward(tab.history, tab.historyIndex)) return;
    const next = forwardHistory(tab.history, tab.historyIndex);
    if (!next) return;
    const location = next.history[next.index];
    set((current) => ({
      panes: patchPaneTab(current.panes, id, tab.id, {
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
    if (location !== HOME_LOCATION) await get().refresh(id);
  },

  async goUp(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const folder = currentFolderOf(state, id);
    if (folder === HOME_LOCATION) return;
    const parent = parentPath(folder);
    if (!parent) return;
    await get().navigate(parent, { paneId: id });
  },

  async refresh(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    const pane = paneOf(state, id);
    if (tab.location === HOME_LOCATION) {
      set((current) => ({
        panes: patchPaneTab(current.panes, id, tab.id, {
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
      await get().runSearch(id);
      return;
    }
    const requestLocation = tab.location;
    set((current) => ({
      panes: patchPaneTab(current.panes, id, tab.id, { loading: true, error: null }),
    }));
    try {
      const listing = await api.listDirectory(requestLocation, pane.showHidden);
      set((current) => {
        const target = findTab(current.panes[id].tabs, tab.id);
        if (!target || target.location !== requestLocation) return current;
        const pruned = pruneSelectionState(
          listing.entries,
          target.selection,
          target.anchorPath,
        );
        return {
          panes: patchPaneTab(current.panes, id, tab.id, {
            entries: listing.entries,
            listingFor: listing.path,
            loading: false,
            error: null,
            truncated: listing.truncated,
            readErrors: listing.readErrors,
            selection: pruned.selection,
            anchorPath: pruned.anchorPath,
          }),
        };
      });
    } catch (error) {
      const normalized = normalizeError(error);
      set((current) => {
        const target = findTab(current.panes[id].tabs, tab.id);
        if (!target || target.location !== requestLocation) return current;
        return {
          panes: patchPaneTab(current.panes, id, tab.id, {
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

  async newTab(location = HOME_LOCATION, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = createTab(location);
    const pane = state.panes[id];
    set({
      panes: patchPane(state.panes, id, {
        tabs: [...pane.tabs, tab],
        activeTabId: tab.id,
      }),
      activePane: id,
      contextMenu: null,
    });
    if (location !== HOME_LOCATION) await get().refresh(id);
  },

  duplicateActiveTab(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const pane = paneOf(state, id);
    const copy = duplicateTab(activeTabOf(pane));
    set({
      panes: patchPane(state.panes, id, {
        tabs: [...pane.tabs, copy],
        activeTabId: copy.id,
      }),
      activePane: id,
    });
    void get().refresh(id);
  },

  async activateTab(tabId, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const pane = paneOf(state, id);
    if (!findTab(pane.tabs, tabId)) return;
    set({ panes: patchPane(state.panes, id, { activeTabId: tabId }), activePane: id, contextMenu: null });
    const tab = findTab(pane.tabs, tabId);
    if (tab && tab.location !== HOME_LOCATION && (!tab.listingFor || tab.listingFor !== tab.location)) {
      await get().refresh(id);
    }
  },

  async closeActiveTab(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const pane = paneOf(state, id);
    const result = closeTab(pane.tabs, pane.activeTabId, pane.activeTabId);
    if (result.closedLast) {
      if (state.dualPane) {
        get().toast({ title: "A pane needs at least one tab.", tone: "info" });
        return;
      }
      if (isTauri) {
        getCurrentWindow()
          .close()
          .catch((error) => get().toastError(error));
      }
      return;
    }
    set({ panes: patchPane(state.panes, id, { tabs: result.tabs, activeTabId: result.activeId }) });
    const tab = findTab(result.tabs, result.activeId);
    if (tab && tab.location !== HOME_LOCATION && (!tab.listingFor || tab.listingFor !== tab.location)) {
      await get().refresh(id);
    }
  },

  async closeTabById(tabId, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const pane = paneOf(state, id);
    const result = closeTab(pane.tabs, pane.activeTabId, tabId);
    if (result.closedLast) {
      await get().closeActiveTab(id);
      return;
    }
    set({ panes: patchPane(state.panes, id, { tabs: result.tabs, activeTabId: result.activeId }) });
    const tab = findTab(result.tabs, result.activeId);
    if (tab && tab.location !== HOME_LOCATION && (!tab.listingFor || tab.listingFor !== tab.location)) {
      await get().refresh(id);
    }
  },

  closeOtherTabs(tabId, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const pane = paneOf(state, id);
    const result = closeOtherTabs(pane.tabs, pane.activeTabId, tabId);
    set({ panes: patchPane(state.panes, id, { tabs: result.tabs, activeTabId: result.activeId }) });
  },

  async cycleActiveTab(direction, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const pane = paneOf(state, id);
    const tabId = cycleTab(pane.tabs, pane.activeTabId, direction);
    if (tabId !== pane.activeTabId) await get().activateTab(tabId, id);
  },

  reorderTab(from, to, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const pane = paneOf(state, id);
    if (from === to || from < 0 || to < 0 || from >= pane.tabs.length || to >= pane.tabs.length) {
      return;
    }
    const tabs = [...pane.tabs];
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    set({ panes: patchPane(state.panes, id, { tabs }) });
  },

  setSelection(paths, anchorPath = null, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const next = normalizeSelection(paths);
    set({
      panes: patchPane(state.panes, id, {
        tabs: paneOf(state, id).tabs.map((tab) =>
          tab.id === paneOf(state, id).activeTabId
            ? {
                ...tab,
                selection: next,
                anchorPath: anchorPath ?? (next.length ? next[next.length - 1] : null),
              }
            : tab,
        ),
      }),
    });
  },
  toggleAt(entry, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    const result = toggleSelection(tab.selection, entry.path);
    set({
      panes: patchPaneTab(state.panes, id, tab.id, {
        selection: result.selection,
        anchorPath: result.anchorPath,
      }),
    });
  },
  selectRangeTo(entry, additive, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    const result = rangeSelection(
      displayedEntriesOf(state, id),
      tab.selection,
      tab.anchorPath,
      entry.path,
      additive,
    );
    set({
      panes: patchPaneTab(state.panes, id, tab.id, {
        selection: result.selection,
        anchorPath: result.anchorPath,
      }),
    });
  },
  selectAll(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    const entries = displayedEntriesOf(state, id);
    set({
      panes: patchPaneTab(state.panes, id, tab.id, {
        selection: selectAllPaths(entries),
        anchorPath: entries[0]?.path ?? null,
      }),
    });
  },
  clearSelection(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    set({
      panes: patchPaneTab(state.panes, id, tab.id, { selection: [], anchorPath: null }),
    });
  },

  setViewMode(mode, paneId) {
    const id = paneId ?? get().activePane;
    set((state) => ({ panes: patchPane(state.panes, id, { viewMode: mode }) }));
  },
  setSort(key, paneId) {
    const id = paneId ?? get().activePane;
    set((state) => {
      const pane = state.panes[id];
      return {
        panes: patchPane(state.panes, id,
          pane.sortKey === key
            ? { sortDirection: pane.sortDirection === "asc" ? "desc" : "asc" }
            : { sortKey: key, sortDirection: "asc" },
        ),
      };
    });
  },
  setSortExplicit(key, direction, paneId) {
    const id = paneId ?? get().activePane;
    set((state) => ({ panes: patchPane(state.panes, id, { sortKey: key, sortDirection: direction }) }));
  },
  setGroupBy(groupBy, paneId) {
    const id = paneId ?? get().activePane;
    set((state) => ({ panes: patchPane(state.panes, id, { groupBy }) }));
  },
  async setShowHidden(show, paneId) {
    const id = paneId ?? get().activePane;
    set((state) => ({ panes: patchPane(state.panes, id, { showHidden: show }) }));
    const tab = activeTabOfState(get(), id);
    if (tab.searchResults) {
      await get().runSearch(id);
    } else {
      await get().refresh(id);
    }
  },
  setShowExtensions(show, paneId) {
    const id = paneId ?? get().activePane;
    set((state) => ({ panes: patchPane(state.panes, id, { showExtensions: show }) }));
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
  setInterfaceTheme(interfaceTheme) {
    set({ interfaceTheme });
  },
  setColumnWidth(key, width) {
    set((state) => ({ columnWidths: { ...state.columnWidths, [key]: width } }));
  },
  setSidebarWidth(width) {
    set({ sidebarWidth: Math.max(160, Math.min(360, width)) });
  },

  setSearchQuery(query, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    if (tab.searchLoading) {
      void api.cancelSearch(tab.searchRequestId).catch(() => undefined);
    }
    if (!query.trim()) {
      set({
        panes: patchPaneTab(state.panes, id, tab.id, {
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
      panes: patchPaneTab(state.panes, id, tab.id, {
        searchQuery: query,
        searchResults: null,
        searchLoading: false,
        searchError: null,
        searchRequestId: tab.searchRequestId + 1,
      }),
    });
  },

  async runSearch(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const pane = paneOf(state, id);
    const tab = activeTabOf(pane);
    const query = tab.searchQuery.trim();
    if (!query) return;
    if (tab.searchLoading) {
      await api.cancelSearch(tab.searchRequestId).catch(() => undefined);
    }
    const requestId = tab.searchRequestId + 1;
    const root = tab.location === HOME_LOCATION ? state.platform?.home ?? "/" : tab.location;
    set((current) => ({
      panes: patchPaneTab(current.panes, id, tab.id, {
        searchLoading: true,
        searchError: null,
        searchRequestId: requestId,
        selection: [],
        anchorPath: null,
      }),
    }));
    try {
      const result = await api.searchFiles(root, query, pane.showHidden, 500, requestId);
      set((current) => {
        const target = findTab(current.panes[id].tabs, tab.id);
        if (!target || target.searchRequestId !== requestId || target.location !== tab.location) {
          return current;
        }
        return {
          panes: patchPaneTab(current.panes, id, tab.id, {
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
        const target = findTab(current.panes[id].tabs, tab.id);
        if (!target || target.searchRequestId !== requestId) return current;
        return {
          panes: patchPaneTab(current.panes, id, tab.id, {
            searchLoading: false,
            searchError: normalized.message,
            searchResults: [],
          }),
        };
      });
    }
  },

  clearSearch(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    if (tab.searchLoading) void api.cancelSearch(tab.searchRequestId).catch(() => undefined);
    set({
      panes: patchPaneTab(state.panes, id, tab.id, {
        searchQuery: "",
        searchResults: null,
        searchLoading: false,
        searchError: null,
      }),
    });
  },

  copySelection(paneId) {
    const entries = selectedEntriesOf(get(), paneId);
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

  cutSelection(paneId) {
    const entries = selectedEntriesOf(get(), paneId);
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

  async paste(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const clipboard = state.clipboard;
    if (!clipboard) return;
    const tab = activeTabOfState(state, id);
    if (tab.location === HOME_LOCATION) {
      get().toast({ title: "Choose a folder before pasting.", tone: "info" });
      return;
    }
    const destination = currentFolderOf(state, id);
    if (clipboard.mode === "cut") {
      const sameFolder = clipboard.paths.every((path) => parentPath(path) === destination);
      if (sameFolder) {
        set({ clipboard: null });
        get().toast({ title: "The items are already in this folder.", tone: "info" });
        return;
      }
    }
    await get().requestTransfer(clipboard.paths, destination, toTransferMode(clipboard.mode), {
      sourcePane: id,
      destinationPane: id,
    });
  },

  async executePaste(policy, paths, destination, mode, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const sourcePaths = paths ?? state.clipboard?.paths ?? [];
    if (!sourcePaths.length) return;
    const target = destination ?? currentFolderOf(state, id);
    if (target === HOME_LOCATION) return;
    get().enqueueTransfer({
      mode: toTransferMode(mode ?? state.clipboard?.mode ?? "copy"),
      sources: sourcePaths,
      destination: target,
      sourcePane: id,
      destinationPane: id,
      conflict: policy,
    });
  },

  copyPathsToClipboard(paths, mode = "copy") {
    if (!paths.length) return;
    set({
      clipboard: {
        mode,
        paths: [...paths],
        names: paths.map((path) => basename(path)),
      },
      contextMenu: null,
    });
  },

  async copyAsPath(paneId) {
    const paths = selectedEntriesOf(get(), paneId).map((entry) => entry.path);
    if (!paths.length) return;
    const success = await copyTextToClipboard(pathsAsText(paths));
    get().toast({
      title: success ? "Path copied to clipboard" : "Couldn't copy the path",
      detail: paths.length === 1 ? paths[0] : `${paths.length} paths`,
      tone: success ? "success" : "error",
    });
    set({ contextMenu: null });
  },

  async copyToOtherPane() {
    await get().transferToOtherPane("copy");
  },
  async moveToOtherPane() {
    await get().transferToOtherPane("move");
  },

  async requestTransfer(paths, destination, mode, options = {}) {
    const state = get();
    const sourcePane = options.sourcePane ?? state.activePane;
    const destinationPane = options.destinationPane ?? otherPane(sourcePane);
    const sources =
      mode === "move" ? paths.filter((path) => parentPath(path) !== destination) : paths.slice();
    if (!sources.length) {
      get().toast({ title: "The items are already in this folder.", tone: "info" });
      return;
    }
    if (isRecursiveTransfer(sources, destination)) {
      get().toast({
        title: "A folder can't be transferred into itself.",
        detail: destination,
        tone: "error",
      });
      return;
    }
    const destinationPaneState = paneOf(state, destinationPane);
    let entries: FileEntry[];
    try {
      const listing = await api.listDirectory(destination, destinationPaneState.showHidden);
      entries = listing.entries;
    } catch (error) {
      get().toastError(error);
      return;
    }
    const start = (policy: ConflictPolicy) => {
      get().enqueueTransfer({
        mode,
        sources,
        destination,
        sourcePane,
        destinationPane,
        conflict: policy,
      });
    };
    if (options.conflict) {
      start(options.conflict);
      return;
    }
    const conflicts = detectConflicts(sources, entries);
    if (conflicts.names.length) {
      get().openDialog({
        kind: "conflict",
        title:
          mode === "move"
            ? "There are already items with these names in the destination"
            : "There are already items with these names in the destination",
        message:
          "Choose how to handle the name conflicts. Nothing is overwritten unless you choose Replace.",
        conflicts: conflicts.names,
        destination,
        onChoose: async (policy) => {
          get().closeDialog();
          if (policy === "error") return;
          start(policy);
        },
      });
      return;
    }
    start("error");
  },

  enqueueTransfer(options) {
    const item = createTransferItem(options);
    set((state) => ({ transfers: [item, ...state.transfers].slice(0, 100) }));
    get().toast({
      title: options.mode === "copy" ? "Copy queued" : "Move queued",
      detail: `${options.sources.length} ${plural(options.sources.length, "item")} to ${options.destination}`,
      tone: "info",
      actionLabel: "Show transfers",
      onAction: () => get().openTransfers(),
    });
    void get().pumpTransfers();
    return item.id;
  },

  async pumpTransfers() {
    if (queueRunning) return;
    queueRunning = true;
    try {
      for (;;) {
        const item = get().transfers.find((transfer) => transfer.status === "queued");
        if (!item) break;
        await runQueuedTransfer(get, set, item);
      }
    } finally {
      queueRunning = false;
    }
  },

  handleTransferProgress(progress) {
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.numericId === progress.id ? applyProgress(item, progress) : item,
      ),
    }));
  },

  async cancelTransfer(id) {
    const item = get().transfers.find((transfer) => transfer.id === id);
    if (!item) return;
    if (item.status === "queued") {
      set((state) => ({
        transfers: state.transfers.map((transfer) =>
          transfer.id === id
            ? {
                ...transfer,
                status: "cancelled",
                phase: "cancelled",
                finishedAt: Date.now(),
                currentFile: null,
                bytesPerSecond: 0,
                etaSeconds: null,
                message: "Cancelled before it started.",
              }
            : transfer,
        ),
      }));
      return;
    }
    if (
      item.status === "completed" ||
      item.status === "failed" ||
      item.status === "cancelled"
    ) {
      return;
    }
    set((state) => ({
      transfers: state.transfers.map((transfer) =>
        transfer.id === id ? { ...transfer, message: "Cancelling..." } : transfer,
      ),
    }));
    await api.cancelTransfer(item.numericId).catch((error) => get().toastError(error));
  },

  async pauseTransfer(id, paused) {
    const item = get().transfers.find((transfer) => transfer.id === id);
    if (!item) return;
    if (paused && item.status !== "running" && item.status !== "paused") return;
    if (!paused && item.status !== "paused") return;
    set((state) => ({
      transfers: state.transfers.map((transfer) =>
        transfer.id === id
          ? { ...transfer, status: paused ? "paused" : "running", message: paused ? "Paused" : "Resuming..." }
          : transfer,
      ),
    }));
    await api.pauseTransfer(item.numericId, paused).catch((error) => get().toastError(error));
  },

  async retryTransfer(id) {
    const item = get().transfers.find((transfer) => transfer.id === id);
    if (!item || (item.status !== "failed" && item.status !== "cancelled")) return;
    set((state) => ({
      transfers: state.transfers.map((transfer) =>
        transfer.id === id
          ? {
              ...transfer,
              status: "queued",
              phase: "queued",
              startedAt: null,
              finishedAt: null,
              processedBytes: 0,
              processedItems: 0,
              bytesPerSecond: 0,
              etaSeconds: null,
              message: null,
              error: null,
              results: [],
            }
          : transfer,
      ),
    }));
    await get().pumpTransfers();
  },

  removeTransfer(id) {
    set((state) => ({
      transfers: state.transfers.filter(
        (transfer) =>
          transfer.id !== id ||
          transfer.status === "running" ||
          transfer.status === "paused" ||
          transfer.status === "queued" ||
          transfer.status === "scanning",
      ),
    }));
  },

  clearFinishedTransfers() {
    set((state) => ({
      transfers: state.transfers.filter(
        (transfer) =>
          transfer.status === "running" ||
          transfer.status === "paused" ||
          transfer.status === "queued" ||
          transfer.status === "scanning",
      ),
    }));
  },

  openTransfers() {
    set({ transfersOpen: true, contextMenu: null });
  },
  closeTransfers() {
    set({ transfersOpen: false });
  },

  async startComparison(verifyContent = false) {
    const state = get();
    if (!state.dualPane) {
      get().toast({ title: "Turn on dual-pane mode to compare folders.", tone: "info" });
      return;
    }
    const left = currentFolderOf(state, "left");
    const right = currentFolderOf(state, "right");
    if (left === right) {
      get().toast({ title: "The panes are showing the same folder.", tone: "info" });
      return;
    }
    comparisonCounter += 1;
    const requestId = comparisonCounter;
    const previous = state.comparison;
    const filterDifferences =
      previous && previous.left === left && previous.right === right
        ? previous.filterDifferences
        : false;
    set({
      comparison: {
        requestId,
        left,
        right,
        verifyContent,
        loading: true,
        scanned: 0,
        total: 0,
        current: null,
        result: null,
        cancelled: false,
        error: null,
        filterDifferences,
        open: true,
      },
      contextMenu: null,
    });
    try {
      const result = await api.compareFolders(left, right, verifyContent, requestId);
      set((current) => {
        if (!current.comparison || current.comparison.requestId !== requestId) return current;
        return {
          comparison: {
            ...current.comparison,
            loading: false,
            result,
            scanned: result.scanned,
            total: result.entries.length,
            cancelled: result.cancelled,
            error: null,
          },
        };
      });
    } catch (error) {
      const normalized = normalizeError(error);
      set((current) => {
        if (!current.comparison || current.comparison.requestId !== requestId) return current;
        return {
          comparison: {
            ...current.comparison,
            loading: false,
            error: normalized.message,
            cancelled: normalized.code === "cancelled",
          },
        };
      });
    }
  },

  async cancelComparison() {
    const comparison = get().comparison;
    if (!comparison || comparison.loading === false) return;
    set({
      comparison: { ...comparison, cancelled: true, current: null },
    });
    await api.cancelCompare(comparison.requestId).catch((error) => get().toastError(error));
  },

  setComparisonFilter(differencesOnly) {
    const comparison = get().comparison;
    if (!comparison) return;
    set({ comparison: { ...comparison, filterDifferences: differencesOnly } });
  },

  setComparisonOpen(open) {
    const comparison = get().comparison;
    if (!comparison) return;
    set({ comparison: { ...comparison, open } });
  },

  closeComparison() {
    set({ comparison: null });
  },

  deleteSelection(permanent = false, paneId) {
    const sourcePane = paneId ?? get().activePane;
    const entries = selectedEntriesOf(get(), sourcePane);
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
        await get().confirmDelete(entries.map((entry) => entry.path), permanent, sourcePane);
      },
    });
  },

  async confirmDelete(paths, permanent, paneId) {
    const sourcePane = paneId ?? get().activePane;
    const sourceFolder = currentFolderOf(get(), sourcePane);
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
      const state = get();
      get().clearSelection(sourcePane);
      await get().refresh(sourcePane);
      const mirror = otherPane(sourcePane);
      if (state.dualPane && currentFolderOf(get(), mirror) === sourceFolder) {
        await get().refresh(mirror);
      }
    } catch (error) {
      get().toastError(error);
    } finally {
      set({ operation: null });
    }
  },

  promptRename(paneId) {
    const id = paneId ?? get().activePane;
    const entries = selectedEntriesOf(get(), id);
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
        await get().renameTo(entry.path, value, id);
        get().closeDialog();
      },
    });
    set({ contextMenu: null });
  },

  async renameTo(path, newName, paneId) {
    const id = paneId ?? get().activePane;
    const newPath = await api.renamePath(path, newName);
    await get().refresh(id);
    get().setSelection([newPath], newPath, id);
    get().toast({ title: "Renamed", detail: newName, tone: "success" });
    return newPath;
  },

  async promptNewFolder(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    if (activeTabOfState(state, id).location === HOME_LOCATION) return;
    const folder = currentFolderOf(state, id);
    const name = uniqueName(currentEntriesOf(state, id), "New folder");
    try {
      const entry = await api.createFolder(folder, name);
      await get().refresh(id);
      get().setSelection([entry.path], entry.path, id);
      get().openDialog({
        kind: "prompt",
        title: "New folder",
        label: "Folder name",
        initialValue: entry.name,
        confirmLabel: "Create",
        selectStem: true,
        onConfirm: async (value) => {
          if (value.trim() && value !== entry.name) {
            await get().renameTo(entry.path, value, id);
          }
          get().closeDialog();
        },
      });
    } catch (error) {
      get().toastError(error);
    }
  },

  async promptNewTextFile(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    if (activeTabOfState(state, id).location === HOME_LOCATION) return;
    const folder = currentFolderOf(state, id);
    const name = uniqueName(currentEntriesOf(state, id), "New Text Document", ".txt");
    try {
      const entry = await api.createTextFile(folder, name, "");
      await get().refresh(id);
      get().setSelection([entry.path], entry.path, id);
      get().openDialog({
        kind: "prompt",
        title: "New text document",
        label: "File name",
        initialValue: entry.name,
        confirmLabel: "Create",
        selectStem: true,
        onConfirm: async (value) => {
          if (value.trim() && value !== entry.name) {
            await get().renameTo(entry.path, value, id);
          }
          get().closeDialog();
        },
      });
    } catch (error) {
      get().toastError(error);
    }
  },

  async createShortcut(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const entries = selectedEntriesOf(state, id);
    if (!entries.length) return;
    let created = 0;
    const usedNames = new Set(currentEntriesOf(state, id).map((entry) => entry.name.toLowerCase()));
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
      await get().refresh(id);
    }
    set({ contextMenu: null });
  },

  async duplicateSelection(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const entries = selectedEntriesOf(state, id);
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
      await get().refresh(id);
    } catch (error) {
      get().toastError(error);
    } finally {
      set({ operation: null });
    }
  },

  async sendSelectionTo(destination, mode = "cut", paneId) {
    const entries = selectedEntriesOf(get(), paneId);
    if (!entries.length) return;
    await get().moveOrCopyPaths(
      entries.map((entry) => entry.path),
      destination,
      toTransferMode(mode),
      paneId,
    );
    set({ contextMenu: null });
  },

  async moveOrCopyPaths(paths, destination, mode, sourcePane, destinationPane) {
    const id = sourcePane ?? get().activePane;
    await get().requestTransfer(paths, destination, mode, {
      sourcePane: id,
      destinationPane: destinationPane ?? id,
    });
  },

  async revealInPane(path, paneId) {
    set({ contextMenu: null });
    if (!path) return false;
    const initial = get();
    const parent = parentPath(path);
    const folder = parent ?? path;
    const preferred: PaneId[] = initial.dualPane
      ? [initial.activePane, otherPane(initial.activePane)]
      : ["left"];

    // Default Reveal is pane-aware. Prefer a pane whose visible folder already
    // contains the result, then reuse an inactive tab that shows it, and only
    // navigate the active pane when the folder is not open anywhere.
    let target: PaneId;
    if (initial.dualPane && paneId) {
      target = paneId;
    } else {
      target =
        preferred.find((id) =>
          foldersMatch(tabFolderOf(initial, activeTabOf(initial.panes[id])), folder),
        ) ??
        preferred.find((id) => Boolean(findTabInFolder(initial, id, folder))) ??
        preferred[0];
    }

    const existingTab = findTabInFolder(initial, target, folder);
    if (existingTab && existingTab.id !== initial.panes[target].activeTabId) {
      await get().activateTab(existingTab.id, target);
    }
    if (get().dualPane) {
      if (get().panes[target].collapsed) get().setPaneCollapsed(target, false);
      get().setActivePane(target);
    }

    if (!parent) {
      // A filesystem root has no parent listing in which to select it.
      if (!foldersMatch(currentFolderOf(get(), target), path)) {
        return get().navigate(path, { paneId: target, skipSync: true });
      }
      return true;
    }

    const current = get();
    const tab = activeTabOfState(current, target);
    const showingFolder = foldersMatch(tabFolderOf(current, tab), parent);
    const cleanListing =
      showingFolder &&
      tab.searchResults === null &&
      tab.listingFor !== null &&
      foldersMatch(tab.listingFor, parent);
    const alreadyListed =
      cleanListing && tab.entries.some((entry) => foldersMatch(entry.path, path));

    if (!showingFolder) {
      const ok = await get().navigate(parent, {
        paneId: target,
        skipSync: true,
      });
      if (!ok) return false;
    } else if (!alreadyListed) {
      // The folder may be showing a contextual search, a stale listing, or an
      // item created after the pane last loaded. Refresh in place without
      // adding history so Reveal never selects an entry that is not on screen.
      const ok = await get().navigate(parent, {
        paneId: target,
        history: false,
        force: true,
        skipSync: true,
      });
      if (!ok) return false;
    }

    let latest = get();
    let latestTab = activeTabOfState(latest, target);
    if (latestTab.error) {
      get().toastError(latestTab.error);
      return false;
    }
    let match = latestTab.entries.find((entry) => foldersMatch(entry.path, path));
    if (!match && !latest.panes[target].showHidden && basename(path).startsWith(".")) {
      // Hidden dotfiles are commonly returned by Universal Search even when the
      // destination pane hides hidden items.
      await get().setShowHidden(true, target);
      latest = get();
      latestTab = activeTabOfState(latest, target);
      match = latestTab.entries.find((entry) => foldersMatch(entry.path, path));
    }
    if (!match) {
      get().toast({
        title: "This item can't be found.",
        detail: `${basename(path)} may have been moved or deleted.`,
        tone: "info",
      });
      return false;
    }

    get().setSelection([match.path], match.path, target);
    // The pane may have just mounted (the full search workspace was replaced),
    // so focus and scroll on the next frame once the file list exists.
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("explorer:focus-path", { detail: { paneId: target, path: match.path } }),
        );
        window.dispatchEvent(
          new CustomEvent("explorer:focus-list", { detail: { paneId: target } }),
        );
      }, 40);
    }
    return true;
  },

  async revealSelection(paneId) {
    const entry = selectedEntriesOf(get(), paneId)[0];
    const target = entry?.path ?? currentFolderOf(get(), paneId);
    try {
      await api.revealPath(target);
    } catch (error) {
      get().toastError(error);
    }
    set({ contextMenu: null });
  },

  async openTerminalHere(paneId) {
    const target = currentFolderOf(get(), paneId);
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

  async shareSelection(paneId) {
    const entries = selectedEntriesOf(get(), paneId);
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
    const paneId = (menu && "paneId" in menu ? menu.paneId : undefined) ?? get().activePane;
    set({ contextMenu: menu, activePane: paneId });
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

  async transferToOtherPane(mode) {
    const state = get();
    if (!state.dualPane) {
      get().toast({ title: "Turn on dual-pane mode to transfer between panes.", tone: "info" });
      return;
    }
    const sourcePane = state.activePane;
    const destinationPane = otherPane(sourcePane);
    const entries = selectedEntriesOf(state, sourcePane);
    if (!entries.length) {
      get().toast({ title: "Select items to transfer first.", tone: "info" });
      return;
    }
    const destination = currentFolderOf(state, destinationPane);
    await get().requestTransfer(
      entries.map((entry) => entry.path),
      destination,
      mode,
      { sourcePane, destinationPane },
    );
  },
}));

function applyProgress(item: TransferItem, progress: TransferProgress): TransferItem {
  const status =
    progress.status === "running" || progress.status === "paused" || progress.status === "queued"
      ? (progress.status as TransferItem["status"])
      : item.status;
  return {
    ...item,
    status,
    phase: progress.phase,
    currentFile: progress.currentFile,
    processedBytes: Math.max(item.processedBytes, progress.processedBytes),
    totalBytes: Math.max(item.totalBytes, progress.totalBytes),
    processedItems: Math.max(item.processedItems, progress.processedItems),
    totalItems: Math.max(item.totalItems, progress.totalItems),
    bytesPerSecond: progress.bytesPerSecond,
    etaSeconds: progress.etaSeconds,
    message: progress.message,
  };
}

/**
 * Runs one queued transfer and merges its outcome into the store. Kept outside
 * the store factory so the queue loop cannot accidentally capture stale state.
 */
async function runQueuedTransfer(
  get: () => ExplorerState,
  set: (partial: Partial<ExplorerState> | ((state: ExplorerState) => Partial<ExplorerState>)) => void,
  item: TransferItem,
): Promise<void> {
  const started = Date.now();
  set((state) => ({
    transfers: state.transfers.map((transfer) =>
      transfer.id === item.id
        ? {
            ...transfer,
            status: "scanning",
            phase: "scanning",
            startedAt: started,
            finishedAt: null,
            error: null,
            message: "Scanning items...",
            results: [],
          }
        : transfer,
    ),
  }));
  try {
    const outcome = await api.transferPaths({
      id: item.numericId,
      paths: item.sources,
      destination: item.destination,
      mode: item.mode,
      conflict: item.conflict,
    });
    const summary = summarizeResults(outcome.results);
    const failed = outcome.results.filter((result) => result.status === "failed");
    const completed = outcome.results.filter((result) => result.status === "completed").length;
    const status: TransferItem["status"] = outcome.cancelled
      ? "cancelled"
      : failed.length && completed === 0
        ? "failed"
        : "completed";
    set((state) => ({
      transfers: state.transfers.map((transfer) =>
        transfer.id === item.id
          ? {
              ...transfer,
              status,
              phase: status,
              finishedAt: Date.now(),
              processedBytes: outcome.processedBytes,
              totalBytes: outcome.totalBytes,
              processedItems: outcome.processedItems,
              totalItems: outcome.totalItems,
              bytesPerSecond: 0,
              etaSeconds: null,
              results: outcome.results,
              message: summary,
              currentFile: null,
              error:
                status === "failed"
                  ? failed[0]?.error ?? "The transfer could not be completed."
                  : failed.length
                    ? `${failed.length} ${plural(failed.length, "item")} could not be transferred.`
                    : null,
            }
          : transfer,
      ),
    }));
    if (outcome.cancelled) {
      get().toast({
        title: item.mode === "copy" ? "Copy cancelled" : "Move cancelled",
        detail: "Completed items were kept; temporary files were removed.",
        tone: "info",
      });
    } else if (failed.length && completed === 0) {
      get().toast({
        title: item.mode === "copy" ? "Copy failed" : "Move failed",
        detail: failed[0]?.error ?? undefined,
        tone: "error",
        actionLabel: "Show transfers",
        onAction: () => get().openTransfers(),
      });
    } else {
      get().toast({
        title: item.mode === "copy" ? "Items copied" : "Items moved",
        detail: summary,
        tone: failed.length ? "error" : "success",
        actionLabel: "Show transfers",
        onAction: () => get().openTransfers(),
      });
    }
    if (item.mode === "move" && completed > 0) {
      set({ clipboard: null });
    }
    const history: TransferHistoryItem = {
      id: item.id,
      mode: item.mode,
      status,
      sources: item.sources,
      destination: item.destination,
      completedAt: Date.now(),
      totalBytes: outcome.totalBytes,
      processedBytes: outcome.processedBytes,
      message: failed.length ? summary : null,
    };
    set((state) => ({ transferHistory: [history, ...state.transferHistory].slice(0, 40) }));
    const refreshTargets = new Set<PaneId>([item.sourcePane, item.destinationPane]);
    if (item.mode === "move") {
      // A paste records the destination pane as the source pane, so the other
      // pane would keep listing files that the move already removed and the
      // operation looks like a copy. Also reload every pane that shows one of
      // the folders the items were moved out of.
      const state = get();
      const folders = {
        left: currentFolderOf(state, "left"),
        right: currentFolderOf(state, "right"),
      };
      for (const paneId of panesShowingSources(folders, item.sources)) {
        refreshTargets.add(paneId);
      }
    }
    await Promise.all([...refreshTargets].map((paneId) => get().refresh(paneId)));
  } catch (error) {
    const normalized = normalizeError(error);
    set((state) => ({
      transfers: state.transfers.map((transfer) =>
        transfer.id === item.id
          ? {
              ...transfer,
              status: normalized.code === "cancelled" ? "cancelled" : "failed",
              phase: "failed",
              finishedAt: Date.now(),
              message: normalized.message,
              error: normalized.message,
              currentFile: null,
            }
          : transfer,
      ),
    }));
    get().toast({
      title: item.mode === "copy" ? "Copy failed" : "Move failed",
      detail: normalized.message,
      tone: normalized.code === "cancelled" ? "info" : "error",
      actionLabel: "Show transfers",
      onAction: () => get().openTransfers(),
    });
  }
}

export function selectPane(state: ExplorerState, paneId?: PaneId): PaneState {
  return paneOf(state, paneId);
}

export function selectPaneActiveTab(state: ExplorerState, paneId?: PaneId): TabState {
  return activeTabOfState(state, paneId);
}

export function selectVisibleEntriesForPane(state: ExplorerState, paneId?: PaneId): FileEntry[] {
  const id = paneId ?? state.activePane;
  const pane = paneOf(state, id);
  const tab = activeTabOf(pane);
  const entries = tab.searchResults ?? tab.entries;
  return filterEntries(sortEntries(entries, pane.sortKey, pane.sortDirection), "");
}

export function selectSelectionStatsForPane(
  state: ExplorerState,
  paneId?: PaneId,
): {
  count: number;
  bytes: number;
  entries: FileEntry[];
} {
  return selectionStats(currentEntriesOf(state, paneId), activeTabOfState(state, paneId).selection);
}

export function selectStatusTextForPane(state: ExplorerState, paneId?: PaneId): string {
  const id = paneId ?? state.activePane;
  const tab = activeTabOfState(state, id);
  if (tab.location === HOME_LOCATION) return "Home";
  const entries = tab.searchResults ?? tab.entries;
  const stats = selectionStats(entries, tab.selection);
  const total = entries.length;
  const itemLabel = `${formatCount(total)} ${plural(total, "item")}`;
  if (stats.count === 0) return itemLabel;
  const size = stats.bytes > 0 ? ` ${formatSize(stats.bytes)}` : "";
  return `${itemLabel} | ${formatCount(stats.count)} ${plural(stats.count, "item")} selected${size}`;
}

export function selectLocationLabelForPane(state: ExplorerState, paneId?: PaneId): string {
  const tab = activeTabOfState(state, paneId);
  if (tab.location === HOME_LOCATION) return "Home";
  return basename(tab.location) || tab.location;
}

export function selectBreadcrumbsForPane(state: ExplorerState, paneId?: PaneId): ReturnType<typeof breadcrumbs> {
  const tab = activeTabOfState(state, paneId);
  return breadcrumbs(
    tab.location === HOME_LOCATION ? HOME_LOCATION : tab.location,
    state.platform?.computerLabel ?? "This PC",
    HOME_LOCATION,
  );
}

// Backwards-compatible selectors for the active pane.
export function selectVisibleEntries(state: ExplorerState): FileEntry[] {
  return selectVisibleEntriesForPane(state);
}

export function selectSelectionStats(state: ExplorerState): {
  count: number;
  bytes: number;
  entries: FileEntry[];
} {
  return selectSelectionStatsForPane(state);
}

export function selectBreadcrumbs(state: ExplorerState): ReturnType<typeof breadcrumbs> {
  return selectBreadcrumbsForPane(state);
}

export function selectStatusText(state: ExplorerState): string {
  return selectStatusTextForPane(state);
}

export function selectLocationLabel(state: ExplorerState): string {
  return selectLocationLabelForPane(state);
}

export function startPersistence(): void {
  if (persistenceStarted) return;
  persistenceStarted = true;
  useExplorerStore.subscribe((state) => {
    if (!state.initialized) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const left = persistedPaneFromState(state.panes.left);
      const right = persistedPaneFromState(state.panes.right);
      const snapshot: PersistedState = {
        version: 1,
        tabs: left.tabs,
        activeTabId: left.activeTabId,
        viewMode: left.viewMode,
        sortKey: left.sortKey,
        sortDirection: left.sortDirection,
        groupBy: left.groupBy,
        showHidden: left.showHidden,
        showExtensions: left.showExtensions,
        detailsPane: state.detailsPane,
        previewPane: state.previewPane,
        theme: state.theme,
        interfaceTheme: state.interfaceTheme,
        columnWidths: state.columnWidths,
        sidebarWidth: state.sidebarWidth,
        pinned: state.pinned,
        recents: state.recents,
        dualPane: state.dualPane,
        activePane: state.activePane,
        splitRatio: state.splitRatio,
        syncNavigation: state.syncNavigation,
        panes: { left, right },
        shortcuts: state.shortcuts,
        transferHistory: state.transferHistory,
      };
      savePersisted(snapshot);
    }, 250);
  });
}
