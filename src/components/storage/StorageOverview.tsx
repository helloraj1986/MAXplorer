import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { StorageIcon } from "../icons/StorageIcon";
import { useStorageStore } from "../../state/storageStore";
import { useExplorerStore } from "../../state/explorerStore";
import { formatCount, formatDate, formatSize } from "../../lib/format";
import {
  CATEGORY_DESCRIPTIONS,
  DEEP_SCAN_MAX_ENTRIES,
  categoryColor,
  storageFileEntry,
  type CleanupRecommendation,
  type StorageScanResult,
  type StorageVolume,
} from "../../lib/storage/types";
import { pickFromRecommendation, recommendationSelection } from "../../lib/storage/selection";

function riskLabel(risk: string): string {
  if (risk === "low") return "Low risk";
  if (risk === "high") return "High risk";
  return "Review recommended";
}

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <span className={`storage-risk storage-risk-${risk}`}>
      <Icon name={risk === "high" ? "warning" : risk === "low" ? "checkCircle" : "info"} size={11} />
      {riskLabel(risk)}
    </span>
  );
}

function CapacityHero({ volume, scan }: { volume: StorageVolume | null; scan: StorageScanResult | null }) {
  if (!volume) return null;
  const usedPercent = Math.min(100, Math.max(0, volume.usagePercent));
  return (
    <section className="storage-hero" aria-label="Volume capacity">
      <div className="storage-hero-head">
        <div>
          <span className="storage-eyebrow">Selected volume</span>
          <h2>{volume.name}</h2>
          <p title={volume.mountPoint}>{volume.mountPoint}</p>
        </div>
        <StorageIcon
          size={42}
          variant={volume.isNetwork ? "network" : volume.isRemovable ? "removable" : volume.isInternal ? "internal" : "external"}
        />
      </div>
      <div
        className="storage-hero-bar"
        role="img"
        aria-label={`${formatSize(volume.usedBytes)} used of ${formatSize(volume.totalBytes)}, ${usedPercent.toFixed(0)} percent`}
      >
        <span style={{ width: `${usedPercent}%` }} />
      </div>
      <div className="storage-hero-legend">
        <span><strong>{formatSize(volume.usedBytes)}</strong> used ({usedPercent.toFixed(1)}%)</span>
        <span><strong>{formatSize(volume.availableBytes)}</strong> available</span>
        <span><strong>{formatSize(volume.totalBytes)}</strong> capacity</span>
        <span>{volume.filesystem || "Unknown format"}{volume.isApfs ? " · APFS" : ""}</span>
      </div>
      {scan && scan.uninspectedBytes > 0 ? (
        <p className="storage-hero-note">
          <Icon name="info" size={12} />
          {scan.truncated || scan.cancelled
            ? `${formatSize(scan.uninspectedBytes)} was not inspected because the scan stopped at its ${formatCount(scan.maxEntries)} entry limit. This is not a cleanup estimate. Run Deep scan, or scan your Home folder or a narrower folder for complete coverage.`
            : `${formatSize(scan.uninspectedBytes)} of reported usage is not attributable to inspected files. APFS snapshots, purgeable space, system-protected data, other volumes sharing the container, and unreadable locations can all contribute.`}
        </p>
      ) : null}
    </section>
  );
}

