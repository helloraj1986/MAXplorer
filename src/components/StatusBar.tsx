import { Icon } from "./Icon";
import { SyncStatusIcon, type SyncState } from "./icons/SyncStatusIcon";
import { useExplorerStore, selectStatusText } from "../state/explorerStore";
import { isTerminalTransfer } from "../lib/transfers";

function transferSyncState(transfers: Array<{ status: string }>): SyncState {
  if (transfers.some((item) => item.status === "failed")) return "error";
  if (transfers.some((item) => item.status === "running" || item.status === "scanning")) return "syncing";
  if (transfers.some((item) => item.status === "queued")) return "pending";
  if (transfers.some((item) => item.status === "paused")) return "offline";
  if (transfers.some((item) => item.status === "cancelled")) return "offline";
  return "synced";
}

export function StatusBar() {
  const text = useExplorerStore(selectStatusText);
  const activePane = useExplorerStore((state) => state.activePane);
  const dualPane = useExplorerStore((state) => state.dualPane);
  const transfers = useExplorerStore((state) => state.transfers);
  const openTransfers = useExplorerStore((state) => state.openTransfers);
  const viewMode = useExplorerStore((state) => state.panes[state.activePane].viewMode);
  const setViewMode = useExplorerStore((state) => state.setViewMode);
  const tab = useExplorerStore(
    (state) => state.panes[state.activePane].tabs.find(
      (item) => item.id === state.panes[state.activePane].activeTabId,
    ),
  );
  const operation = useExplorerStore((state) => state.operation);

  return (
    <footer className="statusbar" aria-live="polite">
      <div className="status-left">
        {operation ? (
          <span className="status-operation">
            <Icon name="spinner" size={12} className="spin" />
            {operation.title}
          </span>
        ) : (
          <span>{text}</span>
        )}
        {tab?.searchLoading ? <span className="status-searching">Searching...</span> : null}
        {dualPane ? (
          <span className={`status-pane-chip ${activePane}`}>
            {activePane === "left" ? "Left pane" : "Right pane"}
          </span>
        ) : null}
      </div>
      <div className="status-right">
        {transfers.length ? (
          <button
            type="button"
            className="status-transfers"
            title="Show transfers"
            aria-label={`Show transfers (${transfers.filter((item) => !isTerminalTransfer(item)).length || transfers.length})`}
            onClick={openTransfers}
          >
            <SyncStatusIcon state={transferSyncState(transfers)} size={12} />
            {transfers.filter((item) => !isTerminalTransfer(item)).length || transfers.length}
          </button>
        ) : null}
        <button
          type="button"
          className={`status-view ${viewMode === "details" ? "active" : ""}`}
          aria-label="Details view"
          title="Details view"
          onClick={() => setViewMode("details", activePane)}
        >
          <Icon name="details" size={14} />
        </button>
        <button
          type="button"
          className={`status-view ${viewMode === "large" ? "active" : ""}`}
          aria-label="Large icons view"
          title="Large icons view"
          onClick={() => setViewMode("large", activePane)}
        >
          <Icon name="grid" size={14} />
        </button>
      </div>
    </footer>
  );
}
