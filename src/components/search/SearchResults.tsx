import { useMemo } from "react";
import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { TagIndicators } from "../TagIndicators";
import { useSearchStore } from "../../state/searchStore";
import { useExplorerStore } from "../../state/explorerStore";
import { useVirtualRows } from "../../hooks/useVirtualRows";
import { useElementSize } from "../../hooks/useElementSize";
import { formatDate, formatSize, parentPath, typeName } from "../../lib/format";
import type { SearchHit, SearchSort } from "../../lib/search/types";

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const escaped = terms
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!escaped) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? <mark key={index}>{part}</mark> : part,
      )}
    </>
  );
}

function matchLabel(hit: SearchHit): string {
  if (hit.matchKind === "content") return "Content";
  if (hit.matchKind === "path") return "Path";
  if (hit.matchKind === "name") return "Name";
  if (hit.matchKind === "metadata") return "Metadata";
  return "Match";
}

function sourceLabel(hit: SearchHit): string | null {
  if (hit.source === "spotlight") return "Spotlight";
  if (hit.source === "filesystem") return "Live";
  return null;
}

function resultMenu(hit: SearchHit, selectedPaths: string[]) {
  const store = useExplorerStore.getState();
  const paths = selectedPaths.includes(hit.entry.path) && selectedPaths.length > 1 ? selectedPaths : [hit.entry.path];
  store.showContextMenu({
    kind: "search",
    x: lastPointer.x,
    y: lastPointer.y,
    path: hit.entry.path,
    isDir: hit.entry.isDir,
    paths,
  });
}

const lastPointer = { x: 0, y: 0 };

function useResultInteractions(hits: SearchHit[]) {
  const selectHit = useSearchStore((state) => state.selectHit);
  const selectMany = useSearchStore((state) => state.selectMany);
  const selectedPaths = useSearchStore((state) => state.selectedPaths);
  const anchorPath = useSearchStore((state) => state.anchorPath);
  const openHit = useSearchStore((state) => state.openHit);

  const click = (event: React.MouseEvent, hit: SearchHit) => {
    const additive = event.metaKey || event.ctrlKey;
    if (event.shiftKey && anchorPath) {
      const anchorIndex = hits.findIndex((item) => item.entry.path === anchorPath);
      const targetIndex = hits.findIndex((item) => item.entry.path === hit.entry.path);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        selectMany(hits.slice(start, end + 1).map((item) => item.entry.path));
        return;
      }
    }
    selectHit(hit.entry.path, additive);
  };

  const context = (event: React.MouseEvent, hit: SearchHit) => {
    event.preventDefault();
    event.stopPropagation();
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    if (!selectedPaths.includes(hit.entry.path)) selectHit(hit.entry.path);
    resultMenu(hit, selectedPaths);
  };

  const open = (hit: SearchHit) => {
    void openHit(hit);
  };

  return { click, context, open };
}

function RelevanceBadge({ hit }: { hit: SearchHit }) {
  return <span className={`search-relevance relevance-${hit.matchKind}`}>{matchLabel(hit)}</span>;
}

