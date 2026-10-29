import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icon";
import { PaneNewTabButton, PaneTabList } from "./PaneTabs";
import { useExplorerStore } from "../state/explorerStore";
import { acceleratorToDisplay } from "../lib/panes";

export function TitleBar() {
  const dualPane = useExplorerStore((state) => state.dualPane);
  const toggleDualPane = useExplorerStore((state) => state.toggleDualPane);
  const shortcuts = useExplorerStore((state) => state.shortcuts);
  const platform = useExplorerStore((state) => state.platform);
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const [maximized, setMaximized] = useState(false);

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

  const toggleMaximize = () => {
    const windowHandle = getCurrentWindow();
    const operation = maximized ? windowHandle.unmaximize() : windowHandle.maximize();
    void operation.catch((error) => useExplorerStore.getState().toastError(error));
  };

  return (
    <header className="titlebar">
      {interfaceTheme === "finder" ? (
        <div className="traffic-lights" onDoubleClick={toggleMaximize}>
          <button
            type="button"
            className="traffic-light traffic-close"
            aria-label="Close window"
            title="Close"
            onClick={() => {
              void getCurrentWindow().close().catch((error) => useExplorerStore.getState().toastError(error));
            }}
          >
            <Icon name="close" size={8} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="traffic-light traffic-minimize"
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => {
              void getCurrentWindow().minimize().catch((error) => useExplorerStore.getState().toastError(error));
            }}
          >
            <Icon name="minimize" size={8} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="traffic-light traffic-zoom"
            aria-label={maximized ? "Restore window" : "Zoom window"}
            title={maximized ? "Restore" : "Zoom"}
            onClick={toggleMaximize}
          >
            <Icon name="fullscreen" size={8} strokeWidth={1.8} />
          </button>
        </div>
      ) : null}
      <div className="tab-strip" data-tauri-drag-region>
        {dualPane ? (
          <span className="dual-title">
            <Icon name="columns" size={14} />
            Dual pane
          </span>
        ) : (
          <>
            <PaneTabList paneId="left" />
            <PaneNewTabButton paneId="left" />
          </>
        )}
        <div
          className="titlebar-spacer"
          data-tauri-drag-region
          onDoubleClick={toggleMaximize}
        />
        <button
          type="button"
          className={`titlebar-dual-toggle ${dualPane ? "active" : ""}`}
          title={`${dualPane ? "Leave" : "Enter"} dual-pane mode (${acceleratorToDisplay(
            shortcuts.toggleDualPane,
            platform?.platform ?? "macos",
          )})`}
          aria-label={dualPane ? "Leave dual-pane mode" : "Enter dual-pane mode"}
          aria-pressed={dualPane}
          onClick={toggleDualPane}
        >
          <Icon name="columns" size={14} />
        </button>
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
