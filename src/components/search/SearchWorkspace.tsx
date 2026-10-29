import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { MenuPanel, type MenuItem } from "../Menu";
import { SearchFilters } from "./SearchFilters";
import { SearchResults } from "./SearchResults";
import { SearchPreview } from "./SearchPreview";
import { DuplicateResults } from "./DuplicateResults";
import { useSearchStore, searchChips } from "../../state/searchStore";
import { useExplorerStore } from "../../state/explorerStore";
import { formatCount, plural } from "../../lib/format";
import { scopeLabel } from "../../lib/search/interpreter";
import type { SearchScopeId, SearchSort } from "../../lib/search/types";

function SortMenu({ onClose }: { onClose: () => void }) {
  const sort = useSearchStore((state) => state.sort);
  const sortDirection = useSearchStore((state) => state.sortDirection);
  const setSort = useSearchStore((state) => state.setSort);
  const items: MenuItem[] = [
    ...(
      [
        ["relevance", "Relevance"],
        ["name", "Name"],
        ["modified", "Date modified"],
        ["created", "Date created"],
        ["size", "Size"],
        ["kind", "Kind"],
      ] as Array<[SearchSort, string]>
    ).map(([value, label]) => ({
      label,
      checked: sort === value,
      onClick: () => {
        setSort(value);
        onClose();
      },
    })),
    { type: "separator" as const },
    {
      label: "Ascending",
      checked: sortDirection === "asc",
      onClick: () => {
        setSort(sort, "asc");
        onClose();
      },
    },
    {
      label: "Descending",
      checked: sortDirection === "desc",
      onClick: () => {
        setSort(sort, "desc");
        onClose();
      },
    },
  ];
  return <MenuPanel items={items} width={180} itemHeight={30} showIcons={false} onClose={onClose} />;
}

function ColumnsMenu({ onClose }: { onClose: () => void }) {
  const columns = useSearchStore((state) => state.columns);
  const toggleColumn = useSearchStore((state) => state.toggleColumn);
  const items: MenuItem[] = [
    { label: "Location", checked: columns.location, onClick: () => toggleColumn("location") },
    { label: "Date created", checked: columns.created, onClick: () => toggleColumn("created") },
    { label: "Date accessed", checked: columns.accessed, onClick: () => toggleColumn("accessed") },
    { label: "Match explanation", checked: columns.relevance, onClick: () => toggleColumn("relevance") },
  ];
  return <MenuPanel items={items} width={196} itemHeight={30} showIcons={false} onClose={onClose} />;
}

function SavedMenu({ onClose }: { onClose: () => void }) {
  const savedSearches = useSearchStore((state) => state.savedSearches);
  const runSavedSearch = useSearchStore((state) => state.runSavedSearch);
  const deleteSaved = useSearchStore((state) => state.deleteSaved);
  const renameSaved = useSearchStore((state) => state.renameSaved);
  const pinSaved = useSearchStore((state) => state.pinSaved);
  const openDialog = useExplorerStore((state) => state.openDialog);
  const items: MenuItem[] = savedSearches.length
    ? [...savedSearches]
        .sort((left, right) => Number(right.pinned) - Number(left.pinned))
        .slice(0, 12)
        .map((search) => ({
          label: search.name,
          icon: search.pinned ? ("star" as const) : ("search" as const),
          onClick: () => {
            runSavedSearch(search);
            onClose();
          },
          submenu: [
            {
              label: search.pinned ? "Unpin" : "Pin to saved searches",
              icon: (search.pinned ? "unpin" : "pin") as "pin" | "unpin",
              onClick: () => pinSaved(search.id),
            },
            {
              label: "Rename...",
              icon: "rename" as const,
              onClick: () =>
                openDialog({
                  kind: "prompt",
                  title: "Rename saved search",
                  label: "Saved search name",
                  initialValue: search.name,
                  confirmLabel: "Rename",
                  onConfirm: (name) => renameSaved(search.id, name),
                }),
            },
            {
              label: "Delete saved search",
              icon: "delete" as const,
              danger: true,
              onClick: () => deleteSaved(search.id),
            },
          ],
        }))
    : [{ label: "No saved searches yet", disabled: true, onClick: () => undefined }];
  return <MenuPanel items={items} width={240} itemHeight={30} showIcons onClose={onClose} />;
}

