import { Icon } from "../Icon";
import { useStorageStore } from "../../state/storageStore";
import { formatCount, formatSize } from "../../lib/format";
import { FILE_TYPE_LABELS } from "../../lib/storage/types";

const TYPE_COLORS: Record<string, string> = {
  videos: "#af52de",
  images: "#5ac8fa",
  audio: "#ff6482",
  pdf: "#ff453a",
  documents: "#f2b84b",
  archives: "#ff9f0a",
  diskImages: "#8e8e93",
  applications: "#4f8ef7",
  developer: "#64d2ff",
  virtualMachines: "#bf5af2",
  databases: "#34c759",
  fonts: "#ffd60a",
  other: "#98989d",
};

export function StorageFileTypesView() {
  const scan = useStorageStore((state) => state.scan);
  const openFileType = useStorageStore((state) => state.openFileType);
  const openLargestFiles = useStorageStore((state) => state.openLargestFiles);

  if (!scan) return null;

  return (
    <div className="storage-types-view">
      <section className="storage-card storage-view-header">
        <div>
          <span className="storage-eyebrow">Deep analysis</span>
          <h2>File-type analysis</h2>
          <p>
            Types are resolved from extension and path metadata. MAXplorer never opens or executes a discovered file to
            classify it. Location categories are separate from these content-oriented groups.
          </p>
        </div>
        <div className="storage-view-actions">
          <button type="button" className="storage-toolbar-button" onClick={() => void openLargestFiles()}>
            <Icon name="list" size={13} />
            All files
          </button>
        </div>
      </section>

      <div className="storage-type-grid">
        {scan.fileTypes.map((type) => (
          <button
            type="button"
            className="storage-type-card"
            key={type.id}
            onClick={() => void openFileType(type.id, FILE_TYPE_LABELS[type.id] ?? type.label)}
          >
            <span className="storage-type-accent" style={{ background: TYPE_COLORS[type.id] ?? TYPE_COLORS.other }} />
            <span className="storage-type-icon" aria-hidden="true">
              <Icon
                name={
                  type.id === "videos" ? "video"
                    : type.id === "images" ? "image"
                      : type.id === "audio" ? "audio"
                        : type.id === "pdf" || type.id === "documents" ? "fileText"
                          : type.id === "archives" ? "archive"
                            : type.id === "diskImages" ? "disk"
                              : type.id === "applications" ? "appWindow"
                                : type.id === "developer" ? "code"
                                  : type.id === "virtualMachines" ? "server"
                                    : type.id === "databases" ? "database"
                                      : type.id === "fonts" ? "font"
                                        : "file"
                }
                size={20}
              />
            </span>
            <span className="storage-type-main">
              <strong>{FILE_TYPE_LABELS[type.id] ?? type.label}</strong>
              <small>{formatCount(type.files)} files · {type.percent.toFixed(1)}% of inspected bytes</small>
              {type.extensions.length ? (
                <span className="storage-extension-list">
                  {type.extensions.slice(0, 7).map((extension) => <span key={extension}>{extension}</span>)}
                </span>
              ) : null}
            </span>
            <span className="storage-type-size">{formatSize(type.bytes)}</span>
          </button>
        ))}
      </div>

      <section className="storage-card storage-table-card">
        <header className="storage-card-head">
          <div>
            <h2>Type totals</h2>
            <p>Each file is assigned to one type group for this table.</p>
          </div>
        </header>
        <div className="storage-table-scroll">
          <table className="storage-table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="storage-number">Logical size</th>
                <th className="storage-number">Allocated</th>
                <th className="storage-number">Files</th>
                <th className="storage-number">Share</th>
                <th>Extensions</th>
                <th className="storage-number">Inspect</th>
              </tr>
            </thead>
            <tbody>
              {scan.fileTypes.map((type) => (
                <tr className="storage-table-row" key={type.id}>
                  <td><strong>{FILE_TYPE_LABELS[type.id] ?? type.label}</strong></td>
                  <td className="storage-number">{formatSize(type.bytes)}</td>
                  <td className="storage-number storage-muted">{formatSize(type.allocated)}</td>
                  <td className="storage-number">{formatCount(type.files)}</td>
                  <td className="storage-number">{type.percent.toFixed(1)}%</td>
                  <td className="storage-extension-cell">{type.extensions.length ? type.extensions.join(", ") : "—"}</td>
                  <td className="storage-row-actions">
                    <button type="button" className="storage-toolbar-button" onClick={() => void openFileType(type.id, FILE_TYPE_LABELS[type.id] ?? type.label)}>
                      View files
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
