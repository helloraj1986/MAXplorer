import { Icon } from "./Icon";
import { useExplorerStore, selectStatusText } from "../state/explorerStore";

export function StatusBar() {
  const text = useExplorerStore(selectStatusText);
  const viewMode = useExplorerStore((state) => state.viewMode);
  const setViewMode = useExplorerStore((state) => state.setViewMode);
  const tab = useExplorerStore((state) => state.tabs.find((item) => item.id === state.activeTabId));
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
      </div>
      <div className="status-right">
        <button
          type="button"
          className={`status-view ${viewMode === "details" ? "active" : ""}`}
          aria-label="Details view"
          title="Details view"
          onClick={() => setViewMode("details")}
        >
          <Icon name="details" size={14} />
        </button>
        <button
          type="button"
          className={`status-view ${viewMode === "large" ? "active" : ""}`}
          aria-label="Large icons view"
          title="Large icons view"
          onClick={() => setViewMode("large")}
        >
          <Icon name="grid" size={14} />
        </button>
      </div>
    </footer>
  );
}
