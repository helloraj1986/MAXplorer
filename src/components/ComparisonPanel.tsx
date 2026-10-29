import { useMemo } from "react";
import { Icon } from "./Icon";
import { useExplorerStore } from "../state/explorerStore";
import { basename, formatDate, formatSize } from "../lib/format";
import {
  comparisonCategory,
  comparisonCategoryLabel,
  comparisonSummary,
  visibleComparisonEntries,
} from "../lib/compare";

function displaySize(value: number | null): string {
  return value == null ? "" : formatSize(value);
}

export function ComparisonPanel() {
  const comparison = useExplorerStore((state) => state.comparison);
  const setComparisonFilter = useExplorerStore((state) => state.setComparisonFilter);
  const setComparisonOpen = useExplorerStore((state) => state.setComparisonOpen);
  const closeComparison = useExplorerStore((state) => state.closeComparison);
  const cancelComparison = useExplorerStore((state) => state.cancelComparison);
  const startComparison = useExplorerStore((state) => state.startComparison);

  const entries = useMemo(
    () =>
      comparison?.result
        ? visibleComparisonEntries(comparison.result, comparison.filterDifferences)
        : [],
    [comparison],
  );

  if (!comparison || !comparison.open) return null;
  const result = comparison.result;
  const percent =
    comparison.total > 0
      ? Math.min(100, (comparison.scanned / comparison.total) * 100)
      : comparison.loading
        ? 12
        : 100;

  return (
    <section className="comparison-panel" aria-label="Folder comparison">
      <header className="comparison-header">
        <div className="comparison-title">
          <Icon name="compare" size={16} />
          <strong>Compare folders</strong>
          <span className="comparison-paths" title={`${comparison.left} <-> ${comparison.right}`}>
            {basename(comparison.left) || comparison.left} <Icon name="sync" size={11} />{" "}
            {basename(comparison.right) || comparison.right}
          </span>
        </div>
        <div className="comparison-actions">
          {comparison.loading ? (
            <button type="button" className="link-button" onClick={() => void cancelComparison()}>
              Cancel
            </button>
          ) : (
            <button type="button" className="link-button" onClick={() => void startComparison(comparison.verifyContent)}>
              <Icon name="refresh" size={12} /> Rescan
            </button>
          )}
          <label className="comparison-filter">
            <input
              type="checkbox"
              checked={comparison.verifyContent}
              disabled={comparison.loading}
              onChange={(event) => void startComparison(event.target.checked)}
            />
            Verify content
          </label>
          <label className="comparison-filter">
            <input
              type="checkbox"
              checked={comparison.filterDifferences}
              onChange={(event) => setComparisonFilter(event.target.checked)}
            />
            Differences only
          </label>
          <button
            type="button"
            className="transfer-close"
            aria-label="Close comparison"
            title="Close comparison"
            onClick={closeComparison}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      </header>

      <div className="comparison-progress">
        <div className="transfer-progress-track" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
        <span>
          {comparison.loading
            ? `Comparing${comparison.total ? ` ${comparison.scanned}/${comparison.total}` : ""}...`
            : result
              ? comparisonSummary(result)
              : comparison.error ?? "Comparison unavailable"}
        </span>
        {comparison.current ? (
          <span className="comparison-current" title={comparison.current}>
            {comparison.current}
          </span>
        ) : null}
      </div>

      {comparison.error ? (
        <div className="comparison-error">
          <Icon name="warning" size={14} /> {comparison.error}
        </div>
      ) : null}

      {result ? (
        <div className="comparison-table" role="table" aria-label="Comparison results">
          <div className="comparison-row head" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Left</span>
            <span role="columnheader">Right</span>
            <span role="columnheader">Result</span>
          </div>
          <div className="comparison-scroll">
            {entries.map((entry) => {
              const category = comparisonCategory(entry);
              return (
                <div className={`comparison-row ${category}`} role="row" key={`${entry.name}-${category}`}>
                  <span className="comparison-name" role="cell" title={entry.leftPath ?? entry.rightPath ?? entry.name}>
                    <Icon name={entry.isDir ? "folder" : "file"} size={14} />
                    {entry.name}
                  </span>
                  <span role="cell">
                    {entry.leftPath ? (
                      <>
                        <span>{displaySize(entry.leftSize)}</span>
                        <small>{formatDate(entry.leftModified)}</small>
                      </>
                    ) : (
                      <em>missing</em>
                    )}
                  </span>
                  <span role="cell">
                    {entry.rightPath ? (
                      <>
                        <span>{displaySize(entry.rightSize)}</span>
                        <small>{formatDate(entry.rightModified)}</small>
                      </>
                    ) : (
                      <em>missing</em>
                    )}
                  </span>
                  <span role="cell">
                    <span className={`comparison-badge ${category}`}>
                      {comparisonCategoryLabel(category)}
                    </span>
                  </span>
                </div>
              );
            })}
            {!entries.length ? (
              <div className="comparison-empty">
                {comparison.filterDifferences ? "No differences found." : "These folders are empty."}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {comparison.cancelled ? (
        <div className="comparison-hint">
          The comparison was cancelled. It is read-only; no files were changed.
          <button type="button" className="link-button" onClick={() => setComparisonOpen(false)}>
            Hide panel
          </button>
        </div>
      ) : null}
    </section>
  );
}
