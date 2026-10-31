import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { useStorageStore } from "../../state/storageStore";
import { formatCount, formatSize } from "../../lib/format";
import { summarizeSelection } from "../../lib/storage/selection";
import { RiskBadge } from "./StorageOverview";

export function StorageSelectionBar() {
  const picks = useStorageStore((state) => state.picks);
  const removePick = useStorageStore((state) => state.removePick);
  const clearPicks = useStorageStore((state) => state.clearPicks);
  const revealInFinder = useStorageStore((state) => state.revealInFinder);
  const performCleanup = useStorageStore((state) => state.performCleanup);
  const running = useStorageStore((state) => state.cleanupRunning);
  const scanFromCache = useStorageStore((state) => state.scanFromCache);
  const rescan = useStorageStore((state) => state.rescan);
  const progress = useStorageStore((state) => state.cleanupProgress);
  const cancelCleanup = useStorageStore((state) => state.cancelCleanup);
  const error = useStorageStore((state) => state.cleanupError);
  const [reviewing, setReviewing] = useState(false);
  const [permanent, setPermanent] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const summary = useMemo(() => summarizeSelection(picks), [picks]);
  const trashOnly =
    summary.picks.length > 0 &&
    summary.picks.every((pick) => /[\\/]\.(Trash|Trashes)([\\/]|$)/.test(pick.path));
  const effectivePermanent = permanent || trashOnly;

  if (!picks.length) return null;

  const closeReview = () => {
    if (running) return;
    setReviewing(false);
    setPermanent(false);
    setAcknowledged(false);
  };

  const execute = async () => {
    if (effectivePermanent && !acknowledged) return;
    await performCleanup(effectivePermanent);
    setReviewing(false);
    setPermanent(false);
    setAcknowledged(false);
  };

  return (
    <>
      <div className="storage-selection-bar" role="region" aria-label="Cleanup selection">
        <div className="storage-selection-total">
          <span className="storage-selection-icon" aria-hidden="true"><Icon name="trash" size={17} /></span>
          <div>
            <strong>{formatCount(summary.count)} selected · {formatSize(summary.totalBytes)}</strong>
            <span>
              Estimated logical space · {summary.skipped.length ? `${summary.skipped.length} nested item(s) already covered` : "no overlapping bytes counted"}
            </span>
          </div>
        </div>
        <div className="storage-selection-risks">
          {summary.highRisk ? <RiskBadge risk="high" /> : null}
          {summary.reviewRisk ? <RiskBadge risk="review" /> : null}
          {summary.lowRisk ? <RiskBadge risk="low" /> : null}
        </div>
        <div className="storage-selection-actions">
          {running && progress ? (
            <span className="storage-muted">
              {progress.processed} of {progress.total} processed
              {progress.currentPath ? ` · ${progress.currentPath.split(/[\\/]/).filter(Boolean).pop()}` : ""}
            </span>
          ) : null}
          {error ? <span className="storage-danger-text">{error}</span> : null}
          {running ? (
            <button type="button" className="storage-toolbar-button danger" onClick={() => void cancelCleanup()}>
              <Icon name="close" size={13} />
              Cancel after current item
            </button>
          ) : (
            <button type="button" className="storage-toolbar-button" onClick={clearPicks}>
              Clear
            </button>
          )}
          {scanFromCache ? (
            <button type="button" className="storage-toolbar-button" onClick={() => void rescan()}>
              <Icon name="refresh" size={13} />
              Rescan to enable cleanup
            </button>
          ) : (
            <button
              type="button"
              className="storage-primary-button danger"
              onClick={() => {
                setPermanent(trashOnly);
                setAcknowledged(false);
                setReviewing(true);
              }}
              disabled={running}
            >
              <Icon name={running ? "spinner" : "trash"} size={14} className={running ? "spin" : ""} />
              {running ? "Cleaning up..." : "Review cleanup"}
            </button>
          )}
        </div>
      </div>

      {reviewing ? (
        <div className="modal-backdrop storage-review-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReview(); }}>
          <div className="storage-review-modal" role="dialog" aria-modal="true" aria-labelledby="storage-review-title">
            <header className="storage-review-head">
              <div>
                <span className="storage-eyebrow">Final confirmation</span>
                <h2 id="storage-review-title">Review exact cleanup targets</h2>
                <p>
                  MAXplorer will revalidate every path, size, and modification date immediately before acting. Files that
                  changed after scanning are left untouched and reported.
                </p>
              </div>
              <button type="button" className="storage-icon-button" aria-label="Cancel cleanup review" onClick={closeReview} disabled={running}><Icon name="close" size={14} /></button>
            </header>

            <div className="storage-review-summary">
              <div><span>Items</span><strong>{formatCount(summary.count)}</strong></div>
              <div><span>Logical size</span><strong>{formatSize(summary.totalBytes)}</strong></div>
              <div><span>Estimated recoverable</span><strong>{formatSize(summary.totalBytes)}</strong></div>
              <div><span>Nested selections collapsed</span><strong>{formatCount(summary.skipped.length)}</strong></div>
            </div>

            <div className="storage-review-risks">
              {summary.highRisk ? (
                <div className="storage-review-warning high">
                  <Icon name="warning" size={14} />
                  <span>{summary.highRisk} high-risk item(s) selected. These may be system-managed, application data, backups, databases, or virtual machines. Deletion can cause permanent data loss.</span>
                </div>
              ) : null}
              {summary.reviewRisk ? (
                <div className="storage-review-warning">
                  <Icon name="info" size={14} />
                  <span>{summary.reviewRisk} item(s) need review. Age, size, or file type is not proof that content is unnecessary.</span>
                </div>
              ) : null}
              <div className="storage-review-warning">
                <Icon name="cloud" size={14} />
                <span>Deleting a cloud-synchronized file can remove it from other devices and your cloud account. Application-managed, backup, and version-control locations may serve different purposes.</span>
              </div>
            </div>

            <div className="storage-review-list" role="list" aria-label="Exact cleanup targets">
              {summary.picks.map((pick) => (
                <div className="storage-review-item" role="listitem" key={pick.path}>
                  <Icon name={pick.isDirectory ? "folder" : "file"} size={15} />
                  <div>
                    <strong>{pick.name}</strong>
                    <span className="storage-path" title={pick.path}>{pick.path}</span>
                    <small>{pick.isDirectory ? "Folder · includes descendants" : "File"} · {formatSize(pick.size)}{pick.risk ? ` · ${pick.risk} risk` : ""}</small>
                  </div>
                  <div className="storage-review-item-actions">
                    <button type="button" className="storage-icon-button" title="Reveal in Finder" aria-label={`Reveal ${pick.name} in Finder`} onClick={() => void revealInFinder(pick.path)}><Icon name="open" size={12} /></button>
                    <button type="button" className="storage-icon-button" title="Remove from selection" aria-label={`Remove ${pick.name} from selection`} onClick={() => removePick(pick.path)} disabled={running}><Icon name="close" size={12} /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="storage-review-options">
              <label className={`storage-radio-row ${!effectivePermanent ? "selected" : ""}`}>
                <input type="radio" checked={!effectivePermanent} onChange={() => { setPermanent(false); setAcknowledged(false); }} disabled={running || trashOnly} />
                <span>
                  <strong>Move to Trash</strong>
                  <small>{trashOnly ? "These items are already in the Trash. Trash cannot be moved to itself." : "Reversible from the Trash. Preferred for user files."}</small>
                </span>
              </label>
              <label className={`storage-radio-row ${effectivePermanent ? "selected" : ""}`}>
                <input type="radio" checked={effectivePermanent} onChange={() => setPermanent(true)} disabled={running} />
                <span>
                  <strong className="storage-danger-text">Delete permanently</strong>
                  <small>Bypasses the Trash. This cannot be undone.</small>
                </span>
              </label>
              {effectivePermanent ? (
                <label className="storage-acknowledge">
                  <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={running} />
                  <span>I understand that permanent deletion cannot be undone and that these exact paths will be removed.</span>
                </label>
              ) : null}
              {summary.highRisk ? (
                <p className="storage-review-note">
                  Elevated permissions may be required for protected locations. MAXplorer never requests administrator access or silently escalates privileges.
                </p>
              ) : null}
            </div>

            {error ? <p className="storage-danger-text" role="alert">{error}</p> : null}

            <footer className="storage-review-footer">
              <span className="storage-muted">
                {running
                  ? progress
                    ? `${progress.processed} of ${progress.total} processed · ${progress.completed} completed · ${progress.failed} failed`
                    : "Preparing cleanup..."
                  : "Nothing has been removed yet."}
              </span>
              <div>
                {running ? (
                  <button type="button" className="storage-toolbar-button danger" onClick={() => void cancelCleanup()}>
                    <Icon name="close" size={13} />
                    Cancel after current item
                  </button>
                ) : (
                  <button type="button" className="storage-toolbar-button" onClick={closeReview}>Cancel</button>
                )}
                <button
                  type="button"
                  className={`storage-primary-button ${effectivePermanent ? "danger" : ""}`}
                  onClick={() => void execute()}
                  disabled={running || (effectivePermanent && !acknowledged)}
                >
                  <Icon name={running ? "spinner" : effectivePermanent ? "warning" : "trash"} size={14} className={running ? "spin" : ""} />
                  {running ? "Processing..." : effectivePermanent ? "Delete permanently" : "Move to Trash"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
