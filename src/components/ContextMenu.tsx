import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { MenuPanel, type MenuItem } from "./Menu";
import { useExplorerStore } from "../state/explorerStore";
import { basename, parentPath } from "../lib/format";
import { HOME_LOCATION, type GroupBy, type SortKey, type ViewMode } from "../lib/types";

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

function viewMenuItems(): MenuItem[] {
  const state = useExplorerStore.getState();
  return VIEW_ITEMS.map((item) => ({
    label: item.label,
    icon: item.icon,
    checked: state.viewMode === item.mode,
    onClick: () => state.setViewMode(item.mode),
  }));
}

function sortMenuItems(): MenuItem[] {
  const state = useExplorerStore.getState();
  const choose = (key: SortKey) => state.setSortExplicit(key, state.sortKey === key ? state.sortDirection : "asc");
  return [
    { label: "Name", checked: state.sortKey === "name", onClick: () => choose("name") },
    { label: "Date modified", checked: state.sortKey === "date", onClick: () => choose("date") },
    { label: "Type", checked: state.sortKey === "type", onClick: () => choose("type") },
    { label: "Size", checked: state.sortKey === "size", onClick: () => choose("size") },
    { type: "separator" },
    { label: "Ascending", checked: state.sortDirection === "asc", onClick: () => state.setSortExplicit(state.sortKey, "asc") },
    { label: "Descending", checked: state.sortDirection === "desc", onClick: () => state.setSortExplicit(state.sortKey, "desc") },
  ];
}

function groupMenuItems(): MenuItem[] {
  const state = useExplorerStore.getState();
  return (["none", "type", "date", "size"] as GroupBy[]).map((value) => ({
    label: value === "none" ? "None" : value === "date" ? "Date modified" : value === "type" ? "Type" : "Size",
    checked: state.groupBy === value,
    onClick: () => state.setGroupBy(value),
  }));
}

