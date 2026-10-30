import { Fragment, useEffect, useState } from "react";
import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { useStorageStore } from "../../state/storageStore";
import { api } from "../../lib/api";
import { basename, formatCount, formatDate, formatSize, parentPath } from "../../lib/format";
import { pickFromDirectory, pickFromFile } from "../../lib/storage/selection";
import {
  storageDirectoryEntry,
  storageFileEntry,
  type StorageChildren,
  type StorageDirectory,
  type StorageFile,
} from "../../lib/storage/types";

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

function PickCheck({ path, pick }: { path: string; pick: ReturnType<typeof pickFromFile> | ReturnType<typeof pickFromDirectory> }) {
  const picks = useStorageStore((state) => state.picks);
  const togglePick = useStorageStore((state) => state.togglePick);
  const selected = picks.some((item) => item.path === path);
  return (
    <button
      type="button"
      className={`storage-check ${selected ? "checked" : ""}`}
      aria-pressed={selected}
      aria-label={selected ? `Remove ${path} from cleanup selection` : `Add ${path} to cleanup selection`}
      onClick={(event) => {
        event.stopPropagation();
        togglePick(pick);
      }}
    >
      {selected ? <Icon name="check" size={12} /> : null}
    </button>
  );
}

function FileRow({
  file,
  depth,
  total,
}: {
  file: StorageFile;
  depth: number;
  total: number;
}) {
  const selectFile = useStorageStore((state) => state.selectFile);
  const selectedFile = useStorageStore((state) => state.selectedFile);
  const openFile = useStorageStore((state) => state.openFile);
  const revealInFinder = useStorageStore((state) => state.revealInFinder);
  const selected = selectedFile?.path === file.path;
  return (
    <tr
      className={`storage-table-row ${selected ? "selected" : ""}`}
      tabIndex={0}
      aria-selected={selected}
      onClick={() => selectFile(file)}
      onDoubleClick={() => void openFile(file.path)}
      onKeyDown={(event) => {
        if (event.key === "Enter") selectFile(file);
        if (event.key === " ") {
          event.preventDefault();
          useStorageStore.getState().togglePick(pickFromFile(file));
        }
      }}
    >
      <td className="storage-check-cell" style={{ paddingLeft: 10 + depth * 18 }}>
        <PickCheck path={file.path} pick={pickFromFile(file)} />
      </td>
      <td>
        <span className="storage-name-cell">
          <FileTypeIcon entry={storageFileEntry(file)} size={18} />
          <span className="storage-name-text" title={file.path}>{file.name}</span>
          {file.isHidden ? <span className="storage-pill">Hidden</span> : null}
          {file.isSymlink ? <span className="storage-pill">Symlink</span> : null}
          {file.hardLink ? <span className="storage-pill">Hard link</span> : null}
          {file.cloudPlaceholder ? <span className="storage-pill">Cloud placeholder</span> : null}
          {file.isProtected ? <span className="storage-pill">Protected</span> : null}
          {file.isReadOnly ? <span className="storage-pill">Read-only</span> : null}
        </span>
      </td>
      <td className="storage-number">{formatSize(file.size)}</td>
      <td className="storage-number storage-muted">{formatSize(file.allocated)}</td>
      <td className="storage-number">{file.size >= 1_048_576 && total > 0 ? `${((file.size / total) * 100).toFixed(1)}%` : ""}</td>
      <td className="storage-number">—</td>
      <td className="storage-number">—</td>
      <td className="storage-date">{formatDate(file.modified)}</td>
      <td className="storage-row-actions">
        <button type="button" className="storage-icon-button" title="Reveal in Finder" aria-label={`Reveal ${file.name} in Finder`} onClick={(event) => { event.stopPropagation(); void revealInFinder(file.path); }}>
          <Icon name="open" size={12} />
        </button>
      </td>
    </tr>
  );
}

