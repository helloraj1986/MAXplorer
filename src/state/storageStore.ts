import { create } from "zustand";
import { api, isTauri, normalizeError } from "../lib/api";
import { logDiagnostic } from "../lib/diagnostics";
import { parentPath } from "../lib/format";
import {
  addPicks,
  canSelectDuplicate,
  pickFromDirectory,
  pickFromDuplicate,
  pickFromFile,
  pickFromRecommendation,
  removePicks,
  summarizeSelection,
  togglePick,
} from "../lib/storage/selection";
import {
  DEFAULT_STORAGE_FILE_QUERY,
  type CleanupRecommendation,
  type StorageChildren,
  type StorageDeleteOutcome,
  type StorageDeleteProgress,
  type StorageDirectory,
  type StorageDuplicateFile,
  type StorageDuplicateResponse,
  type StorageFile,
  type StorageFilePage,
  type StorageFileQuery,
  type StorageFileScope,
  type StoragePick,
  type StorageScanProgress,
  type StorageScanResult,
  type StorageView,
  type StorageVolume,
} from "../lib/storage/types";
import { useExplorerStore } from "./explorerStore";

const MAX_FILE_RESULTS = 400;
let idCounter = 0;
let fileRequestCounter = 0;
let progressListenerStarted = false;
let activeScanId = 0;

const DEFAULT_SCOPE: StorageFileScope = {
  label: "Largest files",
  kind: "largest",
};

function nextId(): number {
  idCounter += 1;
  return Date.now() * 1_000 + idCounter;
}

function selectedVolumeFrom(volumes: StorageVolume[], path: string | null): StorageVolume | null {
  if (!volumes.length) return null;
  return volumes.find((volume) => volume.mountPoint === path) ?? volumes[0];
}

function rootMatchesMount(root: string, mountPoint: string): boolean {
  if (root === mountPoint) return true;
  const normalized = mountPoint.replace(/[\\/]+$/, "");
  return root.startsWith(`${normalized}/`) || root.startsWith(`${normalized}\\`);
}

function notifyError(error: unknown): void {
  const normalized = normalizeError(error);
  logDiagnostic(
    "error",
    `Storage operation failed: ${normalized.message}${normalized.path ? ` (${normalized.path})` : ""}`,
    `storage.${normalized.code}`,
  );
  useExplorerStore.getState().toastError(error);
}

function storedVolumePath(): string | null {
  try {
    return window.localStorage.getItem("maxplorer-storage-volume");
  } catch {
    return null;
  }
}

function rememberVolumePath(path: string): void {
  try {
    window.localStorage.setItem("maxplorer-storage-volume", path);
  } catch {
    // Preference persistence is best-effort and never blocks analysis.
  }
}

function loadRecommendationExclusions(): string[] {
  try {
    const raw = window.localStorage.getItem("maxplorer-storage-exclusions");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(0, 2_000)
      : [];
  } catch {
    return [];
  }
}

function saveRecommendationExclusions(paths: string[]): void {
  try {
    window.localStorage.setItem("maxplorer-storage-exclusions", JSON.stringify(paths.slice(0, 2_000)));
  } catch {
    // Exclusions are a convenience preference; analysis remains correct without them.
  }
}

export interface StorageState {
  workspaceOpen: boolean;
  volumes: StorageVolume[];
  volumesLoading: boolean;
  volumesError: string | null;
  selectedVolumePath: string | null;
  scan: StorageScanResult | null;
  scanFromCache: boolean;
  cachedAt: number | null;
  scanning: boolean;
  scanError: string | null;
  progress: StorageScanProgress | null;
  activeScanId: number;
  lastScanAt: number | null;
  view: StorageView;
  treePath: string | null;
  childrenByPath: Record<string, StorageChildren>;
  childrenLoading: boolean;
  fileScope: StorageFileScope;
  fileQuery: Omit<StorageFileQuery, "scanId">;
  filePage: StorageFilePage | null;
  filesLoading: boolean;
  fileError: string | null;
  selectedFile: StorageFile | null;
  selectedDirectory: StorageDirectory | null;
  picks: StoragePick[];
  duplicates: StorageDuplicateResponse | null;
  duplicatesLoading: boolean;
  duplicatesError: string | null;
  duplicateMinSize: number;
  duplicateRoot: string | null;
  duplicateRequestId: number;
  cleanupOutcome: StorageDeleteOutcome | null;
  cleanupRunning: boolean;
  cleanupError: string | null;
  cleanupProgress: StorageDeleteProgress | null;
  cleanupOperationId: number;
  excludedRecommendations: string[];

