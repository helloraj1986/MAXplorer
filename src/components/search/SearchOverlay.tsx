import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { useExplorerStore } from "../../state/explorerStore";
import { useSearchStore } from "../../state/searchStore";
import { formatCount, formatDate, formatSize, parentPath, plural, typeName } from "../../lib/format";
import { scopeLabel } from "../../lib/search/interpreter";
import type { SearchHit, SearchScopeId } from "../../lib/search/types";

function highlight(text: string, terms: string[], limit = 140): Array<string | JSX.Element> {
  const clipped = text.length > limit ? `${text.slice(0, limit)}...` : text;
  if (!terms.length) return [clipped];
  const escaped = terms
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!escaped) return [clipped];
  const pattern = new RegExp(`(${escaped})`, "gi");
  const parts = clipped.split(pattern);
  return parts.map((part, index) =>
    terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
      <mark key={`${part}-${index}`}>{part}</mark>
    ) : (
      part
    ),
  );
}

function matchBadge(hit: SearchHit): string {
  if (hit.matchKind === "content") return "Content match";
  if (hit.matchKind === "path") return "Path match";
  if (hit.matchKind === "name") return "Name match";
  if (hit.matchKind === "metadata") return "Metadata match";
  return "Match";
}

function sourceBadge(hit: SearchHit): string | null {
  if (hit.source === "spotlight") return "Spotlight";
  if (hit.source === "filesystem") return "Live";
  return null;
}

