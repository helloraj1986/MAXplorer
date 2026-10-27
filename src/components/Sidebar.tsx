import { useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { FileGlyph } from "./FileGlyph";
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

const ICON_COLORS: Record<string, string> = {
  desktop: "sidebar-icon-blue",
  downloads: "sidebar-icon-green",
  documents: "sidebar-icon-blue",
  pictures: "sidebar-icon-purple",
  music: "sidebar-icon-pink",
  movies: "sidebar-icon-purple",
  videos: "sidebar-icon-purple",
  applications: "sidebar-icon-gray",
  network: "sidebar-icon-blue",
};

function LocationIcon({ icon, className }: { icon: string; className?: string }) {
  const name = (["home", "desktop", "downloads", "documents", "pictures", "music", "movies", "applications", "drive", "network"] as IconName[]).includes(icon as IconName)
    ? (icon as IconName)
    : "folder";
  const knownFolder = ["desktop", "downloads", "documents", "pictures", "music", "movies", "videos"].includes(icon);
  if (knownFolder) {
    return (
      <span className={`sidebar-folder ${className ?? ""}`}>
        <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M2.2 5.1c0-.7.6-1.3 1.3-1.3h4.1l1.6 1.7h7.3c.7 0 1.3.6 1.3 1.3v8c0 .7-.6 1.3-1.3 1.3H3.5c-.7 0-1.3-.6-1.3-1.3z"
            fill="#2f9be8"
          />
          <path
            d="M2.2 7.1c0-.7.6-1.3 1.3-1.3h13c.7 0 1.3.6 1.3 1.3v6c0 .7-.6 1.3-1.3 1.3H3.5c-.7 0-1.3-.6-1.3-1.3z"
            fill="#63c4ff"
          />
          <path d="M3.4 7.4h13.2" stroke="#d8f2ff" strokeWidth="1.2" />
        </svg>
        <span className="sidebar-folder-overlay">
          <Icon name={name} size={8} strokeWidth={1.8} />
        </span>
      </span>
    );
  }
  return (
    <span className={`sidebar-icon ${ICON_COLORS[icon] ?? ""} ${className ?? ""}`}>
      <Icon name={name} size={16} />
    </span>
  );
}

export function Sidebar() {
  const platform = useExplorerStore((state) => state.platform);
  const locations = useExplorerStore((state) => state.locations);
  const pinned = useExplorerStore((state) => state.pinned);
  const activeTab = useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const navigate = useExplorerStore((state) => state.navigate);
  const pinPath = useExplorerStore((state) => state.pinPath);
  const unpinPath = useExplorerStore((state) => state.unpinPath);
  const setSidebarWidth = useExplorerStore((state) => state.setSidebarWidth);
  const sidebarWidth = useExplorerStore((state) => state.sidebarWidth);
  const moveOrCopyPaths = useExplorerStore((state) => state.moveOrCopyPaths);
  const [expanded, setExpanded] = useState(true);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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

  const handleDrop = (event: React.DragEvent, destination: string) => {
    event.preventDefault();
    setDropTarget(null);
    const raw = event.dataTransfer.getData("application/x-win11-explorer-paths");
    if (!raw) return;
    try {
      const paths = JSON.parse(raw) as string[];
      if (Array.isArray(paths) && paths.length) {
        void moveOrCopyPaths(paths, destination, event.altKey ? "copy" : "cut");
      }
    } catch {
      // Ignore malformed internal drag payloads.
    }
  };

  const dragOver = (event: React.DragEvent, destination: string) => {
    if (event.dataTransfer.types.includes("application/x-win11-explorer-paths")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
      setDropTarget(destination);
    }
  };

  const renderRow = (location: Location, options: { child?: boolean; pinnable?: boolean } = {}) => {
    const selected = current === location.path;
    const isPinned = pinned.includes(location.path);
    return (
      <div
        key={location.id}
        className={`nav-row ${selected ? "selected" : ""} ${options.child ? "child" : ""} ${dropTarget === location.path ? "drop-target" : ""}`}
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
        onDragOver={(event) => dragOver(event, location.path)}
        onDragLeave={() => setDropTarget((value) => (value === location.path ? null : value))}
        onDrop={(event) => handleDrop(event, location.path)}
      >
        {options.child ? <span className="nav-child-indent" aria-hidden="true" /> : null}
        <LocationIcon icon={location.icon} />
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
          className={`nav-row ${current === path ? "selected" : ""} ${dropTarget === path ? "drop-target" : ""}`}
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
          onDragOver={(event) => dragOver(event, path)}
          onDragLeave={() => setDropTarget((value) => (value === path ? null : value))}
          onDrop={(event) => handleDrop(event, path)}
        >
          <span className="sidebar-icon">
            <FileGlyph category="folder" size={16} />
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
