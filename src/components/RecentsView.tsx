import { Icon } from "./Icon";
import { FileTypeIcon } from "./icons/FileTypeIcon";
import { FolderIcon } from "./icons/FolderIcon";
import { TagIndicators } from "./TagIndicators";
import { useExplorerStore } from "../state/explorerStore";
import { formatDate } from "../lib/format";
import type { FileEntry, PaneId, RecentItem } from "../lib/types";

/** A recent item presented as a normal file entry for opening and previewing. */
export function recentAsEntry(recent: RecentItem): FileEntry {
  const dot = recent.name.lastIndexOf(".");
  return {
    name: recent.name,
    path: recent.path,
    isDir: recent.isDir,
    isSymlink: false,
    size: null,
    modified: recent.modified,
    created: null,
    accessed: null,
    extension: !recent.isDir && dot > 0 ? recent.name.slice(dot + 1).toLowerCase() : null,
    isHidden: recent.name.startsWith("."),
    isReadOnly: false,
    target: null,
  };
}

/**
 * Virtual Recents view. It never lists the filesystem: every row comes from the
 * metadata MAXplorer already recorded, so it works even when a volume is no
 * longer mounted.
 */
export function RecentsView({ paneId = "left" }: { paneId?: PaneId }) {
  const recents = useExplorerStore((state) => state.recents);
  const setActivePane = useExplorerStore((state) => state.setActivePane);
  const openEntry = useExplorerStore((state) => state.openEntry);
  const clearRecents = useExplorerStore((state) => state.clearRecents);
  const showContextMenu = useExplorerStore((state) => state.showContextMenu);
  const openProperties = useExplorerStore((state) => state.openProperties);

  const openContextMenu = (event: React.MouseEvent, recent: RecentItem) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu({
      kind: "item",
      x: event.clientX,
      y: event.clientY,
      path: recent.path,
      isDir: recent.isDir,
      paneId,
    });
  };

  return (
    <div
      className="recents-view"
      onPointerDown={() => setActivePane(paneId)}
      data-pane={paneId}
    >
      <div className="recents-header">
        <div>
          <h1>Recents</h1>
          <p>
            {recents.length
              ? `${recents.length} recently opened ${recents.length === 1 ? "item" : "items"}`
              : "Files and folders you open will appear here."}
          </p>
        </div>
        {recents.length ? (
          <button type="button" className="home-action" onClick={clearRecents}>
            <Icon name="trash" size={14} />
            Clear recents
          </button>
        ) : null}
      </div>
      {recents.length ? (
        <div className="recents-list" role="list">
          {recents.map((recent) => (
            <div
              className="recents-row"
              role="listitem"
              key={recent.path}
              tabIndex={0}
              title={recent.path}
              data-path={recent.path}
              data-drop-path={recent.isDir ? recent.path : undefined}
              data-drop-label={recent.isDir ? recent.name : undefined}
              onClick={() => void openEntry(recentAsEntry(recent), paneId)}
              onContextMenu={(event) => openContextMenu(event, recent)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void openEntry(recentAsEntry(recent), paneId);
                }
                if (event.key === "i" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void openProperties(recent.path);
                }
              }}
            >
              <span className="recents-icon">
                {recent.isDir ? (
                  <FolderIcon size={22} />
                ) : (
                  <FileTypeIcon entry={recentAsEntry(recent)} size={22} />
                )}
              </span>
              <span className="recents-name">
                {recent.name}
                <TagIndicators path={recent.path} max={4} />
              </span>
              <span className="recents-path">{recent.path}</span>
              <span className="recents-date">{formatDate(recent.modified)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="file-area-state empty-state">
          <div className="empty-icon">
            <Icon name="clock" size={42} />
          </div>
          <h2>No recent items yet</h2>
          <p>Open a file or folder and it will show up here.</p>
        </div>
      )}
    </div>
  );
}
