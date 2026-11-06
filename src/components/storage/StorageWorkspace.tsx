import { useEffect } from "react";
import { Icon, type IconName } from "../Icon";
import { StorageIcon } from "../icons/StorageIcon";
import { useExplorerStore } from "../../state/explorerStore";
import { useStorageStore } from "../../state/storageStore";
import { formatCount, formatDate, formatSize } from "../../lib/format";
import { DEEP_SCAN_MAX_ENTRIES, type StorageView } from "../../lib/storage/types";
import { StorageOverview } from "./StorageOverview";
import { StorageTreeView } from "./StorageTreeView";
import { StorageFilesView } from "./StorageFilesView";
import { StorageFoldersView } from "./StorageFoldersView";
import { StorageFileTypesView } from "./StorageFileTypesView";
import { StorageTreemap } from "./StorageTreemap";
import { StorageDuplicates } from "./StorageDuplicates";
import { StorageCleanup } from "./StorageCleanup";
import { StorageDetails } from "./StorageDetails";
import { StorageSelectionBar } from "./StorageSelectionBar";

const VIEWS: Array<{ id: StorageView; label: string; icon: IconName }> = [
  { id: "overview", label: "Overview", icon: "drive" },
  { id: "tree", label: "Folder tree", icon: "folderGit" },
  { id: "files", label: "Largest files", icon: "file" },
  { id: "largestFolders", label: "Largest folders", icon: "folder" },
  { id: "fileTypes", label: "File types", icon: "fileType" },
  { id: "treemap", label: "Treemap", icon: "grid" },
  { id: "duplicates", label: "Duplicates", icon: "copy" },
  { id: "cleanup", label: "Cleanup", icon: "wrench" },
];

function ScanProgress() {
  const progress = useStorageStore((state) => state.progress);
  const scanning = useStorageStore((state) => state.scanning);
  if (!scanning) return null;
  return (
    <div className="storage-progress" role="status" aria-live="polite">
      <span className="storage-progress-track">
        <span className="storage-progress-pulse" />
      </span>
      <span className="storage-progress-copy">
        {progress
          ? `Scanned ${formatCount(progress.scannedEntries)} entries · ${formatCount(progress.scannedFiles)} files · ${formatSize(progress.logicalBytes)} · ${(progress.elapsedMs / 1000).toFixed(0)}s`
          : "Preparing filesystem scan..."}
      </span>
    </div>
  );
}

