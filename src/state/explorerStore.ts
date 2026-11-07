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
import {
  createNetworkConnectionId,
  networkAddressHasShare,
  networkConnectionName,
  networkDisplayName,
  normalizeNetworkAddress,
} from "../lib/network";
import {
  DEFAULT_TAG_COLOR,
  countForTag,
  createTagDefinition,
  duplicateAssignmentPaths,
  entriesForTag,
  isPathOrDescendant,
  normalizeTagColor,
  normalizeTagName,
  pruneTagIds,
  removeAssignmentsForPaths,
  renameAssignmentPaths,
  replacePathPrefix,
  samePath as sameTagPath,
  setTagOnPaths,
  snapshotForPath,
  tagPathKey,
  uniqueTagName,
  type TagSnapshot,
} from "../lib/tags";
import type {
  AppError,
  ClipboardState,
  ColumnVisibility,
  ComparisonProgress,
  ConflictPolicy,
  ContextMenuState,
  DialogState,
  DisplayPreferences,
  FileEntry,
  FolderComparisonState,
  FolderStats,
  FolderOpenMode,
  GroupBy,
  InterfaceTheme,
  Location,
  NetworkConnection,
  OperationState,
  OperationResult,
  PaneId,
  PaneState,
  PersistedState,
  PlatformInfo,
  PreviewPreferences,
  PreviewPosition,
  PreviewRendererId,
  Properties,
  RecentItem,
  ShortcutMap,
  SortDirection,
  SortKey,
  TabState,
  TagAssignment,
  TagDefinition,
  ThemeMode,
  ToastMessage,
  TransferHistoryItem,
  TransferItem,
  TransferMode,
  TransferProgress,
  UiDensity,
  UiIconSize,
  UiTextSize,
  ViewMode,
} from "../lib/types";
import {
  DEFAULT_PREVIEW_PREFERENCES,
  HOME_LOCATION,
  NETWORK_LOCATION,
  RECENTS_LOCATION,
  isVirtualLocation,
} from "../lib/types";
import { DEFAULT_DISPLAY_PREFERENCES, DEFAULT_INTERFACE_THEME } from "../lib/theme";

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
  /** Legacy boolean mirror of `preview.visible`, kept for existing callers. */
  previewPane: boolean;
  preview: PreviewPreferences;
  /** True while the native Quick Look panel owns the screen. */
  quickLookOpen: boolean;
  theme: ThemeMode;
  interfaceTheme: InterfaceTheme;
  display: DisplayPreferences;
  columnVisibility: ColumnVisibility;
  commandBarLabels: boolean;
  sidebarVisible: boolean;
  folderOpenMode: FolderOpenMode;
  confirmTrashDelete: boolean;
  columnWidths: Record<string, number>;
  sidebarWidth: number;
  pinned: string[];
  recents: RecentItem[];
  tags: TagDefinition[];
  tagAssignments: TagAssignment[];
  networkConnections: NetworkConnection[];
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
  tag: (id: string) => TagDefinition | undefined;
  tagIdsForPath: (path: string) => string[];
  tagFilterEntries: (paneId?: PaneId) => FileEntry[];
  createTag: (name: string, color?: string) => string;
  updateTag: (id: string, patch: { name?: string; color?: string }) => void;
  deleteTag: (id: string) => void;
  reorderTags: (fromId: string, toId: string) => void;
  assignTag: (paths: string[], tagId: string, snapshots?: TagSnapshot[]) => void;
  unassignTag: (paths: string[], tagId: string) => void;
  toggleTag: (paths: string[], tagId: string, snapshots?: TagSnapshot[]) => void;
  setTagFilter: (tagId: string | null, paneId?: PaneId) => void;
  clearTagFilter: (paneId?: PaneId) => void;
  openTagEditor: (tagId?: string, assignPaths?: string[]) => void;
  reorderPinned: (fromPath: string, toPath: string) => void;
  refreshLocations: () => Promise<void>;
  ejectVolume: (path: string) => Promise<void>;
  openNetworkConnectionDialog: (connectionId?: string) => void;
  saveNetworkConnection: (input: {
    id?: string;
    name: string;
    address: string;
    username?: string;
    password?: string;
  }) => string;
  removeNetworkConnection: (id: string) => void;
  connectNetworkConnection: (
    id: string,
    credentials?: { username?: string; password?: string },
  ) => Promise<void>;
  openNetworkConnection: (id: string) => Promise<void>;

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
  setPreviewVisible: (show: boolean) => void;
  openQuickLook: (paths: string[]) => Promise<void>;
  closeQuickLook: () => Promise<void>;
  setPreviewPosition: (position: PreviewPosition) => void;
  setPreviewFocusMode: (enabled: boolean) => void;
  setPreviewRatio: (ratio: number, width?: number) => void;
  setPreviewHeightRatio: (ratio: number, height?: number) => void;
  setPreviewAutoPlay: (enabled: boolean) => void;
  setPreviewTextLimit: (bytes: number) => void;
  setPreviewRendererEnabled: (id: PreviewRendererId, enabled: boolean) => void;
  restoreDefaultLayout: () => void;
  setTheme: (theme: ThemeMode) => void;
  setInterfaceTheme: (theme: InterfaceTheme) => void;
  setDensity: (density: UiDensity) => void;
  setTextSize: (size: UiTextSize) => void;
  setIconSize: (size: UiIconSize) => void;
  setColumnVisible: (column: keyof ColumnVisibility, visible: boolean) => void;
  resetColumnWidths: () => void;
  setCommandBarLabels: (visible: boolean) => void;
  setSidebarVisible: (visible: boolean) => void;
  toggleSidebar: () => void;
  setFolderOpenMode: (mode: FolderOpenMode) => void;
  setConfirmTrashDelete: (confirm: boolean) => void;
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
  const pane = paneOf(state, paneId);
  if (pane.tagFilterId) return entriesForTag(state.tagAssignments, pane.tagFilterId);
  const tab = activeTabOfState(state, paneId);
  return tab.searchResults ?? tab.entries;
}

