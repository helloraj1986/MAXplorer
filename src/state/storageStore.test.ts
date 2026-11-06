// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorageStore } from "./storageStore";
import type { StorageScanResult, StorageVolume } from "../lib/storage/types";

const internal: StorageVolume = {
  id: "volume:/",
  name: "Macintosh HD",
  mountPoint: "/",
  totalBytes: 1000,
  freeBytes: 500,
  availableBytes: 500,
  usedBytes: 500,
  usagePercent: 50,
  filesystem: "apfs",
  isRemovable: false,
  isNetwork: false,
  isInternal: true,
  isApfs: true,
  isVirtual: false,
  kind: "internal",
  container: null,
  device: null,
};

const usb: StorageVolume = {
  ...internal,
  id: "volume:/Volumes/USB",
  name: "USB",
  mountPoint: "/Volumes/USB",
  isInternal: false,
  kind: "removable",
  isRemovable: true,
};

function scan(root: string, cleanup: StorageScanResult["cleanup"] = []): StorageScanResult {
  return {
    scanId: 1,
    root,
    volume: root === "/" ? internal : usb,
    startedAt: 1,
    finishedAt: 2,
    elapsedMs: 1,
    scannedEntries: 5,
    scannedFiles: 4,
    scannedDirectories: 1,
    symbolicLinks: 0,
    hardLinks: 0,
    permissionErrors: 0,
    readErrors: 0,
    skippedMounts: 0,
    skippedReserved: 0,
    totalLogicalBytes: 100,
    totalAllocatedBytes: 100,
    inspectableBytes: 100,
    uninspectedBytes: 0,
    cleanupRecoverableBytes: 100,
    cancelled: false,
    truncated: false,
    truncationReason: null,
    maxEntries: 500_000,
    categories: [],
    fileTypes: [],
    largestFiles: [],
    largestDirectories: [],
    recentLargeFiles: [],
    staleLargeFiles: [],
    cleanup,
    notes: [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  useStorageStore.setState({
    workspaceOpen: true,
    volumes: [internal, usb],
    selectedVolumePath: "/",
    scanFromCache: false,
    cachedAt: null,
    scan: scan("/", [
      {
        id: "a",
        kind: "applicationCaches",
        title: "Caches",
        reason: "test",
        path: "/Users/test/Library/Caches",
        size: 100,
        recoverableBytes: 100,
        risk: "review",
        action: "trash",
        isDirectory: true,
        category: "caches",
        modified: 1,
        reversible: true,
        note: null,
      },
    ]),
    treePath: "/",
    picks: [],
    excludedRecommendations: [],
    view: "overview",
  });
});

afterEach(() => {
  window.localStorage.clear();
  useStorageStore.setState({
    workspaceOpen: false,
    picks: [],
    excludedRecommendations: [],
    scanFromCache: false,
    cachedAt: null,
    cleanupError: null,
  });
});

describe("storage store state", () => {
  it("clears stale results when switching to another volume", () => {
    useStorageStore.getState().selectVolume("/Volumes/USB");
    const state = useStorageStore.getState();
    expect(state.selectedVolumePath).toBe("/Volumes/USB");
    expect(state.scan).toBeNull();
    expect(state.treePath).toBeNull();
    expect(window.localStorage.getItem("maxplorer-storage-volume")).toBe("/Volumes/USB");
  });

  it("keeps a scan when its root is inside the selected volume", () => {
    const folderScan = scan("/Volumes/USB/Projects");
    useStorageStore.setState({ selectedVolumePath: null, scan: folderScan });
    useStorageStore.getState().selectVolume("/Volumes/USB");
    expect(useStorageStore.getState().scan?.root).toBe("/Volumes/USB/Projects");
  });

  it("rejects cleanup from a cached scan", async () => {
    useStorageStore.setState({
      scanFromCache: true,
      picks: [
        {
          path: "/Users/test/Library/Caches",
          name: "Caches",
          size: 100,
          isDirectory: true,
          modified: 1,
          category: "caches",
          source: "recommendation",
        },
      ],
    });
    await useStorageStore.getState().performCleanup(false);
    expect(useStorageStore.getState().cleanupRunning).toBe(false);
    expect(useStorageStore.getState().cleanupError).toMatch(/cached scan/i);
  });

  it("excludes and restores recommendation paths", () => {
    useStorageStore.getState().selectAllRecommendations();
    expect(useStorageStore.getState().picks).toHaveLength(1);
    useStorageStore.getState().excludeRecommendation("/Users/test/Library/Caches");
    expect(useStorageStore.getState().picks).toHaveLength(0);
    expect(useStorageStore.getState().excludedRecommendations).toContain(
      "/Users/test/Library/Caches",
    );
    useStorageStore.getState().clearRecommendationExclusions();
    expect(useStorageStore.getState().excludedRecommendations).toHaveLength(0);
  });
});