export function StorageWorkspace() {
  const initialize = useStorageStore((state) => state.initialize);
  const closeWorkspace = useStorageStore((state) => state.closeWorkspace);
  const volumes = useStorageStore((state) => state.volumes);
  const volumesLoading = useStorageStore((state) => state.volumesLoading);
  const volumesError = useStorageStore((state) => state.volumesError);
  const selectedVolumePath = useStorageStore((state) => state.selectedVolumePath);
  const selectVolume = useStorageStore((state) => state.selectVolume);
  const loadVolumes = useStorageStore((state) => state.loadVolumes);
  const scan = useStorageStore((state) => state.scan);
  const scanFromCache = useStorageStore((state) => state.scanFromCache);
  const cachedAt = useStorageStore((state) => state.cachedAt);
  const scanning = useStorageStore((state) => state.scanning);
  const scanError = useStorageStore((state) => state.scanError);
  const rescan = useStorageStore((state) => state.rescan);
  const startScan = useStorageStore((state) => state.startScan);
  const cancelScan = useStorageStore((state) => state.cancelScan);
  const clearIndex = useStorageStore((state) => state.clearIndex);
  const view = useStorageStore((state) => state.view);
  const setView = useStorageStore((state) => state.setView);
  const selectedFile = useStorageStore((state) => state.selectedFile);
  const selectedDirectory = useStorageStore((state) => state.selectedDirectory);
  const picks = useStorageStore((state) => state.picks);
  const excludedRecommendations = useStorageStore((state) => state.excludedRecommendations);
  const volume = volumes.find((item) => item.mountPoint === selectedVolumePath) ?? null;
  const excludedSet = new Set(excludedRecommendations);
  const visibleCleanupCount = (scan?.cleanup ?? []).filter((item) => !excludedSet.has(item.path)).length;

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const canShowView = view === "overview" || Boolean(scan);

  const scanSpecificFolder = () => {
    const explorer = useExplorerStore.getState();
    explorer.openDialog({
      kind: "prompt",
      title: "Scan a specific folder",
      label: "Absolute folder path",
      initialValue: explorer.currentFolder(),
      confirmLabel: "Scan folder",
      onConfirm: (value) => {
        const path = value.trim().replace(/^["']|["']$/g, "");
        if (!path) return;
        explorer.closeDialog();
        void startScan(path, DEEP_SCAN_MAX_ENTRIES);
      },
    });
  };

  return (
    <div className="storage-workspace">
      <header className="storage-header">
        <div className="storage-header-title">
          <span className="storage-header-mark" aria-hidden="true">
            <StorageIcon size={22} variant={volume?.isNetwork ? "network" : volume?.isInternal ? "internal" : "external"} />
          </span>
          <div>
            <h1>Storage Analyzer</h1>
            <p>
              {volume ? `${volume.name} · ${formatSize(volume.usedBytes)} used of ${formatSize(volume.totalBytes)}` : "Choose a volume"}
            </p>
          </div>
        </div>
        <div className="storage-header-controls">
          <label className="storage-volume-select">
            <span className="storage-visually-hidden">Volume</span>
            <select
              value={selectedVolumePath ?? ""}
              disabled={volumesLoading || scanning}
              onChange={(event) => selectVolume(event.target.value)}
              aria-label="Choose a storage volume"
            >
              {volumes.map((item) => (
                <option value={item.mountPoint} key={item.id}>
                  {item.name} — {formatSize(item.usedBytes)} / {formatSize(item.totalBytes)}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" size={11} />
          </label>
          <button
            type="button"
            className="storage-toolbar-button"
            onClick={() => void loadVolumes()}
            disabled={volumesLoading || scanning}
            title="Refresh volumes"
            aria-label="Refresh volumes"
          >
            <Icon name={volumesLoading ? "spinner" : "refresh"} size={14} className={volumesLoading ? "spin" : ""} />
          </button>
          {scanning ? (
            <button type="button" className="storage-toolbar-button danger" onClick={() => void cancelScan()}>
              <Icon name="close" size={13} />
              Cancel scan
            </button>
          ) : (
            <>
              <button
                type="button"
                className="storage-primary-button"
                onClick={() => void startScan()}
                disabled={!volume}
              >
                <Icon name={scan ? "refresh" : "search"} size={14} />
                {scan ? "Rescan volume" : "Scan volume"}
              </button>
              <button
                type="button"
                className="storage-toolbar-button"
                onClick={() => void startScan(undefined, DEEP_SCAN_MAX_ENTRIES)}
                disabled={!volume}
                title="Deep scan runs until the available-memory budget is reached (no fixed entry cap) and can take several minutes"
              >
                <Icon name="database" size={13} />
                Deep scan
              </button>
              <button
                type="button"
                className="storage-toolbar-button"
                onClick={scanSpecificFolder}
                disabled={scanning}
                title="Scan one folder directly instead of the whole volume"
              >
                <Icon name="folderOpen" size={13} />
                Scan folder...
              </button>
            </>
          )}
          <button
            type="button"
            className="storage-toolbar-button storage-close"
            onClick={closeWorkspace}
            aria-label="Close Storage Analyzer"
            title="Close Storage Analyzer"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <ScanProgress />

      {scanFromCache ? (
        <div className="storage-info-banner storage-cache-banner">
          <Icon name="database" size={14} />
          <span>
            Showing the cached scan of <strong>{scan?.root}</strong>
            {cachedAt ? ` from ${formatDate(cachedAt)}` : ""}. Drill-down is available; cleanup is read-only until a fresh
            rescan.
          </span>
          <button type="button" className="storage-toolbar-button" onClick={() => void rescan()}>
            <Icon name="refresh" size={13} />
            Rescan now
          </button>
        </div>
      ) : null}

      {scanError ? (
        <div className="storage-error-banner" role="alert">
          <Icon name="alertCircle" size={14} />
          <span>{scanError}</span>
          {scanError.startsWith("Scan cancelled") ? null : (
            <button type="button" className="link-button" onClick={() => void startScan()}>
              Try again
            </button>
          )}
        </div>
      ) : null}

      {volumesError ? (
        <div className="storage-error-banner" role="alert">
          <Icon name="warning" size={14} />
          <span>{volumesError}</span>
        </div>
      ) : null}

      <div className={`storage-body ${selectedFile || selectedDirectory ? "with-details" : ""}`}>
        <nav className="storage-nav" aria-label="Storage analysis views">
          <div className="storage-nav-section">Analyze</div>
          {VIEWS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`storage-nav-item ${view === item.id ? "active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
              disabled={!canShowView}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
              {item.id === "cleanup" && visibleCleanupCount ? (
                <span className="storage-nav-count">{visibleCleanupCount}</span>
              ) : null}
            </button>
          ))}

          <div className="storage-nav-spacer" />
          {volume ? (
            <section className="storage-volume-card" aria-label="Selected volume">
              <header>
                <StorageIcon
                  size={24}
                  variant={
                    volume.isNetwork
                      ? "network"
                      : volume.isRemovable
                        ? "removable"
                        : volume.isInternal
                          ? "internal"
                          : "external"
                  }
                />
                <div>
                  <strong>{volume.name}</strong>
                  <span title={volume.mountPoint}>{volume.mountPoint}</span>
                </div>
              </header>
              <div className="storage-capacity-track" aria-hidden="true">
                <span
                  className="storage-capacity-used"
                  style={{ width: `${Math.min(100, Math.max(0, volume.usagePercent))}%` }}
                />
              </div>
              <dl>
                <div>
                  <dt>Used</dt>
                  <dd>{formatSize(volume.usedBytes)}</dd>
                </div>
                <div>
                  <dt>Available</dt>
                  <dd>{formatSize(volume.availableBytes)}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>{volume.filesystem || "Unknown"}{volume.isApfs ? " · APFS" : ""}</dd>
                </div>
                <div>
                  <dt>Connection</dt>
                  <dd>{volume.isNetwork ? "Network" : volume.isVirtual ? "Disk image" : volume.isRemovable ? "Removable" : volume.isInternal ? "Internal" : "External"}</dd>
                </div>
                {volume.container ? (
                  <div>
                    <dt>Container</dt>
                    <dd>{volume.container}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="storage-volume-note">
                APFS volumes in the same container share free space. Capacity is reported by the filesystem, not inferred.
              </p>
            </section>
          ) : null}
          <div className="storage-nav-footer-actions">
            <button
              type="button"
              className="storage-toolbar-button"
              onClick={() => void clearIndex()}
              disabled={!scan || scanning}
              title="Clear the in-memory analysis results"
            >
              <Icon name="delete" size={12} />
              Clear analysis results
            </button>
          </div>
          <p className="storage-local-note">
            <Icon name="shield" size={12} />
            Analysis stays on this Mac. Filenames and hashes are never uploaded.
          </p>
        </nav>

        <main className="storage-main">
          {!canShowView ? (
            <div className="storage-empty-state">
              <span className="storage-empty-art" aria-hidden="true">
                <StorageIcon size={64} variant={volume?.isNetwork ? "network" : volume?.isInternal ? "internal" : "external"} />
              </span>
              <h2>{volume ? `Analyze ${volume.name}` : "Choose a volume"}</h2>
              <p>
                Volume capacity is available immediately. A scan measures every readable file, folder, category, and cleanup
                candidate. Nothing is deleted automatically.
              </p>
              <button type="button" className="storage-primary-button" onClick={() => void startScan()} disabled={!volume}>
                <Icon name="search" size={14} />
                Start scan
              </button>
              {scan?.cancelled ? <p className="storage-muted">The previous scan was cancelled and its partial data is available.</p> : null}
            </div>
          ) : view === "overview" ? (
            <StorageOverview />
          ) : view === "tree" ? (
            <StorageTreeView />
          ) : view === "files" ? (
            <StorageFilesView />
          ) : view === "largestFolders" ? (
            <StorageFoldersView />
          ) : view === "fileTypes" ? (
            <StorageFileTypesView />
          ) : view === "treemap" ? (
            <StorageTreemap />
          ) : view === "duplicates" ? (
            <StorageDuplicates />
          ) : (
            <StorageCleanup />
          )}
        </main>

        {selectedFile || selectedDirectory ? <StorageDetails /> : null}
      </div>

      {picks.length ? <StorageSelectionBar /> : null}
    </div>
  );
}
