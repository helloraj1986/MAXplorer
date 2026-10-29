import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/TitleBar";
import { CommandBar } from "./components/CommandBar";
import { NavigationBar } from "./components/NavigationBar";
import { Sidebar } from "./components/Sidebar";
import { FileArea } from "./components/FileArea";
import { DualPaneWorkspace } from "./components/DualPaneWorkspace";
import { DetailsPane } from "./components/DetailsPane";
import { PreviewPane } from "./components/PreviewPane";
import { StatusBar } from "./components/StatusBar";
import { TransferPanel } from "./components/TransferPanel";
import { ComparisonPanel } from "./components/ComparisonPanel";
import { ContextMenu } from "./components/ContextMenu";
import { Dialogs } from "./components/Dialogs";
import { Toasts } from "./components/Toasts";
import { FileDragOverlay } from "./components/FileDragOverlay";
import { OperationOverlay } from "./components/OperationOverlay";
import { Icon } from "./components/Icon";
import { useExplorerStore } from "./state/explorerStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useTheme } from "./hooks/useTheme";
import { useWindowPersistence } from "./hooks/useWindowPersistence";
import { isTauri } from "./lib/api";
import { APP_ICON_URL, PRODUCT_NAME, TAGLINE } from "./lib/branding";
import { HOME_LOCATION } from "./lib/types";

export default function App() {
  const initialize = useExplorerStore((state) => state.initialize);
  const initialized = useExplorerStore((state) => state.initialized);
  const fatalError = useExplorerStore((state) => state.fatalError);
  const detailsPane = useExplorerStore((state) => state.detailsPane);
  const previewPane = useExplorerStore((state) => state.previewPane);
  const dualPane = useExplorerStore((state) => state.dualPane);
  const activeTab = useExplorerStore(
    (state) => state.panes[state.activePane].tabs.find(
      (tab) => tab.id === state.panes[state.activePane].activeTabId,
    ),
  );
  const platform = useExplorerStore((state) => state.platform);
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const [osDropActive, setOsDropActive] = useState(false);
  useTheme();

  useWindowPersistence();
  useKeyboardShortcuts();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const prevent = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", prevent);
    return () => document.removeEventListener("contextmenu", prevent);
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("maxplorer://about", () => {
      useExplorerStore.getState().openDialog({ kind: "about" });
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setOsDropActive(true);
        } else if (event.payload.type === "leave") {
          setOsDropActive(false);
        } else if (event.payload.type === "drop") {
          setOsDropActive(false);
          const store = useExplorerStore.getState();
          const destination = store.currentFolder();
          if (!destination || !event.payload.paths.length) return;
          void store.moveOrCopyPaths(event.payload.paths, destination, "copy");
        }
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!activeTab) return;
    const label =
      activeTab.location === HOME_LOCATION
        ? "Home"
        : activeTab.location.split(/[\\/]/).filter(Boolean).pop() || PRODUCT_NAME;
    document.title = `${label} - ${PRODUCT_NAME}`;
  }, [activeTab?.location]);

  if (fatalError) {
    return (
      <div className="boot-screen error-boot">
        <div className="boot-card">
          <img className="boot-app-icon" src={APP_ICON_URL} alt="" />
          <h1>{PRODUCT_NAME} couldn't start</h1>
          <p>{fatalError.message}</p>
          {fatalError.code === "not_tauri" ? (
            <p className="muted">Run the desktop app with <code>npm run tauri:dev</code>.</p>
          ) : null}
          <button type="button" className="state-button primary" onClick={() => window.location.reload()}>
            <Icon name="refresh" size={14} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <img className="boot-app-icon" src={APP_ICON_URL} alt="" />
          <h1>{PRODUCT_NAME}</h1>
          <p className="boot-tagline">{TAGLINE}</p>
          <p>
            {interfaceTheme === "finder"
              ? "Starting the macOS Finder theme..."
              : "Starting the Windows Explorer theme..."}
          </p>
          <div className="boot-progress">
            <span />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${osDropActive ? "os-drop-active" : ""}`}>
      <TitleBar />
      <div className={`chrome ${dualPane ? "dual-chrome" : ""}`}>
        <CommandBar />
        {!dualPane ? <NavigationBar /> : null}
      </div>
      <div className="main-area">
        <Sidebar />
        {dualPane ? (
          <DualPaneWorkspace />
        ) : (
          <div className="workspace">
            <div className="file-pane">
              <FileArea />
            </div>
            {detailsPane ? <DetailsPane /> : null}
            {previewPane ? <PreviewPane /> : null}
          </div>
        )}
      </div>
      <ComparisonPanel />
      <StatusBar />
      <ContextMenu />
      <Dialogs />
      <OperationOverlay />
      <Toasts />
      <TransferPanel />
      <FileDragOverlay />
      {osDropActive ? (
        <div className="os-drop-overlay">
          <div className="os-drop-card">
            <Icon name="downloads" size={28} />
            <span>Drop to copy into the current folder</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