function UsageBar({ scan }: { scan: StorageScanResult }) {
  const openCategory = useStorageStore((state) => state.openCategory);
  const volume = scan.volume;
  if (!volume) return null;
  const folderScan = scan.root !== volume.mountPoint;
  const incomplete = scan.truncated || scan.cancelled;
  const capacity = (folderScan ? scan.totalAllocatedBytes : volume.totalBytes) || 1;
  const allocated = scan.categories.reduce((sum, category) => sum + category.allocated, 0);
  const used = folderScan ? Math.max(0, scan.totalAllocatedBytes) : Math.max(0, volume.usedBytes);
  const inspected = Math.min(used, allocated);
  const uninspected = folderScan ? 0 : Math.max(0, used - inspected);
  const scale = allocated > used && allocated > 0 ? used / allocated : 1;
  const free = folderScan ? 0 : Math.max(0, volume.totalBytes - used);
  return (
    <section className="storage-card storage-usage-card" aria-label="Storage usage by category">
      <header className="storage-card-head">
        <div>
          <h2>Storage usage</h2>
          <p>Each inspected file belongs to exactly one category. Media inside applications is not counted twice.</p>
        </div>
        <span className="storage-muted">
          {folderScan ? `${formatSize(used)} in this folder scan` : `${formatSize(used)} of ${formatSize(volume.totalBytes)} used`}
        </span>
      </header>
      <div className="storage-usage-bar" role="group" aria-label="Category usage">
        {scan.categories.filter((category) => category.allocated > 0).map((category) => (
          <button
            type="button"
            key={category.id}
            className="storage-usage-segment"
            style={{
              width: `${((category.allocated * scale) / capacity) * 100}%`,
              background: categoryColor(category.id),
            }}
            title={`${category.label}: ${formatSize(category.bytes)} (${category.percent.toFixed(1)}% of inspected files)`}
            aria-label={`${category.label}: ${formatSize(category.bytes)}. Inspect category.`}
            onClick={() => void openCategory(category.id, category.label)}
          />
        ))}
        {uninspected > 0 ? (
          <span
            className="storage-usage-segment storage-usage-uninspected"
            style={{ width: `${(uninspected / capacity) * 100}%` }}
            title={
              incomplete
                ? `${formatSize(uninspected)} was not inspected because the scan hit its entry limit`
                : `${formatSize(uninspected)} cannot be attributed to inspected files`
            }
            aria-label={
              incomplete
                ? `${formatSize(uninspected)} not inspected because the scan hit its entry limit`
                : `${formatSize(uninspected)} uninspected or system-managed storage`
            }
          />
        ) : null}
        {!folderScan ? (
          <span
            className="storage-usage-segment storage-usage-free"
            style={{ width: `${(free / capacity) * 100}%` }}
            title={`${formatSize(free)} free`}
            aria-label={`${formatSize(free)} free`}
          />
        ) : null}
      </div>
      <div className="storage-usage-legend">
        {scan.categories.map((category) => (
          <button
            type="button"
            key={category.id}
            className="storage-legend-row"
            onClick={() => void openCategory(category.id, category.label)}
            title={CATEGORY_DESCRIPTIONS[category.id]}
          >
            <span className="storage-legend-dot" style={{ background: categoryColor(category.id) }} aria-hidden="true" />
            <span className="storage-legend-name">{category.label}</span>
            <span className="storage-legend-size">{formatSize(category.bytes)}</span>
            <span className="storage-legend-percent">{category.percent.toFixed(1)}%</span>
            <span className="storage-legend-files">{formatCount(category.files)} files</span>
            <Icon name="chevronRight" size={11} />
          </button>
        ))}
        {!folderScan ? (
          <div className="storage-legend-row static">
            <span className="storage-legend-dot storage-legend-uninspected" aria-hidden="true" />
            <span className="storage-legend-name">
              {incomplete ? "Not scanned / system-managed" : "Uninspected / system-managed"}
            </span>
            <span className="storage-legend-size">{formatSize(uninspected)}</span>
            <span className="storage-legend-percent" />
            <span className="storage-legend-files">
              {incomplete ? "Scan stopped at entry limit" : "Not attributable to files"}
            </span>
            <span />
          </div>
        ) : null}
        {!folderScan ? (
          <div className="storage-legend-row static">
            <span className="storage-legend-dot storage-legend-free" aria-hidden="true" />
            <span className="storage-legend-name">Available</span>
            <span className="storage-legend-size">{formatSize(free)}</span>
            <span className="storage-legend-percent" />
            <span className="storage-legend-files">Free space</span>
            <span />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  detail,
  action,
  icon,
}: {
  label: string;
  value: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  icon: Parameters<typeof Icon>[0]["name"];
}) {
  return (
    <article className="storage-stat-card">
      <span className="storage-stat-icon" aria-hidden="true"><Icon name={icon} size={16} /></span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
      {action ? (
        <button type="button" className="link-button" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </article>
  );
}

function RecommendationRow({ recommendation }: { recommendation: CleanupRecommendation }) {
  const togglePick = useStorageStore((state) => state.togglePick);
  const picks = useStorageStore((state) => state.picks);
  const revealInFinder = useStorageStore((state) => state.revealInFinder);
  const selected = picks.some((pick) => pick.path === recommendation.path);
  return (
    <div className={`storage-recommendation ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className={`storage-check ${selected ? "checked" : ""}`}
        aria-pressed={selected}
        aria-label={selected ? "Remove from cleanup selection" : "Add to cleanup selection"}
        onClick={() => togglePick(pickFromRecommendation(recommendation))}
      >
        {selected ? <Icon name="check" size={12} /> : null}
      </button>
      <div className="storage-recommendation-main">
        <div className="storage-recommendation-title">
          <strong>{recommendation.title}</strong>
          <RiskBadge risk={recommendation.risk} />
        </div>
        <p>{recommendation.reason}</p>
        <span className="storage-path" title={recommendation.path}>{recommendation.path}</span>
      </div>
      <div className="storage-recommendation-side">
        <strong>{formatSize(recommendation.recoverableBytes)}</strong>
        <span>{recommendation.isDirectory ? "Folder" : "File"}</span>
        <button type="button" className="link-button" onClick={() => void revealInFinder(recommendation.path)}>
          Reveal
        </button>
      </div>
    </div>
  );
}

export function StorageOverview() {
  const scan = useStorageStore((state) => state.scan);
  const volumes = useStorageStore((state) => state.volumes);
  const selectedVolumePath = useStorageStore((state) => state.selectedVolumePath);
  const startScan = useStorageStore((state) => state.startScan);
  const scanning = useStorageStore((state) => state.scanning);
  const setView = useStorageStore((state) => state.setView);
  const openLargestFiles = useStorageStore((state) => state.openLargestFiles);
  const openRecentLarge = useStorageStore((state) => state.openRecentLarge);
  const openStaleLarge = useStorageStore((state) => state.openStaleLarge);
  const openCategory = useStorageStore((state) => state.openCategory);
  const duplicates = useStorageStore((state) => state.duplicates);
  const runningDuplicates = useStorageStore((state) => state.duplicatesLoading);
  const runDuplicates = useStorageStore((state) => state.runDuplicates);
  const excludedRecommendations = useStorageStore((state) => state.excludedRecommendations);
  const volume = volumes.find((item) => item.mountPoint === selectedVolumePath) ?? scan?.volume ?? null;
  const explorerPlatform = useExplorerStore((state) => state.platform);

  if (!scan) {
    return (
      <div className="storage-overview">
        <CapacityHero volume={volume} scan={null} />
        <section className="storage-card storage-intro-card">
          <h2>Know exactly what fills this volume</h2>
          <p>
            MAXplorer reads filesystem metadata locally, measures allocated blocks, categorizes each file once, and keeps
            symbolic links out of recursive traversal. System-managed storage is reported separately instead of being guessed.
          </p>
          <div className="storage-intro-grid">
            <div><Icon name="folder" size={18} /><strong>Folder and file drill-down</strong><span>Every readable directory, subdirectory, and file.</span></div>
            <div><Icon name="grid" size={18} /><strong>Interactive treemap</strong><span>Canvas rendering remains responsive on large trees.</span></div>
            <div><Icon name="copy" size={18} /><strong>Verified duplicates</strong><span>Same-size candidates are confirmed with SHA-256.</span></div>
            <div><Icon name="shield" size={18} /><strong>Review before removal</strong><span>Exact paths, risk, and confirmation for every destructive action.</span></div>
          </div>
          <div className="storage-view-actions">
            <button type="button" className="storage-primary-button" onClick={() => void startScan()} disabled={!volume || scanning}>
              <Icon name={scanning ? "spinner" : "search"} size={14} className={scanning ? "spin" : ""} />
              {scanning ? "Scanning..." : "Quick overview scan"}
            </button>
            <button
              type="button"
              className="storage-toolbar-button"
              onClick={() => void startScan(undefined, DEEP_SCAN_MAX_ENTRIES)}
              disabled={!volume || scanning}
              title="Allow up to 5,000,000 entries; this can take several minutes"
            >
              <Icon name="database" size={13} />
              Deep scan
            </button>
          </div>
          <p className="storage-muted">
            A full scan can take time on large disks. It runs in the background and can be cancelled; MAXplorer remains usable.
          </p>
        </section>
      </div>
    );
  }

  const largestFile = scan.largestFiles[0] ?? null;
  const largestFolder = scan.largestDirectories[0] ?? null;
  const excludedSet = new Set(excludedRecommendations);
  const visibleCleanup = scan.cleanup.filter((recommendation) => !excludedSet.has(recommendation.path));
  const cleanupSummary = recommendationSelection(visibleCleanup);
  const topRecommendation = visibleCleanup[0] ?? null;
  const scannedAt = formatDate(scan.finishedAt);
  const platformLabel = explorerPlatform?.platform === "macos" ? "macOS" : explorerPlatform?.platform ?? "desktop";
  const homeFolder = explorerPlatform?.home;
  const incomplete = scan.cancelled || scan.truncated;

  return (
    <div className="storage-overview">
      <CapacityHero volume={volume} scan={scan} />

      {incomplete ? (
        <div className="storage-warning-banner storage-incomplete-banner">
          <Icon name="warning" size={14} />
          <span>
            {scan.cancelled
              ? "This is a partial scan. Totals and categories cover only inspected entries."
              : `The scan reached its ${formatCount(scan.maxEntries)} entry safety limit, so ${formatSize(scan.uninspectedBytes)} was never examined. This is not a cleanup estimate.`}
          </span>
          <div className="storage-warning-actions">
            {homeFolder ? (
              <button
                type="button"
                className="storage-toolbar-button"
                onClick={() => void startScan(homeFolder, DEEP_SCAN_MAX_ENTRIES)}
                title="Scan your Home folder instead of the entire APFS container"
              >
                <Icon name="home" size={13} />
                Deep scan Home folder
              </button>
            ) : null}
            <button
              type="button"
              className="storage-toolbar-button"
              onClick={() => void startScan(undefined, DEEP_SCAN_MAX_ENTRIES)}
            >
              <Icon name="database" size={13} />
              Deep scan volume
            </button>
          </div>
        </div>
      ) : null}

      <div className="storage-stat-grid">
        <StatCard
          icon="drive"
          label="Storage used"
          value={formatSize(volume?.usedBytes ?? scan.totalAllocatedBytes)}
          detail={`${formatSize(scan.inspectableBytes)} inspected logically`}
        />
        <StatCard
          icon="checkCircle"
          label="Available"
          value={formatSize(volume?.availableBytes ?? 0)}
          detail={volume ? `${(100 - volume.usagePercent).toFixed(1)}% of capacity` : undefined}
        />
        <StatCard
          icon="file"
          label="Largest file"
          value={largestFile ? formatSize(largestFile.size) : "None found"}
          detail={largestFile?.name}
          action={largestFile ? { label: "View largest", onClick: () => void openLargestFiles() } : undefined}
        />
        <StatCard
          icon="folder"
          label="Largest folder"
          value={largestFolder ? formatSize(largestFolder.size) : "None found"}
          detail={largestFolder?.name}
          action={{ label: "Explore", onClick: () => setView("largestFolders") }}
        />
        <StatCard
          icon="wrench"
          label="Cleanup candidates"
          value={formatSize(cleanupSummary.totalBytes)}
          detail={`${formatCount(visibleCleanup.length)} recommendations · deduplicated total`}
          action={{ label: "Review", onClick: () => setView("cleanup") }}
        />
        <StatCard
          icon="copy"
          label="Duplicate candidates"
          value={duplicates ? formatSize(duplicates.recoverableBytes) : runningDuplicates ? "Scanning..." : "Not scanned"}
          detail={duplicates ? `${formatCount(duplicates.groups.length)} verified groups` : "Optional content verification"}
          action={{ label: duplicates ? "Review" : "Find", onClick: () => { setView("duplicates"); if (!duplicates) void runDuplicates(); } }}
        />
        <StatCard
          icon="clock"
          label="Recently changed large files"
          value={formatCount(scan.recentLargeFiles.length)}
          detail={scan.recentLargeFiles[0]?.name}
          action={{ label: "Show", onClick: () => void openRecentLarge() }}
        />
        <StatCard
          icon="warning"
          label="Scan status"
          value={scan.cancelled ? "Partial" : scan.truncated ? "Limited" : "Complete"}
          detail={`${scannedAt} · ${formatCount(scan.scannedEntries)} entries · ${scan.permissionErrors} permission errors`}
        />
      </div>

      <UsageBar scan={scan} />

      <div className="storage-overview-columns">
        <section className="storage-card">
          <header className="storage-card-head">
            <div>
              <h2>Largest opportunities</h2>
              <p>Only scanned evidence is shown. The total is deduplicated so nested selections are not counted twice.</p>
            </div>
            <button type="button" className="link-button" onClick={() => setView("cleanup")}>All cleanup</button>
          </header>
          {visibleCleanup.length ? (
            <div className="storage-recommendation-list">
              {visibleCleanup.slice(0, 5).map((recommendation) => (
                <RecommendationRow key={recommendation.id} recommendation={recommendation} />
              ))}
            </div>
          ) : (
            <div className="storage-inline-empty">
              <Icon name="checkCircle" size={26} />
              <h3>No cleanup recommendations</h3>
              <p>No scanned files met the conservative cleanup rules. Large files and old data are not automatically considered disposable.</p>
            </div>
          )}
          {topRecommendation ? (
            <p className="storage-muted">
              The first recommendation is {topRecommendation.title.toLowerCase()}; review its path and risk before selecting it.
            </p>
          ) : null}
        </section>

        <section className="storage-card">
          <header className="storage-card-head">
            <div>
              <h2>Category detail</h2>
              <p>Click any row to inspect its largest files. Counts come from the current scan.</p>
            </div>
          </header>
          <div className="storage-category-grid">
            {scan.categories.map((category) => (
              <button
                type="button"
                className="storage-category-tile"
                key={category.id}
                onClick={() => void openCategory(category.id, category.label)}
                title={CATEGORY_DESCRIPTIONS[category.id]}
              >
                <span className="storage-legend-dot" style={{ background: categoryColor(category.id) }} />
                <span>
                  <strong>{category.label}</strong>
                  <small>{formatCount(category.files)} files · {category.percent.toFixed(1)}%</small>
                </span>
                <span className="storage-category-size">{formatSize(category.bytes)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="storage-overview-columns">
        <section className="storage-card">
          <header className="storage-card-head">
            <div>
              <h2>Recent and stale large files</h2>
              <p>Modification dates are evidence, not proof that a file is unnecessary.</p>
            </div>
          </header>
          <div className="storage-split-lists">
            <div>
              <h3><Icon name="clock" size={13} /> Recently changed</h3>
              {scan.recentLargeFiles.length ? scan.recentLargeFiles.slice(0, 5).map((file) => (
                <button type="button" className="storage-mini-file" key={file.path} onClick={() => void openRecentLarge()}>
                  <FileTypeIcon entry={storageFileEntry(file)} size={20} />
                  <span title={file.path}>{file.name}</span>
                  <strong>{formatSize(file.size)}</strong>
                </button>
              )) : <p className="storage-muted">No large files were changed recently.</p>}
              <button type="button" className="link-button" onClick={() => void openRecentLarge()}>View all recent</button>
            </div>
            <div>
              <h3><Icon name="warning" size={13} /> Old large files</h3>
              {scan.staleLargeFiles.length ? scan.staleLargeFiles.slice(0, 5).map((file) => (
                <button type="button" className="storage-mini-file" key={file.path} onClick={() => void openStaleLarge()}>
                  <FileTypeIcon entry={storageFileEntry(file)} size={20} />
                  <span title={file.path}>{file.name}</span>
                  <strong>{formatSize(file.size)}</strong>
                </button>
              )) : <p className="storage-muted">No large files are older than a year.</p>}
              <button type="button" className="link-button" onClick={() => void openStaleLarge()}>View all old files</button>
            </div>
          </div>
        </section>

        <section className="storage-card storage-notes-card">
          <header className="storage-card-head">
            <div>
              <h2>Scan transparency</h2>
              <p>{platformLabel} filesystem evidence from {formatCount(scan.scannedDirectories)} folders.</p>
            </div>
          </header>
          <dl className="storage-scan-facts">
            <div><dt>Files</dt><dd>{formatCount(scan.scannedFiles)}</dd></div>
            <div><dt>Folders</dt><dd>{formatCount(scan.scannedDirectories)}</dd></div>
            <div><dt>Logical bytes</dt><dd>{formatSize(scan.totalLogicalBytes)}</dd></div>
            <div><dt>Allocated bytes</dt><dd>{formatSize(scan.totalAllocatedBytes)}</dd></div>
            <div><dt>Hard links deduplicated</dt><dd>{formatCount(scan.hardLinks)}</dd></div>
            <div><dt>Symlinks not followed</dt><dd>{formatCount(scan.symbolicLinks)}</dd></div>
            <div><dt>Permission errors</dt><dd>{formatCount(scan.permissionErrors)}</dd></div>
            <div><dt>Elapsed</dt><dd>{(scan.elapsedMs / 1000).toFixed(1)}s</dd></div>
          </dl>
          <details className="storage-notes">
            <summary>{scan.notes.length} methodology and coverage notes</summary>
            <ul>
              {scan.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </details>
        </section>
      </div>
    </div>
  );
}
