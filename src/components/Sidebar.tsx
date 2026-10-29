import { useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { AppIcon, type AppIconName } from "./icons/AppIcon";
import { FolderIcon } from "./icons/FolderIcon";
import { StorageIcon } from "./icons/StorageIcon";
import { useExplorerStore } from "../state/explorerStore";
import { basename } from "../lib/format";
import { HOME_LOCATION, type Location } from "../lib/types";

const STANDARD_IDS = new Set([
  "desktop",
  "downloads",
  "documents",
  "pictures",
  "music",
  "videos",
  "applications",
]);

const FOLDER_BADGES: Record<string, AppIconName> = {
  desktop: "desktop",
  downloads: "downloads",
  documents: "documents",
  pictures: "pictures",
  music: "music",
  movies: "movies",
  videos: "movies",
  applications: "applications",
};

function LocationIcon({ location, className }: { location: Location; className?: string }) {
  if (location.kind === "drive") {
    return (
      <StorageIcon
        size={17}
        variant={location.id === "root" ? "internal" : "external"}
        status="connected"
        className={className}
      />
    );
  }
  if (location.kind === "network" || location.icon === "network") {
    return <StorageIcon size={17} variant="network" status="connected" className={className} />;
  }
  if (location.icon === "home") {
    return (
      <span className={`sidebar-icon ${className ?? ""}`}>
        <AppIcon name="home" size={16} />
      </span>
    );
  }
  const badge = FOLDER_BADGES[location.icon];
  return (
    <FolderIcon
      size={17}
      variant={badge ? "special" : "standard"}
      badge={badge}
      className={className}
    />
  );
}

export function Sidebar() {
  const platform = useExplorerStore((state) => state.platform);
  const locations = useExplorerStore((state) => state.locations);
  const pinned = useExplorerStore((state) => state.pinned);
  const activeTab = useExplorerStore(
    (state) => state.panes[state.activePane].tabs.find(
      (tab) => tab.id === state.panes[state.activePane].activeTabId,
    ),
  );
  const navigate = useExplorerStore((state) => state.navigate);
  const pinPath = useExplorerStore((state) => state.pinPath);
  const unpinPath = useExplorerStore((state) => state.unpinPath);
  const setSidebarWidth = useExplorerStore((state) => state.setSidebarWidth);
  const sidebarWidth = useExplorerStore((state) => state.sidebarWidth);
  const moveOrCopyPaths = useExplorerStore((state) => state.moveOrCopyPaths);
  const openDialog = useExplorerStore((state) => state.openDialog);
  const [expanded, setExpanded] = useState(true);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const standardLocations = useMemo(
    () => locations.filter((location) => STANDARD_IDS.has(location.id)),
    [locations],
  );
  const rootLocation = locations.find((location) => location.id === "root");
  const volumeLocations = locations.filter((location) => location.kind === "drive" && location.id !== "root");
  const networkLocation = locations.find((location) => location.id === "network");
  const current = activeTab?.location ?? HOME_LOCATION;
  const computerLabel = platform?.computerLabel ?? "This PC";

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    const move = (moveEvent: PointerEvent) => {
      if (!resizeRef.current) return;
      setSidebarWidth(resizeRef.current.startWidth + moveEvent.clientX - resizeRef.current.startX);
    };
    const up = () => {
      resizeRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const renderRow = (location: Location, options: { child?: boolean; pinnable?: boolean } = {}) => {
    const selected = current === location.path;
    const isPinned = pinned.includes(location.path);
    return (
      <div
        key={location.id}
        className={`nav-row ${selected ? "selected" : ""} ${options.child ? "child" : ""}`}
        role="treeitem"
        aria-selected={selected}
        tabIndex={0}
        title={location.path}
        onClick={() => void navigate(location.path)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void navigate(location.path);
          }
        }}
        data-drop-path={location.path}
        data-drop-label={location.name}
      >
        {options.child ? <span className="nav-child-indent" aria-hidden="true" /> : null}
        <LocationIcon location={location} />
        <span className="nav-label">{location.name}</span>
        {isPinned ? (
          <button
            type="button"
            className="nav-pin pinned"
            aria-label={`Unpin ${location.name} from Quick access`}
            title="Unpin from Quick access"
            onClick={(event) => {
              event.stopPropagation();
              unpinPath(location.path);
            }}
          >
            <Icon name="pin" size={12} />
          </button>
        ) : options.pinnable ? (
          <button
            type="button"
            className="nav-pin"
            aria-label={`Pin ${location.name} to Quick access`}
            title="Pin to Quick access"
            onClick={(event) => {
              event.stopPropagation();
              pinPath(location.path);
            }}
          >
            <Icon name="pin" size={12} />
          </button>
        ) : null}
      </div>
    );
  };

  const pinnedRows = pinned
    .filter((path) => !locations.some((location) => location.path === path && STANDARD_IDS.has(location.id)))
    .map((path) => {
      const known = locations.find((location) => location.path === path);
      return (
        <div
          key={`pinned-${path}`}
          className={`nav-row ${current === path ? "selected" : ""}`}
          role="treeitem"
          aria-selected={current === path}
          tabIndex={0}
          title={path}
          onClick={() => void navigate(path)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void navigate(path);
            }
          }}
          data-drop-path={path}
          data-drop-label={basename(path)}
        >
          <span className="sidebar-icon">
            <FolderIcon size={16} variant="favorite" />
          </span>
          <span className="nav-label">{known?.name ?? basename(path) ?? path}</span>
          <button
            type="button"
            className="nav-pin pinned"
            aria-label="Unpin from Quick access"
            title="Unpin from Quick access"
            onClick={(event) => {
              event.stopPropagation();
              unpinPath(path);
            }}
          >
            <Icon name="pin" size={12} />
          </button>
        </div>
      );
    });

  return (
    <>
      <aside className="sidebar" style={{ width: sidebarWidth }} aria-label="Navigation pane">
        <div className="sidebar-scroll" role="tree" aria-label="Locations">
          <div className="sidebar-heading" role="presentation">Favorites</div>
          <div
            className={`nav-row ${current === HOME_LOCATION ? "selected" : ""}`}
            role="treeitem"
            aria-selected={current === HOME_LOCATION}
            tabIndex={0}
            onClick={() => void navigate(HOME_LOCATION)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void navigate(HOME_LOCATION);
              }
            }}
          >
            <span className="sidebar-icon sidebar-icon-home">
              <Icon name="home" size={16} />
            </span>
            <span className="nav-label">Home</span>
          </div>
          {pinnedRows.length ? <div className="nav-section">{pinnedRows}</div> : null}
          <div className="sidebar-heading" role="presentation">Locations</div>
          <div className="nav-section">
            <div
              className={`nav-row nav-group ${current === rootLocation?.path ? "selected" : ""}`}
              role="treeitem"
              aria-expanded={expanded}
              tabIndex={0}
              onClick={() => setExpanded((value) => !value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setExpanded((value) => !value);
                }
              }}
            >
              <button
                type="button"
                className={`nav-chevron ${expanded ? "expanded" : ""}`}
                aria-label={expanded ? "Collapse" : "Expand"}
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded((value) => !value);
                }}
              >
                <Icon name="chevronRight" size={10} />
              </button>
              <span className="sidebar-icon sidebar-icon-blue">
                <Icon name="computer" size={16} />
              </span>
              <span className="nav-label">{computerLabel}</span>
            </div>
            {expanded ? (
              <div className="nav-children">
                {standardLocations.map((location) =>
                  renderRow(location, { child: true, pinnable: true }),
                )}
                {rootLocation ? renderRow(rootLocation, { child: true }) : null}
                {volumeLocations.map((location) => renderRow(location, { child: true }))}
                {networkLocation ? renderRow(networkLocation, { child: true }) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-theme-button"
            title="Appearance and themes"
            aria-label="Appearance and themes"
            onClick={() => openDialog({ kind: "themes" })}
          >
            <Icon name="palette" size={16} />
            <span className="nav-label">Appearance</span>
          </button>
        </div>
      </aside>
      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize navigation pane"
        onPointerDown={startResize}
        onDoubleClick={() => setSidebarWidth(194)}
      />
    </>
  );
}
