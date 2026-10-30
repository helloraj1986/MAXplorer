import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { useStorageStore } from "../../state/storageStore";
import { formatCount, formatDate, formatSize } from "../../lib/format";
import { pickFromDirectory } from "../../lib/storage/selection";
import { storageDirectoryEntry, type StorageDirectory } from "../../lib/storage/types";

const THRESHOLDS = [
  { label: "Any size", value: 0 },
  { label: "> 100 MB", value: 100 * 1024 * 1024 },
  { label: "> 500 MB", value: 500 * 1024 * 1024 },
  { label: "> 1 GB", value: 1024 * 1024 * 1024 },
  { label: "> 5 GB", value: 5 * 1024 * 1024 * 1024 },
];

const AGE_OPTIONS = [
  { label: "Any age", value: 0 },
  { label: "Unchanged for 6 months", value: 183 * 86_400_000 },
  { label: "Unchanged for 1 year", value: 365 * 86_400_000 },
  { label: "Unchanged for 2 years", value: 730 * 86_400_000 },
];

function DirectoryRow({ directory, total }: { directory: StorageDirectory; total: number }) {
  const picks = useStorageStore((state) => state.picks);
  const togglePick = useStorageStore((state) => state.togglePick);
  const selectDirectory = useStorageStore((state) => state.selectDirectory);
  const selectedDirectory = useStorageStore((state) => state.selectedDirectory);
  const openDirectory = useStorageStore((state) => state.openDirectory);
  const setView = useStorageStore((state) => state.setView);
  const revealInFinder = useStorageStore((state) => state.revealInFinder);
  const picked = picks.some((pick) => pick.path === directory.path);
  const selected = selectedDirectory?.path === directory.path;
  return (
    <tr
      className={`storage-table-row ${selected ? "selected" : ""}`}
      tabIndex={0}
      aria-selected={selected}
      onClick={() => selectDirectory(directory)}
      onDoubleClick={() => { void openDirectory(directory.path); setView("tree"); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { void openDirectory(directory.path); setView("tree"); }
        if (event.key === " ") {
          event.preventDefault();
          togglePick(pickFromDirectory(directory));
        }
      }}
    >
      <td className="storage-check-cell">
        <button
          type="button"
          className={`storage-check ${picked ? "checked" : ""}`}
          aria-pressed={picked}
          aria-label={picked ? `Remove ${directory.name} from cleanup selection` : `Add ${directory.name} to cleanup selection`}
          onClick={(event) => { event.stopPropagation(); togglePick(pickFromDirectory(directory)); }}
        >
          {picked ? <Icon name="check" size={12} /> : null}
        </button>
      </td>
      <td>
        <span className="storage-name-cell">
          <FileTypeIcon entry={storageDirectoryEntry(directory)} size={19} />
          <span className="storage-name-text" title={directory.path}>{directory.name}</span>
          {directory.isPackage ? <span className="storage-pill">Package</span> : null}
          {directory.isProtected ? <span className="storage-pill">Protected</span> : null}
          {directory.isReadOnly ? <span className="storage-pill">Read-only</span> : null}
        </span>
      </td>
      <td className="storage-path-cell" title={directory.path}>{directory.parent}</td>
      <td className="storage-number"><strong>{formatSize(directory.size)}</strong></td>
      <td className="storage-number storage-muted">{formatSize(directory.allocated)}</td>
      <td className="storage-number">{formatCount(directory.files)}</td>
      <td className="storage-number">{formatCount(directory.folders)}</td>
      <td className="storage-number">{directory.largestFileSize ? formatSize(directory.largestFileSize) : "—"}</td>
      <td className="storage-date">{formatDate(directory.modified)}</td>
      <td className="storage-row-actions">
        <span className="storage-percent">{total > 0 ? `${((directory.size / total) * 100).toFixed(1)}%` : ""}</span>
        <button type="button" className="storage-icon-button" title="Open in folder tree" aria-label={`Open ${directory.name} in folder tree`} onClick={(event) => { event.stopPropagation(); void openDirectory(directory.path); setView("tree"); }}><Icon name="folderOpen" size={12} /></button>
        <button type="button" className="storage-icon-button" title="Reveal in Finder" aria-label={`Reveal ${directory.name} in Finder`} onClick={(event) => { event.stopPropagation(); void revealInFinder(directory.path); }}><Icon name="open" size={12} /></button>
      </td>
    </tr>
  );
}

