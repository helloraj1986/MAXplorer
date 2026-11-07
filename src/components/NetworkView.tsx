import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { api, normalizeError } from "../lib/api";
import { useExplorerStore } from "../state/explorerStore";
import { formatDate } from "../lib/format";
import { samePath, tagPathKey } from "../lib/tags";
import type {
  Location,
  NetworkComputer,
  NetworkConnection,
  PaneId,
} from "../lib/types";

function connectionMountPath(
  connection: NetworkConnection,
  locations: Location[],
): string | null {
  if (!connection.mountPath) return null;
  return (
    locations.find((location) =>
      samePath(location.path, connection.mountPath as string),
    )?.path ?? null
  );
}

/**
 * Network workspace: saved servers survive restarts, mounted volumes show up
 * automatically, and the Connect action delegates authentication to macOS.
 */
export function NetworkView({ paneId = "left" }: { paneId?: PaneId }) {
  const locations = useExplorerStore((state) => state.locations);
  const connections = useExplorerStore((state) => state.networkConnections);
  const setActivePane = useExplorerStore((state) => state.setActivePane);
  const navigate = useExplorerStore((state) => state.navigate);
  const refreshLocations = useExplorerStore((state) => state.refreshLocations);
  const openNetworkConnection = useExplorerStore((state) => state.openNetworkConnection);
  const connectNetworkConnection = useExplorerStore((state) => state.connectNetworkConnection);
  const openNetworkConnectionDialog = useExplorerStore((state) => state.openNetworkConnectionDialog);
  const removeNetworkConnection = useExplorerStore((state) => state.removeNetworkConnection);
  const openDialog = useExplorerStore((state) => state.openDialog);
  const [computers, setComputers] = useState<NetworkComputer[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  const discover = async () => {
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      setComputers(await api.discoverNetworkComputers());
    } catch (cause) {
      setDiscoveryError(normalizeError(cause).message);
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    void discover();
  }, []);

  const refresh = async () => {
    await Promise.all([refreshLocations(), discover()]);
  };

  const configureComputer = (computer: NetworkComputer) => {
    openDialog({
      kind: "networkConnection",
      initialAddress: computer.address ?? `smb://${computer.name}`,
      initialName: computer.name,
    });
  };

  const savedPaths = new Set(
    connections
      .map((connection) => connection.mountPath)
      .filter((path): path is string => Boolean(path))
      .map(tagPathKey),
  );
  const networkVolumes = locations.filter(
    (location) =>
      location.kind === "network" &&
      location.isVolume &&
      !savedPaths.has(tagPathKey(location.path)),
  );
  const browseLocation = locations.find((location) => location.id === "network");

  const remove = (connection: NetworkConnection) => {
    openDialog({
      kind: "confirm",
      title: `Remove "${connection.name}"?`,
      message:
        "The saved server is removed from Network. The server itself and any mounted volume are not changed.",
      confirmLabel: "Remove Server",
      destructive: true,
      onConfirm: () => removeNetworkConnection(connection.id),
    });
  };

  return (
    <div
      className="network-view"
      onPointerDown={() => setActivePane(paneId)}
      data-pane={paneId}
    >
      <div className="network-header">
        <div>
          <h1>Network</h1>
          <p>Access servers and other computers on your local network.</p>
        </div>
        <div className="network-actions">
          <button
            type="button"
            className="home-action primary"
            onClick={() => openNetworkConnectionDialog()}
          >
            <Icon name="plus" size={14} />
            Connect to Server...
          </button>
          {browseLocation ? (
            <button
              type="button"
              className="home-action"
              onClick={() => void navigate(browseLocation.path, { paneId })}
            >
              <Icon name="network" size={14} />
              Browse Network
            </button>
          ) : null}
          <button
            type="button"
            className="home-action"
            title="Refresh mounted servers and nearby computers"
            onClick={() => void refresh()}
          >
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
      </div>

      <div className="network-scroll">
        <section className="network-section" aria-labelledby="saved-servers-title">
          <div className="home-section-heading">
            <h2 id="saved-servers-title">Saved servers</h2>
            <span className="home-section-hint">Kept across restarts</span>
          </div>
          {connections.length ? (
            <div className="network-list" role="list">
              {connections.map((connection) => {
                const mountedPath = connectionMountPath(connection, locations);
                return (
                  <div className="network-row" role="listitem" key={connection.id}>
                    <button
                      type="button"
                      className="network-main"
                      title={connection.address}
                      onClick={() => void openNetworkConnection(connection.id)}
                    >
                      <span className="network-icon">
                        <Icon name="server" size={20} />
                      </span>
                      <span className="network-copy">
                        <span className="network-name">{connection.name}</span>
                        <span className="network-address">{connection.address}</span>
                      </span>
                      <span className={`network-state ${mountedPath ? "connected" : ""}`}>
                        {mountedPath
                          ? "Connected"
                          : connection.lastConnectedAt
                            ? `Last used ${formatDate(connection.lastConnectedAt)}`
                            : "Not connected"}
                      </span>
                    </button>
                    <div className="network-row-actions">
                      {mountedPath ? (
                        <button
                          type="button"
                          className="home-action"
                          onClick={() => void navigate(mountedPath, { paneId })}
                        >
                          <Icon name="folderOpen" size={14} />
                          Open
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="home-action primary"
                          onClick={() => void connectNetworkConnection(connection.id)}
                        >
                          <Icon name="network" size={14} />
                          Connect
                        </button>
                      )}
                      <button
                        type="button"
                        className="home-action"
                        onClick={() => openNetworkConnectionDialog(connection.id)}
                      >
                        <Icon name="rename" size={14} />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="home-action danger"
                        onClick={() => remove(connection)}
                      >
                        <Icon name="delete" size={14} />
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="network-empty">
              <Icon name="network" size={34} />
              <h3>No saved servers yet</h3>
              <p>
                Add a server address like <code>smb://server/share</code> and it will
                stay here after MAXplorer restarts.
              </p>
              <button
                type="button"
                className="state-button primary"
                onClick={() => openNetworkConnectionDialog()}
              >
                <Icon name="plus" size={14} />
                Connect to Server
              </button>
            </div>
          )}
        </section>

        <section className="network-section" aria-labelledby="nearby-computers-title">
          <div className="home-section-heading">
            <h2 id="nearby-computers-title">Nearby computers</h2>
            <span className="home-section-hint">
              {discovering ? "Searching Bonjour..." : `${computers.length} found`}
            </span>
          </div>
          {discovering ? (
            <div className="network-hint">
              <Icon name="spinner" size={14} className="spin" /> Looking for SMB
              computers on your network...
            </div>
          ) : computers.length ? (
            <div className="network-list" role="list">
              {computers.map((computer) => (
                <div className="network-row" role="listitem" key={computer.name}>
                  <div className="network-main">
                    <span className="network-icon">
                      <Icon name="computer" size={20} />
                    </span>
                    <span className="network-copy">
                      <span className="network-name">{computer.name}</span>
                      <span className="network-address">
                        {computer.host ?? "Name could not be resolved"}
                      </span>
                    </span>
                  </div>
                  <div className="network-row-actions">
                    <button
                      type="button"
                      className="home-action primary"
                      onClick={() => configureComputer(computer)}
                    >
                      <Icon name="plus" size={14} />
                      Configure
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="network-hint">
              <p>
                No SMB computers were discovered. Check that MAXplorer is allowed
                under <strong>System Settings &gt; Privacy &amp; Security &gt; Local
                Network</strong>, then try again. You can still connect directly using{" "}
                <code>smb://computer-name/share</code>.
              </p>
              <button
                type="button"
                className="home-action"
                onClick={() => {
                  void api
                    .openSystemSettings("local_network")
                    .catch((cause) => useExplorerStore.getState().toastError(cause));
                }}
              >
                <Icon name="settings" size={14} />
                Open Local Network Settings
              </button>
            </div>
          )}
          {discoveryError ? <p className="dialog-error">{discoveryError}</p> : null}
        </section>

        <section className="network-section" aria-labelledby="network-volumes-title">
          <div className="home-section-heading">
            <h2 id="network-volumes-title">Connected servers</h2>
          </div>
          {networkVolumes.length ? (
            <div className="network-list" role="list">
              {networkVolumes.map((volume) => (
                <div
                  className="network-row connected"
                  role="listitem"
                  key={volume.path}
                >
                  <button
                    type="button"
                    className="network-main"
                    title={volume.path}
                    onClick={() => void navigate(volume.path, { paneId })}
                  >
                    <span className="network-icon">
                      <Icon name="network" size={20} />
                    </span>
                    <span className="network-copy">
                      <span className="network-name">{volume.name}</span>
                      <span className="network-address">{volume.path}</span>
                    </span>
                    <span className="network-state connected">Mounted</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="network-hint">
              Mounted network volumes appear here. Use Connect to Server to add one.
            </div>
          )}
        </section>

        <section className="network-section" aria-labelledby="network-help-title">
          <div className="home-section-heading">
            <h2 id="network-help-title">About network access</h2>
          </div>
          <p className="network-help">
            MAXplorer asks macOS NetFS to mount the server, just like Finder. When a
            password is needed, macOS shows its normal sign-in sheet and can remember
            the credential in your Keychain; MAXplorer never stores passwords. Use{" "}
            <strong>Browse Network</strong> for Bonjour and NetBIOS discovery. Saved
            addresses may use SMB, AFP, NFS, or FTP.
          </p>
          <div className="network-permissions">
            <strong>macOS permissions for network access</strong>
            <p>
              Local Network and Files &amp; Folders → Network Volumes are separate
              controls. Full Disk Access is also separate. Development builds are
              ad-hoc signed, so after replacing the app macOS can keep a permission
              toggle enabled while denying the new binary. If access still fails,
              remove and re-add MAXplorer in the relevant privacy list, or reset TCC
              after a rebuild.
            </p>
            <div className="network-row-actions">
              <button
                type="button"
                className="home-action"
                onClick={() =>
                  void api.openSystemSettings("local_network").catch((cause) =>
                    useExplorerStore.getState().toastError(cause),
                  )
                }
              >
                <Icon name="network" size={14} />
                Local Network
              </button>
              <button
                type="button"
                className="home-action"
                onClick={() =>
                  void api.openSystemSettings("network_volumes").catch((cause) =>
                    useExplorerStore.getState().toastError(cause),
                  )
                }
              >
                <Icon name="folder" size={14} />
                Network Volumes
              </button>
              <button
                type="button"
                className="home-action"
                onClick={() =>
                  void api.openSystemSettings("full_disk").catch((cause) =>
                    useExplorerStore.getState().toastError(cause),
                  )
                }
              >
                <Icon name="shield" size={14} />
                Full Disk Access
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
