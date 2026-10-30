import type { FileEntry, OperationResult } from "../types";

export type StorageView =
  | "overview"
  | "tree"
  | "files"
  | "largestFolders"
  | "fileTypes"
  | "treemap"
  | "duplicates"
  | "cleanup";

export type StorageRisk = "low" | "review" | "high";
export type StorageSort = "size" | "name" | "modified" | "created" | "type" | "path";
export type StorageSortDirection = "asc" | "desc";

export interface StorageVolume {
  id: string;
  name: string;
  mountPoint: string;
  totalBytes: number;
  freeBytes: number;
  availableBytes: number;
  usedBytes: number;
  usagePercent: number;
  filesystem: string | null;
  isRemovable: boolean;
  isNetwork: boolean;
  isInternal: boolean;
  isApfs: boolean;
  isVirtual: boolean;
  kind: "internal" | "external" | "removable" | "network" | "diskImage" | string;
  container: string | null;
  device: string | null;
}

export interface StorageScanProgress {
  scanId: number;
  root: string;
  scannedEntries: number;
  scannedFiles: number;
  scannedDirectories: number;
  logicalBytes: number;
  currentPath: string | null;
  elapsedMs: number;
  cancelled: boolean;
}

export interface StorageFile {
  path: string;
  name: string;
  parent: string;
  extension: string | null;
  isSymlink: boolean;
  size: number;
  allocated: number;
  modified: number | null;
  created: number | null;
  accessed: number | null;
  isHidden: boolean;
  isPackage: boolean;
  hardLink: boolean;
  cloudPlaceholder: boolean;
  isProtected: boolean;
  isReadOnly: boolean;
  category: string;
  fileType: string;
}

export interface StorageDirectory {
  path: string;
  name: string;
  parent: string;
  size: number;
  allocated: number;
  files: number;
  folders: number;
  directFiles: number;
  directFolders: number;
  largestFileSize: number;
  largestFilePath: string | null;
  modified: number | null;
  depth: number;
  isPackage: boolean;
  isProtected: boolean;
  isReadOnly: boolean;
}

export interface StorageCategory {
  id: string;
  label: string;
  bytes: number;
  allocated: number;
  files: number;
  percent: number;
}

export interface StorageFileType {
  id: string;
  label: string;
  bytes: number;
  allocated: number;
  files: number;
  percent: number;
  extensions: string[];
}

export interface CleanupRecommendation {
  id: string;
  kind: string;
  title: string;
  reason: string;
  path: string;
  size: number;
  recoverableBytes: number;
  risk: StorageRisk;
  action: "trash" | "permanent" | "inspect" | string;
  isDirectory: boolean;
  category: string;
  modified: number | null;
  reversible: boolean;
  note: string | null;
}

export interface StorageScanResult {
  scanId: number;
  root: string;
  volume: StorageVolume | null;
  startedAt: number;
  finishedAt: number;
  elapsedMs: number;
  scannedEntries: number;
  scannedFiles: number;
  scannedDirectories: number;
  symbolicLinks: number;
  hardLinks: number;
  permissionErrors: number;
  readErrors: number;
  skippedMounts: number;
  skippedReserved: number;
  totalLogicalBytes: number;
  totalAllocatedBytes: number;
  inspectableBytes: number;
  uninspectedBytes: number;
  cleanupRecoverableBytes: number;
  cancelled: boolean;
  truncated: boolean;
  maxEntries: number;
  categories: StorageCategory[];
  fileTypes: StorageFileType[];
  largestFiles: StorageFile[];
  largestDirectories: StorageDirectory[];
  recentLargeFiles: StorageFile[];
  staleLargeFiles: StorageFile[];
  cleanup: CleanupRecommendation[];
  notes: string[];
}

export interface StorageChildren {
  path: string;
  directory: StorageDirectory;
  directories: StorageDirectory[];
  files: StorageFile[];
  totalSize: number;
  totalFiles: number;
  totalFolders: number;
  truncated: boolean;
}

export interface StorageFileQuery {
  scanId: number;
  directory?: string | null;
  category?: string | null;
  fileType?: string | null;
  name?: string | null;
  extension?: string | null;
  minSize?: number | null;
  maxSize?: number | null;
  modifiedAfter?: number | null;
  modifiedBefore?: number | null;
  createdAfter?: number | null;
  createdBefore?: number | null;
  hidden?: boolean | null;
  symlinks?: boolean | null;
  recursive?: boolean;
  sort: StorageSort;
  direction: StorageSortDirection;
  limit: number;
  offset: number;
}

