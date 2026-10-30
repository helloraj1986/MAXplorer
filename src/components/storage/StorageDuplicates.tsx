import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { useStorageStore } from "../../state/storageStore";
import { basename, formatCount, formatDate, formatSize } from "../../lib/format";
import { canSelectDuplicate, pickFromDuplicate } from "../../lib/storage/selection";
import type { StorageDuplicateFile, StorageDuplicateGroup } from "../../lib/storage/types";

const MIN_SIZES = [
  { label: "Any size", value: 1 },
  { label: "> 1 MB", value: 1024 * 1024 },
  { label: "> 10 MB", value: 10 * 1024 * 1024 },
  { label: "> 100 MB", value: 100 * 1024 * 1024 },
  { label: "> 1 GB", value: 1024 * 1024 * 1024 },
];

function Group({ group }: { group: StorageDuplicateGroup }) {
  const picks = useStorageStore((state) => state.picks);
  const toggleDuplicatePick = useStorageStore((state) => state.toggleDuplicatePick);
  const revealInFinder = useStorageStore((state) => state.revealInFinder);
  const openFile = useStorageStore((state) => state.openFile);
  const selectedPaths = picks.map((pick) => pick.path);
  const groupPaths = group.files.map((file) => file.entry.path);
  return (
    <section className="storage-duplicate-group" aria-label={`Duplicate group with ${group.files.length} verified copies`}>
      <header>
        <div>
          <h3><Icon name="copy" size={15} /> {group.files.length} verified copies</h3>
          <p>{formatSize(group.size)} each · <strong>{formatSize(group.recoverableBytes)}</strong> potentially recoverable by keeping one copy</p>
        </div>
        <div className="storage-duplicate-badges">
          <span className="storage-verified-badge"><Icon name="shield" size={11} /> SHA-256 verified</span>
          <span className={`storage-volume-badge ${group.sameVolume ? "" : "mixed"}`}>
            {group.sameVolume ? "Same volume" : "Across volumes"}
          </span>
        </div>
      </header>
      <p className="storage-duplicate-explanation">{group.explanation}</p>
      <div className="storage-duplicate-files">
        {group.files.map((file) => {
          const selected = selectedPaths.includes(file.entry.path);
          const check = selected ? { allowed: true } : canSelectDuplicate(groupPaths, selectedPaths, file.entry.path);
          return (
            <div className={`storage-duplicate-file ${selected ? "selected" : ""}`} key={file.entry.path}>
              <button
                type="button"
                className={`storage-check ${selected ? "checked" : ""}`}
                aria-pressed={selected}
                aria-disabled={!check.allowed}
                title={check.reason}
                onClick={() => {
                  if (!check.allowed) {
                    useStorageStore.getState().toggleDuplicatePick(file, groupPaths);
                    return;
                  }
                  toggleDuplicatePick(file, groupPaths);
                }}
              >
                {selected ? <Icon name="check" size={12} /> : null}
              </button>
              <FileTypeIcon entry={file.entry} size={22} />
              <div className="storage-duplicate-file-main">
                <strong>{basename(file.entry.path)}</strong>
                <span className="storage-path" title={file.entry.path}>{file.entry.path}</span>
                <small>{file.volume} · {formatDate(file.entry.modified)}</small>
              </div>
              <span className="storage-duplicate-size">{formatSize(file.entry.size)}</span>
              <div className="storage-row-actions">
                <button type="button" className="storage-icon-button" title="Open" aria-label={`Open ${basename(file.entry.path)}`} onClick={() => void openFile(file.entry.path)}><Icon name="eye" size={12} /></button>
                <button type="button" className="storage-icon-button" title="Reveal in Finder" aria-label={`Reveal ${basename(file.entry.path)} in Finder`} onClick={() => void revealInFinder(file.entry.path)}><Icon name="open" size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>
      {group.files.every((file) => selectedPaths.includes(file.entry.path)) ? (
        <p className="storage-danger-text">At least one copy must remain before cleanup can run.</p>
      ) : null}
    </section>
  );
}

function selectRedundant(group: StorageDuplicateGroup): StorageDuplicateFile[] {
  return group.files.slice(1);
}

export function StorageDuplicates() {
  const scan = useStorageStore((state) => state.scan);
  const treePath = useStorageStore((state) => state.treePath);
  const duplicates = useStorageStore((state) => state.duplicates);
  const loading = useStorageStore((state) => state.duplicatesLoading);
  const error = useStorageStore((state) => state.duplicatesError);
  const minSize = useStorageStore((state) => state.duplicateMinSize);
  const runDuplicates = useStorageStore((state) => state.runDuplicates);
  const cancelDuplicates = useStorageStore((state) => state.cancelDuplicates);
  const addPicks = useStorageStore((state) => state.addPicks);
  const picks = useStorageStore((state) => state.picks);

  if (!scan) return null;
  const root = treePath ?? scan.root;

  return (
    <div className="storage-duplicates-view">
      <section className="storage-card storage-view-header">
        <div>
          <span className="storage-eyebrow">Optional content verification</span>
          <h2>Duplicate files</h2>
          <p>
            Size and metadata narrow the candidates; SHA-256 content hashes confirm identities. Files that change while hashing
            are reported separately. Nothing is removed automatically.
          </p>
        </div>
        <div className="storage-view-actions">
          <label className="storage-field">
            <span>Minimum size</span>
            <select value={minSize} onChange={(event) => void runDuplicates(root, Number(event.target.value))} disabled={loading}>
              {MIN_SIZES.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {loading ? (
            <button type="button" className="storage-toolbar-button danger" onClick={() => void cancelDuplicates()}>
              <Icon name="close" size={13} />
              Cancel
            </button>
          ) : (
            <button type="button" className="storage-primary-button" onClick={() => void runDuplicates(root)}>
              <Icon name="search" size={14} />
              Find duplicates here
            </button>
          )}
        </div>
      </section>

      <div className="storage-info-banner">
        <Icon name="info" size={14} />
        <span>
          Scanning <strong>{root}</strong>. Duplicate-looking files in cloud-synchronized folders, backups, application support,
          and version-control worktrees can serve different purposes. Review paths before selecting anything.
        </span>
      </div>

      {error ? <div className="storage-error-banner" role="alert"><Icon name="warning" size={14} /><span>{error}</span></div> : null}

      {loading ? (
        <section className="storage-card storage-loading-card" aria-live="polite" aria-busy="true">
          <Icon name="spinner" size={22} className="spin" />
          <h3>Hashing same-size candidates</h3>
          <p>Large files are streamed in 128 KB chunks. A file that changes during hashing is discarded from the result.</p>
        </section>
      ) : duplicates ? (
        <>
          <section className="storage-duplicate-summary">
            <div><span>Scanned</span><strong>{formatCount(duplicates.scannedFiles)}</strong><small>files at or above the threshold</small></div>
            <div><span>Same-size candidates</span><strong>{formatCount(duplicates.candidateFiles)}</strong><small>narrowed before hashing</small></div>
            <div><span>Content hashes</span><strong>{formatCount(duplicates.hashedFiles)}</strong><small>SHA-256 values computed</small></div>
            <div><span>Recoverable estimate</span><strong>{formatSize(duplicates.recoverableBytes)}</strong><small>by keeping one copy per group</small></div>
            <div><span>Changed during scan</span><strong>{formatCount(duplicates.changedFiles)}</strong><small>excluded from results</small></div>
          </section>
          {duplicates.cancelled ? (
            <div className="storage-warning-banner"><Icon name="warning" size={14} /><span>The duplicate scan was cancelled. Results are partial.</span></div>
          ) : null}
          {duplicates.truncated ? (
            <div className="storage-warning-banner"><Icon name="warning" size={14} /><span>The candidate set reached a safety limit. Raise the minimum size or choose a narrower folder for complete results.</span></div>
          ) : null}
          {duplicates.groups.length ? (
            <>
              <div className="storage-duplicates-actions">
                <button type="button" className="storage-toolbar-button" onClick={() => addPicks(duplicates.groups.flatMap((group) => selectRedundant(group).map(pickFromDuplicate)))}>
                  <Icon name="check" size={13} />
                  Select redundant copies
                </button>
                <span className="storage-muted">{formatCount(picks.length)} cleanup selections across all views. One copy per group is preserved.</span>
              </div>
              <div className="storage-duplicate-groups">
                {duplicates.groups.map((group) => <Group group={group} key={group.id} />)}
              </div>
            </>
          ) : (
            <div className="storage-inline-empty">
              <Icon name="checkCircle" size={30} />
              <h3>No exact duplicates found</h3>
              <p>No two files in this scope had the same size, fingerprint, and SHA-256 content hash.</p>
            </div>
          )}
        </>
      ) : (
        <section className="storage-inline-empty storage-duplicates-empty">
          <Icon name="copy" size={34} />
          <h3>Find byte-identical files</h3>
          <p>
            The scan is read-only and streams file contents without loading whole files into memory. Only exact matches are
            reported as verified; same-size files with different bytes are rejected.
          </p>
          <button type="button" className="storage-primary-button" onClick={() => void runDuplicates(root)}>
            <Icon name="search" size={14} />
            Start duplicate scan
          </button>
        </section>
      )}
    </div>
  );
}