  initialize: () => Promise<void>;
  loadVolumes: () => Promise<void>;
  openWorkspace: () => Promise<void>;
  closeWorkspace: () => void;
  selectVolume: (mountPoint: string) => void;
  loadCachedScan: (root?: string | null) => Promise<boolean>;
  startScan: (root?: string, maxEntries?: number) => Promise<void>;
  cancelScan: () => Promise<void>;
  rescan: () => Promise<void>;
  rescanFolder: (path: string) => Promise<void>;
  clearIndex: () => Promise<void>;
  setView: (view: StorageView) => void;
  loadChildren: (path?: string) => Promise<void>;
  openDirectory: (path: string) => Promise<void>;
  returnToParent: () => Promise<void>;
  loadFiles: (patch?: Partial<Omit<StorageFileQuery, "scanId">>) => Promise<void>;
  loadMoreFiles: () => Promise<void>;
  openLargestFiles: () => Promise<void>;
  openCategory: (category: string, label: string) => Promise<void>;
  openFileType: (fileType: string, label: string) => Promise<void>;
  openRecentLarge: () => Promise<void>;
  openStaleLarge: () => Promise<void>;
  selectFile: (file: StorageFile | null) => void;
  selectDirectory: (directory: StorageDirectory | null) => void;
  togglePick: (pick: StoragePick) => void;
  addPicks: (picks: StoragePick[]) => void;
  removePick: (path: string) => void;
  clearPicks: () => void;
  selectVisibleFiles: () => void;
  selectAllFilteredFiles: () => Promise<void>;
  selectVisibleDirectories: () => void;
  selectAllRecommendations: () => void;
  excludeRecommendation: (path: string) => void;
  clearRecommendationExclusions: () => void;
  runDuplicates: (root?: string, minSize?: number) => Promise<void>;
  cancelDuplicates: () => Promise<void>;
  toggleDuplicatePick: (file: StorageDuplicateFile, groupPaths: string[]) => void;
  performCleanup: (permanent: boolean) => Promise<void>;
  cancelCleanup: () => Promise<void>;
  dismissCleanupOutcome: () => void;
  revealInMaxplorer: (path: string) => Promise<void>;
  revealInFinder: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  openProperties: (path: string) => Promise<void>;
  openContainingFolder: (path: string) => Promise<void>;
}

async function refreshAfterCleanup(): Promise<void> {
  const state = useStorageStore.getState();
  if (!state.scan || state.cleanupOutcome?.cancelled) return;
  await state.startScan(state.scan.root);
}

