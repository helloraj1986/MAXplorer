import { useCallback, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { Icon } from "./Icon";
import { FileGlyph } from "./FileGlyph";
import { HomeView } from "./HomeView";
import { useExplorerStore } from "../state/explorerStore";
import { useVirtualRows } from "../hooks/useVirtualRows";
import { useFileNavigation } from "../hooks/useFileNavigation";
import { useElementSize } from "../hooks/useElementSize";
import { useMarqueeSelection } from "../hooks/useMarqueeSelection";
import { api } from "../lib/api";
import {
  basename,
  displayName,
  formatCount,
  formatDate,
  formatSize,
  parentPath,
  plural,
  typeName,
} from "../lib/format";
import { groupEntries, sortEntries } from "../lib/sort";
import { HOME_LOCATION, type FileEntry, type GroupBy, type SortKey, type ViewMode } from "../lib/types";

interface ColumnDef {
  key: SortKey | "location";
  label: string;
  width: number;
  sortable: boolean;
}

function useSelectionSet(): Set<string> {
  const selection = useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.selection);
  return useMemo(() => new Set(selection ?? []), [selection]);
}

function displayPath(path: string, home: string): string {
  if (home && path === home) return "~";
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  if (home && path.startsWith(`${home}\\`)) return `~${path.slice(home.length)}`;
  return path;
}

function entryTooltip(entry: FileEntry): string {
  const parts = [entry.name, typeName(entry), formatDate(entry.modified), entry.path];
  if (entry.isSymlink && entry.target) parts.splice(2, 0, `Shortcut to ${entry.target}`);
  return parts.filter(Boolean).join("\n");
}

function setDragData(event: React.DragEvent, entry: FileEntry, selection: string[], selected: Set<string>): string[] {
  const paths = selected.has(entry.path) && selection.length ? selection : [entry.path];
  event.dataTransfer.setData("application/x-win11-explorer-paths", JSON.stringify(paths));
  event.dataTransfer.setData("text/plain", paths.join("\n"));
  event.dataTransfer.effectAllowed = "copyMove";
  if (!selected.has(entry.path)) {
    useExplorerStore.getState().setSelection([entry.path], entry.path);
  }
  return paths;
}

