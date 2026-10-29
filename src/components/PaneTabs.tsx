import { Icon } from "./Icon";
import { FileGlyph } from "./FileGlyph";
import { useExplorerStore } from "../state/explorerStore";
import { beginTabDrag } from "../state/fileDrag";
import { basename } from "../lib/format";
import { HOME_LOCATION, type PaneId } from "../lib/types";

function titleFor(location: string): string {
  if (location === HOME_LOCATION) return "Home";
  return basename(location) || location;
}

/**
 * Tab strip for one pane. Single-pane mode renders it inside the title bar;
 * dual-pane mode renders one compact strip above each pane's address bar.
 */
export function PaneTabList({ paneId }: { paneId: PaneId }) {
  const tabs = useExplorerStore((state) => state.panes[paneId].tabs);
  const activeTabId = useExplorerStore((state) => state.panes[paneId].activeTabId);
  const activateTab = useExplorerStore((state) => state.activateTab);
  const closeTabById = useExplorerStore((state) => state.closeTabById);
  const platform = useExplorerStore((state) => state.platform);

  return (
    <div className="tabs" role="tablist" aria-label="File Explorer tabs" data-pane={paneId}>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""}`}
          role="tab"
          aria-selected={tab.id === activeTabId}
          tabIndex={tab.id === activeTabId ? 0 : -1}
          onPointerDown={(event) =>
            beginTabDrag(event, { id: tab.id, index, label: titleFor(tab.location) }, paneId)
          }
          data-drop-tab={tab.id}
          data-drop-tab-index={index}
          data-drop-tab-label={titleFor(tab.location)}
          data-drop-path={tab.location === HOME_LOCATION ? platform?.home : tab.location}
          data-drop-label={titleFor(tab.location)}
          onClick={() => void activateTab(tab.id, paneId)}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              void closeTabById(tab.id, paneId);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void activateTab(tab.id, paneId);
            }
          }}
          title={tab.location === HOME_LOCATION ? "Home" : tab.location}
        >
          <span className="tab-icon" aria-hidden="true">
            {tab.location === HOME_LOCATION ? (
              <Icon name="home" size={16} />
            ) : (
              <FileGlyph category="folder" size={16} />
            )}
          </span>
          <span className="tab-title">{titleFor(tab.location)}</span>
          <button
            type="button"
            className="tab-close"
            aria-label={`Close ${titleFor(tab.location)} tab`}
            title="Close tab"
            onClick={(event) => {
              event.stopPropagation();
              void closeTabById(tab.id, paneId);
            }}
          >
            <Icon name="close" size={10} strokeWidth={1.4} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function PaneNewTabButton({ paneId }: { paneId: PaneId }) {
  const newTab = useExplorerStore((state) => state.newTab);
  return (
    <button
      type="button"
      className="tab-new"
      title="New tab"
      aria-label="New tab"
      onClick={() => void newTab(undefined, paneId)}
    >
      <Icon name="plus" size={14} />
    </button>
  );
}

export function PaneTabStrip({ paneId }: { paneId: PaneId }) {
  return (
    <div className="pane-tab-strip">
      <PaneTabList paneId={paneId} />
      <PaneNewTabButton paneId={paneId} />
    </div>
  );
}