function tabFolderOf(state: ExplorerState, tab: TabState): string {
  if (tab.location === HOME_LOCATION) return state.platform?.home ?? "/";
  return tab.location;
}

/**
 * Builds assignment snapshots from live listings in a single pass, then falls
 * back to the path basename for items that are not currently visible.
 */
function snapshotsFor(
  state: ExplorerState,
  paths: string[],
  provided?: TagSnapshot[],
): Map<string, TagSnapshot> {
  const snapshots = new Map<string, TagSnapshot>();
  for (const snapshot of provided ?? []) {
    snapshots.set(tagPathKey(snapshot.path), snapshot);
  }
  const wanted = new Set<string>();
  for (const path of paths) {
    const key = tagPathKey(path);
    if (!snapshots.has(key)) wanted.add(key);
  }
  if (wanted.size) {
    for (const paneId of ["left", "right"] as PaneId[]) {
      for (const tab of state.panes[paneId].tabs) {
        for (const entries of [tab.entries, tab.searchResults ?? []]) {
          for (const entry of entries) {
            const key = tagPathKey(entry.path);
            if (!wanted.has(key)) continue;
            snapshots.set(key, snapshotForPath(entry.path, entry));
            wanted.delete(key);
          }
        }
        if (!wanted.size) break;
      }
      if (!wanted.size) break;
    }
  }
  for (const path of paths) {
    const key = tagPathKey(path);
    if (!snapshots.has(key)) snapshots.set(key, snapshotForPath(path));
  }
  return snapshots;
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
  const recents = [
    item,
    ...state.recents.filter((recent) => !sameTagPath(recent.path, path)),
  ];
  return recents.slice(0, 20);
}

