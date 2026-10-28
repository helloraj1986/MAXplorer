import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "./Icon";
import { MenuPanel, type MenuItem } from "./Menu";
import { useExplorerStore } from "../state/explorerStore";
import { HOME_LOCATION, type GroupBy, type ViewMode } from "../lib/types";

type MenuName = "new" | "sort" | "view" | "more" | null;

const VIEW_ITEMS: Array<{ mode: ViewMode; label: string; icon: "grid" | "list" | "details" | "view" }> = [
  { mode: "extraLarge", label: "Extra large icons", icon: "grid" },
  { mode: "large", label: "Large icons", icon: "grid" },
  { mode: "medium", label: "Medium icons", icon: "grid" },
  { mode: "small", label: "Small icons", icon: "grid" },
  { mode: "list", label: "List", icon: "list" },
  { mode: "details", label: "Details", icon: "details" },
  { mode: "tiles", label: "Tiles", icon: "view" },
  { mode: "content", label: "Content", icon: "view" },
];

function shortcutLabel(platform: string, keys: string): string {
  if (platform === "macos") return keys.replace(/Ctrl/g, "Cmd").replace(/Shift/g, "Shift").replace(/Alt/g, "Alt");
  return keys;
}

export function CommandBar() {
  const [menu, setMenu] = useState<MenuName>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const platform = useExplorerStore((state) => state.platform);
  const activeTab = useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const selectedEntries = useExplorerStore(useShallow((state) => state.selectedEntries()));
  const clipboard = useExplorerStore((state) => state.clipboard);
  const viewMode = useExplorerStore((state) => state.viewMode);
  const sortKey = useExplorerStore((state) => state.sortKey);
  const sortDirection = useExplorerStore((state) => state.sortDirection);
  const groupBy = useExplorerStore((state) => state.groupBy);
  const showHidden = useExplorerStore((state) => state.showHidden);
  const showExtensions = useExplorerStore((state) => state.showExtensions);
  const detailsPane = useExplorerStore((state) => state.detailsPane);
  const previewPane = useExplorerStore((state) => state.previewPane);
  const currentFolder = useExplorerStore((state) => state.currentFolder());
  const isHome = activeTab?.location === HOME_LOCATION;
  const hasSelection = selectedEntries.length > 0;
  const singleSelection = selectedEntries.length === 1;

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [menu]);

  useEffect(() => {
    setMenu(null);
  }, [activeTab?.location]);

  const setView = useExplorerStore((state) => state.setViewMode);
  const setSortExplicit = useExplorerStore((state) => state.setSortExplicit);
  const setGroupBy = useExplorerStore((state) => state.setGroupBy);
  const setShowHidden = useExplorerStore((state) => state.setShowHidden);
  const setShowExtensions = useExplorerStore((state) => state.setShowExtensions);
  const setDetailsPane = useExplorerStore((state) => state.setDetailsPane);
  const setPreviewPane = useExplorerStore((state) => state.setPreviewPane);
  const promptNewFolder = useExplorerStore((state) => state.promptNewFolder);
  const promptNewTextFile = useExplorerStore((state) => state.promptNewTextFile);
  const createShortcut = useExplorerStore((state) => state.createShortcut);
  const copySelection = useExplorerStore((state) => state.copySelection);
  const cutSelection = useExplorerStore((state) => state.cutSelection);
  const paste = useExplorerStore((state) => state.paste);
  const promptRename = useExplorerStore((state) => state.promptRename);
  const deleteSelection = useExplorerStore((state) => state.deleteSelection);
  const shareSelection = useExplorerStore((state) => state.shareSelection);
  const refresh = useExplorerStore((state) => state.refresh);
  const selectAll = useExplorerStore((state) => state.selectAll);
  const setSelection = useExplorerStore((state) => state.setSelection);
  const openTerminalHere = useExplorerStore((state) => state.openTerminalHere);
  const openDialog = useExplorerStore((state) => state.openDialog);
  const openProperties = useExplorerStore((state) => state.openProperties);
  const currentEntries = useExplorerStore(useShallow((state) => state.currentEntries()));
  const modifier = platform?.modifier === "cmd" ? "Cmd" : "Ctrl";

  const toggleMenu = (name: MenuName) => setMenu((current) => (current === name ? null : name));

  const newItems: MenuItem[] = [
    {
      label: "Folder",
      icon: "folder",
      disabled: isHome,
      shortcut: shortcutLabel(platform?.platform ?? "macos", `${modifier}+Shift+N`),
      onClick: () => void promptNewFolder(),
    },
    {
      label: "Text Document",
      icon: "text",
      disabled: isHome,
      onClick: () => void promptNewTextFile(),
    },
    {
      label: "Shortcut",
      icon: "link",
      disabled: isHome || !hasSelection,
      onClick: () => void createShortcut(),
    },
  ];

  const sortItems: MenuItem[] = [
    { label: "Name", checked: sortKey === "name", onClick: () => setSortExplicit("name", sortKey === "name" ? sortDirection : "asc") },
    {
      label: "Date modified",
      checked: sortKey === "date",
      onClick: () => setSortExplicit("date", sortKey === "date" ? sortDirection : "asc"),
    },
    { label: "Type", checked: sortKey === "type", onClick: () => setSortExplicit("type", sortKey === "type" ? sortDirection : "asc") },
    { label: "Size", checked: sortKey === "size", onClick: () => setSortExplicit("size", sortKey === "size" ? sortDirection : "asc") },
    { type: "separator" },
    { label: "Ascending", checked: sortDirection === "asc", onClick: () => setSortExplicit(sortKey, "asc") },
    { label: "Descending", checked: sortDirection === "desc", onClick: () => setSortExplicit(sortKey, "desc") },
    {
      label: "Group by",
      submenu: (["none", "type", "date", "size"] as GroupBy[]).map((value) => ({
        label: value === "none" ? "None" : value === "date" ? "Date modified" : value === "type" ? "Type" : "Size",
        checked: groupBy === value,
        onClick: () => setGroupBy(value),
      })),
    },
  ];

  const viewItems: MenuItem[] = [
    ...VIEW_ITEMS.map((item) => ({
      label: item.label,
      icon: item.icon,
      checked: viewMode === item.mode,
      onClick: () => setView(item.mode),
    })),
    { type: "separator" },
    {
      label: "Show",
      submenu: [
        { label: "Hidden items", checked: showHidden, onClick: () => void setShowHidden(!showHidden) },
        { label: "File name extensions", checked: showExtensions, onClick: () => setShowExtensions(!showExtensions) },
        { type: "separator" },
        { label: "Details pane", checked: detailsPane, onClick: () => setDetailsPane(!detailsPane) },
        { label: "Preview pane", checked: previewPane, onClick: () => setPreviewPane(!previewPane) },
      ],
    },
  ];

  const moreItems: MenuItem[] = [
    { label: "Select all", icon: "check", shortcut: shortcutLabel(platform?.platform ?? "macos", `${modifier}+A`), onClick: selectAll },
    {
      label: "Invert selection",
      icon: "sync",
      disabled: !currentEntries.length,
      onClick: () => {
        const selected = new Set(useExplorerStore.getState().activeTab().selection);
        setSelection(currentEntries.filter((entry) => !selected.has(entry.path)).map((entry) => entry.path));
      },
    },
    { type: "separator" },
    { label: "Refresh", icon: "refresh", shortcut: "F5", onClick: () => void refresh() },
    { label: "Open in Terminal", icon: "terminal", onClick: () => void openTerminalHere() },
    { type: "separator" },
    {
      label: "Show hidden items",
      icon: "eye",
      checked: showHidden,
      onClick: () => void setShowHidden(!showHidden),
    },
    {
      label: "Details pane",
      icon: "panel",
      checked: detailsPane,
      onClick: () => setDetailsPane(!detailsPane),
    },
    {
      label: "Preview pane",
      icon: "eye",
      checked: previewPane,
      onClick: () => setPreviewPane(!previewPane),
    },
    { type: "separator" },
    { label: "Keyboard shortcuts", icon: "info", onClick: () => openDialog({ kind: "shortcuts" }) },
    { label: "Appearance and themes", icon: "palette", onClick: () => openDialog({ kind: "themes" }) },
    { label: "Options", icon: "settings", onClick: () => openDialog({ kind: "preferences" }) },
    { label: "About", icon: "info", onClick: () => openDialog({ kind: "about" }) },
  ];

  return (
    <div className="commandbar" ref={rootRef} role="toolbar" aria-label="File Explorer commands">
      <div className="cmd-button-wrap">
        <button
          type="button"
          className={`cmd-btn cmd-wide ${menu === "new" ? "open" : ""}`}
          data-tooltip="Create a new item"
          aria-haspopup="menu"
          aria-expanded={menu === "new"}
          onClick={() => toggleMenu("new")}
        >
          <Icon name="new" size={16} className="cmd-new-icon" />
          <span className="cmd-label">New</span>
          <Icon name="chevronDown" size={11} className="cmd-caret" />
        </button>
        {menu === "new" ? (
          <div className="dropdown-menu">
            <MenuPanel items={newItems} width={234} itemHeight={36} showIcons onClose={() => setMenu(null)} />
          </div>
        ) : null}
      </div>
      <div className="cmd-separator" />
      <button type="button" className="cmd-btn" data-tooltip="Cut" aria-label="Cut" disabled={!hasSelection} onClick={cutSelection}>
        <Icon name="cut" size={16} />
      </button>
      <button type="button" className="cmd-btn" data-tooltip="Copy" aria-label="Copy" disabled={!hasSelection} onClick={copySelection}>
        <Icon name="copy" size={16} />
      </button>
      <button
        type="button"
        className="cmd-btn"
        data-tooltip="Paste"
        aria-label="Paste"
        disabled={!clipboard || isHome}
        onClick={() => void paste()}
      >
        <Icon name="paste" size={16} />
      </button>
      <button
        type="button"
        className="cmd-btn"
        data-tooltip="Rename"
        aria-label="Rename"
        disabled={!singleSelection}
        onClick={promptRename}
      >
        <Icon name="rename" size={16} />
      </button>
      <button
        type="button"
        className="cmd-btn"
        data-tooltip="Share"
        aria-label="Share"
        disabled={!hasSelection}
        onClick={() => void shareSelection()}
      >
        <Icon name="share" size={16} />
      </button>
      <button
        type="button"
        className="cmd-btn"
        data-tooltip="Delete"
        aria-label="Delete"
        disabled={!hasSelection}
        onClick={() => deleteSelection(false)}
      >
        <Icon name="delete" size={16} />
      </button>
      <div className="cmd-separator" />
      <div className="cmd-button-wrap">
        <button
          type="button"
          className={`cmd-btn cmd-wide ${menu === "sort" ? "open" : ""}`}
          data-tooltip="Sort and group"
          aria-haspopup="menu"
          aria-expanded={menu === "sort"}
          onClick={() => toggleMenu("sort")}
        >
          <Icon name="sort" size={16} />
          <span className="cmd-label">Sort</span>
          <Icon name="chevronDown" size={11} className="cmd-caret" />
        </button>
        {menu === "sort" ? (
          <div className="dropdown-menu">
            <MenuPanel items={sortItems} width={168} itemHeight={30} showIcons={false} onClose={() => setMenu(null)} />
          </div>
        ) : null}
      </div>
      <div className="cmd-button-wrap">
        <button
          type="button"
          className={`cmd-btn cmd-wide ${menu === "view" ? "open" : ""}`}
          data-tooltip="Layout and view options"
          aria-haspopup="menu"
          aria-expanded={menu === "view"}
          onClick={() => toggleMenu("view")}
        >
          <Icon name="view" size={16} />
          <span className="cmd-label">View</span>
          <Icon name="chevronDown" size={11} className="cmd-caret" />
        </button>
        {menu === "view" ? (
          <div className="dropdown-menu">
            <MenuPanel items={viewItems} width={206} itemHeight={30} showIcons onClose={() => setMenu(null)} />
          </div>
        ) : null}
      </div>
      <div className="cmd-separator" />
      <div className="cmd-button-wrap">
        <button
          type="button"
          className={`cmd-btn ${menu === "more" ? "open" : ""}`}
          data-tooltip="More options"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menu === "more"}
          onClick={() => toggleMenu("more")}
        >
          <Icon name="more" size={16} />
        </button>
        {menu === "more" ? (
          <div className="dropdown-menu align-right">
            <MenuPanel items={moreItems} width={238} itemHeight={30} showIcons onClose={() => setMenu(null)} />
          </div>
        ) : null}
      </div>
      <div className="commandbar-spacer" />
      <span className="address-hidden" aria-hidden="true">
        {currentFolder}
      </span>
    </div>
  );
}