export function SearchResults({ hits }: { hits: SearchHit[] }) {
  const view = useSearchStore((state) => state.view);
  const columns = useSearchStore((state) => state.columns);
  const sort = useSearchStore((state) => state.sort);
  const sortDirection = useSearchStore((state) => state.sortDirection);
  const setSort = useSearchStore((state) => state.setSort);
  const selectedPaths = useSearchStore((state) => state.selectedPaths);
  const selectedPath = useSearchStore((state) => state.selectedPath);
  const interpretation = useSearchStore((state) => state.interpretation);
  const searchTerms = useMemo(
    () => [...(interpretation?.terms ?? []), ...(interpretation?.contentTerms ?? [])],
    [interpretation],
  );
  const interactions = useResultInteractions(hits);
  const selected = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  type Row = { key: string; height: number; hit: SearchHit; index: number };
  const rows = useMemo<Row[]>(
    () => hits.map((hit, index) => ({ key: hit.entry.path, height: view === "grid" ? 0 : 58, hit, index })),
    [hits, view],
  );
  const virtual = useVirtualRows(rows, view === "grid" ? 0 : 8);
  const gridSize = useElementSize<HTMLDivElement>();
  const gridColumns = Math.max(2, Math.floor(Math.max(0, gridSize.width - 24) / 176));
  const gridRows = useMemo(
    () =>
      Array.from({ length: Math.ceil(hits.length / gridColumns) }, (_, index) => ({
        key: `grid-${index}`,
        height: 132,
        index,
      })),
    [hits.length, gridColumns],
  );
  const gridVirtual = useVirtualRows(gridRows, 3);

  const sortBy = (key: SearchSort) => {
    setSort(key, sort === key && sortDirection === "desc" ? "asc" : "desc");
  };

  const header = (key: SearchSort, label: string) => (
    <button
      type="button"
      className={`search-column-sort ${sort === key ? "active" : ""}`}
      onClick={() => sortBy(key)}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      {sort === key ? <Icon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} size={11} /> : null}
    </button>
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!hits.length) return;
    const currentIndex = hits.findIndex((hit) => hit.entry.path === selectedPath);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : Math.min(hits.length - 1, currentIndex + 1);
      const next = hits[nextIndex];
      useSearchStore.getState().selectHit(next.entry.path);
      if (view === "list") virtual.scrollToIndex(nextIndex);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
      const next = hits[nextIndex];
      useSearchStore.getState().selectHit(next.entry.path);
      if (view === "list") virtual.scrollToIndex(nextIndex);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      useSearchStore.getState().selectHit(hits[0].entry.path);
      if (view === "list") virtual.scrollToIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      useSearchStore.getState().selectHit(hits[hits.length - 1].entry.path);
      if (view === "list") virtual.scrollToIndex(hits.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits.find((item) => item.entry.path === selectedPath);
      if (hit) interactions.open(hit);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      useSearchStore.getState().selectMany(hits.map((hit) => hit.entry.path));
    }
  };

  if (!hits.length) return null;

  if (view === "grid") {
    return (
      <div className="search-results search-results-grid" ref={gridSize.ref}>
        <div
          className="search-results-scroll"
          ref={gridVirtual.containerRef}
          onScroll={gridVirtual.onScroll}
          tabIndex={0}
          onKeyDown={onKeyDown}
          role="grid"
          aria-label="Search results"
          aria-multiselectable="true"
          aria-rowcount={hits.length}
        >
          <div className="search-grid-canvas" style={{ height: Math.max(gridVirtual.totalHeight, 1) }}>
            {gridVirtual.visibleRows.map(({ row, top }) => {
              const slice = hits.slice(row.index * gridColumns, row.index * gridColumns + gridColumns);
              return (
                <div
                  className="search-grid-row"
                  key={row.key}
                  style={{
                    top,
                    gridTemplateColumns: `repeat(${gridColumns}, minmax(140px, 1fr))`,
                  }}
                >
                  {slice.map((hit) => (
                    <button
                      type="button"
                      key={hit.entry.path}
                      className={`search-grid-cell ${selected.has(hit.entry.path) ? "selected" : ""} ${
                        selectedPath === hit.entry.path ? "focused" : ""
                      }`}
                      onClick={(event) => interactions.click(event, hit)}
                      onDoubleClick={() => interactions.open(hit)}
                      onContextMenu={(event) => interactions.context(event, hit)}
                      title={`${hit.entry.name}\n${hit.entry.path}`}
                    >
                      <span className="search-grid-icon">
                        <FileTypeIcon entry={hit.entry} size={64} thumbnail />
                      </span>
                      <span className="search-grid-name">
                        <Highlight text={hit.entry.name} terms={searchTerms} />
                        <TagIndicators path={hit.entry.path} />
                      </span>
                      <span className="search-grid-meta">
                        {typeName(hit.entry)} {hit.entry.size != null ? `- ${formatSize(hit.entry.size)}` : ""}
                      </span>
                      <span className={`search-source-dot source-${hit.source}`} title={sourceLabel(hit) ?? "Indexed"} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const columnsTemplate = [
    "minmax(220px, 2.4fr)",
    "110px",
    columns.location ? "minmax(160px, 1.6fr)" : "",
    "90px",
    "150px",
    columns.created ? "150px" : "",
    columns.accessed ? "150px" : "",
    columns.relevance ? "104px" : "",
    "26px",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="search-results search-results-list">
      <div className="search-column-header" role="row" style={{ gridTemplateColumns: columnsTemplate }}>
        <div role="columnheader">{header("name", "Name")}</div>
        <div role="columnheader">{header("kind", "Kind")}</div>
        {columns.location ? <div role="columnheader">Location</div> : null}
        <div role="columnheader">{header("size", "Size")}</div>
        <div role="columnheader">{header("modified", "Date modified")}</div>
        {columns.created ? <div role="columnheader">{header("created", "Date created")}</div> : null}
        {columns.accessed ? <div role="columnheader">Date accessed</div> : null}
        {columns.relevance ? <div role="columnheader">{header("relevance", "Match")}</div> : null}
        <div role="columnheader" />
      </div>
      <div
        className="search-results-scroll"
        ref={virtual.containerRef}
        onScroll={virtual.onScroll}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="grid"
        aria-label="Search results"
        aria-multiselectable="true"
        aria-rowcount={hits.length}
      >
        <div className="search-list-canvas" style={{ height: Math.max(virtual.totalHeight, 1) }}>
          {virtual.visibleRows.map(({ row, top }) => {
            const hit = row.hit;
            return (
              <div
                key={row.key}
                role="row"
                aria-selected={selected.has(hit.entry.path)}
                className={`search-result-list-row ${selected.has(hit.entry.path) ? "selected" : ""} ${
                  selectedPath === hit.entry.path ? "focused" : ""
                }`}
                style={{ top, gridTemplateColumns: columnsTemplate }}
                onMouseDown={(event) => {
                  if (event.button === 0) interactions.click(event, hit);
                }}
                onDoubleClick={() => interactions.open(hit)}
                onContextMenu={(event) => interactions.context(event, hit)}
              >
                <div className="search-result-name-cell">
                  <span className="search-result-icon">
                    <FileTypeIcon entry={hit.entry} size={22} thumbnail />
                  </span>
                  <span className="search-result-name-text">
                    <span className="search-result-name">
                      <Highlight text={hit.entry.name} terms={searchTerms} />
                      <TagIndicators path={hit.entry.path} />
                    </span>
                    <span className="search-result-snippet" title={hit.snippet ?? parentPath(hit.entry.path) ?? ""}>
                      {hit.snippet ? (
                        <Highlight text={hit.snippet} terms={searchTerms} />
                      ) : (
                        <Highlight text={parentPath(hit.entry.path) ?? ""} terms={searchTerms} />
                      )}
                    </span>
                  </span>
                </div>
                <div className="search-result-cell">
                  {hit.entry.isDir ? "Folder" : typeName(hit.entry)}
                </div>
                {columns.location ? (
                  <div className="search-result-cell search-result-path" title={parentPath(hit.entry.path) ?? ""}>
                    {parentPath(hit.entry.path) ?? ""}
                  </div>
                ) : null}
                <div className="search-result-cell search-result-size">{hit.entry.isDir ? "" : formatSize(hit.entry.size)}</div>
                <div className="search-result-cell">{formatDate(hit.entry.modified)}</div>
                {columns.created ? <div className="search-result-cell">{formatDate(hit.entry.created)}</div> : null}
                {columns.accessed ? <div className="search-result-cell">{formatDate(hit.entry.accessed)}</div> : null}
                {columns.relevance ? (
                  <div className="search-result-cell">
                    <RelevanceBadge hit={hit} />
                  </div>
                ) : null}
                <div className="search-result-cell search-result-source" title={sourceLabel(hit) ?? "Indexed"}>
                  {sourceLabel(hit) ? <span className={`search-source-dot source-${hit.source}`} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
