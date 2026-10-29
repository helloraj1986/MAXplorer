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
}

export interface ShortcutMap {
  toggleDualPane: string;
  copyToOtherPane: string;
  moveToOtherPane: string;
  switchPane: string;
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
  | { kind: "preferences" }
  | { kind: "themes" }
  | { kind: "about" }
  | { kind: "shortcuts" };

export type ContextMenuState =
  | {
      kind: "item";
      x: number;
      y: number;
      path: string;
      isDir: boolean;
      paneId?: PaneId;
    }
  | { kind: "blank"; x: number; y: number; paneId?: PaneId };

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
  previewPane: boolean;
  theme: ThemeMode;
  interfaceTheme: InterfaceTheme;
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
}

export const HOME_LOCATION = "win11://home";