function DirectoryRow({
  directory,
  depth,
  total,
}: {
  directory: StorageDirectory;
  depth: number;
  total: number;
}) {
  const scan = useStorageStore((state) => state.scan);
  const openDirectory = useStorageStore((state) => state.openDirectory);
  const selectedDirectory = useStorageStore((state) => state.selectedDirectory);
  const selectDirectory = useStorageStore((state) => state.selectDirectory);
  const revealInFinder = useStorageStore((state) => state.revealInFinder);
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<StorageChildren | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = selectedDirectory?.path === directory.path;

  const toggleExpanded = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (children || !scan) return;
    setLoading(true);
    try {
      const result = await api.getStorageChildren(scan.scanId, directory.path, 1_000);
      setChildren(result);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This folder could not be expanded.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Fragment>
      <tr
        className={`storage-table-row ${selected ? "selected" : ""}`}
        tabIndex={0}
        aria-selected={selected}
        onClick={() => selectDirectory(directory)}
        onDoubleClick={() => void openDirectory(directory.path)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void openDirectory(directory.path);
          if (event.key === " ") {
            event.preventDefault();
            useStorageStore.getState().togglePick(pickFromDirectory(directory));
          }
        }}
      >
        <td className="storage-check-cell" style={{ paddingLeft: 6 + depth * 18 }}>
          <button
            type="button"
            className={`storage-expander ${expanded ? "expanded" : ""}`}
            aria-label={expanded ? `Collapse ${directory.name}` : `Expand ${directory.name}`}
            aria-expanded={expanded}
            disabled={directory.directFolders + directory.directFiles === 0}
            onClick={(event) => {
              event.stopPropagation();
              void toggleExpanded();
            }}
          >
            <Icon name="chevronRight" size={11} />
          </button>
          <PickCheck path={directory.path} pick={pickFromDirectory(directory)} />
        </td>
        <td>
          <span className="storage-name-cell">
            <button
              type="button"
              className="storage-directory-link"
              onClick={(event) => {
                event.stopPropagation();
                void openDirectory(directory.path);
              }}
            >
              <FileTypeIcon entry={storageDirectoryEntry(directory)} size={18} />
              <span className="storage-name-text" title={directory.path}>{directory.name}</span>
            </button>
            {directory.isPackage ? <span className="storage-pill">Package</span> : null}
            {directory.isProtected ? <span className="storage-pill">Protected</span> : null}
            {directory.isReadOnly ? <span className="storage-pill">Read-only</span> : null}
          </span>
        </td>
        <td className="storage-number"><strong>{formatSize(directory.size)}</strong></td>
        <td className="storage-number storage-muted">{formatSize(directory.allocated)}</td>
        <td className="storage-number">{formatCount(directory.files)}</td>
        <td className="storage-number">{formatCount(directory.folders)}</td>
        <td className="storage-number">{directory.largestFileSize ? formatSize(directory.largestFileSize) : "—"}</td>
        <td className="storage-date">{formatDate(directory.modified)}</td>
        <td className="storage-row-actions">
          <span className="storage-percent">{total > 0 ? `${((directory.size / total) * 100).toFixed(1)}%` : ""}</span>
          <button type="button" className="storage-icon-button" title="Reveal in Finder" aria-label={`Reveal ${directory.name} in Finder`} onClick={(event) => { event.stopPropagation(); void revealInFinder(directory.path); }}>
            <Icon name="open" size={12} />
          </button>
        </td>
      </tr>
      {expanded && loading ? (
        <tr className="storage-table-nested">
          <td colSpan={9} style={{ paddingLeft: 40 + depth * 18 }}>
            <Icon name="spinner" size={13} className="spin" /> Loading {directory.name}...
          </td>
        </tr>
      ) : null}
      {expanded && error ? (
        <tr className="storage-table-nested error">
          <td colSpan={9} style={{ paddingLeft: 40 + depth * 18 }}>{error}</td>
        </tr>
      ) : null}
      {expanded && children ? (
        <>
          {children.directories.map((child) => (
            <DirectoryRow directory={child} depth={depth + 1} total={total} key={child.path} />
          ))}
          {children.files.map((file) => (
            <FileRow file={file} depth={depth + 1} total={total} key={file.path} />
          ))}
          {!children.directories.length && !children.files.length ? (
            <tr className="storage-table-nested">
              <td colSpan={9} style={{ paddingLeft: 40 + depth * 18 }}>This folder is empty.</td>
            </tr>
          ) : null}
        </>
      ) : null}
    </Fragment>
  );
}

