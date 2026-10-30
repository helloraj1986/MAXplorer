import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { useStorageStore } from "../../state/storageStore";
import { formatCount, formatSize, parentPath } from "../../lib/format";
import { pickFromRecommendation, recommendationSelection, summarizeSelection } from "../../lib/storage/selection";
import { CLEANUP_KIND_LABELS, type CleanupRecommendation, type StorageRisk } from "../../lib/storage/types";
import { RiskBadge } from "./StorageOverview";

const RISK_ORDER: StorageRisk[] = ["high", "review", "low"];

function Recommendation({
  recommendation,
}: {
  recommendation: CleanupRecommendation;
}) {
  const picks = useStorageStore((state) => state.picks);
  const togglePick = useStorageStore((state) => state.togglePick);
  const revealInFinder = useStorageStore((state) => state.revealInFinder);
  const openDirectory = useStorageStore((state) => state.openDirectory);
  const setView = useStorageStore((state) => state.setView);
  const excludeRecommendation = useStorageStore((state) => state.excludeRecommendation);
  const selected = picks.some((pick) => pick.path === recommendation.path);
  return (
    <article className={`storage-cleanup-item ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className={`storage-check ${selected ? "checked" : ""}`}
        aria-pressed={selected}
        aria-label={selected ? "Remove from cleanup selection" : "Add to cleanup selection"}
        onClick={() => togglePick(pickFromRecommendation(recommendation))}
      >
        {selected ? <Icon name="check" size={12} /> : null}
      </button>
      <div className="storage-cleanup-main">
        <div className="storage-cleanup-title">
          <strong>{recommendation.title}</strong>
          <RiskBadge risk={recommendation.risk} />
          <span className="storage-pill">{CLEANUP_KIND_LABELS[recommendation.kind] ?? recommendation.kind}</span>
        </div>
        <p>{recommendation.reason}</p>
        <span className="storage-path" title={recommendation.path}>{recommendation.path}</span>
        {recommendation.note ? <p className="storage-cleanup-note"><Icon name="info" size={11} /> {recommendation.note}</p> : null}
      </div>
      <div className="storage-cleanup-side">
        <strong>{formatSize(recommendation.recoverableBytes)}</strong>
        <span>{recommendation.isDirectory ? "Folder total" : "File size"}</span>
        <span>{recommendation.reversible ? "Reversible via Trash" : "Permanent only"}</span>
        <div className="storage-row-actions">
          <button
            type="button"
            className="storage-icon-button"
            title="Inspect in folder tree"
            aria-label={`Inspect ${recommendation.path} in folder tree`}
            onClick={() => {
              void openDirectory(recommendation.isDirectory ? recommendation.path : parentPath(recommendation.path) ?? recommendation.path);
              setView("tree");
            }}
          >
            <Icon name="folderOpen" size={12} />
          </button>
          <button
            type="button"
            className="storage-icon-button"
            title="Reveal in Finder"
            aria-label={`Reveal ${recommendation.path} in Finder`}
            onClick={() => void revealInFinder(recommendation.path)}
          >
            <Icon name="open" size={12} />
          </button>
          <button
            type="button"
            className="storage-icon-button"
            title="Exclude from future recommendations"
            aria-label={`Exclude ${recommendation.path} from future recommendations`}
            onClick={() => excludeRecommendation(recommendation.path)}
          >
            <Icon name="xCircle" size={12} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function StorageCleanup() {
  const scan = useStorageStore((state) => state.scan);
  const picks = useStorageStore((state) => state.picks);
  const selectAllRecommendations = useStorageStore((state) => state.selectAllRecommendations);
  const clearPicks = useStorageStore((state) => state.clearPicks);
  const setView = useStorageStore((state) => state.setView);
  const outcome = useStorageStore((state) => state.cleanupOutcome);
  const excluded = useStorageStore((state) => state.excludedRecommendations);
  const clearExclusions = useStorageStore((state) => state.clearRecommendationExclusions);
  const running = useStorageStore((state) => state.cleanupRunning);
  const cleanupProgress = useStorageStore((state) => state.cleanupProgress);
  const dismissOutcome = useStorageStore((state) => state.dismissCleanupOutcome);
  const rescan = useStorageStore((state) => state.rescan);
  const [risk, setRisk] = useState<StorageRisk | "all">("all");
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState<"size" | "risk">("size");

  const visibleCleanup = useMemo(() => {
    if (!scan) return [];
    const excludedSet = new Set(excluded);
    return scan.cleanup.filter((item) => !excludedSet.has(item.path));
  }, [scan, excluded]);

  const kinds = useMemo(() => {
    return [...new Set(visibleCleanup.map((item) => item.kind))].sort();
  }, [visibleCleanup]);

  const recommendations = useMemo(() => {
    return visibleCleanup
      .filter((item) => risk === "all" || item.risk === risk)
      .filter((item) => kind === "all" || item.kind === kind)
      .sort((left, right) => {
        if (sort === "risk") {
          return RISK_ORDER.indexOf(left.risk) - RISK_ORDER.indexOf(right.risk) || right.size - left.size;
        }
        return right.size - left.size;
      });
  }, [visibleCleanup, risk, kind, sort]);

  const allSummary = useMemo(() => recommendationSelection(visibleCleanup), [visibleCleanup]);
  const filteredSummary = useMemo(() => recommendationSelection(recommendations), [recommendations]);
  const selectedSummary = useMemo(() => summarizeSelection(picks), [picks]);

  if (!scan) return null;

  return (
    <div className="storage-cleanup-view">
      <section className="storage-card storage-view-header">
        <div>
          <span className="storage-eyebrow">Cleanup intelligence</span>
          <h2>Cleanup recommendations</h2>
          <p>
            Recommendations explain why an item was identified, but age, size, or location alone never prove that something is
            safe to delete. Estimates are deduplicated; actual reclaimed space can differ because of allocation, snapshots,
            hard links, and compression.
          </p>
        </div>
        <div className="storage-view-actions">
          <button type="button" className="storage-toolbar-button" onClick={selectAllRecommendations} disabled={!visibleCleanup.length}>
            <Icon name="check" size={13} />
            Select all recommendations
          </button>
          <button type="button" className="storage-toolbar-button" onClick={clearPicks} disabled={!picks.length}>
            <Icon name="close" size={13} />
            Clear selection
          </button>
          <button type="button" className="storage-toolbar-button" onClick={() => setView("duplicates")}>
            <Icon name="copy" size={13} />
            Duplicates
          </button>
        </div>
      </section>

      {running ? (
        <div className="storage-warning-banner">
          <Icon name="spinner" size={14} className="spin" />
          <span>
            Cleanup is running. MAXplorer revalidates each path before moving or deleting it.
            {cleanupProgress
              ? ` ${cleanupProgress.processed} of ${cleanupProgress.total} processed · ${cleanupProgress.completed} completed · ${cleanupProgress.failed} failed.`
              : ""}
          </span>
        </div>
      ) : null}

      {outcome ? (
        <section className="storage-card storage-cleanup-report">
          <header className="storage-card-head">
            <div>
              <h2>Cleanup report</h2>
              <p>
                {outcome.results.filter((result) => result.status === "completed").length} completed ·{" "}
                {outcome.results.filter((result) => result.status === "failed").length} failed ·{" "}
                {formatSize(outcome.reclaimedBytes)} logical size removed.
              </p>
            </div>
            <button type="button" className="storage-icon-button" aria-label="Dismiss cleanup report" onClick={dismissOutcome}><Icon name="close" size={13} /></button>
          </header>
          <div className="storage-report-grid">
            <div><span>Results</span><strong>{formatCount(outcome.results.length)}</strong></div>
            <div><span>Requested logical size</span><strong>{formatSize(outcome.requestedBytes)}</strong></div>
            <div><span>Measured reclaimed basis</span><strong>{formatSize(outcome.reclaimedBytes)}</strong></div>
            <div><span>Free space before</span><strong>{outcome.freeBefore == null ? "Unavailable" : formatSize(outcome.freeBefore)}</strong></div>
            <div><span>Free space after</span><strong>{outcome.freeAfter == null ? "Unavailable" : formatSize(outcome.freeAfter)}</strong></div>
            <div><span>Overlapping selections skipped</span><strong>{formatCount(outcome.skippedOverlaps.length)}</strong></div>
          </div>
          {outcome.changed.length ? (
            <div className="storage-warning-banner compact">
              <Icon name="warning" size={13} />
              <span>{formatCount(outcome.changed.length)} item(s) changed after scanning and were not removed. Rescan before retrying.</span>
            </div>
          ) : null}
          {outcome.cancelled ? <p className="storage-warning-banner compact"><Icon name="warning" size={13} /><span>The cleanup was cancelled. Items already moved or deleted are not restored.</span></p> : null}
          {outcome.results.some((result) => result.status === "failed") ? (
            <details className="storage-notes" open>
              <summary>Failure details</summary>
              <ul>
                {outcome.results.filter((result) => result.status === "failed").map((result) => (
                  <li key={result.source}><span className="storage-path">{result.source}</span> — {result.error}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="storage-view-actions">
            <button type="button" className="storage-primary-button" onClick={() => void rescan()}>
              <Icon name="refresh" size={14} />
              Rescan and refresh statistics
            </button>
          </div>
          <p className="storage-muted">
            Actual free-space change is measured from the filesystem when available. Reclaimed bytes are a logical-size estimate;
            APFS snapshots, clones, compression, and hard links can change the real result.
          </p>
        </section>
      ) : null}

      <div className="storage-cleanup-summary">
        <div><span>All recommendations</span><strong>{formatSize(allSummary.totalBytes)}</strong><small>{formatCount(allSummary.count)} deduplicated items</small></div>
        <div><span>High risk</span><strong>{formatCount(allSummary.highRisk)}</strong><small>system, VM, backup, database, or app data</small></div>
        <div><span>Review recommended</span><strong>{formatCount(allSummary.reviewRisk)}</strong><small>old, large, or potentially redundant</small></div>
        <div><span>Low risk</span><strong>{formatCount(allSummary.lowRisk)}</strong><small>regenerable development caches</small></div>
        <div><span>Current cleanup selection</span><strong>{formatSize(selectedSummary.totalBytes)}</strong><small>{formatCount(selectedSummary.count)} selected across views</small></div>
      </div>

      <section className="storage-card storage-filter-card" aria-label="Cleanup filters">
        <label className="storage-field">
          <span>Risk</span>
          <select value={risk} onChange={(event) => setRisk(event.target.value as StorageRisk | "all")}>
            <option value="all">All risk levels</option>
            <option value="high">High risk</option>
            <option value="review">Review recommended</option>
            <option value="low">Low risk</option>
          </select>
        </label>
        <label className="storage-field">
          <span>Kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="all">All kinds</option>
            {kinds.map((value) => <option key={value} value={value}>{CLEANUP_KIND_LABELS[value] ?? value}</option>)}
          </select>
        </label>
        <label className="storage-field">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as "size" | "risk")}>
            <option value="size">Largest first</option>
            <option value="risk">Highest risk first</option>
          </select>
        </label>
        <span className="storage-muted">
          {formatCount(recommendations.length)} shown · {formatSize(filteredSummary.totalBytes)} filtered estimate
        </span>
        {excluded.length ? (
          <span className="storage-muted">
            {formatCount(excluded.length)} excluded from recommendations.{" "}
            <button type="button" className="link-button" onClick={clearExclusions}>Restore all</button>
          </span>
        ) : null}
      </section>

      <div className="storage-risk-legend">
        <RiskBadge risk="low" />
        <span>Regenerable build or package caches. Inspect the owning tool first.</span>
        <RiskBadge risk="review" />
        <span>Usefulness unknown. Review the exact path and contents.</span>
        <RiskBadge risk="high" />
        <span>System, application, backup, database, or virtual-machine data. Deletion may cause data loss.</span>
      </div>

      {recommendations.length ? (
        <div className="storage-cleanup-list">
          {recommendations.map((recommendation) => (
            <Recommendation recommendation={recommendation} key={recommendation.id} />
          ))}
        </div>
      ) : (
        <div className="storage-inline-empty">
          <Icon name="checkCircle" size={30} />
          <h3>No recommendations in this filter</h3>
          <p>The analyzer found no scanned files or folders matching these conservative rules. This does not mean every file is important; it means nothing met a documented cleanup rule.</p>
        </div>
      )}

      <section className="storage-card storage-estimate-note">
        <Icon name="info" size={15} />
        <div>
          <strong>How the estimate is calculated</strong>
          <p>
            When a folder and a file inside it are both selected, only the folder's bytes are counted. Recommendations are
            also deduplicated at generation time. The selected total is therefore a conservative logical-size estimate, not a
            promise of exact free-space gain.
          </p>
        </div>
      </section>
    </div>
  );
}
