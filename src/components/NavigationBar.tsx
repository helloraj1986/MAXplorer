import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { FolderIcon } from "./icons/FolderIcon";
import { StorageIcon } from "./icons/StorageIcon";
import { MenuPanel } from "./Menu";
import { useExplorerStore } from "../state/explorerStore";
import { useElementSize } from "../hooks/useElementSize";
import { basename, breadcrumbs } from "../lib/format";
import { copyTextToClipboard } from "../lib/clipboard";
import { HOME_LOCATION, type PaneId } from "../lib/types";

export function NavigationBar({ paneId }: { paneId?: PaneId }) {
  const activePane = useExplorerStore((state) => state.activePane);
  const id = paneId ?? activePane;
  const platform = useExplorerStore((state) => state.platform);
  const activeTab = useExplorerStore((state) => state.panes[id].tabs.find((tab) => tab.id === state.panes[id].activeTabId));
  const breadcrumbItems = useMemo(
    () =>
      breadcrumbs(
        activeTab?.location ?? HOME_LOCATION,
        platform?.platform === "macos" ? "Macintosh HD" : platform?.computerLabel ?? "This PC",
        HOME_LOCATION,
      ),
    [activeTab?.location, platform?.computerLabel, platform?.platform],
  );
  const navigate = useExplorerStore((state) => state.navigate);
  const goBack = useExplorerStore((state) => state.goBack);
  const goForward = useExplorerStore((state) => state.goForward);
  const goUp = useExplorerStore((state) => state.goUp);
  const refresh = useExplorerStore((state) => state.refresh);
  const setSearchQuery = useExplorerStore((state) => state.setSearchQuery);
  const runSearch = useExplorerStore((state) => state.runSearch);
  const clearSearch = useExplorerStore((state) => state.clearSearch);
  const toast = useExplorerStore((state) => state.toast);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressMenu, setAddressMenu] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addressWrapRef = useRef<HTMLDivElement>(null);
  const crumbsRef = useRef<HTMLDivElement>(null);
  const { ref: navbarRef, width: navbarWidth } = useElementSize<HTMLDivElement>();

  // Panes can be dragged very narrow in dual-pane mode, so the bar adapts to its
  // own width instead of the window width.
  const density: "regular" | "compact" | "narrow" | "tiny" =
    navbarWidth === 0 || navbarWidth >= 900
      ? "regular"
      : navbarWidth >= 620
        ? "compact"
        : navbarWidth >= 440
          ? "narrow"
          : "tiny";

  const location = activeTab?.location ?? HOME_LOCATION;
  const canBack = (activeTab?.historyIndex ?? 0) > 0;
  const canForward = activeTab ? activeTab.historyIndex < activeTab.history.length - 1 : false;
  const canUp = location !== HOME_LOCATION && Boolean(basename(location) && location !== "/");
  const folderName = location === HOME_LOCATION ? "Home" : basename(location) || location;
  const isHome = location === HOME_LOCATION;
  const rootLabel = platform?.platform === "macos" ? "Macintosh HD" : platform?.computerLabel ?? "This PC";

  useEffect(() => {
    const focusAddress = () => {
      if (useExplorerStore.getState().activePane !== id) return;
      setDraft(location === HOME_LOCATION ? "Home" : location);
      setEditing(true);
      setAddressError(null);
      window.setTimeout(() => {
        addressRef.current?.focus();
        addressRef.current?.select();
      }, 0);
    };
    const focusSearch = () => {
      if (useExplorerStore.getState().activePane !== id) return;
      window.setTimeout(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      }, 0);
    };
    window.addEventListener("explorer:focus-address", focusAddress);
    window.addEventListener("explorer:focus-search", focusSearch);
    return () => {
      window.removeEventListener("explorer:focus-address", focusAddress);
      window.removeEventListener("explorer:focus-search", focusSearch);
    };
  }, [id, location]);

  useEffect(() => {
    if (!editing) return;
    const timer = window.setTimeout(() => {
      const input = addressRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editing]);

  useEffect(() => {
    if (!addressMenu) return;
    const close = (event: PointerEvent) => {
      if (!addressWrapRef.current?.contains(event.target as Node)) setAddressMenu(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [addressMenu]);

  // When the path does not fit, keep the current folder in view instead of the
  // root end of the trail.
  useLayoutEffect(() => {
    const element = crumbsRef.current;
    if (!element) return;
    element.scrollLeft = element.scrollWidth;
  }, [location, navbarWidth, editing]);

  const submitAddress = async () => {
    const value = draft.trim();
    if (!value) return;
    if (value === "Home" || value === "home") {
      setEditing(false);
      await navigate(HOME_LOCATION, { paneId: id });
      return;
    }
    const ok = await navigate(value, { paneId: id });
    if (ok) {
      setEditing(false);
      setAddressError(null);
    } else {
      setAddressError("We can't find that path.");
    }
  };

  const copyAddress = async (asText: boolean) => {
    const value = location === HOME_LOCATION ? (platform?.home ?? "Home") : location;
    const ok = await copyTextToClipboard(value);
    toast({
      title: ok ? "Address copied" : "Couldn't copy the address",
      detail: asText ? value : undefined,
      tone: ok ? "success" : "error",
    });
    setAddressMenu(false);
  };

  return (
    <div
      className="navbar"
      data-density={density}
      ref={navbarRef}
      onPointerDown={() => useExplorerStore.getState().setActivePane(id)}
    >
      <button
        type="button"
        className="nav-btn"
        aria-label="Back"
        title="Back (Alt+Left)"
        disabled={!canBack}
        onClick={() => void goBack(id)}
      >
        <Icon name="back" size={16} />
      </button>
      <button
        type="button"
        className="nav-btn"
        aria-label="Forward"
        title="Forward (Alt+Right)"
        disabled={!canForward}
        onClick={() => void goForward(id)}
      >
        <Icon name="forward" size={16} />
      </button>
      <button
        type="button"
        className="nav-btn"
        aria-label="Up"
        title="Up one level (Alt+Up)"
        disabled={!canUp}
        onClick={() => void goUp(id)}
      >
        <Icon name="up" size={16} />
      </button>
      <div className="address-wrap" ref={addressWrapRef}>
        <div className={`address-bar ${editing ? "editing" : ""} ${addressError ? "invalid" : ""}`}>
          <span className="address-folder" aria-hidden="true">
            {isHome ? <Icon name="home" size={16} /> : <FolderIcon size={16} />}
          </span>
          {editing ? (
            <input
              ref={addressRef}
              className="address-input"
              value={draft}
              spellCheck={false}
              autoComplete="off"
              aria-label="Address"
              onChange={(event) => {
                setDraft(event.target.value);
                setAddressError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitAddress();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                  setAddressError(null);
                }
              }}
              onBlur={() => {
                window.setTimeout(() => {
                  if (!addressWrapRef.current?.contains(document.activeElement)) {
                    setEditing(false);
                    setAddressError(null);
                  }
                }, 120);
              }}
            />
          ) : (
            <div
              className="breadcrumbs"
              ref={crumbsRef}
              onDoubleClick={() => {
                setDraft(location === HOME_LOCATION ? "Home" : location);
                setEditing(true);
              }}
            >
              {breadcrumbItems.map((crumb, index) => (
                <span className="crumb-wrap" key={`${crumb.path}-${index}`}>
                  <button
                    type="button"
                    className={`crumb ${index === breadcrumbItems.length - 1 ? "current" : ""}`}
                    title={crumb.path}
                    onClick={() => {
                      setAddressError(null);
                      void navigate(crumb.path, { paneId: id });
                    }}
                  >
                    {index === 0 ? (
                      <StorageIcon size={14} variant="internal" className="crumb-icon" />
                    ) : null}
                    <span>{crumb.label}</span>
                  </button>
                  {index < breadcrumbItems.length - 1 ? (
                    <Icon name="chevronRight" size={11} className="crumb-separator" />
                  ) : null}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            className="address-dropdown"
            aria-label="Address options"
            title="Address options"
            onClick={() => setAddressMenu((value) => !value)}
          >
            <Icon name="chevronDown" size={11} />
          </button>
        </div>
        {addressError ? <div className="address-error">{addressError}</div> : null}
        {addressMenu ? (
          <div className="address-menu">
            <MenuPanel
              items={[
                { label: "Copy address", icon: "copyPath", onClick: () => void copyAddress(false) },
                {
                  label: "Edit address",
                  icon: "renameFile",
                  onClick: () => {
                    setDraft(location === HOME_LOCATION ? "Home" : location);
                    setEditing(true);
                    setAddressMenu(false);
                    window.setTimeout(() => addressRef.current?.select(), 0);
                  },
                },
                { label: "Copy address as text", icon: "copy", onClick: () => void copyAddress(true) },
              ]}
              width={208}
              itemHeight={32}
              showIcons
              onClose={() => setAddressMenu(false)}
            />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={`nav-btn refresh-btn ${activeTab?.loading ? "spinning" : ""}`}
        aria-label="Refresh"
        title="Refresh (F5)"
        onClick={() => void refresh(id)}
      >
        <Icon name="refresh" size={16} />
      </button>
      <div
        className={`search-box ${activeTab?.searchLoading ? "loading" : ""}`}
        onClick={() => searchRef.current?.focus()}
      >
        <span className="search-icon" aria-hidden="true">
          {activeTab?.searchLoading ? (
            <Icon name="spinner" size={16} className="spin" />
          ) : (
            <Icon name="search" size={16} />
          )}
        </span>
        <input
          ref={searchRef}
          type="search"
          className="search-input"
          value={activeTab?.searchQuery ?? ""}
          placeholder={`Search ${folderName}`}
          aria-label={`Search ${folderName}`}
          spellCheck={false}
          onChange={(event) => setSearchQuery(event.target.value, id)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch(id);
            } else if (event.key === "Escape") {
              event.preventDefault();
              clearSearch(id);
              searchRef.current?.blur();
            }
          }}
        />
        {activeTab?.searchQuery ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => {
              clearSearch(id);
              searchRef.current?.focus();
            }}
          >
            <Icon name="close" size={10} />
          </button>
        ) : null}
      </div>
      <span className="sr-only">{rootLabel}</span>
    </div>
  );
}
