export type ViewMode =
  | "extraLarge"
  | "large"
  | "medium"
  | "small"
  | "list"
  | "details"
  | "tiles"
  | "content";

export type SortKey = "name" | "date" | "type" | "size";
export type SortDirection = "asc" | "desc";
export type GroupBy = "none" | "type" | "date" | "size";
export type ThemeMode = "system" | "light" | "dark";
/**
 * Visual identity of the whole application. Independent of `ThemeMode`
 * (light/dark appearance); both themes support both appearances.
 */
export type InterfaceTheme = "windows" | "finder";
/** Global workspace density. Compact reduces row height and vertical padding. */
export type UiDensity = "comfortable" | "compact";
/** Global UI text scale applied through CSS variables. */
export type UiTextSize = "small" | "default" | "large";
/** Global file/chrome icon scale. */
export type UiIconSize = "small" | "default" | "large";
/** What double-clicking an ordinary folder does in the active pane. */
export type FolderOpenMode = "sameTab" | "newTab";
export type SettingsSection =
  | "appearance"
  | "display"
  | "layout"
  | "preview"
  | "behavior"
  | "keyboard"
  | "advanced";

/** Where the preview region sits relative to the browsing panes. */
export type PreviewPosition = "left" | "right" | "bottom";

/** Renderers can be disabled in Settings; the engine then falls back safely. */
export type PreviewRendererId =
  | "image"
  | "pdf"
  | "media"
  | "text"
  | "archive"
  | "folder"
  | "quicklook"
  | "metadata";

export interface PreviewPreferences {
  visible: boolean;
  position: PreviewPosition;
  /** In dual-pane mode, let the preview take the inactive pane's space. */
  focusMode: boolean;
  /** Legacy width of a left/right preview, in logical pixels. */
  width: number;
  /** Legacy height of a bottom preview, in logical pixels. */
  height: number;
  /** Share of the workspace used by a left/right preview in dual-pane mode. */
  ratio: number;
  /** Share of the workspace used by a left/right preview in single-pane mode. */
  singleRatio: number;
  /** Share of the workspace used by a bottom preview in dual-pane mode. */
  heightRatio: number;
  /** Share of the workspace used by a bottom preview in single-pane mode. */
  singleHeightRatio: number;
  autoPlayMedia: boolean;
  /** Maximum bytes read for the first page of a text/code preview. */
  textLimit: number;
  /** Enabled renderers, preserving the user's chosen fallbacks. */
  renderers: PreviewRendererId[];
}

export const DEFAULT_PREVIEW_PREFERENCES: PreviewPreferences = {
  visible: false,
  position: "right",
  focusMode: false,
  width: 340,
  height: 300,
  ratio: 0.28,
  singleRatio: 0.4,
  heightRatio: 0.3,
  singleHeightRatio: 0.36,
  autoPlayMedia: false,
  textLimit: 256 * 1024,
  renderers: ["image", "pdf", "media", "text", "archive", "folder", "quicklook", "metadata"],
};

export interface PreviewMetadata {
  path: string;
  name: string;
  extension: string | null;
  contentType: string;
  contentTypeTree: string[];
  kind: string;
  size: number | null;
  isDir: boolean;
  isSymlink: boolean;
  isReadable: boolean;
  isPackage: boolean;
  isICloudPlaceholder: boolean;
  isNetworkVolume: boolean;
  modified: number | null;
  created: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  codecs: string[];
  pageCount: number | null;
  tags: string[];
  quickLookSupported: boolean;
}

export interface PreviewThumbnail {
  dataUrl: string | null;
  width: number | null;
  height: number | null;
  mime: string | null;
}

export interface ArchiveEntry {
  name: string;
  size: number | null;
  compressedSize: number | null;
  isDir: boolean;
  modified: number | null;
  method: string;
}

export interface ArchiveListing {
  format: string;
  entries: ArchiveEntry[];
  totalSize: number;
  compressedSize: number;
  truncated: boolean;
  encrypted: boolean;
}

export interface FolderPreview {
  path: string;
  itemCount: number;
  totalSize: number;
  files: number;
  folders: number;
  truncated: boolean;
  cancelled: boolean;
  entries: FileEntry[];
}

