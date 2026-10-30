import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icon";
import { useExplorerStore } from "../state/explorerStore";
import { APP_ICON_URL, PRODUCT_NAME } from "../lib/branding";
import { basename } from "../lib/format";
import { HOME_LOCATION } from "../lib/types";

/**
 * Window chrome only. Tabs live in their own Layer 3 row, and workspace controls
 * live in the command bar, so this bar never mixes navigation with commands.
 */
export function TitleBar() {
  const platform = useExplorerStore((state) => state.platform);
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const activeTab = useExplorerStore(
    (state) => state.panes[state.activePane].tabs.find(
      (tab) => tab.id === state.panes[state.activePane].activeTabId,
    ),
  );
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

  const label =
    activeTab?.location === HOME_LOCATION
      ? "Home"
      : activeTab?.location
        ? basename(activeTab.location) || activeTab.location
        : PRODUCT_NAME;
  const detail =
    activeTab?.location && activeTab.location !== HOME_LOCATION ? activeTab.location : platform?.home ?? "";

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
      <div className="titlebar-identity" data-tauri-drag-region>
        <img className="titlebar-app-icon" src={APP_ICON_URL} alt="" aria-hidden="true" />
        <span className="titlebar-product">{PRODUCT_NAME}</span>
        <span className="titlebar-divider" aria-hidden="true" />
        <span className="titlebar-location" title={detail || label}>
          {label}
        </span>
      </div>
      <div className="titlebar-spacer" data-tauri-drag-region onDoubleClick={toggleMaximize} />
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
