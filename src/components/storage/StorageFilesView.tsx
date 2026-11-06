import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { useStorageStore } from "../../state/storageStore";
import { formatCount, formatDate, formatSize, parentPath } from "../../lib/format";
import { pickFromFile } from "../../lib/storage/selection";
import {
  CATEGORY_LABELS,
  DEFAULT_STORAGE_FILE_QUERY,
  FILE_TYPE_LABELS,
  categoryColor,
  storageFileEntry,
  type StorageFile,
  type StorageSort,
} from "../../lib/storage/types";

const SIZE_THRESHOLDS = [
  { label: "Any size", value: null },
  { label: "> 100 MB", value: 100 * 1024 * 1024 },
  { label: "> 500 MB", value: 500 * 1024 * 1024 },
  { label: "> 1 GB", value: 1024 * 1024 * 1024 },
  { label: "> 5 GB", value: 5 * 1024 * 1024 * 1024 },
];

const MAX_SIZE_THRESHOLDS = [
  { label: "No maximum", value: null },
  { label: "< 100 MB", value: 100 * 1024 * 1024 },
  { label: "< 500 MB", value: 500 * 1024 * 1024 },
  { label: "< 1 GB", value: 1024 * 1024 * 1024 },
  { label: "< 5 GB", value: 5 * 1024 * 1024 * 1024 },
];