export interface TextRangePreview {
  text: string;
  offset: number;
  nextOffset: number;
  truncated: boolean;
  binary: boolean;
  size: number;
  decodedPlist: boolean;
}

/** How the visual Theme Creator should begin when opened from Appearance. */
export type ThemeCreatorStart =
  | { kind: "blank" }
  | { kind: "current" }
  | { kind: "preset"; presetId: string }
  | { kind: "theme"; themeId: string }
  | { kind: "builtin"; theme: InterfaceTheme; appearance: "light" | "dark" }
  | { kind: "palette"; paletteId: string };

export interface DisplayPreferences {
  density: UiDensity;
  textSize: UiTextSize;
  iconSize: UiIconSize;
}

export interface ColumnVisibility {
  date: boolean;
  type: boolean;
  size: boolean;
}
export type ConflictPolicy = "error" | "replace" | "rename" | "skip";
export type PaneId = "left" | "right";
export type TransferMode = "copy" | "move";
export type TransferStatus =
  | "queued"
  | "scanning"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number | null;
  modified: number | null;
  created: number | null;
  accessed: number | null;
  extension: string | null;
  isHidden: boolean;
  isReadOnly: boolean;
  target: string | null;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
  truncated: boolean;
  readErrors: number;
}

export interface Location {
  id: string;
  name: string;
  path: string;
  kind: string;
  icon: string;
  isVolume: boolean;
}

export interface SearchResult {
  root: string;
  query: string;
  entries: FileEntry[];
  truncated: boolean;
  cancelled: boolean;
  scanned: number;
  errors: number;
}

export interface OperationResult {
  source: string;
  destination: string | null;
  status: "completed" | "skipped" | "failed";
  error: string | null;
}

export interface Properties {
  path: string;
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  target: string | null;
  size: number | null;
  modified: number | null;
  created: number | null;
  accessed: number | null;
  extension: string | null;
  permissions: string;
  ownerId: number | null;
  groupId: number | null;
  isReadOnly: boolean;
  isHidden: boolean;
  itemCount: number | null;
}

export interface FolderStats {
  totalSize: number;
  files: number;
  folders: number;
  truncated: boolean;
}

export interface TextPreview {
  text: string;
  truncated: boolean;
  binary: boolean;
  size: number;
}

export interface PlatformInfo {
  platform: "macos" | "windows" | "linux";
  home: string;
  pathSeparator: string;
  modifier: "cmd" | "ctrl";
  computerLabel: string;
}

export interface ApplicationInfo {
  name: string;
  path: string;
}

export interface AppError {
  code: string;
  message: string;
  path?: string | null;
}

export interface RecentItem {
  path: string;
  name: string;
  isDir: boolean;
  modified: number | null;
  visitedAt: number;
}

/**
 * A server the user saved for later access. The address is a URL such as
 * `smb://server/share`; `mountPath` is filled in after macOS reports the
 * mounted volume so the sidebar can reopen it without reconnecting.
 */
export interface NetworkConnection {
  id: string;
  name: string;
  address: string;
  /** Optional SMB username; passwords are never persisted. */
  username: string | null;
  mountPath: string | null;
  createdAt: number;
  lastConnectedAt: number | null;
}

export interface NetworkComputer {
  name: string;
  host: string | null;
  address: string | null;
}

export interface StorageAuditEntry {
  id: string;
  label: string;
  path: string;
  category: string;
  status: "active" | "legacy" | "obsolete";
  bytes: number;
  files: number;
  detail: string;
}

export interface StorageAudit {
  dataRoot: string;
  entries: StorageAuditEntry[];
  totalBytes: number;
  activeBytes: number;
  legacyBytes: number;
  reclaimableBytes: number;
  legacyCount: number;
  recommendations: string[];
}

export interface StorageCleanupResult {
  archived: string[];
  removedCaches: string[];
  migrated: string[];
  skipped: string[];
  failures: string[];
  reclaimedBytes: number;
}

/**
 * A user-created tag. Tags are MAXplorer metadata only: they never touch file
 * contents or extended attributes, and their colours are stored as literal hex
 * values so a tag keeps its identity across every interface theme.
 */