export function StorageTreeView() {
  const scan = useStorageStore((state) => state.scan);
  const treePath = useStorageStore((state) => state.treePath);
  const childrenByPath = useStorageStore((state) => state.childrenByPath);
  const childrenLoading = useStorageStore((state) => state.childrenLoading);
  const loadChildren = useStorageStore((state) => state.loadChildren);
  const returnToParent = useStorageStore((state) => state.returnToParent);
  const rescanFolder = useStorageStore((state) => state.rescanFolder);
  const volume = useStorageStore((state) => state.volumes.find((item) => item.mountPoint === state.selectedVolumePath));

  useEffect(() => {
    if (treePath && !childrenByPath[treePath] && !childrenLoading) {
      void loadChildren(treePath);
    }
  }, [treePath, childrenByPath, childrenLoading, loadChildren]);

  if (!scan) return null;
  const path = treePath ?? scan.root;
  const children = childrenByPath[path] ?? null;
  const directory = children?.directory;
  const parent = parentPath(path);
  const canGoUp = Boolean(parent && path !== scan.root);
  const volumeTotal = scan.inspectableBytes || children?.totalSize || 0;
  const breadcrumbItems = crumbs(path, scan.root, volume?.name ?? basename(scan.root) ?? scan.root);

  return (
    <div className="storage-tree-view">
      <section className="storage-card storage-tree-header">
        <div className="storage-breadcrumbs" aria-label="Folder breadcrumb">
          {breadcrumbItems.map((crumb, index) => (
            <Fragment key={crumb.path}>
              {index > 0 ? <Icon name="chevronRight" size={10} /> : null}
              <button
                type="button"
                className={crumb.path === path ? "current" : ""}
                onClick={() => void loadChildren(crumb.path)}
              >
                {crumb.label}
              </button>
            </Fragment>
          ))}
        </div>
        <div className="storage-tree-summary">
          <div>
            <h2>{directory?.name ?? basename(path)}</h2>
            <p>
              {directory
                ? `${formatSize(directory.size)} total · ${formatCount(directory.files)} files · ${formatCount(directory.folders)} subfolders`
                : "Loading folder..."}
            </p>
          </div>
          <div className="storage-tree-actions">
            <button type="button" className="storage-toolbar-button" disabled={!canGoUp} onClick={() => void returnToParent()}>
              <Icon name="up" size={13} />
              Up
            </button>
            <button type="button" className="storage-toolbar-button" onClick={() => void rescanFolder(path)}>
              <Icon name="refresh" size={13} />
              Rescan this folder
            </button>
          </div>
        </div>
        <p className="storage-muted">
          Folder totals include every descendant. Expanding a folder loads only that folder's direct children on demand.
        </p>
      </section>

      <section className="storage-card storage-table-card">
        {childrenLoading && !children ? (
          <div className="storage-loading"><Icon name="spinner" size={18} className="spin" /> Loading folder contents...</div>
        ) : children ? (
          <>
            {children.truncated ? (
              <div className="storage-warning-banner compact">
                <Icon name="warning" size={13} />
                <span>This folder contains more rows than the display limit. Narrow the folder or use filters in Largest files.</span>
              </div>
            ) : null}
            <div className="storage-table-scroll">
              <table className="storage-table storage-tree-table">
                <thead>
                  <tr>
                    <th className="storage-check-cell"><span className="storage-visually-hidden">Select</span></th>
                    <th>Name</th>
                    <th className="storage-number">Logical size</th>
                    <th className="storage-number">Allocated</th>
                    <th className="storage-number">Files</th>
                    <th className="storage-number">Folders</th>
                    <th className="storage-number">Largest file</th>
                    <th>Modified</th>
                    <th className="storage-number">Volume share</th>
                  </tr>
                </thead>
                <tbody>
                  {children.directories.map((child) => (
                    <DirectoryRow directory={child} depth={0} total={volumeTotal} key={child.path} />
                  ))}
                  {children.files.map((file) => (
                    <FileRow file={file} depth={0} total={volumeTotal} key={file.path} />
                  ))}
                </tbody>
              </table>
            </div>
            {!children.directories.length && !children.files.length ? (
              <div className="storage-inline-empty">
                <Icon name="folder" size={28} />
                <h3>This folder is empty</h3>
                <p>No readable files or subfolders were found in the current scan.</p>
              </div>
            ) : null}
          </>
        ) : (
          <div className="storage-inline-empty">
            <Icon name="warning" size={28} />
            <h3>Folder not available</h3>
            <p>Rescan the volume or choose another folder.</p>
          </div>
        )}
      </section>
    </div>
  );
}
