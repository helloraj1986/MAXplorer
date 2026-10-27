import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icon";
import { FileGlyph } from "./FileGlyph";
import { useExplorerStore } from "../state/explorerStore";
import { basename } from "../lib/format";
import { HOME_LOCATION } from "../lib/types";

export function TitleBar() {
  const tabs = useExplorerStore((state) => state.tabs);
  const activeTabId = useExplorerStore((state) => state.activeTabId);
  const activateTab = useExplorerStore((state) => state.activateTab);
  const closeTabById = useExplorerStore((state) => state.closeTabById);
  const newTab = useExplorerStore((state) => state.newTab);
  const reorderTab = useExplorerStore((state) => state.reorderTab);
  const [maximized, setMaximized] = useState(false);
  const [draggedTab, setDraggedTab] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const windowHandle = getCurrentWindow();
    void windowHandle.isMaximized().then((value) => {
      if (!disposed) setMaximized(value);
    });
    void windowHandle
      .onResized(() => {
        void windowHandle.isMaximized().then((value) => {
          if (!disposed) setMaximized(value);
        });
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const titleFor = (location: string) => {
    if (location === HOME_LOCATION) return "Home";
    return basename(location) || location;
  };

  const toggleMaximize = () => {
    const windowHandle = getCurrentWindow();
    const operation = maximized ? windowHandle.unmaximize() : windowHandle.maximize();
    void operation.catch((error) => useExplorerStore.getState().toastError(error));
  };

  return (
    <header className="titlebar">
      <div className="tab-strip" data-tauri-drag-region>
        <div className="tabs" role="tablist" aria-label="File Explorer tabs">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={`tab ${tab.id === activeTabId ? "active" : ""}`}
              role="tab"
              aria-selected={tab.id === activeTabId}
              tabIndex={tab.id === activeTabId ? 0 : -1}
              draggable
              onDragStart={(event) => {
                setDraggedTab(tab.id);
                event.dataTransfer.setData("application/x-win11-tab", tab.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDraggedTab(null)}
              onDragOver={(event) => {
                if (draggedTab) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData("application/x-win11-tab") || draggedTab;
                const sourceIndex = tabs.findIndex((item) => item.id === sourceId);
                if (sourceIndex >= 0) reorderTab(sourceIndex, index);
                setDraggedTab(null);
              }}
              onClick={() => void activateTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  void closeTabById(tab.id);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void activateTab(tab.id);
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
                  void closeTabById(tab.id);
                }}
              >
                <Icon name="close" size={10} strokeWidth={1.4} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="tab-new"
          title="New tab"
          aria-label="New tab"
          onClick={() => void newTab()}
        >
          <Icon name="plus" size={14} />
        </button>
        <div
          className="titlebar-spacer"
          data-tauri-drag-region
          onDoubleClick={toggleMaximize}
        />
      </div>
      <div className="window-controls" onDoubleClick={toggleMaximize}>
        <button
          type="button"
          className="window-control"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => {
            void getCurrentWindow().minimize().catch((error) => useExplorerStore.getState().toastError(error));
          }}
        >
          <Icon name="minimize" size={10} strokeWidth={1.2} />
        </button>
        <button
          type="button"
          className="window-control"
          aria-label={maximized ? "Restore down" : "Maximize"}
          title={maximized ? "Restore down" : "Maximize"}
          onClick={toggleMaximize}
        >
          <Icon name={maximized ? "restore" : "maximize"} size={10} strokeWidth={1.2} />
        </button>
        <button
          type="button"
          className="window-control window-close"
          aria-label="Close"
          title="Close"
          onClick={() => {
            void getCurrentWindow().close().catch((error) => useExplorerStore.getState().toastError(error));
          }}
        >
          <Icon name="close" size={10} strokeWidth={1.2} />
        </button>
      </div>
    </header>
  );
}