export function ContextMenu() {
  const menu = useExplorerStore((state) => state.contextMenu);
  const hideContextMenu = useExplorerStore((state) => state.hideContextMenu);
  const platform = useExplorerStore((state) => state.platform);
  const isPinned = useExplorerStore((state) => state.isPinned);
  const selectedEntries = useExplorerStore(useShallow((state) => state.selectedEntries()));
  const activeTab = useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const locations = useExplorerStore((state) => state.locations);
  const clipboard = useExplorerStore((state) => state.clipboard);
  const isHome = activeTab?.location === HOME_LOCATION;

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".menu-panel")) return;
      hideContextMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideContextMenu();
    };
    const blur = () => hideContextMenu();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, [hideContextMenu, menu]);

  const items = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    const state = useExplorerStore.getState();
    if (menu.kind === "blank") {
      return [
        {
          label: "Paste",
          icon: "paste",
          shortcut: platform?.platform === "macos" ? "CmdV" : "Ctrl+V",
          disabled: !clipboard || isHome,
          onClick: () => void state.paste(),
        },
        { type: "separator" },
        { label: "View", icon: "view", submenu: viewMenuItems() },
        { label: "Sort by", icon: "sort", submenu: sortMenuItems() },
        { label: "Group by", icon: "view", submenu: groupMenuItems() },
        { type: "separator" },
        {
          label: "Refresh",
          icon: "refresh",
          shortcut: "F5",
          onClick: () => void state.refresh(),
        },
        {
          label: "New",
          icon: "plus",
          disabled: isHome,
          submenu: [
            { label: "Folder", icon: "folder", onClick: () => void state.promptNewFolder() },
            { label: "Text Document", icon: "text", onClick: () => void state.promptNewTextFile() },
            {
              label: "Shortcut",
              icon: "link",
              disabled: selectedEntries.length === 0,
              onClick: () => void state.createShortcut(),
            },
          ],
        },
        {
          label: "Properties",
          icon: "properties",
          shortcut: platform?.platform === "macos" ? "CmdI" : "Alt+Enter",
          onClick: () => void state.openProperties(),
        },
        { type: "separator" },
        {
          label: "Open in Terminal",
          icon: "terminal",
          onClick: () => void state.openTerminalHere(),
        },
      ];
    }

    const entry = selectedEntries.find((item) => item.path === menu.path) ?? selectedEntries[0];
    const filePath = entry?.path ?? menu.path;
    const isDir = entry?.isDir ?? menu.isDir;
    const parent = isDir ? filePath : parentPath(filePath);
    const pinned = isPinned(filePath);
    const openAll = () => {
      const selected = state.selectedEntries();
      if (selected.length <= 1) {
        if (entry) void state.openEntry(entry);
      } else {
        for (const item of selected) {
          if (!item.isDir) void state.openEntry(item);
        }
      }
    };
    const sendTargets = ["desktop", "documents", "downloads"]
      .map((id) => locations.find((location) => location.id === id))
      .filter((location): location is NonNullable<typeof location> => Boolean(location));

    return [
      { label: "Open", icon: "open", bold: true, onClick: openAll },
      ...(platform?.platform === "macos"
        ? [{ label: "Open with", icon: "openWith" as const, onClick: () => void state.openWithDialog(filePath) }]
        : []),
      {
        label: "Open in new tab",
        icon: "tab",
        disabled: !isDir,
        onClick: () => {
          if (parent) void state.openInNewTab(isDir ? filePath : parent);
        },
      },
      {
        label: pinned ? "Unpin from Quick access" : "Pin to Quick access",
        icon: pinned ? "unpin" : "pin",
        disabled: !isDir,
        onClick: () => {
          if (pinned) state.unpinPath(filePath);
          else state.pinPath(filePath);
        },
      },
      {
        label: "Copy as path",
        icon: "copyPath",
        shortcut: platform?.platform === "macos" ? "ShiftCmdC" : "Ctrl+Shift+C",
        onClick: () => void state.copyAsPath(),
      },
      { label: "Share", icon: "share", onClick: () => void state.shareSelection() },
      { type: "separator" },
      {
        label: "Cut",
        icon: "cut",
        shortcut: platform?.platform === "macos" ? "CmdX" : "Ctrl+X",
        onClick: state.cutSelection,
      },
      {
        label: "Copy",
        icon: "copy",
        shortcut: platform?.platform === "macos" ? "CmdC" : "Ctrl+C",
        onClick: state.copySelection,
      },
      {
        label: "Create shortcut",
        icon: "link",
        onClick: () => void state.createShortcut(),
      },
      {
        label: "Duplicate",
        icon: "copy",
        onClick: () => void state.duplicateSelection(),
      },
      {
        label: "Send to",
        icon: "share",
        submenu: sendTargets.map((target) => ({
          label: target.name,
          icon: target.icon === "desktop" ? "desktop" : target.icon === "documents" ? "documents" : "downloads",
          onClick: () => void state.sendSelectionTo(target.path, "cut"),
        })),
      },
      { type: "separator" },
      {
        label: "Delete",
        icon: "delete",
        danger: true,
        shortcut: "Delete",
        onClick: () => state.deleteSelection(false),
      },
      {
        label: "Rename",
        icon: "rename",
        shortcut: "F2",
        disabled: selectedEntries.length !== 1,
        onClick: state.promptRename,
      },
      {
        label: "Properties",
        icon: "properties",
        shortcut: platform?.platform === "macos" ? "CmdI" : "Alt+Enter",
        onClick: () => void state.openProperties(filePath),
      },
    ];
  }, [clipboard, isHome, isPinned, locations, menu, platform?.platform, selectedEntries]);

  if (!menu) return null;
  const width = menu.kind === "blank" ? 270 : 304;
  const estimatedHeight = menu.kind === "blank" ? 430 : 470;
  const x = Math.min(menu.x, window.innerWidth - width - 8);
  const y = Math.min(menu.y, window.innerHeight - estimatedHeight - 8);
  return (
    <div
      className="context-menu"
      style={{ left: Math.max(6, x), top: Math.max(6, y) }}
      role="presentation"
    >
      <MenuPanel
        items={items}
        width={width}
        itemHeight={30}
        showIcons
        onClose={hideContextMenu}
      />
    </div>
  );
}