function dateValue(value: number | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timestamp(value: string): number | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

const closeRowMenu = (event: MouseEvent<HTMLButtonElement>, run: () => void) => {
  event.stopPropagation();
  event.currentTarget.closest("details")?.removeAttribute("open");
  run();
};

function FileRow({ file }: { file: StorageFile }) {
  const selectedFile = useStorageStore((state) => state.selectedFile);
  const selectFile = useStorageStore((state) => state.selectFile);
  const picks = useStorageStore((state) => state.picks);
  const togglePick = useStorageStore((state) => state.togglePick);
  const revealInMaxplorer = useStorageStore((state) => state.revealInMaxplorer);
  const revealInFinder = useStorageStore((state) => state.revealInFinder);
  const openFile = useStorageStore((state) => state.openFile);
  const openProperties = useStorageStore((state) => state.openProperties);
  const selected = selectedFile?.path === file.path;
  const picked = picks.some((pick) => pick.path === file.path);
  return (
    <tr
      className={`storage-table-row ${selected ? "selected" : ""}`}
      tabIndex={0}
      aria-selected={selected}
      onClick={() => selectFile(file)}
      onKeyDown={(event) => {
        if (event.key === "Enter") selectFile(file);
        if (event.key === " ") {
          event.preventDefault();
          togglePick(pickFromFile(file));
        }
      }}
    >
      <td className="storage-check-cell">
        <button
          type="button"
          className={`storage-check ${picked ? "checked" : ""}`}
          aria-pressed={picked}
          aria-label={picked ? `Remove ${file.name} from cleanup selection` : `Add ${file.name} to cleanup selection`}
          onClick={(event) => {
            event.stopPropagation();
            togglePick(pickFromFile(file));
          }}
        >
          {picked ? <Icon name="check" size={12} /> : null}
        </button>
      </td>
      <td>
        <span className="storage-name-cell">
          <FileTypeIcon entry={storageFileEntry(file)} size={19} />
          <span className="storage-name-text" title={file.path}>{file.name}</span>
          {file.isHidden ? <span className="storage-pill">Hidden</span> : null}
          {file.isSymlink ? <span className="storage-pill">Symlink</span> : null}
          {file.cloudPlaceholder ? <span className="storage-pill">Cloud</span> : null}
          {file.isProtected ? <span className="storage-pill">Protected</span> : null}
          {file.isReadOnly ? <span className="storage-pill">Read-only</span> : null}
        </span>
      </td>
      <td className="storage-path-cell" title={file.path}>{parentPath(file.path) ?? file.path}</td>
      <td><span className="storage-category-chip" style={{ borderColor: categoryColor(file.category) }}><span style={{ background: categoryColor(file.category) }} />{CATEGORY_LABELS[file.category] ?? file.category}</span></td>
      <td className="storage-number"><strong>{formatSize(file.size)}</strong></td>
      <td className="storage-number storage-muted">{formatSize(file.allocated)}</td>
      <td className="storage-date">{formatDate(file.modified)}</td>
      <td className="storage-row-actions">
        <details className="storage-row-menu">
          <summary
            className="storage-icon-button"
            title="Actions"
            aria-label={`Actions for ${file.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Icon name="chevronDown" size={12} />
          </summary>
          <div className="storage-row-menu-items" role="group" aria-label={`Actions for ${file.name}`}>
            <button type="button" onClick={(event) => closeRowMenu(event, () => void revealInMaxplorer(file.path))}>Reveal in MAXplorer</button>
            <button type="button" onClick={(event) => closeRowMenu(event, () => void revealInFinder(file.path))}>Reveal in Finder</button>
            <button type="button" onClick={(event) => closeRowMenu(event, () => void openFile(file.path))}>Open</button>
            <button type="button" onClick={(event) => closeRowMenu(event, () => void openProperties(file.path))}>Properties</button>
          </div>
        </details>
      </td>
    </tr>
  );
}

export function StorageFilesView() {
  const scan = useStorageStore((state) => state.scan);
  const scope = useStorageStore((state) => state.fileScope);
  const query = useStorageStore((state) => state.fileQuery);
  const page = useStorageStore((state) => state.filePage);
  const loading = useStorageStore((state) => state.filesLoading);
  const error = useStorageStore((state) => state.fileError);
  const loadFiles = useStorageStore((state) => state.loadFiles);
  const loadMoreFiles = useStorageStore((state) => state.loadMoreFiles);
  const selectVisibleFiles = useStorageStore((state) => state.selectVisibleFiles);
  const selectAllFilteredFiles = useStorageStore((state) => state.selectAllFilteredFiles);
  const openCategory = useStorageStore((state) => state.openCategory);
  const [name, setName] = useState(query.name ?? "");
  const [directory, setDirectory] = useState(query.directory ?? "");

  useEffect(() => {
    setName(query.name ?? "");
  }, [query.name]);

  useEffect(() => {
    setDirectory(query.directory ?? "");
  }, [query.directory]);

  useEffect(() => {
    if (!page && scan && !loading) void loadFiles();
  }, [page, scan, loading, loadFiles]);

  const categories = useMemo(() => {
    if (!scan) return [];
    return scan.categories.map((category) => ({ id: category.id, label: category.label }));
  }, [scan]);

  const types = useMemo(() => {
    if (!scan) return [];
    return scan.fileTypes.map((type) => ({ id: type.id, label: type.label }));
  }, [scan]);

  if (!scan) return null;

  const applyFilter = (patch: Partial<typeof query>) => {
    void loadFiles({ ...patch, offset: 0 });
  };

  return (
    <div className="storage-files-view">
      <section className="storage-card storage-view-header">
        <div>
          <span className="storage-eyebrow">{scope.kind === "largest" ? "Deep analysis" : "Filtered view"}</span>
          <h2>{scope.label}</h2>
          <p>
            {page
              ? `${formatCount(page.total)} results · ${formatSize(page.totalBytes)} total logical size. Sorted by ${query.sort}${query.direction === "asc" ? " ascending" : " descending"}.`
              : "Preparing file index..."}
          </p>
        </div>
        <div className="storage-view-actions">
          <button type="button" className="storage-toolbar-button" onClick={selectVisibleFiles} disabled={!page?.files.length}>
            <Icon name="check" size={13} />
            Select visible
          </button>
          <button type="button" className="storage-toolbar-button" onClick={() => void selectAllFilteredFiles()} disabled={!page?.total}>
            <Icon name="checkCircle" size={13} />
            Select all filtered
          </button>
        </div>
      </section>

      <section className="storage-card storage-filter-card" aria-label="File filters">
        <label className="storage-field storage-field-grow">
          <span>Name contains</span>
          <input
            value={name}
            placeholder="Filter by file or folder name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFilter({ name: name.trim() || null });
              if (event.key === "Escape") {
                setName("");
                applyFilter({ name: null });
              }
            }}
          />
        </label>
        <label className="storage-field storage-field-grow">
          <span>Directory contains</span>
          <input
            value={directory}
            placeholder="Absolute folder path (optional)"
            onChange={(event) => setDirectory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                applyFilter({
                  directory: directory.trim() || null,
                  recursive: Boolean(directory.trim()),
                });
              }
              if (event.key === "Escape") {
                setDirectory("");
                applyFilter({ directory: null, recursive: false });
              }
            }}
          />
        </label>
        <label className="storage-field">
          <span>Minimum size</span>
          <select
            value={String(query.minSize ?? "")}
            onChange={(event) => applyFilter({ minSize: event.target.value ? Number(event.target.value) : null })}
          >
            {SIZE_THRESHOLDS.map((option) => (
              <option key={option.label} value={option.value ?? ""}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="storage-field">
          <span>Maximum size</span>
          <select
            value={String(query.maxSize ?? "")}
            onChange={(event) => applyFilter({ maxSize: event.target.value ? Number(event.target.value) : null })}
          >
            {MAX_SIZE_THRESHOLDS.map((option) => (
              <option key={option.label} value={option.value ?? ""}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="storage-field">
          <span>Modified after</span>
          <input
            type="date"
            value={dateValue(query.modifiedAfter)}
            onChange={(event) => applyFilter({ modifiedAfter: timestamp(event.target.value) })}
          />
        </label>
        <label className="storage-field">
          <span>Modified before</span>
          <input
            type="date"
            value={dateValue(query.modifiedBefore)}
            onChange={(event) => applyFilter({ modifiedBefore: timestamp(event.target.value) })}
          />
        </label>
        <label className="storage-field">
          <span>Created after</span>
          <input
            type="date"
            value={dateValue(query.createdAfter)}
            onChange={(event) => applyFilter({ createdAfter: timestamp(event.target.value) })}
          />
        </label>
        <label className="storage-field">
          <span>Created before</span>
          <input
            type="date"
            value={dateValue(query.createdBefore)}
            onChange={(event) => applyFilter({ createdBefore: timestamp(event.target.value) })}
          />
        </label>
        <label className="storage-field">
          <span>Category</span>
          <select value={query.category ?? ""} onChange={(event) => applyFilter({ category: event.target.value || null })}>
            <option value="">All categories</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
          </select>
        </label>
        <label className="storage-field">
          <span>File type</span>
          <select value={query.fileType ?? ""} onChange={(event) => applyFilter({ fileType: event.target.value || null })}>
            <option value="">All types</option>
            {types.map((type) => <option key={type.id} value={type.id}>{FILE_TYPE_LABELS[type.id] ?? type.label}</option>)}
          </select>
        </label>
        <label className="storage-field">
          <span>Hidden</span>
          <select
            value={query.hidden == null ? "all" : query.hidden ? "only" : "exclude"}
            onChange={(event) => applyFilter({ hidden: event.target.value === "all" ? null : event.target.value === "only" })}
          >
            <option value="all">Include</option>
            <option value="exclude">Exclude</option>
            <option value="only">Only hidden</option>
          </select>
        </label>
        <label className="storage-field">
          <span>Sort</span>
          <select
            value={query.sort}
            onChange={(event) => applyFilter({ sort: event.target.value as StorageSort })}
          >
            <option value="size">Size</option>
            <option value="name">Name</option>
            <option value="modified">Modified</option>
            <option value="created">Created</option>
            <option value="type">Type</option>
            <option value="path">Path</option>
          </select>
        </label>
        <button
          type="button"
          className="storage-toolbar-button"
          onClick={() => applyFilter({ direction: query.direction === "asc" ? "desc" : "asc" })}
          title={query.direction === "asc" ? "Sort descending" : "Sort ascending"}
        >
          <Icon name={query.direction === "asc" ? "sortAsc" : "sortDesc"} size={13} />
          {query.direction === "asc" ? "Ascending" : "Descending"}
        </button>
        <button
          type="button"
          className="storage-toolbar-button"
          onClick={() => {
            setName("");
            setDirectory("");
            void loadFiles({
              ...DEFAULT_STORAGE_FILE_QUERY,
              category: scope.kind === "category" ? scope.category ?? null : null,
              fileType: scope.kind === "type" ? scope.fileType ?? null : null,
              minSize: scope.minSize ?? null,
            });
          }}
        >
          <Icon name="undo" size={13} />
          Reset
        </button>
      </section>

      {scope.kind === "category" && scope.category && query.category === scope.category ? (
        <div className="storage-scope-banner">
          <span className="storage-legend-dot" style={{ background: categoryColor(scope.category) }} />
          <span><strong>{CATEGORY_LABELS[scope.category] ?? scope.label}</strong> files sorted by size. Every file belongs to one category.</span>
          <button type="button" className="link-button" onClick={() => void openCategory(scope.category ?? "other", CATEGORY_LABELS[scope.category ?? "other"] ?? scope.label)}>
            Reapply category filter
          </button>
        </div>
      ) : null}

      <section className="storage-card storage-table-card">
        {error ? (
          <div className="storage-error-banner" role="alert"><Icon name="warning" size={14} /><span>{error}</span><button type="button" className="link-button" onClick={() => void loadFiles()}>Retry</button></div>
        ) : null}
        {loading && !page ? (
          <div className="storage-loading"><Icon name="spinner" size={18} className="spin" /> Querying scanned files...</div>
        ) : page?.files.length ? (
          <>
            <div className="storage-table-scroll">
              <table className="storage-table storage-files-table">
                <thead>
                  <tr>
                    <th className="storage-check-cell"><span className="storage-visually-hidden">Select</span></th>
                    <th>Name</th>
                    <th>Location</th>
                    <th>Category</th>
                    <th className="storage-number">Logical size</th>
                    <th className="storage-number">Allocated</th>
                    <th>Modified</th>
                    <th className="storage-number">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {page.files.map((file) => <FileRow file={file} key={file.path} />)}
                </tbody>
              </table>
            </div>
            <footer className="storage-table-footer">
              <span>{formatCount(page.files.length)} of {formatCount(page.total)} results shown</span>
              {page.hasMore ? (
                <button type="button" className="storage-toolbar-button" onClick={() => void loadMoreFiles()} disabled={loading}>
                  <Icon name={loading ? "spinner" : "chevronDown"} size={13} className={loading ? "spin" : ""} />
                  Load more
                </button>
              ) : null}
            </footer>
          </>
        ) : (
          <div className="storage-inline-empty">
            <Icon name="file" size={30} />
            <h3>No files match these filters</h3>
            <p>Try another minimum size, clear a category filter, or rescan a narrower folder. Analysis filters do not alter your global search.</p>
            <button type="button" className="storage-toolbar-button" onClick={() => void loadFiles({ ...DEFAULT_STORAGE_FILE_QUERY, minSize: null })}>
              Clear filters
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
