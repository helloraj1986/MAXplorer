import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { useSearchStore } from "../../state/searchStore";
import { useExplorerStore } from "../../state/explorerStore";
import { formatCount, formatDate, formatSizeLong } from "../../lib/format";

function activityLabel(status: ReturnType<typeof useSearchStore.getState>["indexStatus"]): string {
  if (!status) return "Unavailable";
  if (status.paused) return "Paused";
  if (status.activity === "indexing") return "Indexing";
  if (status.activity === "content") return "Extracting text";
  if (status.activity === "starting") return "Starting";
  if (status.activity === "watching") return "Up to date";
  return status.activity;
}

export function IndexingDashboard() {
  const status = useSearchStore((state) => state.indexStatus);
  const loadIndexStatus = useSearchStore((state) => state.loadIndexStatus);
  const addIndexLocation = useSearchStore((state) => state.addIndexLocation);
  const removeIndexLocation = useSearchStore((state) => state.removeIndexLocation);
  const setIndexPaused = useSearchStore((state) => state.setIndexPaused);
  const setContentEnabled = useSearchStore((state) => state.setContentEnabled);
  const setContentLimit = useSearchStore((state) => state.setContentLimit);
  const rebuildIndex = useSearchStore((state) => state.rebuildIndex);
  const clearIndex = useSearchStore((state) => state.clearIndex);
  const retryExtractions = useSearchStore((state) => state.retryExtractions);
  const settings = useSearchStore((state) => state.settings);
  const updateSettings = useSearchStore((state) => state.updateSettings);
  const clearHistory = useSearchStore((state) => state.clearHistory);
  const openDialog = useExplorerStore((state) => state.openDialog);
  const [path, setPath] = useState("");
  const [limitMb, setLimitMb] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void loadIndexStatus();
    const timer = window.setInterval(() => void loadIndexStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [loadIndexStatus]);

  useEffect(() => {
    if (!status) return;
    const megabytes = status.maxContentBytes / 1024 ** 2;
    setLimitMb(Number.isInteger(megabytes) ? String(megabytes) : megabytes.toFixed(1));
  }, [status?.maxContentBytes]);

  return (
    <div className="indexing-dashboard">
      <div className="indexing-summary">
        <div className="indexing-stat">
          <span className="indexing-stat-value">{status ? formatCount(status.indexedFiles) : "-"}</span>
          <span className="indexing-stat-label">Files indexed</span>
        </div>
        <div className="indexing-stat">
          <span className="indexing-stat-value">{status ? formatCount(status.searchableContent) : "-"}</span>
          <span className="indexing-stat-label">Searchable text</span>
        </div>
        <div className="indexing-stat">
          <span className="indexing-stat-value">{status ? formatCount(status.pendingContent) : "-"}</span>
          <span className="indexing-stat-label">Waiting for text</span>
        </div>
        <div className="indexing-stat">
          <span className="indexing-stat-value">{status ? formatSizeLong(status.indexSizeBytes) : "-"}</span>
          <span className="indexing-stat-label">Index size</span>
        </div>
      </div>

      <div className={`indexing-status-line status-${status?.paused ? "paused" : status?.activity ?? "idle"}`}>
        <Icon
          name={status?.paused ? "clock" : status?.activity === "watching" ? "checkCircle" : "spinner"}
          size={14}
          className={status?.paused || status?.activity === "watching" ? "" : "spin"}
        />
        <strong>{activityLabel(status)}</strong>
        {status?.currentPath ? <span title={status.currentPath}>{status.currentPath}</span> : null}
        {status?.lastReconciliation ? <span className="indexing-muted">Last reconciled {formatDate(status.lastReconciliation)}</span> : null}
      </div>

      <section className="indexing-section">
        <div className="indexing-section-header">
          <h3>Indexed locations</h3>
          <span className="indexing-muted">
            {status?.locations.length ?? 0} location{status?.locations.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="indexing-location-list">
          {(status?.locations ?? []).map((location) => (
            <div className="indexing-location" key={location.path}>
              <span className="indexing-location-icon">
                <Icon name="folder" size={16} />
              </span>
              <div className="indexing-location-main">
                <strong>{location.name}</strong>
                <span title={location.path}>{location.path}</span>
                <span className="indexing-muted">
                  {formatCount(location.indexedFiles)} files - {formatCount(location.searchableFiles)} with searchable text
                  {location.lastIndexed ? ` - ${formatDate(location.lastIndexed)}` : " - not indexed yet"}
                </span>
                {location.error ? <span className="indexing-error-text">{location.error}</span> : null}
              </div>
              <span className={`indexing-badge badge-${location.status}`}>{location.status.replace(/_/g, " ")}</span>
              <button
                type="button"
                className="indexing-remove"
                aria-label={`Stop indexing ${location.path}`}
                title="Remove from index (does not delete files)"
                onClick={() => void removeIndexLocation(location.path)}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
          {!status?.locations.length ? (
            <p className="indexing-empty">
              No locations are indexed yet. MAXplorer starts with your Home folder; add a folder below to search it.
            </p>
          ) : null}
        </div>
        <div className="indexing-add-row">
          <input
            value={path}
            placeholder="/Users/you/Projects"
            aria-label="Folder to index"
            spellCheck={false}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!path.trim()) return;
                void addIndexLocation(path.trim());
                setPath("");
              }
            }}
          />
          <button
            type="button"
            className="search-small-button"
            disabled={!path.trim()}
            onClick={() => {
              if (!path.trim()) return;
              void addIndexLocation(path.trim());
              setPath("");
            }}
          >
            Add folder
          </button>
        </div>
      </section>

      <section className="indexing-section">
        <h3>Content and control</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={status?.contentEnabled ?? true}
            onChange={(event) => void setContentEnabled(event.target.checked)}
          />
          <span>Index text inside supported documents</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={status?.paused ?? false}
            onChange={(event) => void setIndexPaused(event.target.checked)}
          />
          <span>Pause background indexing</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.includeLive}
            onChange={(event) => updateSettings({ includeLive: event.target.checked })}
          />
          <span>Use a bounded live filesystem scan when the index is not ready</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.includeSpotlight}
            onChange={(event) => updateSettings({ includeSpotlight: event.target.checked })}
          />
          <span>Include macOS Spotlight results</span>
        </label>
        <label className="indexing-field">
          <span>Maximum file size for text extraction</span>
          <span className="indexing-field-control">
            <input
              inputMode="numeric"
              value={limitMb}
              aria-label="Maximum content size in megabytes"
              onChange={(event) => setLimitMb(event.target.value)}
              onBlur={() => {
                const value = Number(limitMb);
                if (Number.isFinite(value) && value >= 0.1) {
                  void setContentLimit(Math.round(value * 1024 ** 2));
                }
              }}
            />
            <span>MB</span>
          </span>
        </label>
        <div className="indexing-actions">
          <button type="button" className="dialog-button" onClick={() => void rebuildIndex()}>
            <Icon name="refresh" size={13} />
            Rebuild index
          </button>
          <button type="button" className="dialog-button" onClick={() => void retryExtractions()}>
            <Icon name="sync" size={13} />
            Retry failed text
          </button>
          {confirmClear ? (
            <span className="indexing-confirm">
              <span>Clear generated index data? Original files stay untouched.</span>
              <button
                type="button"
                className="dialog-button danger"
                onClick={() => {
                  void clearIndex();
                  setConfirmClear(false);
                }}
              >
                Clear index
              </button>
              <button type="button" className="link-button" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="dialog-button danger" onClick={() => setConfirmClear(true)}>
              <Icon name="delete" size={13} />
              Clear index
            </button>
          )}
        </div>
      </section>

      <section className="indexing-section">
        <h3>Search history</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.historyEnabled}
            onChange={(event) => updateSettings({ historyEnabled: event.target.checked })}
          />
          <span>Remember recent searches on this Mac</span>
        </label>
        <label className="indexing-field">
          <span>Keep history for</span>
          <span className="indexing-field-control">
            <input
              inputMode="numeric"
              aria-label="Search history retention in days"
              value={settings.retentionDays}
              disabled={!settings.historyEnabled}
              onChange={(event) => {
                const days = Number(event.target.value);
                if (Number.isFinite(days) && days > 0) updateSettings({ retentionDays: Math.min(3650, days) });
              }}
            />
            <span>days</span>
          </span>
        </label>
        <p className="indexing-muted">Search history stores query text and scope only. It never stores file contents.</p>
        <button type="button" className="dialog-button" onClick={clearHistory} disabled={!settings.historyEnabled}>
          Clear search history
        </button>
      </section>

      <section className="indexing-section">
        <h3>What MAXplorer can and cannot find</h3>
        <ul className="indexing-explanations">
          <li>Files outside your indexed locations are only searched when the current scope includes them.</li>
          <li>Locations protected by macOS permissions are reported as unavailable; MAXplorer never bypasses those permissions.</li>
          <li>Scanned PDFs without embedded text are reported as having no searchable text. OCR is not enabled.</li>
          <li>Full-text search covers plain text, Markdown, JSON, XML, HTML, CSV, source code, PDF, DOCX, XLSX, and PPTX.</li>
          <li>All indexing and query processing happens locally. Paths, contents, and history are not uploaded.</li>
        </ul>
        {status?.errors.length ? (
          <details className="indexing-errors">
            <summary>
              {status.errors.length} indexing error{status.errors.length === 1 ? "" : "s"} (diagnostics)
            </summary>
            <div className="indexing-error-list">
              {status.errors.map((error, index) => (
                <div key={`${error.path}-${index}`} className="indexing-error-row">
                  <strong>{error.kind}</strong>
                  <span title={error.path}>{error.path}</span>
                  <span>{error.message}</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
        <p className="indexing-muted indexing-db">Database: {status?.dbPath ?? "Unavailable"}</p>
      </section>
    </div>
  );
}
