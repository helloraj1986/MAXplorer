import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { useElementSize } from "../../hooks/useElementSize";
import { useStorageStore } from "../../state/storageStore";
import { basename, formatSize } from "../../lib/format";
import { categoryColor, type StorageChildren } from "../../lib/storage/types";
import { layoutTreemap, treemapHitTest, type TreemapRect } from "../../lib/storage/treemap";

const DIRECTORY_COLORS = ["#4f8ef7", "#34c759", "#ff9f0a", "#af52de", "#64d2ff", "#ff6482", "#f2b84b", "#5ac8fa"];

interface CanvasItem extends TreemapRect {
  path: string;
  isDirectory: boolean;
  color: string;
}

function crumbs(path: string, root: string, rootLabel: string): Array<{ label: string; path: string }> {
  if (path === root) return [{ label: rootLabel, path: root }];
  const relative = path.startsWith(root) ? path.slice(root.length) : path;
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  const output = [{ label: rootLabel, path: root }];
  let current = root.replace(/[\\/]+$/, "");
  for (const part of parts) {
    current = `${current}/${part}`;
    output.push({ label: part, path: current });
  }
  return output;
}

function readableText(color: string): string {
  const value = color.replace("#", "");
  if (value.length !== 6) return "#ffffff";
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#111111" : "#ffffff";
}