export interface TagDefinition {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

/**
 * One path's tag membership plus a small metadata snapshot. The snapshot lets
 * tag filters render without listing the filesystem, and keeps working when a
 * file is temporarily unavailable (for example on an unmounted volume).
 */
export interface TagAssignment {
  path: string;
  name: string;
  isDir: boolean;
  modified: number | null;
  size: number | null;
  tagIds: string[];
  updatedAt: number;
}

export interface ClipboardState {
  mode: "copy" | "cut";
  paths: string[];
  names: string[];
}

export interface TabState {
  id: string;
  location: string;
  history: string[];
  historyIndex: number;
  entries: FileEntry[];
  listingFor: string | null;
  loading: boolean;
  error: AppError | null;
  truncated: boolean;
  readErrors: number;
  selection: string[];
  anchorPath: string | null;
  searchQuery: string;
  searchResults: FileEntry[] | null;
  searchLoading: boolean;
  searchError: string | null;
  searchRequestId: number;
  searchTruncated: boolean;
  searchScanned: number;
}

/**
 * Navigation and view state for one side of the window. Single-pane mode uses
 * the left pane; dual-pane mode gives each side its own tabs and preferences.
 */
export interface PaneState {
  tabs: TabState[];
  activeTabId: string;
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDirection: SortDirection;
  groupBy: GroupBy;
  showHidden: boolean;
  showExtensions: boolean;
  collapsed: boolean;
  /**
   * When set, this pane shows an overlay of every path carrying this tag. The
   * tab's folder and history are untouched, so clearing the filter returns to
   * exactly where the user was.
   */
  tagFilterId: string | null;
}

export interface ShortcutMap {
  toggleDualPane: string;
  copyToOtherPane: string;
  moveToOtherPane: string;
  switchPane: string;
  globalSearch: string;
}

export interface TransferProgress {
  id: number;
  status: string;
  phase: string;
  currentFile: string | null;
  processedBytes: number;
  totalBytes: number;
  processedItems: number;
  totalItems: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  message: string | null;
}

export interface TransferOutcome {
  id: number;
  cancelled: boolean;
  paused: boolean;
  results: OperationResult[];
  totalBytes: number;
  processedBytes: number;
  totalItems: number;
  processedItems: number;
}

export interface TransferItem {
  id: string;
  numericId: number;
  mode: TransferMode;
  status: TransferStatus;
  sourcePane: PaneId;
  destinationPane: PaneId;
  sources: string[];
  destination: string;
  conflict: ConflictPolicy;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  phase: string;
  currentFile: string | null;
  processedBytes: number;
  totalBytes: number;
  processedItems: number;
  totalItems: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  message: string | null;
  error: string | null;
  results: OperationResult[];
}

export interface ComparisonProgress {
  requestId: number;
  scanned: number;
  total: number;
  current: string | null;
  cancelled: boolean;
}

export interface ComparisonEntry {
  name: string;
  leftPath: string | null;
  rightPath: string | null;
  leftSize: number | null;
  rightSize: number | null;
  leftModified: number | null;
  rightModified: number | null;
  isDir: boolean;
  sizeDiffers: boolean;
  modifiedDiffers: boolean;
  contentEqual: boolean | null;
}

export interface FolderComparison {
  left: string;
  right: string;
  entries: ComparisonEntry[];
  leftOnly: number;
  rightOnly: number;
  different: number;
  identical: number;
  contentVerified: number;
  cancelled: boolean;
  scanned: number;
  errors: number;
}

export interface FolderComparisonState {
  requestId: number;
  left: string;
  right: string;
  verifyContent: boolean;
  loading: boolean;
  scanned: number;
  total: number;
  current: string | null;
  result: FolderComparison | null;
  cancelled: boolean;
  error: string | null;
  filterDifferences: boolean;
  open: boolean;
}

export type DialogState =
  | {
      kind: "confirm";
      title: string;
      message: string;
      detail?: string;
      confirmLabel: string;
      cancelLabel?: string;
      destructive?: boolean;
      onConfirm: () => void | Promise<void>;
    }
  | {
      kind: "prompt";
      title: string;
      label: string;
      initialValue: string;
      confirmLabel: string;
      selectStem?: boolean;
      onConfirm: (value: string) => void | Promise<void>;
    }
  | {
      kind: "conflict";
      title: string;
      message: string;
      conflicts: string[];
      destination?: string;
      onChoose: (policy: ConflictPolicy) => void | Promise<void>;
    }
  | {
      kind: "properties";
      path: string;
      properties: Properties | null;
      stats: FolderStats | null;
      loading: boolean;
      error: string | null;
    }
  | {
      kind: "openWith";
      path: string;
      applications: ApplicationInfo[];
      loading: boolean;
    }
  | { kind: "settings"; section?: SettingsSection }
  | { kind: "themeCreator"; start?: ThemeCreatorStart }
  | { kind: "tagEditor"; tagId?: string; assignPaths?: string[] }
  | {
      kind: "networkConnection";
      connectionId?: string;
      initialAddress?: string;
      initialName?: string;
    }
  | { kind: "storageAudit" }
  | { kind: "indexing" }
  | { kind: "about" };

export type SidebarMenuTarget =
  | { kind: "favorite"; path: string; name: string }
  | { kind: "tag"; tagId: string }
  | { kind: "location"; locationId: string; path: string; name: string; isVolume: boolean }
  | { kind: "networkConnection"; connectionId: string }
  | { kind: "recents" };

export type ContextMenuState =
  | {
      kind: "item";
      x: number;
      y: number;
      path: string;
      isDir: boolean;
      paneId?: PaneId;
    }
  | {
      kind: "search";
      x: number;
      y: number;
      path: string;
      isDir: boolean;
      paths: string[];
    }
  | { kind: "blank"; x: number; y: number; paneId?: PaneId }
  | { kind: "sidebar"; x: number; y: number; target: SidebarMenuTarget };

export interface ToastMessage {
  id: string;
  title: string;
  detail?: string;
  tone: "info" | "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
}

export interface OperationState {
  title: string;
  detail?: string;
}

export interface PersistedTab {
  id: string;
  location: string;
  history: string[];
  historyIndex: number;
}

export interface PersistedPaneState {
  tabs: PersistedTab[];
  activeTabId: string;
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDirection: SortDirection;
  groupBy: GroupBy;
  showHidden: boolean;
  showExtensions: boolean;
  collapsed: boolean;
  tagFilterId: string | null;
}

export interface TransferHistoryItem {
  id: string;
  mode: TransferMode;
  status: TransferStatus;
  sources: string[];
  destination: string;
  completedAt: number;
  totalBytes: number;
  processedBytes: number;
  message: string | null;
}

export interface PersistedState {
  version: 1;
  /** Legacy mirror of the left pane, kept so older builds can read new data. */
  tabs: PersistedTab[];
  activeTabId: string;
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDirection: SortDirection;
  groupBy: GroupBy;
  showHidden: boolean;
  showExtensions: boolean;
  detailsPane: boolean;
  /** Legacy mirror of `preview.visible`, kept for older builds. */
  previewPane: boolean;
  /** Preview layout and renderer preferences. Optional so old snapshots load. */
  preview?: PreviewPreferences;
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
  dualPane: boolean;
  activePane: PaneId;
  splitRatio: number;
  syncNavigation: boolean;
  panes: Record<PaneId, PersistedPaneState>;
  shortcuts: ShortcutMap;
  transferHistory: TransferHistoryItem[];
  tags: TagDefinition[];
  tagAssignments: TagAssignment[];
  networkConnections: NetworkConnection[];
}

export const HOME_LOCATION = "win11://home";
/** Virtual location that lists recent files and folders instead of a directory. */
export const RECENTS_LOCATION = "win11://recents";
/** Virtual location for saved servers and mounted network volumes. */
export const NETWORK_LOCATION = "win11://network";

/** True for MAXplorer's own virtual locations, which have no filesystem path. */
export function isVirtualLocation(path: string): boolean {
  return path === HOME_LOCATION || path === RECENTS_LOCATION || path === NETWORK_LOCATION;
}