export interface StorageFilePage {
  files: StorageFile[];
  total: number;
  totalBytes: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface StorageDuplicateRequest {
  requestId: number;
  roots: string[];
  minSize: number;
  limit: number;
  includeHidden: boolean;
  maxCandidates: number;
}

export interface StorageDuplicateFile {
  entry: FileEntry;
  hash: string;
  volume: string;
}

export interface StorageDuplicateGroup {
  id: string;
  size: number;
  recoverableBytes: number;
  files: StorageDuplicateFile[];
  verified: boolean;
  sameVolume: boolean;
  explanation: string;
}

export interface StorageDuplicateResponse {
  requestId: number;
  groups: StorageDuplicateGroup[];
  scannedFiles: number;
  candidateFiles: number;
  hashedFiles: number;
  changedFiles: number;
  errors: number;
  recoverableBytes: number;
  cancelled: boolean;
  truncated: boolean;
  elapsedMs: number;
}

export interface StorageDeleteItem {
  path: string;
  expectedSize?: number | null;
  expectedModified?: number | null;
  isDirectory: boolean;
}

export interface StorageDeleteRequest {
  operationId: number;
  scanId: number;
  items: StorageDeleteItem[];
  permanent: boolean;
}

export interface StorageDeleteProgress {
  operationId: number;
  processed: number;
  total: number;
  completed: number;
  failed: number;
  currentPath: string | null;
  cancelled: boolean;
}

export interface StorageDeleteOutcome {
  operationId: number;
  results: OperationResult[];
  requestedBytes: number;
  reclaimedBytes: number;
  freeBefore: number | null;
  freeAfter: number | null;
  changed: string[];
  skippedOverlaps: string[];
  cancelled: boolean;
}

export interface StoragePick {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  modified: number | null;
  category: string;
  risk?: StorageRisk;
  source: "file" | "directory" | "recommendation" | "duplicate";
}

export interface StorageFileScope {
  label: string;
  kind: "largest" | "category" | "type" | "recent" | "stale" | "search";
  category?: string | null;
  fileType?: string | null;
  minSize?: number | null;
  modifiedAfter?: number | null;
  modifiedBefore?: number | null;
}

export interface StorageSelectionSummary {
  picks: StoragePick[];
  skipped: StoragePick[];
  totalBytes: number;
  count: number;
  highRisk: number;
  reviewRisk: number;
  lowRisk: number;
}

/** Deep scan ceiling exposed by the analyzer UI (the backend hard cap is 5M). */
export const DEEP_SCAN_MAX_ENTRIES = 5_000_000;

export const DEFAULT_STORAGE_FILE_QUERY: Omit<StorageFileQuery, "scanId"> = {
  directory: null,
  category: null,
  fileType: null,
  name: null,
  extension: null,
  minSize: null,
  maxSize: null,
  modifiedAfter: null,
  modifiedBefore: null,
  createdAfter: null,
  createdBefore: null,
  hidden: null,
  symlinks: null,
  recursive: false,
  sort: "size",
  direction: "desc",
  limit: 400,
  offset: 0,
};

export const CATEGORY_ORDER = [
  "applications",
  "documents",
  "photos",
  "videos",
  "audio",
  "downloads",
  "archives",
  "developer",
  "virtualMachines",
  "mail",
  "system",
  "caches",
  "trash",
  "other",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  applications: "Applications",
  documents: "Documents",
  photos: "Photos",
  videos: "Videos",
  audio: "Audio",
  downloads: "Downloads",
  archives: "Archives & disk images",
  developer: "Developer files",
  virtualMachines: "Virtual machines",
  mail: "Mail & messages",
  system: "System",
  caches: "Caches & temporary files",
  trash: "Trash",
  other: "Other files",
};

export const CATEGORY_COLORS: Record<string, string> = {
  applications: "#4f8ef7",
  documents: "#f2b84b",
  photos: "#5ac8fa",
  videos: "#af52de",
  audio: "#ff6482",
  downloads: "#34c759",
  archives: "#ff9f0a",
  developer: "#64d2ff",
  virtualMachines: "#bf5af2",
  mail: "#ff375f",
  system: "#8e8e93",
  caches: "#ffd60a",
  trash: "#ff453a",
  other: "#98989d",
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
}

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  applications: "Application bundles and their resources. Media inside a bundle is counted here, not twice.",
  documents: "PDF, text, office, spreadsheet, and presentation files.",
  photos: "Image files including RAW camera images.",
  videos: "Movie and video files.",
  audio: "Music, podcasts, and audio recordings.",
  downloads: "Files in a Downloads folder. The location category wins to avoid double counting.",
  archives: "ZIP, archive, installer, and disk-image files.",
  developer: "Xcode, package-manager caches, source trees, and build output.",
  virtualMachines: "Virtual machine disks and containers. Treat as high risk.",
  mail: "Local mailboxes and message attachments managed by Mail.",
  system: "Operating system and system library files.",
  caches: "Application caches, logs, and temporary files. Applications may manage these themselves.",
  trash: "Items already in the Trash. Removing them is permanent.",
  other: "Files that do not match a more specific category.",
};

export const CLEANUP_KIND_LABELS: Record<string, string> = {
  trash: "Trash",
  applicationCaches: "Application caches",
  logs: "Logs",
  developer: "Developer storage",
  packageCache: "Package manager caches",
  buildArtifacts: "Build artifacts",
  virtualMachines: "Virtual machines",
  backups: "Device backups",
  applicationSupport: "Application support",
  mail: "Mail data",
  largeDownload: "Large downloads",
  installer: "Installers",
  archive: "Large archives",
  database: "Databases",
  oldLargeFile: "Old large files",
};

export const FILE_TYPE_LABELS: Record<string, string> = {
  videos: "Videos",
  images: "Images",
  audio: "Audio",
  pdf: "PDF documents",
  documents: "Documents",
  archives: "Archives",
  diskImages: "Disk images",
  applications: "Applications",
  developer: "Source & build files",
  virtualMachines: "Virtual machines",
  databases: "Databases",
  fonts: "Fonts",
  other: "Other",
};

/** Convert an analyzer file into the shared icon/metadata contract. */
export function storageFileEntry(file: StorageFile): FileEntry {
  return {
    name: file.name,
    path: file.path,
    isDir: false,
    isSymlink: file.isSymlink,
    size: file.size,
    modified: file.modified,
    created: file.created,
    accessed: file.accessed,
    extension: file.extension,
    isHidden: file.isHidden,
    isReadOnly: file.isReadOnly,
    target: null,
  };
}

export function storageDirectoryEntry(directory: StorageDirectory): FileEntry {
  return {
    name: directory.name,
    path: directory.path,
    isDir: true,
    isSymlink: false,
    size: null,
    modified: directory.modified,
    created: null,
    accessed: null,
    extension: null,
    isHidden: directory.name.startsWith("."),
    isReadOnly: directory.isReadOnly,
    target: null,
  };
}