/** Deduplicates paths case-insensitively while preserving the first spelling. */
function uniquePathList(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = tagPathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

/** Rewrites pinned/recents paths after a rename or move. */
function rewritePathList(paths: string[], from: string, to: string): string[] {
  return uniquePathList(paths.map((path) => replacePathPrefix(path, from, to) ?? path));
}

function rewriteRecentItems(recents: RecentItem[], from: string, to: string): RecentItem[] {
  const rewritten = recents.map((recent) => {
    const path = replacePathPrefix(recent.path, from, to);
    if (!path) return recent;
    return {
      ...recent,
      path,
      name: sameTagPath(recent.path, from) ? basename(path) || recent.name : recent.name,
    };
  });
  const seen = new Set<string>();
  return rewritten.filter((recent) => {
    const key = tagPathKey(recent.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Removes a deleted subtree from pinned folders and recent items. */
function forgetDeletedPaths(
  paths: string[],
  values: string[],
  recents: RecentItem[],
): { pinned: string[]; recents: RecentItem[] } {
  const roots = paths.filter(Boolean);
  return {
    pinned: values.filter(
      (value) => !roots.some((root) => isPathOrDescendant(value, root)),
    ),
    recents: recents.filter(
      (recent) => !roots.some((root) => isPathOrDescendant(recent.path, root)),
    ),
  };
}

// Credentials supplied in the connection dialog are kept in memory only, long
// enough to complete the mount. They are never part of a persisted snapshot.
const networkSessionCredentials = new Map<
  string,
  { username?: string; password?: string }
>();

// Selector helpers must return a stable reference when there is nothing to
// return. A fresh `[]` on every call changes the zustand snapshot identity, so
// React keeps re-rendering the subtree after any unrelated state change until
// it aborts with "Maximum update depth exceeded" (React #185).
const NO_TAG_IDS: string[] = [];

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
  preview: { ...DEFAULT_PREVIEW_PREFERENCES },
  quickLookOpen: false,
  theme: initialPreferences.theme,
  interfaceTheme: initialPreferences.interfaceTheme,
  display: { ...DEFAULT_DISPLAY_PREFERENCES },
  columnVisibility: { date: true, type: true, size: true },
  commandBarLabels: true,
  sidebarVisible: true,
  folderOpenMode: "sameTab",
  confirmTrashDelete: true,
  columnWidths: { name: 272, date: 144, type: 120, size: 80, location: 260 },
  sidebarWidth: 204,
  pinned: [],
  recents: [],
  tags: [],
  tagAssignments: [],
  networkConnections: [],
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
  isPinned: (path) => get().pinned.some((item) => sameTagPath(item, path)),
  tag: (id) => get().tags.find((tag) => tag.id === id),
  tagIdsForPath: (path) => {
    const key = tagPathKey(path);
    return (
      get().tagAssignments.find((assignment) => tagPathKey(assignment.path) === key)
        ?.tagIds ?? NO_TAG_IDS
    );
  },
  tagFilterEntries: (paneId) => {
    const state = get();
    const filter = paneOf(state, paneId).tagFilterId;
    return filter ? entriesForTag(state.tagAssignments, filter) : [];
  },

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
      let preview: PreviewPreferences = { ...DEFAULT_PREVIEW_PREFERENCES };
      let theme: ThemeMode = "system";
      let interfaceTheme: InterfaceTheme = DEFAULT_INTERFACE_THEME;
      let display: DisplayPreferences = { ...DEFAULT_DISPLAY_PREFERENCES };
      let columnVisibility: ColumnVisibility = { date: true, type: true, size: true };
      let commandBarLabels = true;
      let sidebarVisible = true;
      let folderOpenMode: FolderOpenMode = "sameTab";
      let confirmTrashDelete = true;
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
      let tags: TagDefinition[] = [];
      let tagAssignments: TagAssignment[] = [];
      let networkConnections: NetworkConnection[] = [];

      if (persisted) {
        detailsPane = persisted.detailsPane;
        preview = persisted.preview ?? {
          ...DEFAULT_PREVIEW_PREFERENCES,
          visible: persisted.previewPane,
        };
        if (detailsPane && preview.visible) {
          preview = { ...preview, visible: false };
        }
        theme = persisted.theme;
        interfaceTheme = persisted.interfaceTheme;
        display = persisted.display;
        columnVisibility = persisted.columnVisibility;
        commandBarLabels = persisted.commandBarLabels;
        sidebarVisible = persisted.sidebarVisible;
        folderOpenMode = persisted.folderOpenMode;
        confirmTrashDelete = persisted.confirmTrashDelete;
        columnWidths = persisted.columnWidths;
        sidebarWidth = persisted.sidebarWidth;
        pinned = persisted.pinned;
        recents = persisted.recents;
        shortcuts = persisted.shortcuts;
        transferHistory = persisted.transferHistory;
        tags = persisted.tags;
        tagAssignments = persisted.tagAssignments;
        networkConnections = persisted.networkConnections;
      }

      // First run only: give the Favorites section the familiar standard
      // locations. Existing installations keep exactly the pins they chose.
      if (!persisted) {
        const defaultIds = ["desktop", "documents", "downloads", "applications"];
        pinned = defaultIds
          .map((id) => locations.find((location) => location.id === id)?.path)
          .filter((path): path is string => Boolean(path));
      }

      const validTagIds = new Set(tags.map((tag) => tag.id));
      tagAssignments = pruneTagIds(tagAssignments, validTagIds);
      panes = {
        left: {
          ...panes.left,
          tagFilterId:
            panes.left.tagFilterId && validTagIds.has(panes.left.tagFilterId)
              ? panes.left.tagFilterId
              : null,
        },
        right: {
          ...panes.right,
          tagFilterId:
            panes.right.tagFilterId && validTagIds.has(panes.right.tagFilterId)
              ? panes.right.tagFilterId
              : null,
        },
      };

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
        previewPane: preview.visible,
        preview,
        theme,
        interfaceTheme,
        display,
        columnVisibility,
        commandBarLabels,
        sidebarVisible,
        folderOpenMode,
        confirmTrashDelete,
        columnWidths,
        sidebarWidth,
        pinned,
        recents,
        tags,
        tagAssignments,
        networkConnections,
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
    if (!isVirtualLocation(path)) {
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
      panes: patchPane(
        patchPaneTab(current.panes, paneId, tab.id, {
          location: resolved,
          history: historyState.history,
          historyIndex: historyState.index,
          selection: [],
          anchorPath: null,
          searchQuery: "",
          searchResults: null,
          searchLoading: false,
          searchError: null,
          entries:
            isVirtualLocation(resolved)
              ? []
              : findTab(current.panes[paneId].tabs, tab.id)?.entries ?? [],
          listingFor: null,
          loading: !isVirtualLocation(resolved),
          error: null,
        }),
        paneId,
        { tagFilterId: null },
      ),
      contextMenu: null,
      recents: isVirtualLocation(resolved)
        ? current.recents
        : addRecentTo(current, resolved, true),
    }));
    if (!isVirtualLocation(resolved)) {
      await get().refresh(paneId);
    }

    const after = get();
    if (
      after.syncNavigation &&
      after.dualPane &&
      !options.skipSync &&
      after.syncAnchors &&
      !isVirtualLocation(resolved)
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
      if (get().folderOpenMode === "newTab") {
        await get().openInNewTab(entry.path, paneId);
      } else {
        await get().navigate(entry.path, { paneId });
      }
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
      panes: patchPane(
        patchPaneTab(current.panes, id, tab.id, {
          location,
          history: next.history,
          historyIndex: next.index,
          selection: [],
          anchorPath: null,
          searchQuery: "",
          searchResults: null,
          loading: !isVirtualLocation(location),
          error: null,
        }),
        id,
        { tagFilterId: null },
      ),
    }));
    if (!isVirtualLocation(location)) await get().refresh(id);
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
      panes: patchPane(
        patchPaneTab(current.panes, id, tab.id, {
          location,
          history: next.history,
          historyIndex: next.index,
          selection: [],
          anchorPath: null,
          searchQuery: "",
          searchResults: null,
          loading: !isVirtualLocation(location),
          error: null,
        }),
        id,
        { tagFilterId: null },
      ),
    }));
    if (!isVirtualLocation(location)) await get().refresh(id);
  },

  async goUp(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const folder = currentFolderOf(state, id);
    if (folder === HOME_LOCATION || isVirtualLocation(folder)) return;
    const parent = parentPath(folder);
    if (!parent) return;
    await get().navigate(parent, { paneId: id });
  },

  async refresh(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    const tab = activeTabOfState(state, id);
    const pane = paneOf(state, id);
    if (isVirtualLocation(tab.location)) {
      set((current) => ({
        panes: patchPaneTab(current.panes, id, tab.id, {
          entries: [],
          listingFor: tab.location,
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
    if (!isVirtualLocation(location)) await get().refresh(id);
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
    if (tab && !isVirtualLocation(tab.location) && (!tab.listingFor || tab.listingFor !== tab.location)) {
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
    if (tab && !isVirtualLocation(tab.location) && (!tab.listingFor || tab.listingFor !== tab.location)) {
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
    if (tab && !isVirtualLocation(tab.location) && (!tab.listingFor || tab.listingFor !== tab.location)) {
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
    set((state) => ({
      detailsPane: show,
      previewPane: show ? false : state.previewPane,
      preview: show ? { ...state.preview, visible: false } : state.preview,
    }));
  },
  setPreviewPane(show) {
    set((state) => ({
      previewPane: show,
      detailsPane: show ? false : state.detailsPane,
      preview: { ...state.preview, visible: show },
    }));
    if (!show) void get().closeQuickLook();
  },
  setPreviewVisible(show) {
    get().setPreviewPane(show);
  },
  async openQuickLook(paths) {
    if (!paths.length) return;
    try {
      await api.previewQuickLookOpen(paths);
      set({ quickLookOpen: true });
    } catch (error) {
      get().toastError(error);
    }
  },
  async closeQuickLook() {
    set({ quickLookOpen: false });
    try {
      await api.previewQuickLookClose();
    } catch {
      // The panel may already be gone; the flag is still cleared.
    }
  },
  setPreviewPosition(position) {
    set((state) => ({ preview: { ...state.preview, position } }));
  },
  setPreviewFocusMode(enabled) {
    set((state) => ({ preview: { ...state.preview, focusMode: enabled } }));
  },
  setPreviewRatio(ratio, width) {
    const clamped = Math.max(0.18, Math.min(0.6, ratio));
    set((state) => ({
      preview: {
        ...state.preview,
        ...(state.dualPane ? { ratio: clamped } : { singleRatio: clamped }),
        width:
          width != null
            ? Math.max(240, Math.min(2400, Math.round(width)))
            : state.preview.width,
      },
    }));
  },
  setPreviewHeightRatio(ratio, height) {
    const clamped = Math.max(0.18, Math.min(0.6, ratio));
    set((state) => ({
      preview: {
        ...state.preview,
        ...(state.dualPane ? { heightRatio: clamped } : { singleHeightRatio: clamped }),
        height:
          height != null
            ? Math.max(180, Math.min(620, Math.round(height)))
            : state.preview.height,
      },
    }));
  },
  setPreviewAutoPlay(enabled) {
    set((state) => ({ preview: { ...state.preview, autoPlayMedia: enabled } }));
  },
  setPreviewTextLimit(bytes) {
    set((state) => ({
      preview: {
        ...state.preview,
        textLimit: Math.max(16 * 1024, Math.min(4 * 1024 * 1024, bytes)),
      },
    }));
  },
  setPreviewRendererEnabled(id, enabled) {
    set((state) => {
      const current = new Set(state.preview.renderers);
      if (enabled) current.add(id);
      else current.delete(id);
      return {
        preview: {
          ...state.preview,
          renderers: DEFAULT_PREVIEW_PREFERENCES.renderers.filter((item) =>
            current.has(item),
          ),
        },
      };
    });
  },
  restoreDefaultLayout() {
    set((state) => ({
      detailsPane: false,
      previewPane: false,
      preview: {
        ...DEFAULT_PREVIEW_PREFERENCES,
        renderers: state.preview.renderers,
        textLimit: state.preview.textLimit,
        autoPlayMedia: state.preview.autoPlayMedia,
      },
      sidebarVisible: true,
      sidebarWidth: 204,
      splitRatio: 0.5,
    }));
    void get().closeQuickLook();
  },
  setTheme(theme) {
    set({ theme });
  },
  setInterfaceTheme(interfaceTheme) {
    set({ interfaceTheme });
  },
  setDensity(density) {
    set((state) => ({ display: { ...state.display, density } }));
  },
  setTextSize(size) {
    set((state) => ({ display: { ...state.display, textSize: size } }));
  },
  setIconSize(size) {
    set((state) => ({ display: { ...state.display, iconSize: size } }));
  },
  setColumnVisible(column, visible) {
    set((state) => ({
      columnVisibility: { ...state.columnVisibility, [column]: visible },
    }));
  },
  resetColumnWidths() {
    set({ columnWidths: { name: 272, date: 144, type: 120, size: 80, location: 260 } });
  },
  setCommandBarLabels(visible) {
    set({ commandBarLabels: visible });
  },
  setSidebarVisible(visible) {
    set({ sidebarVisible: visible });
  },
  toggleSidebar() {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }));
  },
  setFolderOpenMode(mode) {
    set({ folderOpenMode: mode });
  },
  setConfirmTrashDelete(confirm) {
    set({ confirmTrashDelete: confirm });
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
      // Searching and a tag overlay are two ways of filtering the same pane, so
      // starting a search returns the pane to its folder view first.
      panes: patchPane(
        patchPaneTab(state.panes, id, tab.id, {
          searchQuery: query,
          searchResults: null,
          searchLoading: false,
          searchError: null,
          searchRequestId: tab.searchRequestId + 1,
        }),
        id,
        { tagFilterId: null },
      ),
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
    const networkRoot = state.locations.find((location) => location.id === "network")?.path;
    const root =
      tab.location === HOME_LOCATION || tab.location === RECENTS_LOCATION
        ? state.platform?.home ?? "/"
        : tab.location === NETWORK_LOCATION
          ? networkRoot ?? state.platform?.home ?? "/"
          : tab.location;
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
    if (isVirtualLocation(tab.location)) {
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
    if (isVirtualLocation(target)) return;
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
    if (!permanent && !get().confirmTrashDelete) {
      void get().confirmDelete(entries.map((entry) => entry.path), false, sourcePane);
      return;
    }
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
      const removed = results
        .filter((result) => result.status === "completed")
        .map((result) => result.source);
      if (removed.length) {
        set((current) => {
          const forgotten = forgetDeletedPaths(removed, current.pinned, current.recents);
          return {
            tagAssignments: removeAssignmentsForPaths(current.tagAssignments, removed),
            pinned: forgotten.pinned,
            recents: forgotten.recents,
          };
        });
      }
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
    if (path !== newPath) {
      set((state) => ({
        tagAssignments: renameAssignmentPaths(state.tagAssignments, path, newPath),
        pinned: rewritePathList(state.pinned, path, newPath),
        recents: rewriteRecentItems(state.recents, path, newPath),
      }));
    }
    await get().refresh(id);
    get().setSelection([newPath], newPath, id);
    get().toast({ title: "Renamed", detail: newName, tone: "success" });
    return newPath;
  },

  async promptNewFolder(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    if (isVirtualLocation(activeTabOfState(state, id).location)) return;
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
    if (isVirtualLocation(activeTabOfState(state, id).location)) return;
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
      const copies = results.filter(
        (result) => result.status === "completed" && result.destination,
      );
      if (copies.length) {
        set((state) => {
          let assignments = state.tagAssignments;
          for (const result of copies) {
            assignments = duplicateAssignmentPaths(
              assignments,
              result.source,
              result.destination as string,
            );
          }
          return { tagAssignments: assignments };
        });
      }
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
        if (typeof window === "undefined") return;
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
      pinned: state.pinned.some((item) => sameTagPath(item, path))
        ? state.pinned
        : [...state.pinned, path],
    }));
  },
  unpinPath(path) {
    set((state) => ({ pinned: state.pinned.filter((item) => !sameTagPath(item, path)) }));
  },
  reorderPinned(fromPath, toPath) {
    set((state) => {
      const from = state.pinned.findIndex((item) => sameTagPath(item, fromPath));
      const to = state.pinned.findIndex((item) => sameTagPath(item, toPath));
      if (from < 0 || to < 0 || from === to) return state;
      const pinned = [...state.pinned];
      const [moved] = pinned.splice(from, 1);
      pinned.splice(to, 0, moved);
      return { pinned };
    });
  },

  createTag(name, color = DEFAULT_TAG_COLOR) {
    const state = get();
    const clean = normalizeTagName(name);
    if (!clean) return "";
    const existing = state.tags.find(
      (tag) => tag.name.toLowerCase() === clean.toLowerCase(),
    );
    if (existing) return existing.id;
    const tag = createTagDefinition(state.tags, clean, color);
    set({ tags: [...state.tags, tag] });
    return tag.id;
  },

  updateTag(id, patch) {
    set((state) => {
      const target = state.tags.find((tag) => tag.id === id);
      if (!target) return state;
      const name =
        patch.name !== undefined
          ? uniqueTagName(state.tags, patch.name, id)
          : target.name;
      const color =
        patch.color !== undefined ? normalizeTagColor(patch.color) : target.color;
      return {
        tags: state.tags.map((tag) =>
          tag.id === id ? { ...tag, name, color } : tag,
        ),
      };
    });
  },

  deleteTag(id) {
    set((state) => {
      const tags = state.tags.filter((tag) => tag.id !== id);
      const validIds = new Set(tags.map((tag) => tag.id));
      const clearFilter = (pane: PaneState): PaneState => {
        if (pane.tagFilterId !== id) return pane;
        const active = activeTabOf(pane);
        return {
          ...pane,
          tagFilterId: null,
          tabs: pane.tabs.map((tab) =>
            tab.id === active.id ? { ...tab, selection: [], anchorPath: null } : tab,
          ),
        };
      };
      return {
        tags,
        tagAssignments: pruneTagIds(state.tagAssignments, validIds),
        panes: {
          left: clearFilter(state.panes.left),
          right: clearFilter(state.panes.right),
        },
        contextMenu: null,
      };
    });
  },

  reorderTags(fromId, toId) {
    set((state) => {
      const from = state.tags.findIndex((tag) => tag.id === fromId);
      const to = state.tags.findIndex((tag) => tag.id === toId);
      if (from < 0 || to < 0 || from === to) return state;
      const tags = [...state.tags];
      const [moved] = tags.splice(from, 1);
      tags.splice(to, 0, moved);
      return { tags };
    });
  },

  assignTag(paths, tagId, snapshots) {
    const state = get();
    if (!paths.length || !state.tags.some((tag) => tag.id === tagId)) return;
    set({
      tagAssignments: setTagOnPaths(
        state.tagAssignments,
        paths,
        tagId,
        true,
        snapshotsFor(state, paths, snapshots),
      ),
    });
  },

  unassignTag(paths, tagId) {
    const state = get();
    if (!paths.length) return;
    set({
      tagAssignments: setTagOnPaths(state.tagAssignments, paths, tagId, false),
    });
  },

  toggleTag(paths, tagId, snapshots) {
    const state = get();
    if (!paths.length || !state.tags.some((tag) => tag.id === tagId)) return;
    const allTagged = paths.every((path) => state.tagIdsForPath(path).includes(tagId));
    set({
      tagAssignments: setTagOnPaths(
        state.tagAssignments,
        paths,
        tagId,
        !allTagged,
        snapshotsFor(state, paths, snapshots),
      ),
    });
  },

  setTagFilter(tagId, paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    if (tagId && !state.tags.some((tag) => tag.id === tagId)) return;
    const pane = paneOf(state, id);
    const tab = activeTabOf(pane);
    const next = tagId && pane.tagFilterId === tagId ? null : tagId;
    if (tab.searchLoading) {
      void api.cancelSearch(tab.searchRequestId).catch(() => undefined);
    }
    const withClearedView = patchPaneTab(state.panes, id, tab.id, {
      searchQuery: "",
      searchResults: null,
      searchLoading: false,
      searchError: null,
      selection: [],
      anchorPath: null,
    });
    set({
      panes: patchPane(withClearedView, id, { tagFilterId: next }),
      activePane: id,
      contextMenu: null,
    });
  },

  clearTagFilter(paneId) {
    const state = get();
    const id = paneId ?? state.activePane;
    if (!state.panes[id].tagFilterId) return;
    const pane = state.panes[id];
    const tab = activeTabOf(pane);
    set({
      panes: patchPane(
        patchPaneTab(state.panes, id, tab.id, { selection: [], anchorPath: null }),
        id,
        { tagFilterId: null },
      ),
    });
  },

  openTagEditor(tagId, assignPaths) {
    set({
      contextMenu: null,
      dialog: { kind: "tagEditor", tagId, assignPaths },
    });
  },

  async refreshLocations() {
    try {
      const locations = await api.getSidebarLocations();
      set((state) => {
        const networkVolumes = locations.filter(
          (location) => location.kind === "network" && location.isVolume,
        );
        const networkConnections = state.networkConnections.map((connection) => {
          const currentlyMounted =
            connection.mountPath != null &&
            networkVolumes.some((volume) =>
              sameTagPath(volume.path, connection.mountPath as string),
            );
          if (currentlyMounted) return connection;
          if (!networkAddressHasShare(connection.address)) return connection;
          const share = networkDisplayName(connection.address);
          const match = networkVolumes.find((volume) =>
            sameTagPath(basename(volume.path), share),
          );
          return match ? { ...connection, mountPath: match.path } : connection;
        });
        return { locations, networkConnections };
      });
    } catch (error) {
      get().toastError(error);
    }
  },

  async ejectVolume(path) {
    try {
      await api.ejectVolume(path);
      get().toast({ title: "Volume ejected", detail: path, tone: "success" });
      await get().refreshLocations();
      await Promise.all([get().refresh("left"), get().refresh("right")]);
    } catch (error) {
      get().toastError(error);
    }
  },

  openNetworkConnectionDialog(connectionId) {
    set({
      contextMenu: null,
      dialog: { kind: "networkConnection", connectionId },
    });
  },

  saveNetworkConnection(input) {
    const address = normalizeNetworkAddress(input.address);
    if (!address) return "";
    const state = get();
    const name = networkConnectionName(input.name, address);
    const now = Date.now();
    const current = input.id
      ? state.networkConnections.find((connection) => connection.id === input.id)
      : undefined;
    const duplicate = state.networkConnections.find(
      (connection) =>
        connection.address.toLowerCase() === address.toLowerCase() &&
        connection.id !== input.id,
    );
    const existing = current ?? duplicate;
    const id = existing?.id ?? createNetworkConnectionId(now);
    const index = state.networkConnections.findIndex(
      (connection) => connection.id === id,
    );
    const next = state.networkConnections.filter(
      (connection) =>
        connection.id !== id &&
        connection.address.toLowerCase() !== address.toLowerCase(),
    );
    const connection: NetworkConnection = {
      id,
      name,
      address,
      mountPath:
        existing && existing.address.toLowerCase() === address.toLowerCase()
          ? existing.mountPath
          : null,
      createdAt: existing?.createdAt ?? now,
      lastConnectedAt: existing?.lastConnectedAt ?? null,
    };
    if (index >= 0) next.splice(Math.min(index, next.length), 0, connection);
    else next.push(connection);
    const suppliedUsername = input.username?.trim();
    if (suppliedUsername || input.password) {
      networkSessionCredentials.set(id, {
        username: suppliedUsername || undefined,
        password: input.password || undefined,
      });
    } else {
      networkSessionCredentials.delete(id);
    }
    set({ networkConnections: next, contextMenu: null });
    get().toast({
      title: existing ? "Server updated" : "Server saved",
      detail: name,
      tone: "success",
    });
    return id;
  },

  removeNetworkConnection(id) {
    networkSessionCredentials.delete(id);
    set((state) => ({
      networkConnections: state.networkConnections.filter(
        (connection) => connection.id !== id,
      ),
      contextMenu: null,
    }));
  },

  async connectNetworkConnection(id, credentials) {
    const state = get();
    const connection = state.networkConnections.find((item) => item.id === id);
    if (!connection) return;
    if (!networkAddressHasShare(connection.address)) {
      get().openNetworkConnectionDialog(id);
      get().toast({
        title: "Choose a share first",
        detail:
          "Use Find Shares to list the folders exposed by this computer, then select one.",
        tone: "info",
      });
      return;
    }
    const before = new Set(state.locations.map((location) => location.path));
    const session = credentials ?? networkSessionCredentials.get(id);
    try {
      const reported = await api.connectNetworkLocation(
        connection.address,
        session?.username,
        session?.password,
      );
      await get().refreshLocations();
      let mountPath = reported?.trim() ? reported : null;
      if (!mountPath) {
        mountPath =
          get().locations.find(
            (location) =>
              location.kind === "network" &&
              location.isVolume &&
              !before.has(location.path),
          )?.path ?? null;
      }
      if (!mountPath && connection.mountPath) {
        const exists = await api.pathExists(connection.mountPath).catch(() => false);
        if (exists) mountPath = connection.mountPath;
      }
      set((current) => ({
        networkConnections: current.networkConnections.map((item) =>
          item.id === id
            ? {
                ...item,
                lastConnectedAt: Date.now(),
                mountPath: mountPath ?? item.mountPath,
              }
            : item,
        ),
      }));
      if (mountPath) {
        // The mount (and macOS Keychain, when the user chose to save it) now
        // owns the credential; drop the in-memory copy.
        networkSessionCredentials.delete(id);
        get().toast({
          title: "Connected to server",
          detail: mountPath,
          tone: "success",
        });
        await get().navigate(mountPath);
      } else {
        get().toast({
          title: "Finish connecting in macOS",
          detail:
            "Complete the sign-in prompt, then refresh Network to show the server.",
          tone: "info",
        });
        if (activeTabOfState(get(), get().activePane).location !== NETWORK_LOCATION) {
          await get().navigate(NETWORK_LOCATION);
        }
      }
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code !== "cancelled") {
        get().toastError(normalized);
      }
    }
  },

  async openNetworkConnection(id) {
    const state = get();
    const connection = state.networkConnections.find((item) => item.id === id);
    if (!connection) return;
    const mounted = state.locations.find(
      (location) =>
        location.kind === "network" &&
        location.isVolume &&
        connection.mountPath != null &&
        sameTagPath(location.path, connection.mountPath),
    );
    if (mounted) {
      await get().navigate(mounted.path);
      return;
    }
    if (connection.mountPath) {
      const exists = await api.pathExists(connection.mountPath).catch(() => false);
      if (exists) {
        await get().navigate(connection.mountPath);
        return;
      }
    }
    await get().connectNetworkConnection(id);
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

    // Keep metadata attached to the actual result paths. Conflict handling can
    // rename or replace items, so use each operation's destination instead of
    // assuming the requested destination folder.
    const movedOrCopied = outcome.results.filter(
      (result) =>
        result.status === "completed" &&
        result.destination &&
        result.source !== result.destination,
    );
    if (movedOrCopied.length) {
      set((state) => {
        let tagAssignments = state.tagAssignments;
        let pinned = state.pinned;
        let recents = state.recents;
        for (const result of movedOrCopied) {
          const destination = result.destination as string;
          if (item.mode === "move") {
            tagAssignments = renameAssignmentPaths(
              tagAssignments,
              result.source,
              destination,
            );
            pinned = rewritePathList(pinned, result.source, destination);
            recents = rewriteRecentItems(recents, result.source, destination);
          } else {
            tagAssignments = duplicateAssignmentPaths(
              tagAssignments,
              result.source,
              destination,
            );
          }
        }
        return { tagAssignments, pinned: uniquePathList(pinned), recents };
      });
    }

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
  const entries = currentEntriesOf(state, id);
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
  const tagFilterId = paneOf(state, id).tagFilterId;
  if (!tagFilterId && tab.location === HOME_LOCATION) return "Home";
  if (!tagFilterId && tab.location === RECENTS_LOCATION) return "Recents";
  if (!tagFilterId && tab.location === NETWORK_LOCATION) return "Network";
  const entries = currentEntriesOf(state, id);
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
  if (tab.location === RECENTS_LOCATION) return "Recents";
  if (tab.location === NETWORK_LOCATION) return "Network";
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
        previewPane: state.preview.visible,
        preview: state.preview,
        theme: state.theme,
        interfaceTheme: state.interfaceTheme,
        display: state.display,
        columnVisibility: state.columnVisibility,
        commandBarLabels: state.commandBarLabels,
        sidebarVisible: state.sidebarVisible,
        folderOpenMode: state.folderOpenMode,
        confirmTrashDelete: state.confirmTrashDelete,
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
        tags: state.tags,
        tagAssignments: state.tagAssignments,
        networkConnections: state.networkConnections,
      };
      savePersisted(snapshot);
    }, 250);
  });
}
