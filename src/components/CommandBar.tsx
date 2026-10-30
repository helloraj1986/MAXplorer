import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "./Icon";
import { MenuPanel, type MenuItem } from "./Menu";
import { useExplorerStore } from "../state/explorerStore";
import { useSearchStore } from "../state/searchStore";
import { useElementSize } from "../hooks/useElementSize";
import { acceleratorToDisplay, DEFAULT_SHORTCUTS, normalizeAccelerator } from "../lib/panes";
import { HOME_LOCATION, type GroupBy, type ViewMode } from "../lib/types";

type MenuName = "new" | "sort" | "view" | "workspace" | "settings" | null;

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

/**
 * Layer 1. One global command area for every command and workspace control.
 * Navigation lives in the next layer; tabs live in their own row.
 */
export function CommandBar() {
  const [menu, setMenu] = useState<MenuName>(null);
  const { ref: rootRef, width } = useElementSize<HTMLDivElement>();
  const platform = useExplorerStore((state) => state.platform);

  // The bar measures itself so labels and lower-priority groups can collapse
  // before the buttons overlap. The Settings menu always remains available.
  const density: "regular" | "compact" | "narrow" =
    width === 0 || width >= 900 ? "regular" : width >= 700 ? "compact" : "narrow";

  const activePane = useExplorerStore((state) => state.activePane);
  const pane = useExplorerStore((state) => state.panes[state.activePane]);
  const activeTab = useExplorerStore(
    (state) => state.panes[state.activePane].tabs.find(
      (tab) => tab.id === state.panes[state.activePane].activeTabId,
    ),
  );
  const selectedEntries = useExplorerStore(
    useShallow((state) => state.selectedEntries(state.activePane)),
  );
  const clipboard = useExplorerStore((state) => state.clipboard);
  const viewMode = pane.viewMode;
  const sortKey = pane.sortKey;
  const sortDirection = pane.sortDirection;
  const groupBy = pane.groupBy;
  const showHidden = pane.showHidden;
  const showExtensions = pane.showExtensions;
  const columnVisibility = useExplorerStore((state) => state.columnVisibility);
  const detailsPane = useExplorerStore((state) => state.detailsPane);
  const previewPane = useExplorerStore((state) => state.previewPane);
  const dualPane = useExplorerStore((state) => state.dualPane);
  const syncNavigation = useExplorerStore((state) => state.syncNavigation);
  const sidebarVisible = useExplorerStore((state) => state.sidebarVisible);
  const commandBarLabels = useExplorerStore((state) => state.commandBarLabels);
  const comparison = useExplorerStore((state) => state.comparison);
  const shortcuts = useExplorerStore((state) => state.shortcuts);
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
  }, [menu, rootRef]);

  useEffect(() => {
    setMenu(null);
  }, [activeTab?.location]);

  const setView = useExplorerStore((state) => state.setViewMode);
  const setSortExplicit = useExplorerStore((state) => state.setSortExplicit);
  const setGroupBy = useExplorerStore((state) => state.setGroupBy);
  const setShowHidden = useExplorerStore((state) => state.setShowHidden);
  const setShowExtensions = useExplorerStore((state) => state.setShowExtensions);
  const setColumnVisible = useExplorerStore((state) => state.setColumnVisible);
  const resetColumnWidths = useExplorerStore((state) => state.resetColumnWidths);
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
  const currentEntries = useExplorerStore(useShallow((state) => state.currentEntries(state.activePane)));
  const toggleDualPane = useExplorerStore((state) => state.toggleDualPane);
  const setDualPane = useExplorerStore((state) => state.setDualPane);
  const setSyncNavigation = useExplorerStore((state) => state.setSyncNavigation);
  const startComparison = useExplorerStore((state) => state.startComparison);
  const setComparisonOpen = useExplorerStore((state) => state.setComparisonOpen);
  const copyToOtherPane = useExplorerStore((state) => state.copyToOtherPane);
  const moveToOtherPane = useExplorerStore((state) => state.moveToOtherPane);
  const toggleSidebar = useExplorerStore((state) => state.toggleSidebar);
  const setInterfaceTheme = useExplorerStore((state) => state.setInterfaceTheme);
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const platformName = platform?.platform ?? "macos";
  const mod = platform?.modifier === "cmd" ? "Cmd" : "Ctrl";
  const customShortcut = (accelerator: string, fallback: string) =>
    acceleratorToDisplay(normalizeAccelerator(accelerator, fallback), platformName);

  const toggleMenu = (name: MenuName) => setMenu((current) => (current === name ? null : name));

  const newItems: MenuItem[] = [
    {
      label: "Folder",
      icon: "folder",
      disabled: isHome,
      shortcut: `${mod}+Shift+N`,
      onClick: () => void promptNewFolder(activePane),
    },
    {
      label: "Text Document",
      icon: "text",
      disabled: isHome,
      onClick: () => void promptNewTextFile(activePane),
    },
    {
      label: "Shortcut",
      icon: "link",
      disabled: isHome || !hasSelection,
      onClick: () => void createShortcut(activePane),
    },
  ];

  const sortItems: MenuItem[] = [
    { label: "Name", checked: sortKey === "name", onClick: () => setSortExplicit("name", sortKey === "name" ? sortDirection : "asc", activePane) },
    {
      label: "Date modified",
      checked: sortKey === "date",
      onClick: () => setSortExplicit("date", sortKey === "date" ? sortDirection : "asc", activePane),
    },
    { label: "Type", checked: sortKey === "type", onClick: () => setSortExplicit("type", sortKey === "type" ? sortDirection : "asc", activePane) },
    { label: "Size", checked: sortKey === "size", onClick: () => setSortExplicit("size", sortKey === "size" ? sortDirection : "asc", activePane) },
    { type: "separator" },
    { label: "Ascending", checked: sortDirection === "asc", onClick: () => setSortExplicit(sortKey, "asc", activePane) },
    { label: "Descending", checked: sortDirection === "desc", onClick: () => setSortExplicit(sortKey, "desc", activePane) },
    {
      label: "Group by",
      submenu: (["none", "type", "date", "size"] as GroupBy[]).map((value) => ({
        label: value === "none" ? "None" : value === "date" ? "Date modified" : value === "type" ? "Type" : "Size",
        checked: groupBy === value,
        onClick: () => setGroupBy(value, activePane),
      })),
    },
  ];

  const viewItems: MenuItem[] = [
    ...VIEW_ITEMS.map((item) => ({
      label: item.label,
      icon: item.icon,
      checked: viewMode === item.mode,
      onClick: () => setView(item.mode, activePane),
    })),
    { type: "separator" },
    {
      label: "Show",
      submenu: [
        { label: "Hidden items", checked: showHidden, onClick: () => void setShowHidden(!showHidden, activePane) },
        { label: "File name extensions", checked: showExtensions, onClick: () => setShowExtensions(!showExtensions, activePane) },
        { type: "separator" },
        { label: "Details pane", checked: detailsPane, onClick: () => setDetailsPane(!detailsPane) },
        { label: "Preview pane", checked: previewPane, onClick: () => setPreviewPane(!previewPane) },
      ],
    },
    {
      label: "Columns",
      submenu: [
        { label: "Date modified", checked: columnVisibility.date, onClick: () => setColumnVisible("date", !columnVisibility.date) },
        { label: "Type", checked: columnVisibility.type, onClick: () => setColumnVisible("type", !columnVisibility.type) },
        { label: "Size", checked: columnVisibility.size, onClick: () => setColumnVisible("size", !columnVisibility.size) },
        { type: "separator" },
        { label: "Reset column widths", icon: "undo", onClick: resetColumnWidths },
      ],
    },
  ];

  const workspaceItems: MenuItem[] = [
    {
      label: dualPane ? "Single-pane mode" : "Dual-pane mode",
      icon: "columns",
      checked: dualPane,
      shortcut: customShortcut(shortcuts.toggleDualPane, DEFAULT_SHORTCUTS.toggleDualPane),
      onClick: toggleDualPane,
    },
    { label: "Show navigation pane", icon: "sidebar", checked: sidebarVisible, onClick: toggleSidebar },
    { type: "separator" },
    ...(dualPane
      ? [
          {
            label: "Copy to other pane",
            icon: "copy" as const,
            shortcut: customShortcut(shortcuts.copyToOtherPane, DEFAULT_SHORTCUTS.copyToOtherPane),
            disabled: !hasSelection,
            onClick: () => void copyToOtherPane(),
          },
          {
            label: "Move to other pane",
            icon: "cut" as const,
            shortcut: customShortcut(shortcuts.moveToOtherPane, DEFAULT_SHORTCUTS.moveToOtherPane),
            disabled: !hasSelection,
            onClick: () => void moveToOtherPane(),
          },
          {
            label: "Synchronized navigation",
            icon: "sync" as const,
            checked: syncNavigation,
            onClick: () => setSyncNavigation(!syncNavigation),
          },
          {
            label: "Compare folders",
            icon: "compare" as const,
            onClick: () => void startComparison(),
          },
          ...(comparison
            ? [
                {
                  label: "Show folder comparison",
                  icon: "details" as const,
                  onClick: () => setComparisonOpen(true),
                },
              ]
            : []),
        ]
      : []),
  ];

  const settingsItems: MenuItem[] = [
    { label: "Settings...", icon: "settings", shortcut: `${mod}+,`, onClick: () => openDialog({ kind: "settings", section: "appearance" }) },
    { label: "Appearance and themes", icon: "palette", onClick: () => openDialog({ kind: "settings", section: "appearance" }) },
    { label: "Display and layout", icon: "view", onClick: () => openDialog({ kind: "settings", section: "display" }) },
    { label: "Keyboard shortcuts", icon: "info", onClick: () => openDialog({ kind: "settings", section: "keyboard" }) },
    {
      label: "Interface theme",
      icon: "palette",
      submenu: [
        { label: "Windows 11 Explorer", checked: interfaceTheme === "windows", onClick: () => setInterfaceTheme("windows") },
        { label: "macOS Finder", checked: interfaceTheme === "finder", onClick: () => setInterfaceTheme("finder") },
      ],
    },
    { type: "separator" },
    {
      label: "Universal Search",
      icon: "search",
      shortcut: customShortcut(shortcuts.globalSearch, DEFAULT_SHORTCUTS.globalSearch),
      onClick: () => useSearchStore.getState().openOverlay(),
    },
    {
      label: "Search indexing",
      icon: "database",
      onClick: () => openDialog({ kind: "indexing" }),
    },
    { label: "Open in Terminal", icon: "terminal", onClick: () => void openTerminalHere(activePane) },
    {
      label: "Select all",
      icon: "check",
      shortcut: `${mod}+A`,
      disabled: !currentEntries.length,
      onClick: () => selectAll(activePane),
    },
    {
      label: "Invert selection",
      icon: "sync",
      disabled: !currentEntries.length,
      onClick: () => {
        const selected = new Set(useExplorerStore.getState().activeTab(activePane).selection);
        setSelection(
          currentEntries.filter((entry) => !selected.has(entry.path)).map((entry) => entry.path),
          undefined,
          activePane,
        );
      },
    },
    ...(density === "narrow"
      ? ([
          { type: "separator" },
          {
            label: "Rename",
            icon: "rename",
            shortcut: "F2",
            disabled: !singleSelection,
            onClick: () => promptRename(activePane),
          },
          {
            label: "Share",
            icon: "share",
            disabled: !hasSelection,
            onClick: () => void shareSelection(activePane),
          },
          { label: "Sort", icon: "sort", submenu: sortItems },
          { label: "View", icon: "view", submenu: viewItems },
        ] as MenuItem[])
      : []),
    { type: "separator" },
    { label: "About MAXplorer", icon: "info", onClick: () => openDialog({ kind: "about" }) },
  ];

  const tooltip = (label: string, shortcut?: string) =>
    shortcut ? `${label} (${shortcut})` : label;

  return (
    <div
      className="commandbar"
      ref={rootRef}
      role="toolbar"
      aria-label="MAXplorer commands"
      data-density={density}
      data-labels={commandBarLabels ? "on" : "off"}
    >
      <div className="cmd-button-wrap">
        <button
          type="button"
          className={`cmd-btn cmd-wide ${menu === "new" ? "open" : ""}`}
          data-tooltip="Create a new item"
          aria-label="New"
          disabled={isHome}
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
      <button
        type="button"
        className="cmd-btn cmd-op"
        data-tooltip={tooltip("Cut", `${mod}+X`)}
        aria-label="Cut"
        aria-keyshortcuts={`${mod}+X`}
        disabled={!hasSelection}
        onClick={() => cutSelection(activePane)}
      >
        <Icon name="cut" size={16} />
      </button>
      <button
        type="button"
        className="cmd-btn cmd-op"
        data-tooltip={tooltip("Copy", `${mod}+C`)}
        aria-label="Copy"
        aria-keyshortcuts={`${mod}+C`}
        disabled={!hasSelection}
        onClick={() => copySelection(activePane)}
      >
        <Icon name="copy" size={16} />
      </button>
      <button
        type="button"
        className="cmd-btn cmd-op"
        data-tooltip={tooltip("Paste", `${mod}+V`)}
        aria-label="Paste"
        aria-keyshortcuts={`${mod}+V`}
        disabled={!clipboard || isHome}
        onClick={() => void paste(activePane)}
      >
        <Icon name="paste" size={16} />
      </button>
      <button
        type="button"
        className="cmd-btn cmd-op cmd-secondary"
        data-tooltip={tooltip("Rename", "F2")}
        aria-label="Rename"
        aria-keyshortcuts="F2"
        disabled={!singleSelection}
        onClick={() => promptRename(activePane)}
      >
        <Icon name="rename" size={16} />
      </button>
      <button
        type="button"
        className="cmd-btn cmd-op cmd-secondary"
        data-tooltip="Share"
        aria-label="Share"
        disabled={!hasSelection}
        onClick={() => void shareSelection(activePane)}
      >
        <Icon name="share" size={16} />
      </button>
      <button
        type="button"
        className="cmd-btn cmd-op"
        data-tooltip={tooltip("Delete", "Delete")}
        aria-label="Delete"
        aria-keyshortcuts="Delete"
        disabled={!hasSelection}
        onClick={() => deleteSelection(false, activePane)}
      >
        <Icon name="delete" size={16} />
      </button>
      <div className="cmd-separator" />
      <div className="cmd-button-wrap cmd-organization">
        <button
          type="button"
          className={`cmd-btn cmd-wide ${menu === "sort" ? "open" : ""}`}
          data-tooltip="Sort and group"
          aria-label="Sort and group"
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
            <MenuPanel items={sortItems} width={180} itemHeight={30} showIcons={false} onClose={() => setMenu(null)} />
          </div>
        ) : null}
      </div>
      <div className="cmd-button-wrap cmd-organization">
        <button
          type="button"
          className={`cmd-btn cmd-wide ${menu === "view" ? "open" : ""}`}
          data-tooltip="Layout and view options"
          aria-label="Layout and view options"
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
            <MenuPanel items={viewItems} width={214} itemHeight={30} showIcons onClose={() => setMenu(null)} />
          </div>
        ) : null}
      </div>
      <div className="cmd-separator" />
      <button
        type="button"
        className={`cmd-btn cmd-workspace ${sidebarVisible ? "active-toggle" : ""}`}
        data-tooltip={sidebarVisible ? "Hide navigation pane" : "Show navigation pane"}
        aria-label={sidebarVisible ? "Hide navigation pane" : "Show navigation pane"}
        aria-pressed={sidebarVisible}
        onClick={toggleSidebar}
      >
        <Icon name="sidebar" size={16} />
      </button>
      <div className="cmd-split">
        <button
          type="button"
          className={`cmd-btn cmd-dual ${dualPane ? "active-toggle" : ""}`}
          data-tooltip={dualPane ? "Switch to single pane" : "Switch to dual pane"}
          aria-label={dualPane ? "Switch to single pane" : "Switch to dual pane"}
          aria-pressed={dualPane}
          onClick={toggleDualPane}
        >
          <Icon name="columns" size={16} />
        </button>
        <button
          type="button"
          className={`cmd-split-caret ${menu === "workspace" ? "open" : ""}`}
          data-tooltip="Workspace options"
          aria-label="Workspace options"
          aria-haspopup="menu"
          aria-expanded={menu === "workspace"}
          onClick={() => toggleMenu("workspace")}
        >
          <Icon name="chevronDown" size={10} />
        </button>
        {menu === "workspace" ? (
          <div className="dropdown-menu">
            <MenuPanel items={workspaceItems} width={244} itemHeight={30} showIcons onClose={() => setMenu(null)} />
          </div>
        ) : null}
      </div>
      <div className="commandbar-spacer" />
      <div className="cmd-button-wrap">
        <button
          type="button"
          className={`cmd-btn cmd-wide cmd-settings ${menu === "settings" ? "open" : ""}`}
          data-tooltip="Settings and more"
          aria-label="Settings and more"
          aria-haspopup="menu"
          aria-expanded={menu === "settings"}
          onClick={() => toggleMenu("settings")}
        >
          <Icon name="settings" size={16} />
          <span className="cmd-label">Settings</span>
          <Icon name="chevronDown" size={11} className="cmd-caret" />
        </button>
        {menu === "settings" ? (
          <div className="dropdown-menu align-right">
            <MenuPanel items={settingsItems} width={248} itemHeight={30} showIcons onClose={() => setMenu(null)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
