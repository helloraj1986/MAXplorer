// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StorageWorkspace } from "./StorageWorkspace";
import { useStorageStore } from "../../state/storageStore";
import type { StorageScanResult, StorageVolume } from "../../lib/storage/types";

const volume: StorageVolume = {
  id: "volume:/",
  name: "Macintosh HD",
  mountPoint: "/",
  totalBytes: 1_000_000,
  freeBytes: 400_000,
  availableBytes: 400_000,
  usedBytes: 600_000,
  usagePercent: 60,
  filesystem: "apfs",
  isRemovable: false,
  isNetwork: false,
  isInternal: true,
  isApfs: true,
  isVirtual: false,
  kind: "internal",
  container: "disk3",
  device: "disk3s1",
};

const scan: StorageScanResult = {
  scanId: 42,
  root: "/",
  volume,
  startedAt: 1,
  finishedAt: 2,
  elapsedMs: 1500,
  scannedEntries: 20,
  scannedFiles: 12,
  scannedDirectories: 7,
  symbolicLinks: 1,
  hardLinks: 0,
  permissionErrors: 1,
  readErrors: 1,
  skippedMounts: 0,
  skippedReserved: 0,
  totalLogicalBytes: 600_000,
  totalAllocatedBytes: 590_000,
  inspectableBytes: 600_000,
  uninspectedBytes: 10_000,
  cleanupRecoverableBytes: 250_000,
  cancelled: false,
  truncated: false,
  truncationReason: null,
  maxEntries: 500_000,
  categories: [
    { id: "applications", label: "Applications", bytes: 300_000, allocated: 300_000, files: 4, percent: 50 },
    { id: "documents", label: "Documents", bytes: 200_000, allocated: 190_000, files: 6, percent: 33.3 },
    { id: "caches", label: "Caches & temporary files", bytes: 100_000, allocated: 100_000, files: 2, percent: 16.7 },
  ],
  fileTypes: [
    { id: "applications", label: "Applications", bytes: 300_000, allocated: 300_000, files: 4, percent: 50, extensions: ["app"] },
    { id: "documents", label: "Documents", bytes: 200_000, allocated: 190_000, files: 6, percent: 33.3, extensions: ["txt"] },
  ],
  largestFiles: [],
  largestDirectories: [],
  recentLargeFiles: [],
  staleLargeFiles: [],
  cleanup: [
    {
      id: "cleanup-0",
      kind: "applicationCaches",
      title: "Application caches",
      reason: "Caches can be rebuilt by applications, but some store recoverable state here.",
      path: "/Users/test/Library/Caches",
      size: 100_000,
      recoverableBytes: 100_000,
      risk: "review",
      action: "trash",
      isDirectory: true,
      category: "caches",
      modified: 1,
      reversible: true,
      note: null,
    },
    {
      id: "cleanup-1",
      kind: "virtualMachines",
      title: "Virtual machine disk",
      reason: "VM state can contain unrecoverable data.",
      path: "/Users/test/VMs/dev.vmdk",
      size: 250_000,
      recoverableBytes: 250_000,
      risk: "high",
      action: "inspect",
      isDirectory: false,
      category: "virtualMachines",
      modified: 1,
      reversible: false,
      note: "Use the virtual machine manager.",
    },
  ],
  notes: ["Symlinks are not followed.", "Allocated size uses filesystem blocks."],
};

beforeEach(() => {
  useStorageStore.setState({
    initialize: async () => undefined,
    workspaceOpen: true,
    volumes: [volume],
    volumesLoading: false,
    volumesError: null,
    selectedVolumePath: "/",
    scan,
    scanFromCache: false,
    cachedAt: null,
    scanning: false,
    scanError: null,
    progress: null,
    view: "overview",
    picks: [],
    selectedFile: null,
    selectedDirectory: null,
    cleanupOutcome: null,
    cleanupRunning: false,
    cleanupError: null,
    excludedRecommendations: [],
  });
});

afterEach(() => {
  cleanup();
  useStorageStore.setState({
    workspaceOpen: false,
    picks: [],
    selectedFile: null,
    selectedDirectory: null,
    excludedRecommendations: [],
    scanFromCache: false,
    cachedAt: null,
  });
});