export function StorageTreemap() {
  const scan = useStorageStore((state) => state.scan);
  const treePath = useStorageStore((state) => state.treePath);
  const childrenByPath = useStorageStore((state) => state.childrenByPath);
  const childrenLoading = useStorageStore((state) => state.childrenLoading);
  const loadChildren = useStorageStore((state) => state.loadChildren);
  const openDirectory = useStorageStore((state) => state.openDirectory);
  const returnToParent = useStorageStore((state) => state.returnToParent);
  const selectFile = useStorageStore((state) => state.selectFile);
  const selectedFile = useStorageStore((state) => state.selectedFile);
  const volume = useStorageStore((state) => state.volumes.find((item) => item.mountPoint === state.selectedVolumePath));
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<CanvasItem | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (treePath && !childrenByPath[treePath] && !childrenLoading) {
      void loadChildren(treePath);
    }
  }, [treePath, childrenByPath, childrenLoading, loadChildren]);

  const path = treePath ?? scan?.root ?? null;
  const children: StorageChildren | null = path ? childrenByPath[path] ?? null : null;

  const items = useMemo<CanvasItem[]>(() => {
    if (!children) return [];
    const payload = [
      ...children.directories.map((directory, index) => ({
        id: directory.path,
        label: directory.name,
        size: directory.size,
        path: directory.path,
        isDirectory: true,
        color: DIRECTORY_COLORS[index % DIRECTORY_COLORS.length],
      })),
      ...children.files.map((file) => ({
        id: file.path,
        label: file.name,
        size: file.size,
        path: file.path,
        isDirectory: false,
        color: categoryColor(file.category),
      })),
    ].filter((item) => item.size > 0);
    return layoutTreemap(payload, Math.max(1, width), Math.max(1, height)).map((rect) => {
      const original = payload.find((item) => item.id === rect.id);
      return {
        ...rect,
        path: original?.path ?? rect.id,
        isDirectory: original?.isDirectory ?? false,
        color: original?.color ?? DIRECTORY_COLORS[0],
      };
    });
  }, [children, width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.textBaseline = "top";
    for (const [index, rect] of items.entries()) {
      context.fillStyle = rect.color;
      context.globalAlpha = index === activeIndex || rect.path === hovered?.path ? 1 : 0.88;
      context.fillRect(rect.x, rect.y, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1));
      context.globalAlpha = 1;
      if (rect.width > 64 && rect.height > 24) {
        context.fillStyle = readableText(rect.color);
        const label = rect.label.length > Math.floor(rect.width / 6.4)
          ? `${rect.label.slice(0, Math.max(4, Math.floor(rect.width / 6.4) - 1))}…`
          : rect.label;
        context.fillText(label, rect.x + 5, rect.y + 4);
        if (rect.height > 40) {
          context.globalAlpha = 0.78;
          context.fillText(formatSize(rect.size), rect.x + 5, rect.y + 20);
          context.globalAlpha = 1;
        }
      }
    }
  }, [items, width, height, hovered, activeIndex]);

  if (!scan) return null;
  if (!path) return null;

  const breadcrumbItems = crumbs(path, scan.root, volume?.name ?? basename(scan.root) ?? scan.root);

  const activate = (item: CanvasItem | undefined) => {
    if (!item) return;
    if (item.isDirectory) {
      void openDirectory(item.path);
      setActiveIndex(-1);
    } else {
      const file = children?.files.find((entry) => entry.path === item.path);
      if (file) selectFile(file);
    }
  };

  return (
    <div className="storage-treemap-view">
      <section className="storage-card storage-tree-header">
        <div className="storage-breadcrumbs" aria-label="Treemap breadcrumb">
          {breadcrumbItems.map((crumb, index) => (
            <Fragment key={crumb.path}>
              {index > 0 ? <Icon name="chevronRight" size={10} /> : null}
              <button type="button" className={crumb.path === path ? "current" : ""} onClick={() => void loadChildren(crumb.path)}>
                {crumb.label}
              </button>
            </Fragment>
          ))}
        </div>
        <div className="storage-tree-summary">
          <div>
            <h2>{children?.directory.name ?? basename(path)}</h2>
            <p>
              {children
                ? `${formatSize(children.totalSize)} · ${children.directories.length} folders · ${children.files.length} files shown directly`
                : "Loading treemap..."}
            </p>
          </div>
          <div className="storage-tree-actions">
            <button type="button" className="storage-toolbar-button" onClick={() => void returnToParent()} disabled={path === scan.root}>
              <Icon name="up" size={13} />
              Up
            </button>
            <button type="button" className="storage-toolbar-button" onClick={() => void loadChildren(path)}>
              <Icon name="refresh" size={13} />
              Reload
            </button>
          </div>
        </div>
        <p className="storage-muted">
          Rectangle area is proportional to size. Click a folder to drill in, or select a file to inspect it. The canvas keeps
          thousands of files out of the DOM.
        </p>
      </section>

      <section className="storage-card storage-treemap-card">
        <div className="storage-treemap-wrap" ref={ref}>
          {childrenLoading && !children ? (
            <div className="storage-loading"><Icon name="spinner" size={18} className="spin" /> Loading treemap...</div>
          ) : items.length ? (
            <>
              <canvas
                ref={canvasRef}
                className="storage-treemap-canvas"
                style={{ width: "100%", height: "100%" }}
                tabIndex={0}
                role="img"
                aria-label={`Treemap of ${children?.directory.name ?? path}. Use arrow keys to move between regions and Enter to open a folder or select a file.`}
                onPointerMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const hit = treemapHitTest(items, event.clientX - rect.left, event.clientY - rect.top);
                  setHovered(hit ? items.find((item) => item.id === hit.id) ?? null : null);
                }}
                onPointerLeave={() => setHovered(null)}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const hit = treemapHitTest(items, event.clientX - rect.left, event.clientY - rect.top);
                  activate(items.find((item) => item.id === hit?.id));
                }}
                onKeyDown={(event) => {
                  if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
                    event.preventDefault();
                    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
                    setActiveIndex((index) => {
                      const next = (index + direction + items.length) % items.length;
                      setHovered(items[next]);
                      return next;
                    });
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    activate(items[activeIndex] ?? items[0]);
                  }
                }}
              />
              {hovered ? (
                <div className="storage-treemap-tooltip" role="status">
                  <strong>{hovered.label}</strong>
                  <span>{formatSize(hovered.size)}</span>
                  <small>{hovered.isDirectory ? "Folder · click to drill in" : "File · click to inspect"}</small>
                  <span className="storage-path">{hovered.path}</span>
                </div>
              ) : null}
            </>
          ) : (
            <div className="storage-inline-empty">
              <Icon name="grid" size={30} />
              <h3>No measurable files here</h3>
              <p>This folder is empty, or every child has zero size. Choose another folder from the breadcrumb.</p>
            </div>
          )}
        </div>
      </section>

      <section className="storage-card storage-treemap-list">
        <header className="storage-card-head">
          <div>
            <h2>Accessible region list</h2>
            <p>An equivalent keyboard- and screen-reader-friendly representation of the treemap.</p>
          </div>
        </header>
        <div className="storage-treemap-items">
          {items.slice(0, 40).map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={index === activeIndex ? "active" : ""}
              style={{ borderLeftColor: item.color }}
              onClick={() => activate(item)}
            >
              <span>{item.label}</span>
              <small>{item.isDirectory ? "Folder" : "File"} · {formatSize(item.size)}</small>
            </button>
          ))}
        </div>
        {selectedFile ? <p className="storage-muted">Selected file: {selectedFile.path}</p> : null}
      </section>
    </div>
  );
}
