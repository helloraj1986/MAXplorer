import { Icon } from "./Icon";
import { useExplorerStore } from "../state/explorerStore";
import { basename } from "../lib/format";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  isTerminalTransfer,
  transferPercent,
  transferStatusLabel,
  transferStatusText,
} from "../lib/transfers";

function ProgressBar({ value }: { value: number | null }) {
  return (
    <div className="transfer-progress-track" aria-hidden="true">
      <span style={{ width: value == null ? "100%" : `${value}%` }} className={value == null ? "indeterminate" : ""} />
    </div>
  );
}

export function TransferPanel() {
  const open = useExplorerStore((state) => state.transfersOpen);
  const transfers = useExplorerStore((state) => state.transfers);
  const history = useExplorerStore((state) => state.transferHistory);
  const closeTransfers = useExplorerStore((state) => state.closeTransfers);
  const cancelTransfer = useExplorerStore((state) => state.cancelTransfer);
  const pauseTransfer = useExplorerStore((state) => state.pauseTransfer);
  const retryTransfer = useExplorerStore((state) => state.retryTransfer);
  const removeTransfer = useExplorerStore((state) => state.removeTransfer);
  const clearFinishedTransfers = useExplorerStore((state) => state.clearFinishedTransfers);

  if (!open) return null;
  const activeCount = transfers.filter((item) => !isTerminalTransfer(item)).length;

  return (
    <aside className="transfer-panel" aria-label="Transfers">
      <header className="transfer-header">
        <div>
          <strong>Transfers</strong>
          <span className="transfer-subtitle">
            {activeCount ? `${activeCount} active` : "No active transfers"}
          </span>
        </div>
        <div className="transfer-header-actions">
          <button
            type="button"
            className="link-button"
            onClick={clearFinishedTransfers}
            disabled={!transfers.some(isTerminalTransfer)}
          >
            Clear finished
          </button>
          <button
            type="button"
            className="transfer-close"
            aria-label="Close transfers"
            title="Close"
            onClick={closeTransfers}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      </header>

      <div className="transfer-list">
        {!transfers.length ? (
          <div className="transfer-empty">
            <Icon name="sync" size={26} />
            <p>Copy or move items between panes to see their progress here.</p>
          </div>
        ) : null}
        {transfers.map((item) => {
          const percent = transferPercent(item);
          const terminal = isTerminalTransfer(item);
          return (
            <div className={`transfer-item ${item.status}`} key={item.id}>
              <div className="transfer-item-head">
                <span className="transfer-mode">
                  <Icon name={item.mode === "copy" ? "copy" : "cut"} size={13} />
                  {item.mode === "copy" ? "Copy" : "Move"}
                </span>
                <span className="transfer-status">{transferStatusLabel(item)}</span>
                <span className="transfer-destination" title={item.destination}>
                  {item.sources.length} {item.sources.length === 1 ? "item" : "items"} to{" "}
                  {basename(item.destination) || item.destination}
                </span>
                <div className="transfer-item-actions">
                  {item.status === "running" ? (
                    <button
                      type="button"
                      className="transfer-action"
                      title="Pause"
                      aria-label="Pause"
                      onClick={() => void pauseTransfer(item.id, true)}
                    >
                      <Icon name="minimize" size={11} />
                    </button>
                  ) : null}
                  {item.status === "paused" ? (
                    <button
                      type="button"
                      className="transfer-action"
                      title="Resume"
                      aria-label="Resume"
                      onClick={() => void pauseTransfer(item.id, false)}
                    >
                      <Icon name="forward" size={11} />
                    </button>
                  ) : null}
                  {!terminal ? (
                    <button
                      type="button"
                      className="transfer-action"
                      title="Cancel"
                      aria-label="Cancel"
                      onClick={() => void cancelTransfer(item.id)}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  ) : (
                    <>
                      {item.status === "failed" || item.status === "cancelled" ? (
                        <button
                          type="button"
                          className="transfer-action"
                          title="Retry"
                          aria-label="Retry"
                          onClick={() => void retryTransfer(item.id)}
                        >
                          <Icon name="refresh" size={11} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="transfer-action"
                        title="Remove from list"
                        aria-label="Remove from list"
                        onClick={() => removeTransfer(item.id)}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <ProgressBar value={percent} />
              <div className="transfer-meta">
                <span>
                  {formatBytes(item.processedBytes)}
                  {item.totalBytes ? ` of ${formatBytes(item.totalBytes)}` : ""}
                </span>
                <span>{formatSpeed(item.bytesPerSecond)}</span>
                <span>{formatEta(item.etaSeconds)}</span>
                {item.totalItems ? (
                  <span>
                    {item.processedItems}/{item.totalItems} items
                  </span>
                ) : null}
              </div>
              {item.currentFile ? (
                <div className="transfer-current" title={item.currentFile}>
                  {item.currentFile}
                </div>
              ) : null}
              {item.error ? <div className="transfer-error">{item.error}</div> : null}
              {!item.error && item.message ? (
                <div className="transfer-message">{item.message}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      {history.length ? (
        <section className="transfer-history">
          <h3>Recent transfers</h3>
          {history.slice(0, 8).map((item) => (
            <div className="transfer-history-row" key={`${item.id}-${item.completedAt}`}>
              <Icon name={item.mode === "copy" ? "copy" : "cut"} size={11} />
              <span className="transfer-history-name" title={item.destination}>
                {basename(item.destination) || item.destination}
              </span>
              <span className={`transfer-history-status ${item.status}`}>
                {transferStatusText(item.status)}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </aside>
  );
}