export function StorageFoldersView() {
  const scan = useStorageStore((state) => state.scan);
  const addPicks = useStorageStore((state) => state.addPicks);
  const setView = useStorageStore((state) => state.setView);
  const [minimum, setMinimum] = useState(0);
  const [olderThan, setOlderThan] = useState(0);
  const [filter, setFilter] = useState("");
  const [ascending, setAscending] = useState(false);

  const folders = useMemo(() => {
    if (!scan) return [];
    const cutoff = olderThan ? Date.now() - olderThan : null;
    return scan.largestDirectories
      .filter((directory) => directory.size >= minimum)
      .filter((directory) => !cutoff || (directory.modified != null && directory.modified < cutoff))
      .filter((directory) => !filter.trim() || directory.name.toLowerCase().includes(filter.trim().toLowerCase()) || directory.path.toLowerCase().includes(filter.trim().toLowerCase()))
      .sort((left, right) => (ascending ? left.size - right.size : right.size - left.size))
      .slice(0, 600);
  }, [scan, minimum, olderThan, filter, ascending]);

  if (!scan) return null;
  const total = scan.totalLogicalBytes || 1;

  return (
    <div className="storage-folders-view">
      <section className="storage-card storage-view-header">
        <div>
          <span className="storage-eyebrow">Deep analysis</span>
          <h2>Largest folders</h2>
          <p>
            Ranked by the total size of every descendant. A folder's size includes its subfolders, so two rows can describe
            the same bytes at different levels. Select one row per branch to avoid double counting.
          </p>
        </div>
        <div className="storage-view-actions">
          <button type="button" className="storage-toolbar-button" onClick={() => setView("tree")}>
            <Icon name="folderGit" size={13} />
            Folder tree
          </button>
          <button type="button" className="storage-toolbar-button" onClick={() => addPicks(folders.map(pickFromDirectory))}>
            <Icon name="check" size={13} />
            Select visible
          </button>
        </div>
      </section>

      <section className="storage-card storage-filter-card" aria-label="Folder filters">
        <label className="storage-field storage-field-grow">
          <span>Name or path contains</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter folders" />
        </label>
        <label className="storage-field">
          <span>Minimum size</span>
          <select value={minimum} onChange={(event) => setMinimum(Number(event.target.value))}>
            {THRESHOLDS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="storage-field">
          <span>Last modified</span>
          <select value={olderThan} onChange={(event) => setOlderThan(Number(event.target.value))}>
            {AGE_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button type="button" className="storage-toolbar-button" onClick={() => setAscending((value) => !value)}>
          <Icon name={ascending ? "sortAsc" : "sortDesc"} size={13} />
          {ascending ? "Smallest first" : "Largest first"}
        </button>
      </section>

      <div className="storage-info-banner">
        <Icon name="info" size={14} />
        <span>Folder modification dates describe the directory entry, not every file inside it. An old folder can still contain active data.</span>
      </div>

      <section className="storage-card storage-table-card">
        {folders.length ? (
          <>
            <div className="storage-table-scroll">
              <table className="storage-table">
                <thead>
                  <tr>
                    <th className="storage-check-cell"><span className="storage-visually-hidden">Select</span></th>
                    <th>Folder</th>
                    <th>Location</th>
                    <th className="storage-number">Total size</th>
                    <th className="storage-number">Allocated</th>
                    <th className="storage-number">Files</th>
                    <th className="storage-number">Subfolders</th>
                    <th className="storage-number">Largest file</th>
                    <th>Modified</th>
                    <th className="storage-number">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {folders.map((directory) => <DirectoryRow directory={directory} total={total} key={directory.path} />)}
                </tbody>
              </table>
            </div>
            <footer className="storage-table-footer">
              <span>{formatCount(folders.length)} ranked folders</span>
              <span className="storage-muted">Totals include descendants.</span>
            </footer>
          </>
        ) : (
          <div className="storage-inline-empty">
            <Icon name="folder" size={30} />
            <h3>No folders match</h3>
            <p>Lower the minimum size or clear the age filter. Very small folders are omitted from the ranked list.</p>
          </div>
        )}
      </section>
    </div>
  );
}
