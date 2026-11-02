import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { FolderIcon } from "./icons/FolderIcon";
import { MenuPanel, type MenuItem } from "./Menu";
import { useExplorerStore } from "../state/explorerStore";
import { beginTabDrag } from "../state/fileDrag";
import { basename } from "../lib/format";
import {
  HOME_LOCATION,
  NETWORK_LOCATION,
  RECENTS_LOCATION,
  isVirtualLocation,
  type PaneId,
} from "../lib/types";

function titleFor(location: string): string {
  if (location === HOME_LOCATION) return "Home";
  if (location === RECENTS_LOCATION) return "Recents";
  if (location === NETWORK_LOCATION) return "Network";
  return basename(location) || location;
}

function iconFor(location: string): "home" | "clock" | "network" | "folder" {
  if (location === HOME_LOCATION) return "home";
  if (location === RECENTS_LOCATION) return "clock";
  if (location === NETWORK_LOCATION) return "network";
  return "folder";
}

export function PaneTabList({ paneId }: { paneId: PaneId }) {
  const tabs = useExplorerStore((state) => state.panes[paneId].tabs);
  const activeTabId = useExplorerStore((state) => state.panes[paneId].activeTabId);
  const activateTab = useExplorerStore((state) => state.activateTab);
  const closeTabById = useExplorerStore((state) => state.closeTabById);

  return (
    <div className="tabs" role="tablist" aria-label="MAXplorer tabs" data-pane={paneId}>
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
          data-drop-path={
            isVirtualLocation(tab.location)
              ? undefined
              : tab.location
          }
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
          title={isVirtualLocation(tab.location) ? titleFor(tab.location) : tab.location}
        >
          <span className="tab-icon" aria-hidden="true">
            {iconFor(tab.location) === "folder" ? (
              <FolderIcon size={16} />
            ) : (
              <Icon name={iconFor(tab.location)} size={16} />
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

/**
 * Overflow and tab-management menu. It keeps every tab reachable even when the
 * row is narrower than the sum of the tab widths.
 */
function TabMenuButton({ paneId }: { paneId: PaneId }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tabs = useExplorerStore((state) => state.panes[paneId].tabs);
  const activeTabId = useExplorerStore((state) => state.panes[paneId].activeTabId);
  const activateTab = useExplorerStore((state) => state.activateTab);
  const newTab = useExplorerStore((state) => state.newTab);
  const duplicateActiveTab = useExplorerStore((state) => state.duplicateActiveTab);
  const closeActiveTab = useExplorerStore((state) => state.closeActiveTab);
  const closeOtherTabs = useExplorerStore((state) => state.closeOtherTabs);
  const platform = useExplorerStore((state) => state.platform);
  const mod = platform?.modifier === "cmd" ? "Cmd" : "Ctrl";

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);

  const items: MenuItem[] = [
    ...tabs.map((tab) => ({
      label: titleFor(tab.location),
      checked: tab.id === activeTabId,
      onClick: () => void activateTab(tab.id, paneId),
    })),
    { type: "separator" },
    { label: "New tab", icon: "plus", shortcut: `${mod}+T`, onClick: () => void newTab(undefined, paneId) },
    { label: "Duplicate tab", icon: "copy", onClick: () => duplicateActiveTab(paneId) },
    { label: "Close tab", icon: "close", shortcut: `${mod}+W`, onClick: () => void closeActiveTab(paneId) },
    {
      label: "Close other tabs",
      icon: "close",
      disabled: tabs.length < 2,
      onClick: () => closeOtherTabs(activeTabId, paneId),
    },
  ];

  return (
    <div className="tab-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`tab-menu ${open ? "open" : ""}`}
        title="All tabs"
        aria-label="All tabs"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="chevronDown" size={12} />
      </button>
      {open ? (
        <div className="dropdown-menu align-right tab-menu-dropdown">
          <MenuPanel items={items} width={214} itemHeight={30} showIcons onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Layer 3 tab row. Single-pane mode renders one global row; dual-pane mode
 * renders a row per pane with an active-pane badge and a collapse control.
 */
export function TabBar({
  paneId,
  showPaneLabel = false,
  onCollapse,
}: {
  paneId: PaneId;
  showPaneLabel?: boolean;
  onCollapse?: () => void;
}) {
  const activePane = useExplorerStore((state) => state.activePane);
  const setActivePane = useExplorerStore((state) => state.setActivePane);
  const active = activePane === paneId;
  return (
    <div
      className={`tabbar ${showPaneLabel ? "pane-tabbar" : ""} ${active ? "active-pane" : ""}`}
      data-pane={paneId}
      onPointerDown={() => setActivePane(paneId)}
      role="toolbar"
      aria-label={`${showPaneLabel ? (paneId === "left" ? "Left pane" : "Right pane") : "Tab"} tabs`}
    >
      {showPaneLabel ? (
        <span className={`tabbar-pane-badge ${active ? "active" : ""}`} aria-label={`${active ? "Active" : "Inactive"} pane`}>
          <span className="tabbar-pane-dot" aria-hidden="true" />
          {paneId === "left" ? "Left" : "Right"}
        </span>
      ) : null}
      <PaneTabList paneId={paneId} />
      <PaneNewTabButton paneId={paneId} />
      <TabMenuButton paneId={paneId} />
      {onCollapse ? (
        <button
          type="button"
          className="pane-collapse"
          title="Collapse this pane"
          aria-label="Collapse this pane"
          onClick={onCollapse}
        >
          <Icon name={paneId === "left" ? "chevronLeft" : "chevronRight"} size={13} />
        </button>
      ) : null}
    </div>
  );
}

/** Dual-pane header row: Layer 3 tabs for one pane. */
export function PaneTabStrip({ paneId, onCollapse }: { paneId: PaneId; onCollapse?: () => void }) {
  return <TabBar paneId={paneId} showPaneLabel onCollapse={onCollapse} />;
}