describe("StorageWorkspace", () => {
  it("renders real category totals and the analysis navigation", () => {
    render(<StorageWorkspace />);
    expect(screen.getByRole("heading", { name: "Storage Analyzer" })).toBeTruthy();
    expect(screen.getByText("Storage usage")).toBeTruthy();
    expect(screen.getAllByText("Applications").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "Storage analysis views" })).toBeTruthy();
    expect(screen.getAllByText(/Uninspected \/ system-managed/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Analysis stays on this Mac/i)).toBeTruthy();
  });

  it("labels a truncated scan as not scanned instead of implying hidden files", () => {
    useStorageStore.setState({
      scan: { ...scan, truncated: true, uninspectedBytes: 796_000_000_000 },
    });
    render(<StorageWorkspace />);
    expect(screen.getByText(/was never examined/i)).toBeTruthy();
    expect(screen.getAllByText(/Not scanned \/ system-managed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Scan stopped early/i).length).toBeGreaterThan(0);
  });

  it("names the memory budget when that is what stopped the scan", () => {
    useStorageStore.setState({
      scan: {
        ...scan,
        truncated: true,
        truncationReason: "memory budget of 9.4 GB of index space",
        uninspectedBytes: 796_000_000_000,
      },
    });
    render(<StorageWorkspace />);
    expect(screen.getAllByText(/memory budget of 9\.4 GB of index space/i).length).toBeGreaterThan(0);
  });

  it("switches to cleanup without replacing file-browser state", () => {
    render(<StorageWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: /^Clean up/ }));
    expect(screen.getByRole("heading", { name: "Cleanup recommendations" })).toBeTruthy();
    expect(screen.getAllByText("High risk").length).toBeGreaterThan(0);
    expect(screen.getByText(/Age, size, or location alone never prove/i)).toBeTruthy();
  });

  it("requires an explicit review and acknowledgement before permanent deletion", () => {
    useStorageStore.setState({
      picks: [
        {
          path: "/Users/test/Library/Caches",
          name: "Caches",
          size: 100_000,
          isDirectory: true,
          modified: 1,
          category: "caches",
          risk: "review",
          source: "recommendation",
        },
      ],
    });
    render(<StorageWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Review cleanup" }));
    expect(screen.getByRole("dialog", { name: "Review exact cleanup targets" })).toBeTruthy();
    expect(screen.getAllByText("/Users/test/Library/Caches").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Move to Trash" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Delete permanently/i }));
    const confirm = screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /cannot be undone/i }));
    expect(confirm.disabled).toBe(false);
  });

  it("can exclude a recommendation from future cleanup suggestions", () => {
    render(<StorageWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: /^Clean up/ }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Exclude /Users/test/Library/Caches from future recommendations",
      }),
    );
    expect(useStorageStore.getState().excludedRecommendations).toContain("/Users/test/Library/Caches");
    expect(screen.queryByRole("button", { name: /Exclude \/Users\/test\/Library\/Caches/ })).toBeNull();
  });

  it("marks restored cached scans as read-only for cleanup", () => {
    useStorageStore.setState({
      scanFromCache: true,
      cachedAt: 2,
      picks: [
        {
          path: "/Users/test/Library/Caches",
          name: "Caches",
          size: 100_000,
          isDirectory: true,
          modified: 1,
          category: "caches",
          risk: "review",
          source: "recommendation",
        },
      ],
    });
    render(<StorageWorkspace />);
    expect(screen.getByText(/Showing the cached scan/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Rescan to enable cleanup/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Review cleanup/i })).toBeNull();
  });

  it("offers a scan state when no result exists", () => {
    useStorageStore.setState({ scan: null, view: "overview" });
    render(<StorageWorkspace />);
    expect(screen.getByText(/Ready to measure/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Quick overview scan/i })).toBeTruthy();
    expect(screen.getAllByText(/Deep scan/i).length).toBeGreaterThan(0);
  });

  it("does not fake a scan when the Tauri runtime is unavailable", async () => {
    useStorageStore.setState({ scan: null, view: "overview", volumes: [], selectedVolumePath: null });
    render(<StorageWorkspace />);
    expect(screen.getAllByText(/Choose a volume/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Quick overview scan/i })).toBeTruthy();
    // Scan scopes live behind one menu instead of three header buttons.
    const menu = screen.getByText(/^Scan$/, { selector: "summary" });
    expect(menu).toBeTruthy();
    fireEvent.click(menu);
    expect(screen.getAllByText(/^Deep scan$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Choose folder/).length).toBeGreaterThan(0);
  });
});
