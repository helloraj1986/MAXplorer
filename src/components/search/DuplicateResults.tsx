import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { useSearchStore } from "../../state/searchStore";
import { useExplorerStore } from "../../state/explorerStore";
import { api } from "../../lib/api";
import { basename, formatCount, formatDate, formatSize, formatSizeLong, parentPath } from "../../lib/format";
import type { DuplicateGroup } from "../../lib/search/types";

function Group({ group }: { group: DuplicateGroup }) {
  const revealHit = useSearchStore((state) => state.revealHit);
  return (
    <section className="duplicate-group" aria-label={`Duplicate group ${group.id}`}>
      <header className="duplicate-group-header">
        <div>
          <h3>
            <Icon name="copy" size={15} />
            {formatCount(group.files.length)} copies
          </h3>
          <p>
            {formatSizeLong(group.size)} each - <strong>{formatSizeLong(group.recoverableBytes)}</strong> potentially recoverable
          </p>
        </div>
        <span className={`duplicate-badge ${group.verified ? "verified" : "unverified"}`}>
          <Icon name={group.verified ? "shield" : "warning"} size={12} />
          {group.verified ? "Verified byte-identical" : "Potential duplicate"}
        </span>
      </header>
      <p className="duplicate-explanation">{group.explanation}</p>
      <div className="duplicate-file-list">
        {group.files.map((file) => (
          <div className="duplicate-file" key={file.entry.path}>
            <FileTypeIcon entry={file.entry} size={24} />
            <div className="duplicate-file-main">
              <strong>{basename(file.entry.path)}</strong>
              <span title={file.entry.path}>{parentPath(file.entry.path) ?? file.entry.path}</span>
            </div>
            <span className="duplicate-file-size">{formatSize(file.entry.size)}</span>
            <span className="duplicate-file-date">{formatDate(file.entry.modified)}</span>
            <button
              type="button"
              className="search-small-button"
              onClick={() => void api.openPath(file.entry.path).catch((error) => useExplorerStore.getState().toastError(error))}
            >
              Open
            </button>
            <button
              type="button"
              className="search-small-button"
              onClick={() => void revealHit(file.entry.path)}
            >
              Reveal
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DuplicateResults() {
  const duplicates = useSearchStore((state) => state.duplicates);
  const loading = useSearchStore((state) => state.duplicatesLoading);
  const runDuplicateSearch = useSearchStore((state) => state.runDuplicateSearch);
  const error = useSearchStore((state) => state.error);

  return (
    <div className="duplicate-results">
      <header className="duplicate-summary">
        <div>
          <h2>Duplicate candidates</h2>
          <p>
            {duplicates
              ? `${formatCount(duplicates.groups.length)} verified groups - ${formatSizeLong(duplicates.recoverableBytes)} potentially recoverable`
              : "Find files with identical content. Size alone is never used to declare duplicates."}
          </p>
        </div>
        <button type="button" className="search-small-button" disabled={loading} onClick={() => void runDuplicateSearch()}>
          <Icon name={loading ? "spinner" : "search"} size={12} className={loading ? "spin" : ""} />
          {loading ? "Hashing candidates..." : "Find duplicates"}
        </button>
      </header>
      {error ? <p className="search-muted">{error}</p> : null}
      {duplicates ? (
        <p className="duplicate-method">
          Scanned {formatCount(duplicates.scannedFiles)} files, narrowed {formatCount(duplicates.candidateFiles)} same-size
          candidates, and computed {formatCount(duplicates.hashedFiles)} SHA-256 hashes. Nothing is deleted automatically.
        </p>
      ) : null}
      {loading ? (
        <div className="duplicate-loading" aria-live="polite" aria-busy="true">
          <Icon name="spinner" size={18} className="spin" />
          <span>Hashing same-size candidates. Search remains available.</span>
        </div>
      ) : duplicates?.groups.length ? (
        <div className="duplicate-group-list">
          {duplicates.groups.map((group) => (
            <Group group={group} key={group.id} />
          ))}
        </div>
      ) : duplicates ? (
        <div className="search-empty-inline">
          <Icon name="checkCircle" size={30} />
          <h3>No exact duplicates found</h3>
          <p>No two files in this scope had both the same size and the same SHA-256 content hash.</p>
        </div>
      ) : null}
    </div>
  );
}
