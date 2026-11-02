import { useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { AppIcon, type AppIconName } from "./icons/AppIcon";
import { FolderIcon } from "./icons/FolderIcon";
import { StorageIcon } from "./icons/StorageIcon";
import { useExplorerStore } from "../state/explorerStore";
import { useStorageStore } from "../state/storageStore";
import { beginFavoriteDrag, beginTagDrag } from "../state/fileDrag";
import { basename } from "../lib/format";
import { samePath, tagPathKey } from "../lib/tags";
import {
  HOME_LOCATION,
  NETWORK_LOCATION,
  RECENTS_LOCATION,
  type Location,
  type NetworkConnection,
} from "../lib/types";

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

type SidebarSection = "favorites" | "locations" | "tags";

function LocationIcon({ location, className }: { location: Location; className?: string }) {
  if (location.icon === "icloud") {
    return (
      <span className={`sidebar-icon sidebar-icon-blue ${className ?? ""}`}>
        <AppIcon name="cloud" size={16} />
      </span>
    );
  }
  if (location.icon === "trash") {
    return (
      <span className={`sidebar-icon sidebar-icon-gray ${className ?? ""}`}>
        <AppIcon name="trash" size={16} />
      </span>
    );
  }
  if (location.icon === "shared") {
    return (
      <span className={`sidebar-icon sidebar-icon-green ${className ?? ""}`}>
        <AppIcon name="share" size={16} />
      </span>
    );
  }
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
      <span className={`sidebar-icon sidebar-icon-home ${className ?? ""}`}>
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

function shouldArmRowDrag(event: React.PointerEvent): boolean {
  if (event.button !== 0) return false;
  const target = event.target as HTMLElement | null;
  return !target?.closest("button, input, a, [role='separator']");
}

export function Sidebar() {
  const platform = useExplorerStore((state) => state.platform);
  const locations = useExplorerStore((state) => state.locations);
  const pinned = useExplorerStore((state) => state.pinned);
  const tags = useExplorerStore((state) => state.tags);
  const tagAssignments = useExplorerStore((state) => state.tagAssignments);
  const networkConnections = useExplorerStore((state) => state.networkConnections);
  const openNetworkConnection = useExplorerStore((state) => state.openNetworkConnection);
  const openNetworkConnectionDialog = useExplorerStore(
    (state) => state.openNetworkConnectionDialog,
  );
  const activePane = useExplorerStore((state) => state.activePane);
  const currentLocation = useExplorerStore((state) => {
    const pane = state.panes[state.activePane];
    return pane.tabs.find((tab) => tab.id === pane.activeTabId)?.location ?? HOME_LOCATION;
  });
  const activeTagFilter = useExplorerStore(
    (state) => state.panes[state.activePane].tagFilterId,
  );
  const navigate = useExplorerStore((state) => state.navigate);
  const unpinPath = useExplorerStore((state) => state.unpinPath);
  const setTagFilter = useExplorerStore((state) => state.setTagFilter);
  const openTagEditor = useExplorerStore((state) => state.openTagEditor);
  const setSidebarWidth = useExplorerStore((state) => state.setSidebarWidth);
  const sidebarWidth = useExplorerStore((state) => state.sidebarWidth);
  const showContextMenu = useExplorerStore((state) => state.showContextMenu);
  const ejectVolume = useExplorerStore((state) => state.ejectVolume);
  const openStorageWorkspace = useStorageStore((state) => state.openWorkspace);
  const storageWorkspaceOpen = useStorageStore((state) => state.workspaceOpen);
  const storageVolume = useStorageStore((state) =>
    state.volumes.find((volume) => volume.mountPoint === state.selectedVolumePath),
  );
  const [openSections, setOpenSections] = useState<Record<SidebarSection, boolean>>({
    favorites: true,
    locations: true,
    tags: true,
  });
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, Location>();
    for (const location of locations) map.set(location.id, location);
    return map;
  }, [locations]);
  const rootLocation = byId.get("root");
  const volumeLocations = locations.filter(
    (location) => location.kind === "drive" && location.id !== "root",
  );
  const networkLocation = byId.get("network");
  const networkVolumeLocations = locations.filter(
    (location) => location.kind === "network" && location.isVolume,
  );
  const savedNetworkPaths = new Set(
    networkConnections
      .map((connection) => connection.mountPath)
      .filter((path): path is string => Boolean(path))
      .map(tagPathKey),
  );
  const unsavedNetworkVolumes = networkVolumeLocations.filter(
    (location) => !savedNetworkPaths.has(tagPathKey(location.path)),
  );
  const networkCount = networkConnections.length + unsavedNetworkVolumes.length;
  const mountedPathFor = (connection: NetworkConnection): string | null => {
    if (!connection.mountPath) return null;
    return (
      locations.find((location) =>
        samePath(location.path, connection.mountPath as string),
      )?.path ?? null
    );
  };
  const icloudLocation = byId.get("icloud");
  const sharedLocation = byId.get("shared");
  const trashLocation = byId.get("trash");
  const computerLabel = platform?.computerLabel ?? "This PC";
  const homePath = platform?.home ?? "/";
  const tagCounts = useMemo(() => {
    // Count unique paths per tag in one pass so a large tag library cannot
    // turn every sidebar render into a nested scan.
    const pathsByTag = new Map<string, Set<string>>();
    for (const assignment of tagAssignments) {
      const pathKey = tagPathKey(assignment.path);
      for (const tagId of assignment.tagIds) {
        const paths = pathsByTag.get(tagId);
        if (paths) paths.add(pathKey);
        else pathsByTag.set(tagId, new Set([pathKey]));
      }
    }
    return new Map(
      [...pathsByTag.entries()].map(([tagId, paths]) => [tagId, paths.size]),
    );
  }, [tagAssignments]);

  const toggleSection = (section: SidebarSection) =>
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));

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

  const isCurrent = (path: string) => !activeTagFilter && currentLocation === path;

  const openLocationMenu = (
    event: React.MouseEvent,
    locationId: string,
    path: string,
    name: string,
    isVolume: boolean,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu({
      kind: "sidebar",
      x: event.clientX,
      y: event.clientY,
      target: { kind: "location", locationId, path, name, isVolume },
    });
  };

  const renderLocationRow = (
    location: Location,
    options: { indent?: boolean; droppable?: boolean } = {},
  ) => {
    const selected = isCurrent(location.path);
    const canEject = location.isVolume && location.id !== "root";
    return (
      <div
        key={location.id}
        className={`nav-row ${selected ? "selected" : ""}`}
        role="button"
        aria-current={selected ? "page" : undefined}
        tabIndex={0}
        title={location.path}
        onClick={() => void navigate(location.path)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void navigate(location.path);
          }
        }}
        onContextMenu={(event) =>
          openLocationMenu(event, location.id, location.path, location.name, location.isVolume)
        }
        data-drop-path={options.droppable === false ? undefined : location.path}
        data-drop-label={location.name}
      >
        {options.indent ? <span className="nav-child-indent" aria-hidden="true" /> : null}
        <LocationIcon location={location} />
        <span className="nav-label">{location.name}</span>
        {canEject ? (
          <button
            type="button"
            className="nav-pin nav-eject"
            aria-label={`Eject ${location.name}`}
            title={`Eject ${location.name}`}
            onClick={(event) => {
              event.stopPropagation();
              void ejectVolume(location.path);
            }}
          >
            <Icon name="eject" size={12} />
          </button>
        ) : null}
      </div>
    );
  };

  const renderHomeRow = () => {
    const selected = isCurrent(HOME_LOCATION);
    return (
      <div
        className={`nav-row ${selected ? "selected" : ""}`}
        role="button"
        aria-current={selected ? "page" : undefined}
        tabIndex={0}
        title={homePath}
        onClick={() => void navigate(HOME_LOCATION)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void navigate(HOME_LOCATION);
          }
        }}
        onContextMenu={(event) => openLocationMenu(event, "home", homePath, "Home", false)}
        data-drop-path={homePath}
        data-drop-label="Home"
      >
        <span className="sidebar-icon sidebar-icon-home">
          <Icon name="home" size={16} />
        </span>
        <span className="nav-label">Home</span>
      </div>
    );
  };

  const renderRecentsRow = () => {
    const selected = isCurrent(RECENTS_LOCATION);
    return (
      <div
        className={`nav-row ${selected ? "selected" : ""}`}
        role="button"
        aria-current={selected ? "page" : undefined}
        tabIndex={0}
        title="Recently opened files and folders"
        onClick={() => void navigate(RECENTS_LOCATION)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void navigate(RECENTS_LOCATION);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showContextMenu({
            kind: "sidebar",
            x: event.clientX,
            y: event.clientY,
            target: { kind: "recents" },
          });
        }}
      >
        <span className="sidebar-icon sidebar-icon-purple">
          <Icon name="clock" size={16} />
        </span>
        <span className="nav-label">Recents</span>
      </div>
    );
  };

  const renderNetworkConnectionRow = (connection: NetworkConnection) => {
    const mountedPath = mountedPathFor(connection);
    const selected = mountedPath != null && isCurrent(mountedPath);
    return (
      <div
        key={`network-${connection.id}`}
        className={`nav-row nav-network-row ${selected ? "selected" : ""}`}
        role="button"
        aria-current={selected ? "page" : undefined}
        tabIndex={0}
        title={`${connection.address}${mountedPath ? `\n${mountedPath}` : ""}`}
        onClick={() => void openNetworkConnection(connection.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void openNetworkConnection(connection.id);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showContextMenu({
            kind: "sidebar",
            x: event.clientX,
            y: event.clientY,
            target: { kind: "networkConnection", connectionId: connection.id },
          });
        }}
        data-drop-path={mountedPath ?? undefined}
        data-drop-label={connection.name}
      >
        <span className="nav-child-indent" aria-hidden="true" />
        <span className="sidebar-icon sidebar-icon-blue">
          <Icon name="server" size={16} />
        </span>
        <span className="nav-label">{connection.name}</span>
        <span
          className={`network-dot ${mountedPath ? "connected" : ""}`}
          title={mountedPath ? "Connected" : "Not connected"}
          aria-label={mountedPath ? "Connected" : "Not connected"}
        />
      </div>
    );
  };

  const favoritePaths = pinned.filter(
    (path) => !sharedLocation || !samePath(path, sharedLocation.path),
  );
  const favoriteRows = favoritePaths.map((path, index) => {
    const known = locations.find((location) => samePath(location.path, path));
    const name = known?.name ?? (basename(path) || path);
    const selected = isCurrent(path);
    const pseudo: Location = known ?? {
      id: `favorite:${path}`,
      name,
      path,
      kind: "folder",
      icon: "folder",
      isVolume: false,
    };
    return (
      <div
        key={`pinned-${path}`}
        className={`nav-row ${selected ? "selected" : ""}`}
        role="button"
        aria-current={selected ? "page" : undefined}
        tabIndex={0}
        title={path}
        onClick={() => void navigate(path)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void navigate(path);
          }
        }}
        onPointerDown={(event) => {
          if (!shouldArmRowDrag(event)) return;
          beginFavoriteDrag(event, path, name, index);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showContextMenu({
            kind: "sidebar",
            x: event.clientX,
            y: event.clientY,
            target: { kind: "favorite", path, name },
          });
        }}
        data-drop-path={path}
        data-drop-label={name}
        data-drop-favorite={path}
      >
        {known ? (
          <LocationIcon location={pseudo} />
        ) : (
          <span className="sidebar-icon">
            <FolderIcon size={16} variant="favorite" />
          </span>
        )}
        <span className="nav-label">{name}</span>
        <button
          type="button"
          className="nav-pin pinned"
          aria-label={`Remove ${name} from Favorites`}
          title="Remove from Favorites"
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

  const renderSection = (section: SidebarSection, label: string, children: React.ReactNode) => {
    const open = openSections[section];
    return (
      <section className="sidebar-section" aria-label={label} key={section}>
        <button
          type="button"
          className={`sidebar-heading ${open ? "expanded" : ""}`}
          aria-expanded={open}
          onClick={() => toggleSection(section)}
        >
          <span className="sidebar-heading-chevron" aria-hidden="true">
            <Icon name="chevronRight" size={10} />
          </span>
          <span>{label}</span>
        </button>
        {open ? <div className="nav-section">{children}</div> : null}
      </section>
    );
  };

  return (
    <>
      <aside className="sidebar" style={{ width: sidebarWidth }} aria-label="Navigation pane">
        <nav className="sidebar-scroll" aria-label="Sidebar">
          {renderSection(
            "favorites",
            "Favorites",
            <>
              {renderRecentsRow()}
              {sharedLocation ? renderLocationRow(sharedLocation) : null}
              {favoriteRows}
              {!pinned.length && !sharedLocation ? (
                <div className="sidebar-hint">
                  Pin folders here from the file list or a location's menu.
                </div>
              ) : null}
            </>,
          )}

          {renderSection(
            "locations",
            "Locations",
            <>
              {icloudLocation ? renderLocationRow(icloudLocation) : null}
              {renderHomeRow()}
              <div className="nav-row nav-group" role="presentation" title={computerLabel}>
                <span className="nav-child-indent" aria-hidden="true" />
                <span className="sidebar-icon sidebar-icon-blue">
                  <Icon name="computer" size={16} />
                </span>
                <span className="nav-label">{computerLabel}</span>
              </div>
              <div className="nav-children">
                {rootLocation ? renderLocationRow(rootLocation, { indent: true }) : null}
                {volumeLocations.map((location) =>
                  renderLocationRow(location, { indent: true }),
                )}
              </div>
              <div
                className={`nav-row ${isCurrent(NETWORK_LOCATION) ? "selected" : ""}`}
                role="button"
                aria-current={isCurrent(NETWORK_LOCATION) ? "page" : undefined}
                tabIndex={0}
                title="Servers and computers on your network"
                onClick={() => void navigate(NETWORK_LOCATION)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void navigate(NETWORK_LOCATION);
                  }
                }}
              >
                <span className="sidebar-icon sidebar-icon-blue">
                  <Icon name="network" size={16} />
                </span>
                <span className="nav-label">Network</span>
                {networkCount ? <span className="nav-count">{networkCount}</span> : null}
              </div>
              <div className="nav-children">
                {networkConnections.map(renderNetworkConnectionRow)}
                {unsavedNetworkVolumes.map((location) =>
                  renderLocationRow(location, { indent: true }),
                )}
                {networkLocation ? (
                  <div
                    className="nav-row nav-network-browse"
                    role="button"
                    tabIndex={0}
                    title={networkLocation.path}
                    onClick={() => void navigate(networkLocation.path)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void navigate(networkLocation.path);
                      }
                    }}
                  >
                    <span className="nav-child-indent" aria-hidden="true" />
                    <span className="sidebar-icon sidebar-icon-blue">
                      <Icon name="network" size={16} />
                    </span>
                    <span className="nav-label">Browse Network</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="nav-row nav-add-tag"
                  onClick={() => openNetworkConnectionDialog()}
                  title="Save a server address"
                >
                  <span className="nav-child-indent" aria-hidden="true" />
                  <span className="sidebar-icon">
                    <Icon name="plus" size={15} />
                  </span>
                  <span className="nav-label">Connect to Server...</span>
                </button>
              </div>
              {trashLocation ? renderLocationRow(trashLocation) : null}
            </>,
          )}

          {renderSection(
            "tags",
            "Tags",
            <>
              {tags.map((tag, index) => {
                const selected = activeTagFilter === tag.id;
                const count = tagCounts.get(tag.id) ?? 0;
                return (
                  <div
                    key={tag.id}
                    className={`nav-row tag-row ${selected ? "selected" : ""}`}
                    role="button"
                    aria-pressed={selected}
                    tabIndex={0}
                    title={`${tag.name} - ${count} ${count === 1 ? "item" : "items"}`}
                    onClick={() => setTagFilter(tag.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setTagFilter(tag.id);
                      }
                    }}
                    onPointerDown={(event) => {
                      if (!shouldArmRowDrag(event)) return;
                      beginTagDrag(event, tag.id, tag.name, index);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      showContextMenu({
                        kind: "sidebar",
                        x: event.clientX,
                        y: event.clientY,
                        target: { kind: "tag", tagId: tag.id },
                      });
                    }}
                    data-drop-tag={tag.id}
                    data-drop-label={tag.name}
                  >
                    <span className="sidebar-icon">
                      <span
                        className="tag-swatch"
                        style={{ backgroundColor: tag.color }}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="nav-label">{tag.name}</span>
                    {count ? <span className="nav-count">{count}</span> : null}
                  </div>
                );
              })}
              <button
                type="button"
                className="nav-row nav-add-tag"
                onClick={() => openTagEditor()}
                title="Create a tag"
              >
                <span className="sidebar-icon">
                  <Icon name="plus" size={15} />
                </span>
                <span className="nav-label">New Tag...</span>
              </button>
              {!tags.length ? (
                <div className="sidebar-hint">
                  Tags are MAXplorer metadata. They never change file contents.
                </div>
              ) : null}
            </>,
          )}

          <section className="sidebar-section" aria-label="Tools">
            <div className="sidebar-heading static">Tools</div>
            <div className="nav-section">
              <div
                className={`nav-row ${storageWorkspaceOpen ? "selected" : ""}`}
                role="button"
                aria-current={storageWorkspaceOpen ? "page" : undefined}
                tabIndex={0}
                title={
                  storageVolume
                    ? `Analyze ${storageVolume.name}`
                    : "Analyze storage on this Mac"
                }
                onClick={() => void openStorageWorkspace()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openStorageWorkspace();
                  }
                }}
              >
                <span className="sidebar-icon sidebar-icon-blue">
                  <StorageIcon
                    size={16}
                    variant={
                      storageVolume?.isNetwork
                        ? "network"
                        : storageVolume?.isInternal
                          ? "internal"
                          : "external"
                    }
                  />
                </span>
                <span className="nav-label">Storage Analyzer</span>
                {storageVolume ? (
                  <span
                    className="nav-storage-percent"
                    title={`${storageVolume.usagePercent.toFixed(1)}% used`}
                  >
                    {Math.round(storageVolume.usagePercent)}%
                  </span>
                ) : null}
              </div>
            </div>
          </section>
        </nav>
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
