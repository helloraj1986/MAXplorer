import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AppError,
  ApplicationInfo,
  ConflictPolicy,
  DirectoryListing,
  FileEntry,
  FolderStats,
  Location,
  OperationResult,
  PlatformInfo,
  Properties,
  SearchResult,
  TextPreview,
} from "./types";

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
      message: "File Explorer must run inside the Tauri desktop runtime.",
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
