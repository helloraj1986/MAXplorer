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
export type ConflictPolicy = "error" | "replace" | "rename" | "skip";

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
  | { kind: "about" }
  | { kind: "shortcuts" };

export type ContextMenuState =
  | {
      kind: "item";
      x: number;
      y: number;
      path: string;
      isDir: boolean;
    }
  | { kind: "blank"; x: number; y: number };

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

export interface PersistedState {
  version: 1;
  tabs: Array<Pick<TabState, "id" | "location" | "history" | "historyIndex">>;
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
}

export const HOME_LOCATION = "win11://home";