export function SearchOverlay() {
  const open = useSearchStore((state) => state.open);
  const closeOverlay = useSearchStore((state) => state.closeOverlay);
  const openWorkspace = useSearchStore((state) => state.openWorkspace);
  const query = useSearchStore((state) => state.query);
  const setQuery = useSearchStore((state) => state.setQuery);
  const interpretation = useSearchStore((state) => state.interpretation);
  const results = useSearchStore((state) => state.results);
  const loading = useSearchStore((state) => state.loading);
  const stats = useSearchStore((state) => state.stats);
  const error = useSearchStore((state) => state.error);
  const scope = useSearchStore((state) => state.scope);
  const setScope = useSearchStore((state) => state.setScope);
  const removeChip = useSearchStore((state) => state.removeChip);
  const setFiltersOpen = useSearchStore((state) => state.setFiltersOpen);
  const openHit = useSearchStore((state) => state.openHit);
  const selectHit = useSearchStore((state) => state.selectHit);
  const selectedPath = useSearchStore((state) => state.selectedPath);
  const history = useSearchStore((state) => state.history);
  const savedSearches = useSearchStore((state) => state.savedSearches);
  const reuseHistory = useSearchStore((state) => state.reuseHistory);
  const runSavedSearch = useSearchStore((state) => state.runSavedSearch);
  const indexStatus = useSearchStore((state) => state.indexStatus);
  const loadIndexStatus = useSearchStore((state) => state.loadIndexStatus);
  const settings = useSearchStore((state) => state.settings);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scopeMenu, setScopeMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const locations = useExplorerStore((state) => state.locations);
  const platform = useExplorerStore((state) => state.platform);
  const openDialog = useExplorerStore((state) => state.openDialog);
  const hasSelectedFolders = useExplorerStore((state) =>
    state.selectedEntries(state.activePane).some((entry) => entry.isDir),
  );
  const externalCount = locations.filter((location) => location.isVolume && location.path !== "/").length;
  const terms = useMemo(
    () => [...(interpretation?.terms ?? []), ...(interpretation?.contentTerms ?? [])],
    [interpretation],
  );
  const chips = interpretation?.chips ?? [];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    void loadIndexStatus();
  }, [open, loadIndexStatus]);

  useEffect(() => {
    if (!scopeMenu) return;
    const close = (event: PointerEvent) => {
      if (!scopeRef.current?.contains(event.target as Node)) setScopeMenu(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [scopeMenu]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    if (!open) return;
    const element = resultsRef.current?.querySelector<HTMLElement>(`#search-hit-${activeIndex}`);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  if (!open) return null;

  const selectScope = (next: SearchScopeId) => {
    setScope(next);
    setScopeMenu(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeOverlay();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      openWorkspace();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((value) => Math.min(results.length - 1, value + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((value) => Math.max(0, value - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = results[activeIndex];
      if (hit) {
        useSearchStore.getState().commitSearch();
        void openHit(hit);
        closeOverlay();
      } else {
        openWorkspace();
      }
    }
  };

  const scopeButton = (
    <div className="search-scope-wrap" ref={scopeRef}>
      <button
        type="button"
        className="search-scope-button"
        aria-haspopup="menu"
        aria-expanded={scopeMenu}
        onClick={() => setScopeMenu((value) => !value)}
      >
        <Icon name="folder" size={13} />
        <span>{scopeLabel(scope)}</span>
        <Icon name="chevronDown" size={10} />
      </button>
      {scopeMenu ? (
        <div className="search-scope-menu" role="menu" aria-label="Search scope">
          {(
            [
              ["current", "Current folder", true],
              ["currentRecursive", "Current folder and subfolders", true],
              ["home", "Home folder", true],
              ["selected", "Selected folders", hasSelectedFolders],
              ["indexed", "All indexed locations", true],
              ["external", "External drives", externalCount > 0],
              ["custom", "Custom locations", useSearchStore.getState().customRoots.length > 0],
            ] as Array<[SearchScopeId, string, boolean]>
          ).map(([id, label, enabled]) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={scope === id}
              className={`search-scope-item ${scope === id ? "active" : ""}`}
              disabled={!enabled}
              onClick={() => selectScope(id)}
            >
              <span>{label}</span>
              {scope === id ? <Icon name="check" size={13} /> : null}
            </button>
          ))}
          <div className="search-scope-separator" />
          <button
            type="button"
            role="menuitem"
            className="search-scope-item"
            onClick={() => {
              setScopeMenu(false);
              closeOverlay();
              openDialog({ kind: "indexing" });
            }}
          >
            Manage indexed locations...
          </button>
        </div>
      ) : null}
    </div>
  );

  const statusLabel = indexStatus
    ? indexStatus.paused
      ? "Index paused"
      : indexStatus.activity === "indexing" || indexStatus.activity === "content"
        ? "Indexing in background"
        : "Index up to date"
    : "Index status unavailable";

  return (
    <div
      className="search-overlay-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeOverlay();
      }}
    >
      <div
        className="search-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Universal Search"
        ref={panelRef}
        onKeyDown={handleKeyDown}
      >
        <div className="search-overlay-input-row">
          <span className="search-overlay-icon" aria-hidden="true">
            {loading ? <Icon name="spinner" size={18} className="spin" /> : <Icon name="search" size={18} />}
          </span>
          <input
            ref={inputRef}
            className="search-overlay-input"
            value={query}
            placeholder="Search files, contents, and everywhere..."
            aria-label="Search files, contents, and everywhere"
            aria-controls="search-overlay-results"
            aria-activedescendant={results[activeIndex] ? `search-hit-${activeIndex}` : undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
          {query ? (
            <button
              type="button"
              className="search-overlay-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <Icon name="close" size={12} />
            </button>
          ) : null}
          <kbd className="search-overlay-escape">esc</kbd>
        </div>

        <div className="search-overlay-toolbar">
          {scopeButton}
          <button
            type="button"
            className={`search-toolbar-button ${chips.length ? "has-filters" : ""}`}
            onClick={() => {
              setFiltersOpen(true);
              openWorkspace();
            }}
          >
            <Icon name="sort" size={13} />
            Filters
            {chips.length ? <span className="search-filter-count">{chips.length}</span> : null}
          </button>
          <span className="search-overlay-hint">
            {query ? (loading ? "Searching..." : `${formatCount(results.length)} ${plural(results.length, "result")}`) : "Type to search"}
          </span>
          <button
            type="button"
            className="search-toolbar-button search-toolbar-muted"
            onClick={() => {
              closeOverlay();
              openDialog({ kind: "indexing" });
            }}
            title={statusLabel}
          >
            <Icon name={indexStatus?.paused ? "clock" : "database"} size={13} />
            <span className="search-index-label">{statusLabel}</span>
          </button>
        </div>

        {chips.length ? (
          <div className="search-chip-row" aria-label="Active filters">
            {chips.slice(0, 7).map((chip) => (
              <span className="search-chip" key={chip.id}>
                <button
                  type="button"
                  className="search-chip-label"
                  title={`Edit ${chip.label} in Filters`}
                  onClick={() => {
                    setFiltersOpen(true);
                    openWorkspace();
                  }}
                >
                  {chip.label}
                </button>
                <button
                  type="button"
                  className="search-chip-remove"
                  aria-label={`Remove ${chip.label}`}
                  title={`Remove ${chip.label}`}
                  onClick={() => removeChip(chip)}
                >
                  <Icon name="close" size={9} />
                </button>
              </span>
            ))}
            {chips.length > 7 ? <span className="search-chip-more">+{chips.length - 7}</span> : null}
          </div>
        ) : null}

        {interpretation?.notes.length ? (
          <div className="search-notes" role="status">
            <Icon name="info" size={13} />
            <span>{interpretation.notes[0]}</span>
          </div>
        ) : null}

        <div
          className="search-overlay-results"
          id="search-overlay-results"
          role="listbox"
          aria-label="Search results"
          ref={resultsRef}
        >
          {!query.trim() && !chips.length ? (
            <div className="search-suggestions">
              {savedSearches.length ? (
                <section>
                  <h3>Saved searches</h3>
                  {[...savedSearches]
                    .sort((left, right) => Number(right.pinned) - Number(left.pinned))
                    .slice(0, 4)
                    .map((search) => (
                      <button
                        type="button"
                        key={search.id}
                        className="search-suggestion-row"
                        onClick={() => runSavedSearch(search)}
                      >
                        <Icon name={search.pinned ? "star" : "search"} size={14} />
                        <span className="search-suggestion-text">{search.name}</span>
                        <span className="search-suggestion-detail">{scopeLabel(search.scope)}</span>
                      </button>
                    ))}
                </section>
              ) : null}
              {history.length ? (
                <section>
                  <h3>Recent searches</h3>
                  {history.slice(0, 6).map((entry) => (
                    <button
                      type="button"
                      key={entry.id}
                      className="search-suggestion-row"
                      onClick={() => reuseHistory(entry)}
                    >
                      <Icon name="clock" size={14} />
                      <span className="search-suggestion-text">{entry.query}</span>
                      <span className="search-suggestion-detail">{scopeLabel(entry.scope)}</span>
                    </button>
                  ))}
                </section>
              ) : null}
              {!history.length && !savedSearches.length ? (
                <div className="search-empty-inline">
                  <Icon name="search" size={30} />
                  <h3>Search everything MAXplorer can see</h3>
                  <p>
                    Try a filename, a phrase from a document, or a natural-language query such as
                    {" "}
                    <button type="button" className="search-example" onClick={() => setQuery("PDF modified last week")}>
                      PDF modified last week
                    </button>
                    .
                  </p>
                  {!settings.semanticSearch ? (
                    <p className="search-muted">
                      Semantic and visual search are optional and currently disabled. Results never pretend to be semantic matches.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : results.length ? (
            results.map((hit, index) => {
              const active = index === activeIndex;
              const selected = hit.entry.path === selectedPath;
              return (
                <button
                  type="button"
                  id={`search-hit-${index}`}
                  key={hit.entry.path}
                  role="option"
                  aria-selected={active || selected}
                  className={`search-result-row ${active ? "active" : ""} ${selected ? "selected" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    selectHit(hit.entry.path);
                    setActiveIndex(index);
                  }}
                  onDoubleClick={() => {
                    void openHit(hit);
                    closeOverlay();
                  }}
                >
                  <span className="search-result-icon">
                    <FileTypeIcon entry={hit.entry} size={30} thumbnail />
                  </span>
                  <span className="search-result-main">
                    <span className="search-result-name">{highlight(hit.entry.name, terms, 120)}</span>
                    <span className="search-result-path">
                      {highlight(parentPath(hit.entry.path) ?? "", terms, 120)}
                    </span>
                    {hit.snippet ? (
                      <span className="search-result-snippet">{highlight(hit.snippet, terms, 180)}</span>
                    ) : null}
                  </span>
                  <span className="search-result-meta">
                    <span className="search-result-kind">{typeName(hit.entry)}</span>
                    <span className="search-result-size">{hit.entry.isDir ? "" : formatSize(hit.entry.size)}</span>
                    <span className="search-result-date">{formatDate(hit.entry.modified)}</span>
                  </span>
                  <span className={`search-match-badge match-${hit.matchKind}`}>{matchBadge(hit)}</span>
                  {sourceBadge(hit) ? <span className="search-source-badge">{sourceBadge(hit)}</span> : null}
                </button>
              );
            })
          ) : loading ? (
            <div className="search-loading-list" aria-live="polite" aria-busy="true">
              {Array.from({ length: 5 }, (_, index) => (
                <div className="search-skeleton-row" key={index}>
                  <span className="search-skeleton-icon" />
                  <span className="search-skeleton-text" style={{ width: `${45 + index * 7}%` }} />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="search-empty-inline search-error">
              <Icon name="warning" size={30} />
              <h3>Search couldn't complete</h3>
              <p>{error}</p>
            </div>
          ) : (
            <div className="search-empty-inline">
              <Icon name="search" size={30} />
              <h3>No matches found</h3>
              <p>
                Nothing in <strong>{scopeLabel(scope)}</strong> matched this query. Check the scope, remove a filter, or
                try different words.
              </p>
              {stats?.notes.length ? <p className="search-muted">{stats.notes[0]}</p> : null}
            </div>
          )}
        </div>

        <div className="search-overlay-footer">
          <span className="search-footnote">
            {stats
              ? `${formatCount(stats.total)} ${plural(stats.total, "result")} - ${stats.elapsedMs} ms`
              : results.length
                ? `${formatCount(results.length)} ${plural(results.length, "result")} so far`
                : "Name, path, metadata, and indexed contents"}
            {stats && !stats.ftsAvailable ? " - full-text index unavailable" : ""}
          </span>
          <span className="search-footer-actions">
            <span className="search-footer-shortcuts">
              <kbd>↑</kbd>
              <kbd>↓</kbd>
              <span>navigate</span>
              <kbd>{platform?.modifier === "cmd" ? "⌘" : "Ctrl"}</kbd>
              <kbd>↵</kbd>
              <span>all results</span>
            </span>
            <button type="button" className="search-show-all" onClick={openWorkspace}>
              Show all results
              <Icon name="arrowRight" size={12} />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
