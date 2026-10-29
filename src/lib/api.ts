import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppError,
  ApplicationInfo,
  ComparisonProgress,
  ConflictPolicy,
  DirectoryListing,
  FileEntry,
  FolderComparison,
  FolderStats,
  Location,
  OperationResult,
  PlatformInfo,
  Properties,
  SearchResult,
  TextPreview,
  TransferMode,
  TransferOutcome,
  TransferProgress,
} from "./types";
import type {
  DuplicateResponse,
  IndexError,
  IndexStatus,
  SearchProgress,
  SearchRequestPayload,
  SearchResponse,
  SearchSuggestion,
} from "./search/types";
import { PRODUCT_NAME } from "./branding";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function normalizeError(error: unknown): AppError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<AppError>;
    if (typeof candidate.message === "string") {
      return {
        code: typeof candidate.code === "string" ? candidate.code : "error",
        message: candidate.message,
        path: typeof candidate.path === "string" ? candidate.path : null,
      };
    }
  }
  if (typeof error === "string") {
    return { code: "error", message: error, path: null };
  }
  return {
    code: "error",
    message: "The operation could not be completed.",
    path: null,
  };
}

function requireTauri(): void {
  if (!isTauri) {
    throw {
      code: "not_tauri",
      message: `${PRODUCT_NAME} must run inside the Tauri desktop runtime.`,
      path: null,
    } satisfies AppError;
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  requireTauri();
  return invoke<T>(command, args);
}

export const api = {
  getPlatformInfo: () => call<PlatformInfo>("get_platform_info"),
  getSidebarLocations: () => call<Location[]>("get_sidebar_locations"),
  getInitialPath: () => call<string | null>("get_initial_path"),
  resolvePath: (path: string) => call<string>("resolve_path", { path }),
  pathExists: (path: string) => call<boolean>("path_exists", { path }),
  listDirectory: (path: string, showHidden: boolean) =>
    call<DirectoryListing>("list_directory", { path, showHidden }),
  searchFiles: (
    root: string,
    query: string,
    showHidden: boolean,
    maxResults: number,
    requestId: number,
  ) => call<SearchResult>("search_files", { root, query, showHidden, maxResults, requestId }),
  cancelSearch: (requestId: number) => call<void>("cancel_search", { requestId }),
  universalSearch: (request: SearchRequestPayload) =>
    call<SearchResponse>("universal_search", { request }),
  findDuplicates: (request: {
    queryId: number;
    roots: string[];
    minSize: number;
    includeSimilarNames: boolean;
    limit: number;
  }) => call<DuplicateResponse>("find_duplicates", { request }),
  searchSuggestions: (prefix: string, limit = 8) =>
    call<SearchSuggestion[]>("search_suggestions", { prefix, limit }),
  getSearchIndexStatus: () => call<IndexStatus>("get_search_index_status"),
  addSearchLocation: (path: string) =>
    call<IndexStatus>("add_search_location", { path }),
  removeSearchLocation: (path: string) =>
    call<IndexStatus>("remove_search_location", { path }),
  setSearchIndexPaused: (paused: boolean) =>
    call<IndexStatus>("set_search_index_paused", { paused }),
  setSearchContentEnabled: (enabled: boolean) =>
    call<IndexStatus>("set_search_content_enabled", { enabled }),
  setSearchContentLimit: (bytes: number) =>
    call<IndexStatus>("set_search_content_limit", { bytes }),
  rebuildSearchIndex: () => call<IndexStatus>("rebuild_search_index"),
  clearSearchIndex: () => call<IndexStatus>("clear_search_index"),
  retryFailedExtractions: () => call<IndexStatus>("retry_failed_extractions"),
  removeSearchPath: (path: string) => call<void>("remove_search_path", { path }),
  getIndexErrors: (limit = 50) => call<IndexError[]>("get_index_errors", { limit }),
  onSearchProgress: (handler: (progress: SearchProgress) => void): Promise<UnlistenFn> => {
    if (!isTauri) return Promise.resolve(() => undefined);
    return listen<SearchProgress>("search-progress", (event) => handler(event.payload));
  },
  createFolder: (parent: string, name: string) =>
    call<FileEntry>("create_folder", { parent, name }),
  createTextFile: (parent: string, name: string, contents = "") =>
    call<FileEntry>("create_text_file", { parent, name, contents }),
  createSymlink: (parent: string, name: string, target: string) =>
    call<FileEntry>("create_symlink", { parent, name, target }),
  renamePath: (path: string, newName: string) =>
    call<string>("rename_path", { path, newName }),
  copyPaths: (paths: string[], destination: string, conflict: ConflictPolicy) =>
    call<OperationResult[]>("copy_paths", { paths, destination, conflict }),
  movePaths: (paths: string[], destination: string, conflict: ConflictPolicy) =>
    call<OperationResult[]>("move_paths", { paths, destination, conflict }),
  transferPaths: (request: {
    id: number;
    paths: string[];
    destination: string;
    mode: TransferMode;
    conflict: ConflictPolicy;
  }) => call<TransferOutcome>("transfer_paths", { request }),
  cancelTransfer: (id: number) => call<void>("cancel_transfer", { id }),
  pauseTransfer: (id: number, paused: boolean) =>
    call<void>("pause_transfer", { id, paused }),
  compareFolders: (
    left: string,
    right: string,
    verifyContent: boolean,
    requestId: number,
  ) => call<FolderComparison>("compare_folders", { left, right, verifyContent, requestId }),
  cancelCompare: (requestId: number) => call<void>("cancel_compare", { requestId }),
  onTransferProgress: (handler: (progress: TransferProgress) => void): Promise<UnlistenFn> => {
    if (!isTauri) return Promise.resolve(() => undefined);
    return listen<TransferProgress>("transfer-progress", (event) => handler(event.payload));
  },
  onCompareProgress: (
    handler: (progress: ComparisonProgress) => void,
  ): Promise<UnlistenFn> => {
    if (!isTauri) return Promise.resolve(() => undefined);
    return listen<ComparisonProgress>("compare-progress", (event) => handler(event.payload));
  },
  deletePaths: (paths: string[], permanent: boolean) =>
    call<OperationResult[]>("delete_paths", { paths, permanent }),
  duplicatePaths: (paths: string[]) => call<OperationResult[]>("duplicate_paths", { paths }),
  getProperties: (path: string) => call<Properties>("get_properties", { path }),
  getFolderStats: (path: string) => call<FolderStats>("get_folder_stats", { path }),
  readTextPreview: (path: string, maxBytes = 128 * 1024) =>
    call<TextPreview>("read_text_preview", { path, maxBytes }),
  listApplications: () => call<ApplicationInfo[]>("list_applications"),
  readAppIcon: (path: string) => call<string | null>("read_app_icon", { path }),
  openPath: (path: string) => call<void>("open_path", { path }),
  revealPath: (path: string) => call<void>("reveal_path", { path }),
  openTerminal: (path: string) => call<void>("open_terminal", { path }),
  openWith: (app: string, path: string) => call<void>("open_with", { app, path }),
  openSystemSettings: (section: string) =>
    call<void>("open_system_settings", { section }),
};

export function assetUrl(path: string): string {
  if (!isTauri) return path;
  return convertFileSrc(path);
}
