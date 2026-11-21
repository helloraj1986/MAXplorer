import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppError,
  ApplicationInfo,
  ArchiveListing,
  ComparisonProgress,
  ConflictPolicy,
  DirectoryListing,
  FileEntry,
  FolderComparison,
  FolderPreview,
  FolderStats,
  Location,
  NetworkComputer,
  OperationResult,
  PlatformInfo,
  PreviewMetadata,
  PreviewThumbnail,
  Properties,
  SearchResult,
  StorageAudit,
  StorageCleanupResult,
  TextPreview,
  TextRangePreview,
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
import type {
  MediaCatalogResponse,
  MediaManifest,
  NativePlayerDiagnostics,
  NativePlayerStatus,
  StreamsResponse,
} from "../components/media/types";
import type {
  CachedStorageScan,
  StorageChildren,
  StorageDeleteOutcome,
  StorageDeleteProgress,
  StorageDeleteRequest,
  StorageDuplicateRequest,
  StorageDuplicateResponse,
  StorageFilePage,
  StorageFileQuery,
  StorageScanProgress,
  StorageScanResult,
  StorageVolume,
} from "./storage/types";
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
  getAddonManifest: (url: string) =>
    call<MediaManifest>("media_addon_manifest", { url }),
  getMediaCatalog: (url: string, type: string, catalogId: string) =>
    call<MediaCatalogResponse>("media_catalog", { url, type, catalogId }),
  getMediaStreams: (url: string, type: string, id: string) =>
    call<StreamsResponse>("media_streams", { url, type, id }),
  playMediaStream: (url: string) => call<{ player: string }>("media_play", { url }),
  // Native playback engine (libmpv). The video surface is an NSView the backend
  // places over the rect the UI reports, so playback is not limited by what the
  // webview can decode (MKV/AC3/DTS all work).
  playerOpen: (
    url: string,
    title: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => call<NativePlayerStatus>("media_player_open", { url, title, ...rect }),
  playerClose: () => call<void>("media_player_close"),
  playerSetRect: (rect: { x: number; y: number; width: number; height: number }) =>
    call<void>("media_player_set_rect", { ...rect }),
  playerSetPause: (paused: boolean) => call<NativePlayerStatus>("media_player_set_pause", { paused }),
  playerSeek: (seconds: number) => call<NativePlayerStatus>("media_player_seek", { seconds }),
  playerSeekRelative: (delta: number) =>
    call<NativePlayerStatus>("media_player_seek_relative", { delta }),
  playerSetVolume: (volume: number) =>
    call<NativePlayerStatus>("media_player_set_volume", { volume }),
  playerSetMuted: (muted: boolean) => call<NativePlayerStatus>("media_player_set_muted", { muted }),
  // Fit (mpv default, whole frame visible) vs Fill (panscan=1: zoom until the
  // picture covers the window, cropping the overshoot). Per-title, not persisted.
  playerSetFill: (fill: boolean) => call<void>("media_player_set_fill", { fill }),
  playerSetSurfaceVisible: (visible: boolean) =>
      call<void>("media_player_set_surface_visible", { visible }),
    playerStatus: () => call<NativePlayerStatus>("media_player_status"),
  playerDiagnostics: () => call<NativePlayerDiagnostics>("media_player_diagnostics"),
  startTorrent: (infoHash: string) =>
      call<{ baseUrl: string }>("media_torrent_start", { infoHash }),
    torrentStatus: (infoHash: string, baseUrl: string, probe = true) =>
      call<{
        registered: boolean;
        metadataReady: boolean;
        name: string | null;
        files: { idx: number; name: string; length: number }[];
        progress: number;
        /** MB/s */
        downloadSpeed: number;
        /** Connected peers. */
        peers: number;
        /** Peers discovered in the swarm. */
        peersSeen: number;
        /** librqbit state: initializing | live | paused | error */
        state: string;
        /** True only when librqbit can actually serve the stream URL. */
        streamable: boolean;
        streamUrl: string | null;
      }>(
        "media_torrent_status",
        { infoHash, baseUrl, probe },
      ),
    debridResolve: (infoHash: string) => call<string>("media_debrid_resolve", { infoHash }),
    debridSaveConfig: (config: { provider: "realdebrid" | "torbox"; apiKey: string }) =>
      call<void>("media_debrid_save_config", { config }),
    debridGetConfig: () => call<{ provider: "realdebrid" | "torbox"; apiKey: string } | null>("media_debrid_get_config"),
    debridTestKey: (provider: "realdebrid" | "torbox", apiKey: string) => call<boolean>("media_debrid_test_key", { provider, apiKey }),
  getSidebarLocations: () => call<Location[]>("get_sidebar_locations"),
  ejectVolume: (path: string) => call<void>("eject_volume", { path }),
  connectNetworkLocation: (
    address: string,
    username?: string | null,
    password?: string | null,
  ) =>
    call<string | null>("connect_network_location", {
      address,
      username: username ?? null,
      password: password ?? null,
    }),
  discoverNetworkComputers: () =>
    call<NetworkComputer[]>("discover_network_computers"),
  listNetworkShares: (
    address: string,
    username?: string | null,
    password?: string | null,
  ) =>
    call<string[]>("list_network_shares", {
      address,
      username: username ?? null,
      password: password ?? null,
    }),
  getStorageAudit: () => call<StorageAudit>("get_storage_audit"),
  cleanupLegacyStorage: (confirm: boolean) =>
    call<StorageCleanupResult>("cleanup_legacy_storage", { confirm }),
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
  pruneSearchIndex: () => call<IndexStatus>("prune_search_index"),
  optimizeSearchIndex: () => call<IndexStatus>("optimize_search_index"),
  rebuildSearchNameIndex: () => call<IndexStatus>("rebuild_search_name_index"),
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

  /* Preview pane ---------------------------------------------------------- */
  previewMetadata: (path: string) =>
    call<PreviewMetadata>("preview_metadata", { path }),
  previewThumbnail: (path: string, size = 1024) =>
    call<PreviewThumbnail>("preview_thumbnail", { path, size }),
  previewQuickLookOpen: (paths: string[]) =>
    call<void>("preview_quicklook_open", { paths }),
  previewQuickLookClose: () => call<void>("preview_quicklook_close"),
  previewReadText: (path: string, offset = 0, maxBytes = 256 * 1024) =>
    call<TextRangePreview>("preview_read_text", { path, offset, maxBytes }),
  previewArchive: (path: string) => call<ArchiveListing>("preview_archive", { path }),
  previewExtractArchive: (path: string, destination: string) =>
    call<string>("preview_extract_archive", { path, destination }),
  previewFolderSummary: (path: string, requestId: number, sampleLimit = 12) =>
    call<FolderPreview>("preview_folder_summary", { path, requestId, sampleLimit }),
  cancelPreviewTask: (requestId: number) =>
    call<void>("cancel_preview_task", { requestId }),
  clearPreviewCache: () => call<void>("preview_clear_cache"),
  previewDownloadICloud: (path: string) =>
    call<void>("preview_download_icloud", { path }),
  previewWatch: (path: string) => call<void>("preview_watch", { path }),
  previewUnwatch: () => call<void>("preview_unwatch"),
  onPreviewChanged: (
    handler: (event: { path: string; kind: string }) => void,
  ): Promise<UnlistenFn> => {
    if (!isTauri) return Promise.resolve(() => undefined);
    return listen<{ path: string; kind: string }>("preview-changed", (event) =>
      handler(event.payload),
    );
  },
  listApplications: () => call<ApplicationInfo[]>("list_applications"),
  readAppIcon: (path: string) => call<string | null>("read_app_icon", { path }),
  openPath: (path: string) => call<void>("open_path", { path }),
  revealPath: (path: string) => call<void>("reveal_path", { path }),
  openTerminal: (path: string) => call<void>("open_terminal", { path }),
  openWith: (app: string, path: string) => call<void>("open_with", { app, path }),
  openSystemSettings: (section: string) =>
    call<void>("open_system_settings", { section }),
  saveAppearancePackage: (fileName: string, contents: string) =>
    call<string>("save_appearance_package", { fileName, contents }),

  /* Storage Space Analyzer ------------------------------------------------ */
  getStorageVolumes: () => call<StorageVolume[]>("get_storage_volumes"),
  scanStorage: (request: { scanId: number; root: string; maxEntries?: number }) =>
    call<StorageScanResult>("scan_storage", { request }),
  cancelStorageScan: (scanId: number) => call<void>("cancel_storage_scan", { scanId }),
  getStorageScanResult: () => call<StorageScanResult | null>("get_storage_scan_result"),
  getStorageCachedScan: (root?: string | null) =>
    call<CachedStorageScan | null>("get_storage_cached_scan", { root: root ?? null }),
  getStorageChildren: (scanId: number, path: string, limit = 2_000) =>
    call<StorageChildren>("get_storage_children", { scanId, path, limit }),
  queryStorageFiles: (query: StorageFileQuery) =>
    call<StorageFilePage>("query_storage_files", { query }),
  findStorageDuplicates: (request: StorageDuplicateRequest) =>
    call<StorageDuplicateResponse>("find_storage_duplicates", { request }),
  cancelStorageDuplicates: (requestId: number) =>
    call<void>("cancel_storage_duplicates", { requestId }),
  deleteStoragePaths: (request: StorageDeleteRequest) =>
    call<StorageDeleteOutcome>("delete_storage_paths", { request }),
  cancelStorageDelete: (operationId: number) =>
    call<void>("cancel_storage_delete", { operationId }),
  clearStorageIndex: () => call<void>("clear_storage_index"),
  onStorageScanProgress: (handler: (progress: StorageScanProgress) => void): Promise<UnlistenFn> => {
    if (!isTauri) return Promise.resolve(() => undefined);
    return listen<StorageScanProgress>("storage-scan-progress", (event) => handler(event.payload));
  },
  onStorageDeleteProgress: (handler: (progress: StorageDeleteProgress) => void): Promise<UnlistenFn> => {
    if (!isTauri) return Promise.resolve(() => undefined);
    return listen<StorageDeleteProgress>("storage-delete-progress", (event) => handler(event.payload));
  },

  /* Diagnostics ----------------------------------------------------------- */
  logFrontendEvent: (level: "info" | "warn" | "error" | "debug", message: string, context?: string) =>
    call<void>("log_frontend_event", { level, message, context: context ?? null }),
  getLogPath: () => call<string | null>("get_log_path"),
  logStorageDiagnostics: () => call<string | null>("log_storage_diagnostics"),
};

export function assetUrl(path: string): string {
  if (!isTauri) return path;
  return convertFileSrc(path);
}