export function SearchWorkspace() {
  const query = useSearchStore((state) => state.query);
  const setQuery = useSearchStore((state) => state.setQuery);
  const runSearchNow = useSearchStore((state) => state.runSearchNow);
  const closeWorkspace = useSearchStore((state) => state.closeWorkspace);
  const openOverlay = useSearchStore((state) => state.openOverlay);
  const interpretation = useSearchStore((state) => state.interpretation);
  const filters = useSearchStore((state) => state.filters);
  const removeChip = useSearchStore((state) => state.removeChip);
  const clearFilters = useSearchStore((state) => state.clearFilters);
  const filtersOpen = useSearchStore((state) => state.filtersOpen);
  const setFiltersOpen = useSearchStore((state) => state.setFiltersOpen);
  const results = useSearchStore((state) => state.results);
  const stats = useSearchStore((state) => state.stats);
  const loading = useSearchStore((state) => state.loading);
  const error = useSearchStore((state) => state.error);
  const selectedPath = useSearchStore((state) => state.selectedPath);
  const previewOpen = useSearchStore((state) => state.previewOpen);
  const setPreviewOpen = useSearchStore((state) => state.setPreviewOpen);
  const view = useSearchStore((state) => state.view);
  const toggleView = useSearchStore((state) => state.toggleView);
  const scope = useSearchStore((state) => state.scope);
  const setScope = useSearchStore((state) => state.setScope);
  const customRoots = useSearchStore((state) => state.customRoots);
  const indexStatus = useSearchStore((state) => state.indexStatus);
  const loadIndexStatus = useSearchStore((state) => state.loadIndexStatus);
  const history = useSearchStore((state) => state.history);
  const savedSearches = useSearchStore((state) => state.savedSearches);
  const reuseHistory = useSearchStore((state) => state.reuseHistory);
  const runSavedSearch = useSearchStore((state) => state.runSavedSearch);
  const openDialog = useExplorerStore((state) => state.openDialog);
  const locations = useExplorerStore((state) => state.locations);
  const [scopeMenu, setScopeMenu] = useState(false);
  const [sortMenu, setSortMenu] = useState(false);
  const [columnMenu, setColumnMenu] = useState(false);
  const [savedMenu, setSavedMenu] = useState(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasSelectedFolders = useExplorerStore((state) =>
    state.selectedEntries(state.activePane).some((entry) => entry.isDir),
  );
  const externalCount = locations.filter((location) => location.isVolume && location.path !== "/").length;
  const selectedHit = useMemo(
    () => results.find((hit) => hit.entry.path === selectedPath) ?? null,
    [results, selectedPath],
  );
  const chips = searchChips();

  useEffect(() => {
    void loadIndexStatus();
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [loadIndexStatus]);

  useEffect(() => {
    const focusSearch = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("maxplorer:focus-search-workspace", focusSearch);
    return () => window.removeEventListener("maxplorer:focus-search-workspace", focusSearch);
  }, []);

  useEffect(() => {
    if (!scopeMenu && !sortMenu && !columnMenu && !savedMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (scopeRef.current?.contains(target) || actionRef.current?.contains(target)) return;
      setScopeMenu(false);
      setSortMenu(false);
      setColumnMenu(false);
      setSavedMenu(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [scopeMenu, sortMenu, columnMenu, savedMenu]);

  const saveSearch = () => {
    openDialog({
      kind: "prompt",
      title: "Save search",
      label: "Name this search",
      initialValue: query.trim() || "Saved search",
      confirmLabel: "Save",
      onConfirm: (name) => {
        useSearchStore.getState().saveCurrentSearch(name);
      },
    });
  };

  const scopeItems: Array<[SearchScopeId, string, boolean]> = [
    ["current", "Current folder", true],
    ["currentRecursive", "Current folder and subfolders", true],
    ["home", "Home folder", true],
    ["selected", "Selected folders", hasSelectedFolders],
    ["indexed", "All indexed locations", true],
    ["external", "External drives", externalCount > 0],
    ["custom", "Custom locations", customRoots.length > 0],
  ];

  const emptyState = !query.trim() && !chips.length;

  return (
    <div className="search-workspace">
      <header className="search-workspace-header">
        <div className="search-workspace-query">
          <span className="search-workspace-icon" aria-hidden="true">
            {loading ? <Icon name="spinner" size={18} className="spin" /> : <Icon name="search" size={18} />}
          </span>
          <input
            ref={inputRef}
            value={query}
            placeholder="Search files, contents, and everywhere..."
            aria-label="Search query"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.metaKey || event.ctrlKey) {
                  void runSearchNow();
                  return;
                }
                const hit = results.find((item) => item.entry.path === selectedPath);
                if (hit) void useSearchStore.getState().openHit(hit);
                else {
                  useSearchStore.getState().commitSearch();
                  void runSearchNow();
                }
              }
              if (event.key === "Escape") {
                event.preventDefault();
                openOverlay(query);
              }
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
        </div>

        <div className="search-workspace-actions" ref={actionRef}>
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
              <div className="search-scope-menu align-right" role="menu" aria-label="Search scope">
                {scopeItems.map(([id, label, enabled]) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={scope === id}
                    className={`search-scope-item ${scope === id ? "active" : ""}`}
                    disabled={!enabled}
                    onClick={() => {
                      setScope(id);
                      setScopeMenu(false);
                    }}
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
                    openDialog({ kind: "indexing" });
                  }}
                >
                  Manage indexed locations...
                </button>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className={`search-toolbar-button ${filtersOpen ? "active" : ""}`}
            aria-pressed={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Icon name="sort" size={13} />
            Filters
            {chips.length ? <span className="search-filter-count">{chips.length}</span> : null}
          </button>

          <div className="search-menu-wrap">
            <button
              type="button"
              className="search-toolbar-button"
              aria-haspopup="menu"
              aria-expanded={sortMenu}
              onClick={() => {
                setSortMenu((value) => !value);
                setScopeMenu(false);
                setColumnMenu(false);
                setSavedMenu(false);
              }}
            >
              <Icon name="sort" size={13} />
              Sort
              <Icon name="chevronDown" size={9} />
            </button>
            {sortMenu ? (
              <div className="dropdown-menu">
                <SortMenu onClose={() => setSortMenu(false)} />
              </div>
            ) : null}
          </div>

          <div className="search-view-switch" role="group" aria-label="Result view">
            <button
              type="button"
              className={view === "list" ? "active" : ""}
              aria-pressed={view === "list"}
              title="List view"
              onClick={() => toggleView("list")}
            >
              <Icon name="list" size={14} />
            </button>
            <button
              type="button"
              className={view === "grid" ? "active" : ""}
              aria-pressed={view === "grid"}
              title="Grid view"
              onClick={() => toggleView("grid")}
            >
              <Icon name="grid" size={14} />
            </button>
          </div>

          <div className="search-menu-wrap">
            <button
              type="button"
              className="search-toolbar-button search-icon-button"
              aria-label="Choose columns"
              aria-haspopup="menu"
              aria-expanded={columnMenu}
              title="Choose columns"
              onClick={() => {
                setColumnMenu((value) => !value);
                setScopeMenu(false);
                setSortMenu(false);
                setSavedMenu(false);
              }}
            >
              <Icon name="details" size={14} />
            </button>
            {columnMenu ? (
              <div className="dropdown-menu align-right">
                <ColumnsMenu onClose={() => setColumnMenu(false)} />
              </div>
            ) : null}
          </div>

          <div className="search-menu-wrap">
            <button
              type="button"
              className="search-toolbar-button search-icon-button"
              aria-label="Saved searches"
              aria-haspopup="menu"
              aria-expanded={savedMenu}
              title="Saved searches"
              onClick={() => {
                setSavedMenu((value) => !value);
                setScopeMenu(false);
                setSortMenu(false);
                setColumnMenu(false);
              }}
            >
              <Icon name="star" size={14} />
            </button>
            {savedMenu ? (
              <div className="dropdown-menu align-right">
                <SavedMenu onClose={() => setSavedMenu(false)} />
              </div>
            ) : null}
          </div>

          <button type="button" className="search-toolbar-button" onClick={saveSearch}>
            <Icon name="star" size={13} />
            Save
          </button>

          <button
            type="button"
            className={`search-toolbar-button search-icon-button ${previewOpen ? "active" : ""}`}
            aria-label="Toggle preview pane"
            aria-pressed={previewOpen}
            title="Preview pane"
            onClick={() => setPreviewOpen(!previewOpen)}
          >
            <Icon name="eye" size={14} />
          </button>

          <button
            type="button"
            className="search-toolbar-button search-icon-button"
            aria-label="Open Quick Search"
            title="Quick Search"
            onClick={() => openOverlay(query)}
          >
            <Icon name="panel" size={14} />
          </button>

          <button
            type="button"
            className="search-toolbar-button search-icon-button"
            aria-label="Close search workspace"
            title="Close search"
            onClick={closeWorkspace}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className="search-workspace-chips">
        {chips.length ? (
          <>
            {chips.map((chip) => (
              <span className="search-chip" key={chip.id}>
                <button
                  type="button"
                  className="search-chip-label"
                  title={`Edit ${chip.label} in Filters`}
                  onClick={() => setFiltersOpen(true)}
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
            <button type="button" className="link-button" onClick={clearFilters}>
              Clear all
            </button>
          </>
        ) : (
          <span className="search-workspace-subtitle">
            {scopeLabel(scope)} - name, path, metadata, and indexed contents
          </span>
        )}
      </div>

      <div className={`search-workspace-body ${filtersOpen ? "with-filters" : ""} ${previewOpen ? "with-preview" : ""}`}>
        {filtersOpen ? <SearchFilters /> : null}
        <div className="search-workspace-results">
          {filters.duplicatesOnly ? (
            <DuplicateResults />
          ) : results.length ? (
            <SearchResults hits={results} />
          ) : loading ? (
            <div className="search-workspace-loading" aria-live="polite" aria-busy="true">
              <Icon name="spinner" size={22} className="spin" />
              <h2>Searching {scopeLabel(scope).toLowerCase()}</h2>
              <p>Filename and metadata matches appear first; content, filesystem, and Spotlight results merge as they arrive.</p>
              <div className="search-loading-list">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="search-skeleton-row" key={index}>
                    <span className="search-skeleton-icon" />
                    <span className="search-skeleton-text" style={{ width: `${38 + index * 8}%` }} />
                  </div>
                ))}
              </div>
            </div>
          ) : emptyState ? (
            <div className="search-workspace-empty">
              <Icon name="search" size={36} />
              <h2>Find anything MAXplorer can see</h2>
              <p>
                Search by filename, path, indexed content, metadata, dates, sizes, and file type. Natural-language
                queries become visible, editable filters.
              </p>
              <div className="search-example-row">
                {["invoice March", "PDF modified last week", "large videos over 2GB", "files containing API_KEY"].map((example) => (
                  <button
                    type="button"
                    key={example}
                    className="search-example"
                    onClick={() => {
                      setQuery(example);
                      useSearchStore.getState().runSearchNow();
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>
              {history.length ? (
                <section className="search-workspace-recents">
                  <h3>Recent searches</h3>
                  {history.slice(0, 5).map((entry) => (
                    <button type="button" key={entry.id} className="search-suggestion-row" onClick={() => reuseHistory(entry)}>
                      <Icon name="clock" size={14} />
                      <span className="search-suggestion-text">{entry.query}</span>
                    </button>
                  ))}
                </section>
              ) : null}
              {savedSearches.length ? (
                <section className="search-workspace-recents">
                  <h3>Saved searches</h3>
                  {savedSearches.slice(0, 5).map((search) => (
                    <button type="button" key={search.id} className="search-suggestion-row" onClick={() => runSavedSearch(search)}>
                      <Icon name={search.pinned ? "star" : "search"} size={14} />
                      <span className="search-suggestion-text">{search.name}</span>
                    </button>
                  ))}
                </section>
              ) : null}
              {interpretation?.notes.length ? (
                <div className="search-notes">
                  <Icon name="info" size={13} />
                  <span>{interpretation.notes[0]}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="search-workspace-empty">
              <Icon name="search" size={36} />
              <h2>{error ? "Search couldn't complete" : "No matches"}</h2>
              <p>
                {error ??
                  `Nothing in ${scopeLabel(scope).toLowerCase()} matched this query. Try another scope, remove a filter, or use different words.`}
              </p>
              {stats?.notes.length ? (
                <ul className="search-notes-list">
                  {stats.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              <button type="button" className="search-small-button" onClick={() => openOverlay(query)}>
                <Icon name="search" size={12} />
                Quick Search
              </button>
            </div>
          )}
        </div>
        {previewOpen ? (
          selectedHit ? (
            <SearchPreview hit={selectedHit} />
          ) : (
            <aside className="search-preview search-preview-empty">
              <div className="search-preview-header">
                <span>Preview</span>
                <button type="button" aria-label="Close preview" onClick={() => setPreviewOpen(false)}>
                  <Icon name="close" size={12} />
                </button>
              </div>
              <p className="search-muted">Select a result to preview it without leaving the search results.</p>
            </aside>
          )
        ) : null}
      </div>

      <footer className="search-workspace-footer">
        <span>
          {loading
            ? "Searching..."
            : stats
              ? `${formatCount(stats.total)} ${plural(stats.total, "result")} in ${stats.elapsedMs} ms`
              : "Ready"}
          {stats?.truncated ? " - first results shown" : ""}
        </span>
        <span className="search-coverage">
          {stats?.coverage.length
            ? `${stats.coverage.length} location${stats.coverage.length === 1 ? "" : "s"} covered`
            : indexStatus
              ? `${indexStatus.indexedFiles.toLocaleString()} indexed files`
              : "Index status unavailable"}
          {stats ? ` - ${stats.indexContent.toLocaleString()} with searchable text` : ""}
          {stats?.liveScanned ? ` - ${stats.liveScanned.toLocaleString()} live-scanned` : ""}
          {stats?.spotlightHits ? ` - ${stats.spotlightHits} Spotlight` : ""}
        </span>
        {stats?.notes.length ? (
          <details className="search-footer-notes">
            <summary>{stats.notes.length} coverage note{stats.notes.length === 1 ? "" : "s"}</summary>
            <ul>
              {stats.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {!stats?.ftsAvailable ? <span className="search-footer-warning">Full-text index unavailable</span> : null}
      </footer>
    </div>
  );
}
