import { Icon } from "../Icon";
import { FileTypeIcon } from "../icons/FileTypeIcon";
import { useStorageStore } from "../../state/storageStore";
import { basename, formatCount, formatDate, formatSize } from "../../lib/format";
import { pickFromDirectory, pickFromFile } from "../../lib/storage/selection";
import {
  CATEGORY_LABELS,
  FILE_TYPE_LABELS,
  categoryColor,
  storageDirectoryEntry,
  storageFileEntry,
} from "../../lib/storage/types";

export function StorageDetails() {
  const file = useStorageStore((state) => state.selectedFile);
  const directory = useStorageStore((state) => state.selectedDirectory);
  const picks = useStorageStore((state) => state.picks);
  const togglePick = useStorageStore((state) => state.togglePick);
  const selectFile = useStorageStore((state) => state.selectFile);
  const selectDirectory = useStorageStore((state) => state.selectDirectory);
  const revealInMaxplorer = useStorageStore((state) => state.revealInMaxplorer);
  const revealInFinder = useStorageStore((state) => state.revealInFinder);
  const openFile = useStorageStore((state) => state.openFile);
  const openProperties = useStorageStore((state) => state.openProperties);
  const openDirectory = useStorageStore((state) => state.openDirectory);
  const setView = useStorageStore((state) => state.setView);

  if (!file && !directory) return null;
  const path = file?.path ?? directory?.path ?? "";
  const name = file?.name ?? directory?.name ?? basename(path);
  const size = file?.size ?? directory?.size ?? 0;
  const allocated = file?.allocated ?? directory?.allocated ?? 0;
  const modified = file?.modified ?? directory?.modified ?? null;
  const pick = file ? pickFromFile(file) : directory ? pickFromDirectory(directory) : null;
  const selected = pick ? picks.some((item) => item.path === pick.path) : false;
  const entry = file ? storageFileEntry(file) : directory ? storageDirectoryEntry(directory) : null;

  const close = () => {
    selectFile(null);
    selectDirectory(null);
  };

  return (
    <aside className="storage-details" aria-label="Selected item details">
      <header className="storage-details-head">
        <span>Details</span>
        <button type="button" className="storage-icon-button" aria-label="Close details" onClick={close}><Icon name="close" size={13} /></button>
      </header>
      <div className="storage-details-hero">
        {entry ? <FileTypeIcon entry={entry} size={52} /> : null}
        <h2 title={name}>{name}</h2>
        <button type="button" className="storage-path storage-path-button" title={path} onClick={() => void revealInFinder(path)}>{path}</button>
      </div>

      <dl className="storage-details-grid">
        <div><dt>Kind</dt><dd>{file ? FILE_TYPE_LABELS[file.fileType] ?? file.fileType : directory?.isPackage ? "Application package" : "Folder"}</dd></div>
        <div><dt>Logical size</dt><dd>{formatSize(size)}</dd></div>
        <div><dt>Allocated</dt><dd>{formatSize(allocated)}</dd></div>
        {directory ? <div><dt>Files inside</dt><dd>{formatCount(directory.files)}</dd></div> : null}
        {directory ? <div><dt>Subfolders</dt><dd>{formatCount(directory.folders)}</dd></div> : null}
        {directory ? <div><dt>Largest file</dt><dd>{directory.largestFileSize ? formatSize(directory.largestFileSize) : "None"}</dd></div> : null}
        {file ? <div><dt>Category</dt><dd><span className="storage-category-chip" style={{ borderColor: categoryColor(file.category) }}><span style={{ background: categoryColor(file.category) }} />{CATEGORY_LABELS[file.category] ?? file.category}</span></dd></div> : null}
        <div><dt>Modified</dt><dd>{formatDate(modified) || "Unknown"}</dd></div>
        {file ? <div><dt>Created</dt><dd>{formatDate(file.created) || "Unknown"}</dd></div> : null}
        {file ? <div><dt>Last accessed</dt><dd>{formatDate(file.accessed) || "Unavailable"}</dd></div> : null}
        {file ? <div><dt>Hidden</dt><dd>{file.isHidden ? "Yes" : "No"}</dd></div> : null}
        <div><dt>Protected</dt><dd>{file?.isProtected || directory?.isProtected ? "Yes · deletion refused" : "No"}</dd></div>
        <div><dt>Read-only</dt><dd>{file?.isReadOnly || directory?.isReadOnly ? "Yes" : "No"}</dd></div>
        {file ? <div><dt>Symbolic link</dt><dd>{file.isSymlink ? "Yes · not followed" : "No"}</dd></div> : null}
        {file ? <div><dt>Hard link</dt><dd>{file.hardLink ? "Shares storage with another path" : "No"}</dd></div> : null}
        {file?.cloudPlaceholder ? <div><dt>Cloud</dt><dd>Local placeholder · content not downloaded</dd></div> : null}
      </dl>

      {directory?.largestFilePath ? (
        <p className="storage-details-note">
          <Icon name="info" size={11} /> Largest contained file: <span className="storage-path">{directory.largestFilePath}</span>
        </p>
      ) : null}
      {file?.cloudPlaceholder ? (
        <p className="storage-details-note warning">
          <Icon name="cloud" size={11} /> Removing a cloud placeholder may remove the item from every synchronized device.
        </p>
      ) : null}

      <div className="storage-details-actions">
        <button type="button" className="storage-primary-button" onClick={() => {
          if (pick) togglePick(pick);
        }}>
          <Icon name={selected ? "check" : "plus"} size={13} />
          {selected ? "Selected for cleanup" : "Add to cleanup selection"}
        </button>
        <button type="button" className="storage-toolbar-button" onClick={() => void revealInMaxplorer(path)}>
          <Icon name="folderOpen" size={13} />
          Reveal in MAXplorer
        </button>
        <button type="button" className="storage-toolbar-button" onClick={() => void revealInFinder(path)}>
          <Icon name="open" size={13} />
          Reveal in Finder
        </button>
        {file ? (
          <button type="button" className="storage-toolbar-button" onClick={() => void openFile(path)}>
            <Icon name="eye" size={13} />
            Open
          </button>
        ) : (
          <button type="button" className="storage-toolbar-button" onClick={() => { void openDirectory(path); setView("tree"); }}>
            <Icon name="folder" size={13} />
            Open folder
          </button>
        )}
        <button type="button" className="storage-toolbar-button" onClick={() => void openProperties(path)}>
          <Icon name="properties" size={13} />
          Properties
        </button>
      </div>
      <p className="storage-muted">
        The analyzer never executes files. Destructive actions always require the cleanup review step.
      </p>
    </aside>
  );
}
