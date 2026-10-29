import { useMemo } from "react";
import { Icon } from "./Icon";
import { FileTypeIcon } from "./icons/FileTypeIcon";
import { FolderIcon } from "./icons/FolderIcon";
import type { AppIconName } from "./icons/AppIcon";
import { useExplorerStore } from "../state/explorerStore";
import { basename, formatDate } from "../lib/format";
import { HOME_LOCATION, type FileEntry, type PaneId, type RecentItem } from "../lib/types";

const QUICK_BADGES: Record<string, AppIconName> = {
  desktop: "desktop",
  downloads: "downloads",
  documents: "documents",
  pictures: "pictures",
  music: "music",
  movies: "movies",
  videos: "movies",
  applications: "applications",
};

function recentAsEntry(recent: RecentItem): FileEntry {
  return {
    name: recent.name,
    path: recent.path,
    isDir: recent.isDir,
    isSymlink: false,
    size: null,
    modified: recent.modified,
    created: null,
    accessed: null,
    extension: recent.name.includes(".") ? recent.name.split(".").pop()?.toLowerCase() ?? null : null,
    isHidden: recent.name.startsWith("."),
    isReadOnly: false,
    target: null,
  };
}

export function HomeView({ paneId = "left" }: { paneId?: PaneId }) {
  const platform = useExplorerStore((state) => state.platform);
  const setActivePane = useExplorerStore((state) => state.setActivePane);
  const locations = useExplorerStore((state) => state.locations);
  const pinned = useExplorerStore((state) => state.pinned);
  const recents = useExplorerStore((state) => state.recents);
  const navigate = useExplorerStore((state) => state.navigate);
  const openEntry = useExplorerStore((state) => state.openEntry);
  const pinPath = useExplorerStore((state) => state.pinPath);
  const unpinPath = useExplorerStore((state) => state.unpinPath);
  const clearRecents = useExplorerStore((state) => state.clearRecents);

  const quickAccess = useMemo(() => {
    const defaults = ["desktop", "downloads", "documents", "pictures"]
      .map((id) => locations.find((location) => location.id === id))
      .filter((location): location is NonNullable<typeof location> => Boolean(location));
    const entries = pinned.map((path) => {
      const known = locations.find((location) => location.path === path);
      return {
        path,
        name: known?.name ?? (basename(path) || path),
        icon: known?.icon ?? "folder",
        pinned: true,
      };
    });
    for (const location of defaults) {
      if (!entries.some((entry) => entry.path === location.path)) {
        entries.push({
          path: location.path,
          name: location.name,
          icon: location.icon,
          pinned: false,
        });
      }
    }
    return entries;
  }, [locations, pinned]);

  return (
    <div
      className="home-view"
      onPointerDown={() => setActivePane(paneId)}
      onContextMenu={(event) => {
        event.preventDefault();
        useExplorerStore.getState().showContextMenu({
          kind: "blank",
          x: event.clientX,
          y: event.clientY,
          paneId,
        });
      }}
      data-drop-pane={paneId}
    >
      <div className="home-header">
        <div>
          <h1>Home</h1>
          <p className="home-subtitle">
            {platform?.platform === "macos" ? "Your Mac" : "This PC"}  -  Quick access and recent files
          </p>
        </div>
        <button
          type="button"
          className="home-refresh"
          title="Refresh"
          aria-label="Refresh home"
          onClick={() => useExplorerStore.getState().refresh(paneId)}
        >
          <Icon name="refresh" size={16} />
        </button>
      </div>

      <section className="home-section" aria-labelledby="quick-access-title">
        <div className="home-section-heading">
          <h2 id="quick-access-title">Quick access</h2>
          <span className="home-section-hint">Pin folders for one-click access</span>
        </div>
        {quickAccess.length ? (
          <div className="quick-grid">
            {quickAccess.map((item) => (
              <div
                className="quick-tile"
                key={item.path}
                role="button"
                tabIndex={0}
                title={item.path}
                onClick={() => void navigate(item.path, { paneId })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void navigate(item.path, { paneId });
                  }
                }}
              >
                <span className="quick-icon">
                  <FolderIcon
                    size={32}
                    variant={item.pinned ? "favorite" : "special"}
                    badge={QUICK_BADGES[item.icon]}
                  />
                </span>
                <span className="quick-meta">
                  <span className="quick-name">{item.name}</span>
                  <span className="quick-path">{item.path}</span>
                </span>
                <button
                  type="button"
                  className={`quick-pin ${item.pinned ? "active" : ""}`}
                  title={item.pinned ? "Unpin from Quick access" : "Pin to Quick access"}
                  aria-label={item.pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (item.pinned) unpinPath(item.path);
                    else pinPath(item.path);
                  }}
                >
                  <Icon name="pin" size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="home-empty">Folders you pin will appear here.</div>
        )}
      </section>

      <section className="home-section" aria-labelledby="recent-title">
        <div className="home-section-heading">
          <h2 id="recent-title">Recent</h2>
          {recents.length ? (
            <button type="button" className="link-button" onClick={clearRecents}>
              Clear recent
            </button>
          ) : null}
        </div>
        {recents.length ? (
          <div className="recent-list" role="list">
            {recents.map((recent) => (
              <div
                className="recent-row"
                role="listitem"
                key={recent.path}
                tabIndex={0}
                title={recent.path}
                onClick={() => void openEntry(recentAsEntry(recent), paneId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openEntry(recentAsEntry(recent), paneId);
                  }
                }}
              >
                <span className="recent-icon">
                  {recent.isDir ? (
                    <FolderIcon size={22} />
                  ) : (
                    <FileTypeIcon entry={recentAsEntry(recent)} size={22} />
                  )}
                </span>
                <span className="recent-name">{recent.name}</span>
                <span className="recent-path">{recent.path}</span>
                <span className="recent-date">{formatDate(recent.modified)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="home-empty">
            Files and folders you open will appear here. Browse your Mac to get started.
            <div className="home-empty-actions">
              <button type="button" className="home-action" onClick={() => void navigate(platform?.home ?? "/", { paneId })}>
                <Icon name="home" size={14} />
                Open Home folder
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