export const useStorageStore = create<StorageState>((set, get) => ({
  workspaceOpen: false,
  volumes: [],
  volumesLoading: false,
  volumesError: null,
  selectedVolumePath: null,
  scan: null,
  scanFromCache: false,
  cachedAt: null,
  scanning: false,
  scanError: null,
  progress: null,
  activeScanId: 0,
  lastScanAt: null,
  view: "overview",
  treePath: null,
  childrenByPath: {},
  childrenLoading: false,
  fileScope: { ...DEFAULT_SCOPE },
  fileQuery: { ...DEFAULT_STORAGE_FILE_QUERY },
  filePage: null,
  filesLoading: false,
  fileError: null,
  selectedFile: null,
  selectedDirectory: null,
  picks: [],
  duplicates: null,
  duplicatesLoading: false,
  duplicatesError: null,
  duplicateMinSize: 1024 * 1024,
  duplicateRoot: null,
  duplicateRequestId: 0,
  cleanupOutcome: null,
  cleanupRunning: false,
  cleanupError: null,
  cleanupProgress: null,
  cleanupOperationId: 0,
  excludedRecommendations: [],

  async initialize() {
    logDiagnostic("info", "Storage Analyzer initializing", "storage.initialize");
    set({ excludedRecommendations: loadRecommendationExclusions() });
    if (!progressListenerStarted && isTauri) {
      progressListenerStarted = true;
      void api.onStorageScanProgress((progress) => {
        const state = get();
        if (!state.scanning || progress.scanId !== state.activeScanId) return;
        set({ progress });
      });
      void api.onStorageDeleteProgress((cleanupProgress) => {
        const state = get();
        if (!state.cleanupRunning) return;
        if (state.cleanupOperationId && cleanupProgress.operationId !== state.cleanupOperationId) return;
        set({ cleanupProgress });
      });
    }
    await get().loadVolumes();
  },

  async loadVolumes() {
    if (!isTauri) {
      set({
        volumesLoading: false,
        volumesError: "Storage analysis runs inside the MAXplorer desktop runtime.",
      });
      return;
    }
    set({ volumesLoading: true, volumesError: null });
    try {
      const volumes = await api.getStorageVolumes();
      const remembered = storedVolumePath();
      const current = get().selectedVolumePath;
      const selected =
        volumes.find((volume) => volume.mountPoint === current) ??
        volumes.find((volume) => volume.mountPoint === remembered) ??
        volumes.find((volume) => volume.mountPoint === "/") ??
        volumes[0] ??
        null;
      set({
        volumes,
        volumesLoading: false,
        selectedVolumePath: selected?.mountPoint ?? null,
      });
    } catch (error) {
      set({ volumesLoading: false, volumesError: normalizeError(error).message });
    }
  },

  async openWorkspace() {
    set({ workspaceOpen: true });
    await get().loadVolumes();
    if (!isTauri) return;
    try {
      const current = await api.getStorageScanResult();
      const preferred = get().selectedVolumePath;
      if (current && (!preferred || rootMatchesMount(current.root, preferred))) {
        const volumes = get().volumes;
        const volume = volumes
          .filter((item) => rootMatchesMount(current.root, item.mountPoint))
          .sort((left, right) => right.mountPoint.length - left.mountPoint.length)[0];
        set({
          scan: current,
          scanFromCache: false,
          cachedAt: null,
          lastScanAt: current.finishedAt,
          selectedVolumePath: volume?.mountPoint ?? preferred,
          treePath: current.root,
          fileScope: { ...DEFAULT_SCOPE },
        });
        if (get().view === "tree" || get().view === "treemap") {
          await get().loadChildren(current.root);
        }
      } else {
        await get().loadCachedScan(preferred);
      }
    } catch {
      // A missing or expired in-memory scan is not an error; try the cache.
      await get().loadCachedScan(get().selectedVolumePath);
    }
  },

  closeWorkspace() {
    set({ workspaceOpen: false });
  },

  selectVolume(mountPoint) {
    if (get().selectedVolumePath === mountPoint) return;
    rememberVolumePath(mountPoint);
    const scan = get().scan;
    const keepScan = scan ? rootMatchesMount(scan.root, mountPoint) : false;
    set({
      selectedVolumePath: mountPoint,
      scan: keepScan ? scan : null,
      treePath: keepScan ? get().treePath : null,
      childrenByPath: keepScan ? get().childrenByPath : {},
      filePage: keepScan ? get().filePage : null,
      fileError: null,
      duplicates: keepScan ? get().duplicates : null,
      cleanupOutcome: keepScan ? get().cleanupOutcome : null,
      picks: keepScan ? get().picks : [],
      scanFromCache: keepScan ? get().scanFromCache : false,
      cachedAt: keepScan ? get().cachedAt : null,
    });
    if (!keepScan) {
      void get().loadCachedScan(mountPoint);
    }
  },

  async loadCachedScan(root) {
    if (!isTauri) return false;
    const live = get().scan;
    if (live && !get().scanFromCache) return false;
    try {
      const requested = root ?? get().selectedVolumePath;
      const cached = await api.getStorageCachedScan(requested);
      if (!cached) return false;
      if (root != null && get().selectedVolumePath !== root) return false;
      if (get().scan && !get().scanFromCache) return false;
      set({
        scan: cached.scan,
        scanFromCache: true,
        cachedAt: cached.cachedAt,
        lastScanAt: cached.scan.finishedAt,
        treePath: cached.scan.root,
        fileScope: { ...DEFAULT_SCOPE },
        filePage: null,
        fileError: null,
        duplicates: null,
        picks: [],
        selectedFile: null,
        selectedDirectory: null,
      });
      if (get().view === "tree" || get().view === "treemap") {
        await get().loadChildren(cached.scan.root);
      }
      if (get().view === "files") {
        await get().loadFiles();
      }
      return true;
    } catch (error) {
      logDiagnostic("warn", `Cached scan could not be restored: ${normalizeError(error).message}`, "storage.cache");
      return false;
    }
  },

  async startScan(root, maxEntries) {
    const volume = selectedVolumeFrom(get().volumes, get().selectedVolumePath);
    if (!volume) {
      set({ scanError: "Choose an accessible volume before scanning." });
      return;
    }
    const target = root ?? volume.mountPoint;
    const scanId = nextId();
    const budgetLabel = maxEntries === 0 ? "auto (memory-budgeted)" : String(maxEntries ?? 500_000);
    logDiagnostic(
      "info",
      `Starting storage scan id=${scanId} root=${target} maxEntries=${budgetLabel}`,
      "storage.scan",
    );
    activeScanId = scanId;
    set({
      scanning: true,
      scanError: null,
      progress: null,
      activeScanId: scanId,
      cleanupError: null,
      picks: [],
    });
    try {
      const scan = await api.scanStorage({
        scanId,
        root: target,
        maxEntries: maxEntries ?? 500_000,
      });
      if (get().activeScanId !== scanId) return;
      logDiagnostic(
        "info",
        `Storage scan complete id=${scanId} entries=${scan.scannedEntries} files=${scan.scannedFiles} dirs=${scan.scannedDirectories} cancelled=${scan.cancelled} truncated=${scan.truncated}`,
        "storage.scan",
      );
      const scannedVolume = scan.volume;
      set({
        scan,
        scanFromCache: false,
        cachedAt: null,
        scanning: false,
        progress: null,
        lastScanAt: scan.finishedAt,
        treePath: scan.root,
        selectedVolumePath: scannedVolume?.mountPoint ?? get().selectedVolumePath,
        filePage: null,
        duplicates: null,
        selectedFile: null,
        selectedDirectory: null,
      });
      if (get().view === "tree" || get().view === "treemap") {
        await get().loadChildren(scan.root);
      }
      if (get().view === "files") {
        await get().loadFiles();
      }
    } catch (error) {
      if (get().activeScanId !== scanId) return;
      const normalized = normalizeError(error);
      logDiagnostic("error", `Storage scan failed: ${normalized.message}`, "storage.scan");
      set({ scanning: false, progress: null, scanError: normalized.message });
      notifyError(error);
    }
  },

  async cancelScan() {
    const scanId = get().activeScanId;
    if (!scanId || !get().scanning) return;
    try {
      await api.cancelStorageScan(scanId);
    } catch {
      // The scan may already have completed; its real result is authoritative.
    }
  },

  async rescan() {
    await get().startScan();
  },

  async rescanFolder(path) {
    await get().startScan(path);
  },

  async clearIndex() {
    try {
      await api.clearStorageIndex();
    } catch (error) {
      notifyError(error);
    }
    set({
      scan: null,
      scanFromCache: false,
      cachedAt: null,
      progress: null,
      lastScanAt: null,
      treePath: null,
      childrenByPath: {},
      filePage: null,
      duplicates: null,
      picks: [],
      cleanupOutcome: null,
    });
  },

  setView(view) {
    set({ view });
    if ((view === "tree" || view === "treemap") && get().treePath) {
      void get().loadChildren(get().treePath ?? undefined);
    }
    if (view === "files" && !get().filePage) {
      void get().loadFiles();
    }
  },

  async loadChildren(path) {
    const scan = get().scan;
    if (!scan) return;
    const target = path ?? get().treePath ?? scan.root;
    set({ childrenLoading: true });
    try {
      const children = await api.getStorageChildren(scan.scanId, target);
      set((state) => ({
        childrenLoading: false,
        treePath: target,
        childrenByPath: { ...state.childrenByPath, [target]: children },
      }));
    } catch (error) {
      set({ childrenLoading: false });
      notifyError(error);
    }
  },

  async openDirectory(path) {
    set({ selectedFile: null });
    await get().loadChildren(path);
  },

  async returnToParent() {
    const current = get().treePath;
    if (!current) return;
    const parent = parentPath(current);
    if (!parent) return;
    await get().loadChildren(parent);
  },

  async loadFiles(patch = {}) {
    const scan = get().scan;
    if (!scan) return;
    const query = { ...get().fileQuery, ...patch };
    const requestId = ++fileRequestCounter;
    set({ fileQuery: query, filesLoading: true, fileError: null });
    try {
      const page = await api.queryStorageFiles({
        ...query,
        scanId: scan.scanId,
        limit: Math.min(query.limit || MAX_FILE_RESULTS, MAX_FILE_RESULTS),
      });
      if (requestId !== fileRequestCounter) return;
      set({ filePage: page, filesLoading: false });
    } catch (error) {
      if (requestId !== fileRequestCounter) return;
      logDiagnostic("error", `Storage file query failed: ${normalizeError(error).message}`, "storage.query");
      set({ filesLoading: false, fileError: normalizeError(error).message });
    }
  },

  async loadMoreFiles() {
    const page = get().filePage;
    if (!page?.hasMore || get().filesLoading) return;
    const scan = get().scan;
    if (!scan) return;
    const query = get().fileQuery;
    const requestId = ++fileRequestCounter;
    set({ filesLoading: true });
    try {
      const next = await api.queryStorageFiles({
        ...query,
        scanId: scan.scanId,
        offset: page.files.length,
      });
      if (requestId !== fileRequestCounter) return;
      set({
        filesLoading: false,
        filePage: {
          ...next,
          files: [...page.files, ...next.files],
          offset: 0,
        },
      });
    } catch (error) {
      logDiagnostic("error", `Storage pagination failed: ${normalizeError(error).message}`, "storage.query");
      set({ filesLoading: false, fileError: normalizeError(error).message });
    }
  },

  async openLargestFiles() {
    set({
      view: "files",
      fileScope: { label: "Largest files", kind: "largest" },
      selectedFile: null,
      filePage: null,
      fileError: null,
    });
    await get().loadFiles({
      ...DEFAULT_STORAGE_FILE_QUERY,
      sort: "size",
      direction: "desc",
      minSize: null,
    });
  },

  async openCategory(category, label) {
    set({
      view: "files",
      fileScope: { label: `${label} - largest files`, kind: "category", category },
      selectedFile: null,
      filePage: null,
      fileError: null,
    });
    await get().loadFiles({
      ...DEFAULT_STORAGE_FILE_QUERY,
      category,
      fileType: null,
      minSize: null,
      sort: "size",
      direction: "desc",
    });
  },

  async openFileType(fileType, label) {
    set({
      view: "files",
      fileScope: { label: `${label} files`, kind: "type", fileType },
      selectedFile: null,
      filePage: null,
      fileError: null,
    });
    await get().loadFiles({
      ...DEFAULT_STORAGE_FILE_QUERY,
      fileType,
      category: null,
      minSize: null,
      sort: "size",
      direction: "desc",
    });
  },

  async openRecentLarge() {
    const threshold = Date.now() - 30 * 86_400_000;
    set({
      view: "files",
      fileScope: { label: "Recently changed large files", kind: "recent", minSize: 50 * 1024 * 1024 },
      selectedFile: null,
      filePage: null,
      fileError: null,
    });
    await get().loadFiles({
      ...DEFAULT_STORAGE_FILE_QUERY,
      category: null,
      fileType: null,
      minSize: 50 * 1024 * 1024,
      modifiedAfter: threshold,
      sort: "modified",
      direction: "desc",
    });
  },

  async openStaleLarge() {
    const threshold = Date.now() - 365 * 86_400_000;
    set({
      view: "files",
      fileScope: { label: "Old large files", kind: "stale", minSize: 500 * 1024 * 1024 },
      selectedFile: null,
      filePage: null,
      fileError: null,
    });
    await get().loadFiles({
      ...DEFAULT_STORAGE_FILE_QUERY,
      category: null,
      fileType: null,
      minSize: 500 * 1024 * 1024,
      modifiedBefore: threshold,
      sort: "size",
      direction: "desc",
    });
  },

  selectFile(file) {
    set({ selectedFile: file, selectedDirectory: null });
  },
  selectDirectory(directory) {
    set({ selectedDirectory: directory, selectedFile: null });
  },
  togglePick(pick) {
    set((state) => ({ picks: togglePick(state.picks, pick) }));
  },
  addPicks(picks) {
    set((state) => ({ picks: addPicks(state.picks, picks) }));
  },
  removePick(path) {
    set((state) => ({ picks: removePicks(state.picks, [path]) }));
  },
  clearPicks() {
    set({ picks: [] });
  },
  selectVisibleFiles() {
    const files = get().filePage?.files ?? [];
    set((state) => ({ picks: addPicks(state.picks, files.map((file) => pickFromFile(file))) }));
  },
  async selectAllFilteredFiles() {
    const scan = get().scan;
    if (!scan) return;
    try {
      const page = await api.queryStorageFiles({
        ...get().fileQuery,
        scanId: scan.scanId,
        limit: 5_000,
        offset: 0,
      });
      set((state) => ({ picks: addPicks(state.picks, page.files.map((file) => pickFromFile(file))) }));
      if (page.hasMore) {
        useExplorerStore.getState().toast({
          title: "Selected the first 5,000 matching files",
          detail: "The filtered result is larger. Narrow the filters before selecting more.",
          tone: "info",
        });
      }
    } catch (error) {
      notifyError(error);
    }
  },
  selectVisibleDirectories() {
    const children = get().treePath ? get().childrenByPath[get().treePath as string] : null;
    if (!children) return;
    set((state) => ({
      picks: addPicks(state.picks, children.directories.map((directory) => pickFromDirectory(directory))),
    }));
  },
  selectAllRecommendations() {
    const excluded = new Set(get().excludedRecommendations);
    const recommendations = (get().scan?.cleanup ?? []).filter(
      (recommendation) => !excluded.has(recommendation.path),
    );
    set((state) => ({
      picks: addPicks(
        state.picks,
        recommendations.map((recommendation) => pickFromRecommendation(recommendation)),
      ),
    }));
  },
  excludeRecommendation(path) {
    const next = [...new Set([...get().excludedRecommendations, path])];
    saveRecommendationExclusions(next);
    set((state) => ({
      excludedRecommendations: next,
      picks: removePicks(state.picks, [path]),
    }));
  },
  clearRecommendationExclusions() {
    saveRecommendationExclusions([]);
    set({ excludedRecommendations: [] });
  },

  async runDuplicates(root, minSize) {
    const scan = get().scan;
    if (!scan) return;
    const target = root ?? get().duplicateRoot ?? get().treePath ?? scan.root;
    const requestId = nextId();
    set({
      duplicatesLoading: true,
      duplicatesError: null,
      duplicateRoot: target,
      duplicateMinSize: minSize ?? get().duplicateMinSize,
      duplicateRequestId: requestId,
      duplicates: null,
    });
    try {
      const duplicates = await api.findStorageDuplicates({
        requestId,
        roots: [target],
        minSize: minSize ?? get().duplicateMinSize,
        limit: 200,
        includeHidden: false,
        maxCandidates: 50_000,
      });
      if (get().duplicateRequestId !== requestId) return;
      set({ duplicates, duplicatesLoading: false });
    } catch (error) {
      if (get().duplicateRequestId !== requestId) return;
      logDiagnostic("error", `Duplicate scan failed: ${normalizeError(error).message}`, "storage.duplicates");
      set({
        duplicatesLoading: false,
        duplicatesError: normalizeError(error).message,
      });
    }
  },

  async cancelDuplicates() {
    const requestId = get().duplicateRequestId;
    if (!requestId || !get().duplicatesLoading) return;
    set({ duplicatesLoading: false, duplicateRequestId: 0 });
    try {
      await api.cancelStorageDuplicates(requestId);
    } catch {
      // Hashing may already have completed.
    }
  },

  toggleDuplicatePick(file, groupPaths) {
    const state = get();
    const path = file.entry.path;
    const already = state.picks.some((pick) => pick.path === path);
    if (already) {
      set({ picks: removePicks(state.picks, [path]) });
      return;
    }
    const selectedPaths = state.picks.map((pick) => pick.path);
    const check = canSelectDuplicate(groupPaths, selectedPaths, path);
    if (!check.allowed) {
      useExplorerStore.getState().toast({
        title: "Keep one copy",
        detail: check.reason,
        tone: "info",
      });
      return;
    }
    set({ picks: addPicks(state.picks, [pickFromDuplicate(file)]) });
  },

  async performCleanup(permanent) {
    const state = get();
    const scan = state.scan;
    if (!scan) return;
    if (state.scanFromCache) {
      set({
        cleanupError:
          "This is a cached scan. Rescan the folder or volume before moving or deleting anything.",
      });
      return;
    }
    const summary = summarizeSelection(state.picks);
    if (!summary.picks.length) {
      set({ cleanupError: "Select at least one file or folder to clean up." });
      return;
    }
    const operationId = nextId();
    set({
      cleanupRunning: true,
      cleanupError: null,
      cleanupOutcome: null,
      cleanupProgress: null,
      cleanupOperationId: operationId,
    });
    try {
      const outcome = await api.deleteStoragePaths({
        operationId,
        scanId: scan.scanId,
        items: summary.picks.map((pick) => ({
          path: pick.path,
          expectedSize: pick.size,
          expectedModified: pick.modified,
          isDirectory: pick.isDirectory,
        })),
        permanent,
      });
      const removed = new Set(
        outcome.results
          .filter((result) => result.status === "completed")
          .map((result) => result.source),
      );
      set((current) => ({
        cleanupRunning: false,
        cleanupOutcome: outcome,
        cleanupProgress: null,
        cleanupOperationId: 0,
        picks: current.picks.filter((pick) => !removed.has(pick.path)),
      }));
      const explorer = useExplorerStore.getState();
      if (outcome.results.some((result) => result.status === "failed")) {
        explorer.toast({
          title: "Some items could not be removed",
          detail:
            outcome.changed.length > 0
              ? "Some files changed after scanning and were left untouched. Rescan before retrying."
              : "Permission errors or locked files prevented part of the cleanup.",
          tone: "error",
        });
      } else {
        explorer.toast({
          title: permanent ? "Permanently deleted" : "Moved to Trash",
          detail: `${outcome.results.length} item${outcome.results.length === 1 ? "" : "s"} processed.`,
          tone: "success",
        });
      }
      if (outcome.results.some((result) => result.status === "completed") && !outcome.cancelled) {
        await refreshAfterCleanup();
      }
    } catch (error) {
      const normalized = normalizeError(error);
      set({
        cleanupRunning: false,
        cleanupProgress: null,
        cleanupOperationId: 0,
        cleanupError: normalized.message,
      });
      notifyError(error);
    }
  },

  async cancelCleanup() {
    const operationId = get().cleanupOperationId;
    if (!operationId || !get().cleanupRunning) return;
    try {
      await api.cancelStorageDelete(operationId);
    } catch {
      // The operation may already have completed; the result report is authoritative.
    }
  },

  dismissCleanupOutcome() {
    set({ cleanupOutcome: null, cleanupError: null });
  },

  async revealInMaxplorer(path) {
    set({ workspaceOpen: false });
    await useExplorerStore.getState().revealInPane(path);
  },

  async revealInFinder(path) {
    try {
      await api.revealPath(path);
    } catch (error) {
      notifyError(error);
    }
  },

  async openFile(path) {
    try {
      await api.openPath(path);
    } catch (error) {
      notifyError(error);
    }
  },

  async openProperties(path) {
    await useExplorerStore.getState().openProperties(path);
  },

  async openContainingFolder(path) {
    const parent = parentPath(path);
    await get().revealInMaxplorer(parent ?? path);
  },
}));

export function storageSelectionSummary(): ReturnType<typeof summarizeSelection> {
  return summarizeSelection(useStorageStore.getState().picks);
}

export function recommendationSummary(): ReturnType<typeof summarizeSelection> {
  return summarizeSelection(
    (useStorageStore.getState().scan?.cleanup ?? []).map((recommendation: CleanupRecommendation) =>
      pickFromRecommendation(recommendation),
    ),
  );
}
