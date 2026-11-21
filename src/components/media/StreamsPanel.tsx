import { useEffect, useMemo, useState } from "react";
import { MediaIcon } from "./icons";
import { StreamRow } from "./StreamRow";
import { filterStreams, STREAM_FILTERS } from "./streams";
import type { MediaCatalogMeta, RankedStream, StreamFilter } from "./types";

/** Rows rendered before the `Show all (N)` button (spec §4.3 row cap). */
export const STREAM_VISIBLE_CAP = 60;

/**
 * Streams panel (docs/MEDIA_UI_SPEC.md §4.3, `crop-streams-panel.png`).
 *
 * Docked as the right column at ≥ 1600 px and a slide-over below that — same
 * component, the host (`MediaWorkspace` + `media.css`) decides the placement.
 *
 * The filter is client-side over the already-fetched streams and never reorders
 * them: `streams.ts#filterStreams` preserves the ranking, and the rank is shown
 * on each row's first line so the order is explainable.
 */
export function StreamsPanel({
  meta,
  streams,
  loading,
  error,
  filter,
  onFilterChange,
  onClose,
  onRetry,
}: {
  meta: MediaCatalogMeta;
  streams: RankedStream[];
  loading: boolean;
  error: string | null;
  filter: StreamFilter;
  onFilterChange: (filter: StreamFilter) => void;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = meta.name ?? meta.id;

  // A new title gets a fresh, unexpanded list.
  useEffect(() => {
    setExpanded(false);
  }, [meta.id]);

  const filtered = useMemo(() => filterStreams(streams, filter), [streams, filter]);
  const visible = expanded ? filtered : filtered.slice(0, STREAM_VISIBLE_CAP);
  const hidden = filtered.length - visible.length;
  const activeFilter = STREAM_FILTERS.find((entry) => entry.id === filter) ?? STREAM_FILTERS[0];

  return (
    <section
      className="media-streams"
      aria-label={`Streams for ${title}`}
      data-filter={filter}
    >
      <div className="media-streams-head">
        <label className="media-streams-filter">
          <span className="media-visually-hidden">Filter sources</span>
          <select
            className="media-streams-select"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value as StreamFilter)}
            aria-label="Filter sources"
            title={activeFilter.hint}
          >
            {STREAM_FILTERS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <MediaIcon name="chevron-down" size={16} className="media-streams-filter-chevron" />
        </label>
        <button
          type="button"
          className="media-streams-close"
          onClick={onClose}
          aria-label="Close streams panel"
          title="Back to the board (Esc)"
        >
          <MediaIcon name="close" size={14} />
        </button>
      </div>

      <div className="media-streams-group">
        <h3 className="media-streams-group-title">Selection</h3>
        {!loading && !error ? (
          <span className="media-streams-count">
            {filtered.length === 0
              ? "0 sources"
              : `${visible.length} of ${filtered.length}`}
          </span>
        ) : null}
      </div>

      {loading ? (
        <ol className="media-stream-list" aria-busy="true" aria-label="Loading streams">
          {[0, 1, 2, 3].map((index) => (
            <li key={index} className="media-stream-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </li>
          ))}
        </ol>
      ) : error ? (
        <div className="media-streams-empty" role="alert">
          <p>Couldn't resolve streams for {title}.</p>
          <p className="media-error-detail">{error}</p>
          {onRetry ? (
            <button type="button" className="media-retry" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : filtered.length === 0 ? (
        <div className="media-streams-empty">
          <p>
            {streams.length === 0
              ? "No sources found for this title."
              : `No sources match “${activeFilter.label}”.`}
          </p>
          {streams.length > 0 && filter !== "all" ? (
            <button type="button" className="media-retry" onClick={() => onFilterChange("all")}>
              Show all sources
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <ol className="media-stream-list">
            {visible.map((ranked) => (
              <StreamRow key={`${ranked.stream.infoHash ?? ranked.stream.url ?? ranked.label}-${ranked.rank}`} ranked={ranked} metaId={meta.id} />
            ))}
          </ol>
          {hidden > 0 ? (
            <button type="button" className="media-streams-showall" onClick={() => setExpanded(true)}>
              Show all ({filtered.length})
            </button>
          ) : null}
        </>
      )}

      <p className="media-streams-hint">
        Sorted by quality → direct/cached → size. Click a row to play; the built-in engine
        streams torrents with no debrid needed.
      </p>
    </section>
  );
}