function parseDragPaths(event: React.DragEvent): string[] {
  const raw = event.dataTransfer.getData("application/x-win11-explorer-paths");
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function openContextMenu(event: React.MouseEvent, entry: FileEntry, selected: Set<string>): void {
  event.preventDefault();
  event.stopPropagation();
  const store = useExplorerStore.getState();
  if (!selected.has(entry.path)) {
    store.setSelection([entry.path], entry.path);
  }
  store.showContextMenu({ kind: "item", x: event.clientX, y: event.clientY, path: entry.path, isDir: entry.isDir });
}

function openBlankContextMenu(event: React.MouseEvent): void {
  const target = event.target as HTMLElement;
  if (target.closest("[data-path]")) return;
  event.preventDefault();
  const store = useExplorerStore.getState();
  store.clearSelection();
  store.showContextMenu({ kind: "blank", x: event.clientX, y: event.clientY });
}

function ColumnHeader({
  columns,
  sortKey,
  sortDirection,
  onSort,
  onResize,
  innerRef,
}: {
  columns: ColumnDef[];
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  onSort: (key: SortKey) => void;
  onResize: (key: SortKey | "location", width: number) => void;
  innerRef: React.RefObject<HTMLDivElement>;
}) {
  const startResize = (event: React.PointerEvent, column: ColumnDef) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = column.width;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.max(60, startWidth + moveEvent.clientX - startX);
      onResize(column.key, next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="column-header-clip">
      <div
        className="column-header"
        role="row"
        ref={innerRef}
        style={{
          gridTemplateColumns: columns.map((column) => `${column.width}px`).join(" "),
          width: columns.reduce((sum, column) => sum + column.width, 0),
        }}
      >
        {columns.map((column) => (
          <div
            className={`column-cell ${column.sortable ? "sortable" : ""}`}
            key={column.key}
            role="columnheader"
            aria-sort={
              column.sortable && sortKey === column.key
                ? sortDirection === "asc"
                  ? "ascending"
                  : "descending"
                : "none"
            }
          >
            {column.sortable ? (
              <button type="button" className="column-sort" onClick={() => onSort(column.key as SortKey)}>
                <span>{column.label}</span>
                {sortKey === column.key ? (
                  <Icon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} size={12} />
                ) : null}
              </button>
            ) : (
              <span>{column.label}</span>
            )}
            <span
              className="column-resizer"
              role="separator"
              aria-orientation="vertical"
              onPointerDown={(event) => startResize(event, column)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupRow({ label, count, top, width }: { label: string; count: number; top: number; width?: number }) {
  return (
    <div className="group-row" style={{ top, width }}>
      <span className="group-label">{label}</span>
      <span className="group-count">{formatCount(count)}</span>
    </div>
  );
}

function DetailsView({
  entries,
  groups,
  isSearch,
}: {
  entries: FileEntry[];
  groups: ReturnType<typeof groupEntries>;
  isSearch: boolean;
}) {
  const showExtensions = useExplorerStore((state) => state.showExtensions);
  const columnWidths = useExplorerStore((state) => state.columnWidths);
  const sortKey = useExplorerStore((state) => state.sortKey);
  const sortDirection = useExplorerStore((state) => state.sortDirection);
  const setSort = useExplorerStore((state) => state.setSort);
  const setColumnWidth = useExplorerStore((state) => state.setColumnWidth);
  const platform = useExplorerStore((state) => state.platform);
  const clearSelection = useExplorerStore((state) => state.clearSelection);
  const selection = useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.selection ?? []);
  const selected = useSelectionSet();
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const headerInnerRef = useRef<HTMLDivElement>(null);
  const home = platform?.home ?? "";

  const columns: ColumnDef[] = useMemo(
    () => [
      { key: "name", label: "Name", width: columnWidths.name ?? 272, sortable: true },
      { key: "date", label: "Date modified", width: columnWidths.date ?? 144, sortable: true },
      { key: "type", label: "Type", width: columnWidths.type ?? 120, sortable: true },
      { key: "size", label: "Size", width: columnWidths.size ?? 80, sortable: true },
      ...(isSearch
        ? [{ key: "location" as const, label: "Location", width: columnWidths.location ?? 260, sortable: false }]
        : []),
    ],
    [columnWidths, isSearch],
  );
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);

  type Row =
    | { kind: "group"; key: string; height: number; label: string; count: number }
    | { kind: "entry"; key: string; height: number; entry: FileEntry; index: number };

  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    let entryIndex = 0;
    for (const group of groups) {
      if (group.label) {
        result.push({ kind: "group", key: `group-${group.key}`, height: 30, label: group.label, count: group.entries.length });
      }
      for (const entry of group.entries) {
        result.push({ kind: "entry", key: entry.path, height: 31, entry, index: entryIndex });
        entryIndex += 1;
      }
    }
    return result;
  }, [groups]);

  const virtual = useVirtualRows(rows, 8);
  const rowIndexByPath = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.kind === "entry") map.set(row.entry.path, index);
    });
    return map;
  }, [rows]);
  const scrollToPath = useCallback(
    (path: string) => {
      const index = rowIndexByPath.get(path);
      if (index != null) virtual.scrollToIndex(index);
    },
    [rowIndexByPath, virtual],
  );
  const navigation = useFileNavigation({
    entries,
    scrollToPath,
    containerRef: virtual.containerRef,
  });
  const marquee = useMarqueeSelection();

  const handleScroll = () => {
    virtual.onScroll();
    const element = virtual.containerRef.current;
    if (element && headerInnerRef.current) {
      headerInnerRef.current.style.transform = `translateX(-${element.scrollLeft}px)`;
    }
  };

  return (
    <div className="file-view details-view" onKeyDown={navigation.onKeyDown}>
      <ColumnHeader
        columns={columns}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={setSort}
        onResize={setColumnWidth}
        innerRef={headerInnerRef}
      />
      <div
        className="file-scroll"
        ref={virtual.containerRef}
        onScroll={handleScroll}
        onPointerDown={marquee.onPointerDown}
        onContextMenu={openBlankContextMenu}
        tabIndex={0}
        onFocus={navigation.onFocus}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            clearSelection();
            event.currentTarget.focus();
          }
        }}
        aria-label="Files"
        role="grid"
        aria-rowcount={entries.length}
        aria-colcount={columns.length}
      >
        {marquee.rect ? <div className="marquee-box" style={marquee.rect} /> : null}
        <div className="virtual-canvas" style={{ height: Math.max(virtual.totalHeight, 1), width: totalWidth }}>
          {virtual.visibleRows.map(({ row, top }) => {
            if (row.kind === "group") {
              return <GroupRow key={row.key} label={row.label} count={row.count} top={top} width={totalWidth} />;
            }
            const entry = row.entry;
            const isSelected = selected.has(entry.path);
            return (
              <div
                key={row.key}
                className={`details-row ${isSelected ? "selected" : ""} ${entry.isHidden ? "hidden-item" : ""} ${dropTarget === entry.path ? "drop-target" : ""}`}
                style={{ top, width: totalWidth, gridTemplateColumns: columns.map((column) => `${column.width}px`).join(" ") }}
                role="row"
                data-path={entry.path}
                aria-selected={isSelected}
                tabIndex={-1}
                title={entryTooltip(entry)}
                draggable
                onDragStart={(event) => setDragData(event, entry, selection, selected)}
                onDragOver={(event) => {
                  if (entry.isDir && event.dataTransfer.types.includes("application/x-win11-explorer-paths")) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
                    setDropTarget(entry.path);
                  }
                }}
                onDragLeave={() => setDropTarget((value) => (value === entry.path ? null : value))}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropTarget(null);
                  const paths = parseDragPaths(event);
                  if (entry.isDir && paths.length) {
                    void useExplorerStore.getState().moveOrCopyPaths(paths, entry.path, event.altKey ? "copy" : "cut");
                  }
                }}
                onClick={(event) => navigation.handleRowClick(event, entry)}
                onDoubleClick={() => void useExplorerStore.getState().openEntry(entry)}
                onContextMenu={(event) => openContextMenu(event, entry, selected)}
              >
                <div className="details-name">
                  <span className="entry-icon">
                    <FileGlyph entry={entry} size={18} />
                  </span>
                  <span className="entry-name">{displayName(entry, showExtensions)}</span>
                </div>
                <div className="details-text">{formatDate(entry.modified)}</div>
                <div className="details-text">{typeName(entry)}</div>
                <div className="details-text details-size">{entry.isDir ? "" : formatSize(entry.size)}</div>
                {isSearch ? (
                  <div className="details-text details-location">{displayPath(parentPath(entry.path) ?? "", home)}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListView({ entries, groups, isSearch }: { entries: FileEntry[]; groups: ReturnType<typeof groupEntries>; isSearch: boolean }) {
  const showExtensions = useExplorerStore((state) => state.showExtensions);
  const platform = useExplorerStore((state) => state.platform);
  const selection = useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.selection ?? []);
  const selected = useSelectionSet();
  const clearSelection = useExplorerStore((state) => state.clearSelection);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const home = platform?.home ?? "";

  type Row =
    | { kind: "group"; key: string; height: number; label: string; count: number }
    | { kind: "entry"; key: string; height: number; entry: FileEntry; index: number };
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    for (const group of groups) {
      if (group.label) {
        result.push({ kind: "group", key: `group-${group.key}`, height: 28, label: group.label, count: group.entries.length });
      }
      for (const entry of group.entries) {
        result.push({ kind: "entry", key: entry.path, height: 22, entry, index: result.length });
      }
    }
    return result;
  }, [groups]);
  const virtual = useVirtualRows(rows, 8);
  const rowIndexByPath = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.kind === "entry") map.set(row.entry.path, index);
    });
    return map;
  }, [rows]);
  const scrollToPath = useCallback(
    (path: string) => {
      const index = rowIndexByPath.get(path);
      if (index != null) virtual.scrollToIndex(index);
    },
    [rowIndexByPath, virtual],
  );
  const navigation = useFileNavigation({ entries, scrollToPath, containerRef: virtual.containerRef });
  const marquee = useMarqueeSelection();

  return (
    <div className="file-view list-view" onKeyDown={navigation.onKeyDown}>
      <div
        className="file-scroll"
        ref={virtual.containerRef}
        onScroll={virtual.onScroll}
        onPointerDown={marquee.onPointerDown}
        onContextMenu={openBlankContextMenu}
        tabIndex={0}
        onFocus={navigation.onFocus}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            clearSelection();
            event.currentTarget.focus();
          }
        }}
        aria-label="Files"
        role="list"
      >
        {marquee.rect ? <div className="marquee-box" style={marquee.rect} /> : null}
        <div className="virtual-canvas" style={{ height: Math.max(virtual.totalHeight, 1) }}>
          {virtual.visibleRows.map(({ row, top }) => {
            if (row.kind === "group") {
              return <GroupRow key={row.key} label={row.label} count={row.count} top={top} />;
            }
            const entry = row.entry;
            const isSelected = selected.has(entry.path);
            return (
              <div
                key={row.key}
                className={`list-row ${isSelected ? "selected" : ""} ${entry.isHidden ? "hidden-item" : ""} ${dropTarget === entry.path ? "drop-target" : ""}`}
                style={{ top }}
                role="listitem"
                data-path={entry.path}
                aria-selected={isSelected}
                title={entryTooltip(entry)}
                draggable
                onDragStart={(event) => setDragData(event, entry, selection, selected)}
                onDragOver={(event) => {
                  if (entry.isDir && event.dataTransfer.types.includes("application/x-win11-explorer-paths")) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
                    setDropTarget(entry.path);
                  }
                }}
                onDragLeave={() => setDropTarget((value) => (value === entry.path ? null : value))}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropTarget(null);
                  const paths = parseDragPaths(event);
                  if (entry.isDir && paths.length) {
                    void useExplorerStore.getState().moveOrCopyPaths(paths, entry.path, event.altKey ? "copy" : "cut");
                  }
                }}
                onClick={(event) => navigation.handleRowClick(event, entry)}
                onDoubleClick={() => void useExplorerStore.getState().openEntry(entry)}
                onContextMenu={(event) => openContextMenu(event, entry, selected)}
              >
                <span className="entry-icon">
                  <FileGlyph entry={entry} size={16} />
                </span>
                <span className="entry-name">{displayName(entry, showExtensions)}</span>
                {isSearch ? <span className="list-path">{displayPath(parentPath(entry.path) ?? "", home)}</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface GridMetrics {
  cellWidth: number;
  cellHeight: number;
  iconSize: number;
  gapX: number;
  gapY: number;
  mode: "grid" | "tiles" | "content";
}

function metricsFor(mode: ViewMode): GridMetrics {
  switch (mode) {
    case "extraLarge":
      return { cellWidth: 212, cellHeight: 220, iconSize: 160, gapX: 8, gapY: 12, mode: "grid" };
    case "large":
      return { cellWidth: 105, cellHeight: 132, iconSize: 64, gapX: 6, gapY: 16, mode: "grid" };
    case "medium":
      return { cellWidth: 78, cellHeight: 96, iconSize: 40, gapX: 8, gapY: 14, mode: "grid" };
    case "small":
      return { cellWidth: 96, cellHeight: 58, iconSize: 16, gapX: 8, gapY: 8, mode: "grid" };
    case "tiles":
      return { cellWidth: 270, cellHeight: 68, iconSize: 48, gapX: 12, gapY: 10, mode: "tiles" };
    case "content":
      return { cellWidth: 320, cellHeight: 64, iconSize: 32, gapX: 0, gapY: 6, mode: "content" };
    default:
      return { cellWidth: 105, cellHeight: 132, iconSize: 64, gapX: 6, gapY: 16, mode: "grid" };
  }
}

function GridView({ entries, groups, mode }: { entries: FileEntry[]; groups: ReturnType<typeof groupEntries>; mode: ViewMode }) {
  const showExtensions = useExplorerStore((state) => state.showExtensions);
  const selection = useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.selection ?? []);
  const selected = useSelectionSet();
  const clearSelection = useExplorerStore((state) => state.clearSelection);
  const size = useElementSize<HTMLDivElement>();
  const metrics = metricsFor(mode);
  const available = Math.max(0, size.width - 28);
  const columns =
    metrics.mode === "content"
      ? 1
      : Math.max(1, Math.floor((available + metrics.gapX) / (metrics.cellWidth + metrics.gapX)));
  const cellWidth = metrics.mode === "content" ? Math.max(260, available) : metrics.cellWidth;
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  type GridRow =
    | { kind: "group"; key: string; height: number; label: string; count: number }
    | { kind: "items"; key: string; height: number; items: FileEntry[] };

  const rows = useMemo<GridRow[]>(() => {
    const result: GridRow[] = [];
    for (const group of groups) {
      if (group.label) {
        result.push({ kind: "group", key: `group-${group.key}`, height: 30, label: group.label, count: group.entries.length });
      }
      for (let index = 0; index < group.entries.length; index += columns) {
        result.push({
          kind: "items",
          key: `${group.key}-row-${index}`,
          height: metrics.cellHeight + metrics.gapY,
          items: group.entries.slice(index, index + columns),
        });
      }
    }
    return result;
  }, [columns, groups, metrics.cellHeight, metrics.gapY]);

  const virtual = useVirtualRows(rows, 4);
  const rowIndexByPath = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.kind === "items") {
        for (const entry of row.items) map.set(entry.path, index);
      }
    });
    return map;
  }, [rows]);
  const scrollToPath = useCallback(
    (path: string) => {
      const index = rowIndexByPath.get(path);
      if (index != null) virtual.scrollToIndex(index);
    },
    [rowIndexByPath, virtual],
  );
  const navigation = useFileNavigation({
    entries,
    columns,
    scrollToPath,
    containerRef: virtual.containerRef,
  });
  const marquee = useMarqueeSelection();

  return (
    <div className="file-view grid-view" onKeyDown={navigation.onKeyDown} ref={size.ref}>
      <div
        className="file-scroll"
        ref={virtual.containerRef}
        onScroll={virtual.onScroll}
        onPointerDown={marquee.onPointerDown}
        onContextMenu={openBlankContextMenu}
        tabIndex={0}
        onFocus={navigation.onFocus}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            clearSelection();
            event.currentTarget.focus();
          }
        }}
        aria-label="Files"
        role="list"
      >
        {marquee.rect ? <div className="marquee-box" style={marquee.rect} /> : null}
        <div className="virtual-canvas grid-canvas" style={{ height: Math.max(virtual.totalHeight, 1) }}>
          {virtual.visibleRows.map(({ row, top }) => {
            if (row.kind === "group") {
              return <GroupRow key={row.key} label={row.label} count={row.count} top={top} />;
            }
            return (
              <div
                className={`grid-row ${metrics.mode} ${mode}`}
                key={row.key}
                style={{
                  top,
                  paddingLeft: 14,
                  gap: `${metrics.gapY}px ${metrics.gapX}px`,
                  gridTemplateColumns: `repeat(${columns}, ${cellWidth}px)`,
                }}
              >
                {row.items.map((entry) => {
                  const isSelected = selected.has(entry.path);
                  return (
                    <div
                      key={entry.path}
                      className={`grid-item ${metrics.mode} ${mode} ${isSelected ? "selected" : ""} ${entry.isHidden ? "hidden-item" : ""} ${dropTarget === entry.path ? "drop-target" : ""}`}
                      style={{ width: cellWidth, height: metrics.cellHeight }}
                      role="listitem"
                      data-path={entry.path}
                      aria-selected={isSelected}
                      tabIndex={-1}
                      title={entryTooltip(entry)}
                      draggable
                      onDragStart={(event) => setDragData(event, entry, selection, selected)}
                      onDragOver={(event) => {
                        if (entry.isDir && event.dataTransfer.types.includes("application/x-win11-explorer-paths")) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
                          setDropTarget(entry.path);
                        }
                      }}
                      onDragLeave={() => setDropTarget((value) => (value === entry.path ? null : value))}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDropTarget(null);
                        const paths = parseDragPaths(event);
                        if (entry.isDir && paths.length) {
                          void useExplorerStore.getState().moveOrCopyPaths(paths, entry.path, event.altKey ? "copy" : "cut");
                        }
                      }}
                      onClick={(event) => navigation.handleRowClick(event, entry)}
                      onDoubleClick={() => void useExplorerStore.getState().openEntry(entry)}
                      onContextMenu={(event) => openContextMenu(event, entry, selected)}
                    >
                      <span className="grid-icon" style={{ width: metrics.iconSize, height: metrics.iconSize }}>
                        <FileGlyph entry={entry} size={metrics.iconSize} thumbnail={metrics.mode === "grid" || metrics.mode === "tiles"} />
                      </span>
                      <span className="grid-text">
                        <span className="grid-name">{displayName(entry, showExtensions)}</span>
                        {metrics.mode !== "grid" || mode === "small" ? (
                          <>
                            <span className="grid-meta">{typeName(entry)}</span>
                            {!entry.isDir ? <span className="grid-meta">{formatSize(entry.size)}</span> : null}
                            {metrics.mode === "content" ? <span className="grid-meta">{formatDate(entry.modified)}</span> : null}
                          </>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LoadingState({ mode }: { mode: ViewMode }) {
  const rows = Array.from({ length: 9 }, (_, index) => index);
  return (
    <div className="file-area-state loading-state" aria-live="polite" aria-busy="true">
      <div className="loading-header">
        <Icon name="spinner" size={16} className="spin" />
        <span>Loading...</span>
      </div>
      {mode === "details" ? (
        <div className="skeleton-details">
          {rows.map((row) => (
            <div className="skeleton-row" key={row}>
              <span className="skeleton-block icon" />
              <span className="skeleton-block name" style={{ width: `${30 + (row % 4) * 12}%` }} />
              <span className="skeleton-block date" />
              <span className="skeleton-block type" />
              <span className="skeleton-block size" />
            </div>
          ))}
        </div>
      ) : (
        <div className={`skeleton-grid ${mode}`}>
          {rows.concat(rows).map((row, index) => (
            <span className="skeleton-tile" key={`${row}-${index}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ search, query }: { search: boolean; query: string }) {
  return (
    <div className="file-area-state empty-state">
      <div className="empty-icon">
        <Icon name={search ? "search" : "folder"} size={42} />
      </div>
      <h2>{search ? "No items match your search" : "This folder is empty"}</h2>
      <p>
        {search
          ? `No files or folders match "${query}". Try a different search term.`
          : "Drag files here, or use New to create something in this folder."}
      </p>
      {search ? (
        <button type="button" className="state-button" onClick={() => useExplorerStore.getState().clearSearch()}>
          Clear search
        </button>
      ) : (
        <button type="button" className="state-button" onClick={() => void useExplorerStore.getState().promptNewFolder()}>
          <Icon name="folder" size={14} />
          New folder
        </button>
      )}
    </div>
  );
}

function ErrorState() {
  const tab = useExplorerStore((state) => state.tabs.find((item) => item.id === state.activeTabId));
  const refresh = useExplorerStore((state) => state.refresh);
  const revealSelection = useExplorerStore((state) => state.revealSelection);
  const error = tab?.error;
  const permission = error?.code === "permission_denied";
  return (
    <div className="file-area-state error-state">
      <div className="error-icon">
        <Icon name={permission ? "lock" : "warning"} size={38} />
      </div>
      <h2>{permission ? "You don't have permission to access this folder" : "We can't open this location"}</h2>
      <p>{error?.message ?? "The location is unavailable."}</p>
      {error?.path ? <code className="error-path">{error.path}</code> : null}
      <div className="state-actions">
        <button type="button" className="state-button primary" onClick={() => void refresh()}>
          <Icon name="refresh" size={14} />
          Try again
        </button>
        {permission ? (
          <button
            type="button"
            className="state-button"
            onClick={() => {
              void api.openSystemSettings("files").catch((cause) => useExplorerStore.getState().toastError(cause));
            }}
          >
            <Icon name="settings" size={14} />
            Open System Settings
          </button>
        ) : (
          <button type="button" className="state-button" onClick={() => void revealSelection()}>
            <Icon name="open" size={14} />
            Show in Finder
          </button>
        )}
      </div>
    </div>
  );
}

export function FileArea() {
  const activeTab = useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const viewMode = useExplorerStore((state) => state.viewMode);
  const sortKey = useExplorerStore((state) => state.sortKey);
  const sortDirection = useExplorerStore((state) => state.sortDirection);
  const groupBy = useExplorerStore((state) => state.groupBy);
  const detailsPane = useExplorerStore((state) => state.detailsPane);
  const clearSearch = useExplorerStore((state) => state.clearSearch);
  const refresh = useExplorerStore((state) => state.refresh);

  const isHome = activeTab?.location === HOME_LOCATION;
  const isSearch = activeTab?.searchResults != null;
  const isSearchLoading = Boolean(activeTab?.searchLoading && activeTab?.searchQuery);
  const baseEntries = isSearch ? activeTab?.searchResults ?? [] : activeTab?.entries ?? [];
  const sorted = useMemo(
    () => sortEntries(baseEntries, sortKey, sortDirection),
    [baseEntries, sortKey, sortDirection],
  );
  const groups = useMemo(() => groupEntries(sorted, groupBy), [groupBy, sorted]);

  if (isHome && !isSearch) {
    return <HomeView />;
  }

  if (activeTab?.loading && !activeTab.entries.length) {
    return <LoadingState mode={viewMode} />;
  }

  if (isSearchLoading && activeTab?.searchResults == null) {
    return <LoadingState mode={viewMode} />;
  }

  if (activeTab?.error) {
    return <ErrorState />;
  }

  return (
    <div className={`content-area ${detailsPane ? "with-details" : ""}`} onContextMenu={openBlankContextMenu}>
      {isSearch ? (
        <div className="search-summary">
          <span>
            Search results for <strong>"{activeTab?.searchQuery}"</strong>
            <span className="search-summary-count">
              {" "}
              - {formatCount(baseEntries.length)} {plural(baseEntries.length, "item")}
              {activeTab?.searchTruncated ? " (first results)" : ""}
            </span>
          </span>
          <button type="button" className="search-summary-clear" onClick={clearSearch}>
            <Icon name="close" size={10} />
            Clear
          </button>
        </div>
      ) : null}
      {activeTab?.truncated ? (
        <div className="truncation-banner">
          <Icon name="warning" size={14} />
          Some items are not shown because this folder is very large.
          <button type="button" className="link-button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      ) : null}
      {activeTab?.readErrors ? (
        <div className="truncation-banner">
          <Icon name="warning" size={14} />
          {activeTab.readErrors} {plural(activeTab.readErrors, "item")} couldn't be read because of a permissions or filesystem error.
        </div>
      ) : null}
      {baseEntries.length === 0 ? (
        <EmptyState search={isSearch} query={activeTab?.searchQuery ?? ""} />
      ) : viewMode === "details" ? (
        <DetailsView entries={sorted} groups={groups} isSearch={isSearch} />
      ) : viewMode === "list" ? (
        <ListView entries={sorted} groups={groups} isSearch={isSearch} />
      ) : (
        <GridView entries={sorted} groups={groups} mode={viewMode} />
      )}
    </div>
  );
}
