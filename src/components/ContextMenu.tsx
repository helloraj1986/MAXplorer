import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { MenuPanel, type MenuItem } from "./Menu";
import { useExplorerStore } from "../state/explorerStore";
import { useSearchStore } from "../state/searchStore";
import { api } from "../lib/api";
import { copyTextToClipboard, pathsAsText } from "../lib/clipboard";
import { basename, parentPath } from "../lib/format";
import { samePath } from "../lib/tags";
import {
  HOME_LOCATION,
  RECENTS_LOCATION,
  type GroupBy,
  type PaneId,
  type SortKey,
  type TagDefinition,
  type ViewMode,
} from "../lib/types";

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

function viewMenuItems(paneId: PaneId): MenuItem[] {
  const state = useExplorerStore.getState();
  const pane = state.pane(paneId);
  return VIEW_ITEMS.map((item) => ({
    label: item.label,
    icon: item.icon,
    checked: pane.viewMode === item.mode,
    onClick: () => state.setViewMode(item.mode, paneId),
  }));
}

function sortMenuItems(paneId: PaneId): MenuItem[] {
  const state = useExplorerStore.getState();
  const pane = state.pane(paneId);
  const choose = (key: SortKey) =>
    state.setSortExplicit(key, pane.sortKey === key ? pane.sortDirection : "asc", paneId);
  return [
    { label: "Name", checked: pane.sortKey === "name", onClick: () => choose("name") },
    { label: "Date modified", checked: pane.sortKey === "date", onClick: () => choose("date") },
    { label: "Type", checked: pane.sortKey === "type", onClick: () => choose("type") },
    { label: "Size", checked: pane.sortKey === "size", onClick: () => choose("size") },
    { type: "separator" },
    { label: "Ascending", checked: pane.sortDirection === "asc", onClick: () => state.setSortExplicit(pane.sortKey, "asc", paneId) },
    { label: "Descending", checked: pane.sortDirection === "desc", onClick: () => state.setSortExplicit(pane.sortKey, "desc", paneId) },
  ];
}

function tagMenuItems(paths: string[], tags: TagDefinition[]): MenuItem[] {
  const state = useExplorerStore.getState();
  const items: MenuItem[] = tags.map((tag) => {
    const tagged = paths.length > 0 && paths.every((path) => state.tagIdsForPath(path).includes(tag.id));
    return {
      label: tag.name,
      icon: "tag",
      checked: tagged,
      onClick: () => state.toggleTag(paths, tag.id),
    };
  });
  if (items.length) items.push({ type: "separator" });
  items.push(
    {
      label: "New Tag...",
      icon: "plus",
      onClick: () => state.openTagEditor(undefined, paths),
    },
  );
  return items;
}

function groupMenuItems(paneId: PaneId): MenuItem[] {
  const state = useExplorerStore.getState();
  const pane = state.pane(paneId);
  return (["none", "type", "date", "size"] as GroupBy[]).map((value) => ({
    label: value === "none" ? "None" : value === "date" ? "Date modified" : value === "type" ? "Type" : "Size",
    checked: pane.groupBy === value,
    onClick: () => state.setGroupBy(value, paneId),
  }));
}

export function ContextMenu() {
  const menu = useExplorerStore((state) => state.contextMenu);
  const hideContextMenu = useExplorerStore((state) => state.hideContextMenu);
  const platform = useExplorerStore((state) => state.platform);
  const activePane = useExplorerStore((state) => state.activePane);
  const paneId: PaneId = (menu && "paneId" in menu ? menu.paneId : undefined) ?? activePane;
  const isPinned = useExplorerStore((state) => state.isPinned);
  const selectedEntries = useExplorerStore(
    useShallow((state) => state.selectedEntries(paneId)),
  );
  const activeTab = useExplorerStore(
    (state) => state.panes[paneId].tabs.find((tab) => tab.id === state.panes[paneId].activeTabId),
  );
  const locations = useExplorerStore((state) => state.locations);
  const tags = useExplorerStore((state) => state.tags);
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
    if (menu.kind === "search") {
      const paths = menu.paths.length ? menu.paths : [menu.path];
      const first = menu.path;
      const otherPane: PaneId = activePane === "left" ? "right" : "left";
      const otherFolder = state.currentFolder(otherPane);
      const openAll = () => {
        for (const path of paths) {
          const target = path === first ? menu.isDir : false;
          if (target) void state.navigate(path);
          else void api.openPath(path).catch((error) => state.toastError(error));
        }
      };
      return [
        { label: "Open", icon: "open", bold: true, onClick: openAll },
        ...(platform?.platform === "macos"
          ? [
              {
                label: "Open with",
                icon: "openWith" as const,
                disabled: menu.isDir || paths.length > 1,
                onClick: () => void state.openWithDialog(first),
              },
            ]
          : []),
        {
          label: platform?.platform === "macos" ? "Reveal in Finder" : "Show in file manager",
          icon: "open",
          onClick: () => void api.revealPath(first).catch((error) => state.toastError(error)),
        },
        {
          label: "Reveal in MAXplorer",
          icon: "folderOpen",
          onClick: () => void useSearchStore.getState().revealInMaxplorer(first),
        },
        ...(state.dualPane
          ? [
              {
                label: `Reveal in ${otherPane === "left" ? "left" : "right"} pane`,
                icon: "columns" as const,
                onClick: () => void useSearchStore.getState().revealInMaxplorer(first, otherPane),
              },
            ]
          : []),
        { label: "Tags", icon: "tag", submenu: tagMenuItems(paths, tags) },
        { type: "separator" },
        {
          label: "Copy",
          icon: "copy",
          shortcut: platform?.platform === "macos" ? "CmdC" : "Ctrl+C",
          onClick: () => {
            state.copyPathsToClipboard(paths, "copy");
            state.toast({
              title: paths.length === 1 ? "File ready to copy" : `${paths.length} files ready to copy`,
              detail: "Use Paste in the destination folder.",
              tone: "info",
            });
          },
        },
        {
          label: "Cut",
          icon: "cut",
          shortcut: platform?.platform === "macos" ? "CmdX" : "Ctrl+X",
          onClick: () => state.copyPathsToClipboard(paths, "cut"),
        },
        {
          label: "Copy as path",
          icon: "copyPath",
          onClick: () => {
            void copyTextToClipboard(pathsAsText(paths)).then((ok) =>
              state.toast({ title: ok ? "Path copied" : "Couldn't copy the path", tone: ok ? "success" : "error" }),
            );
          },
        },
        {
          label: "Copy name",
          icon: "copy",
          onClick: () => {
            void copyTextToClipboard(paths.map((path) => basename(path)).join("\n")).then((ok) =>
              state.toast({ title: ok ? "Name copied" : "Couldn't copy the name", tone: ok ? "success" : "error" }),
            );
          },
        },
        {
          label: "Share",
          icon: "share",
          onClick: () => {
            void copyTextToClipboard(pathsAsText(paths)).then((ok) =>
              state.toast({
                title: ok ? "Share is not available in this build" : "Couldn't copy the path",
                detail: ok
                  ? "The path was copied instead. Use Reveal in Finder to open the macOS share sheet."
                  : undefined,
                tone: ok ? "info" : "error",
              }),
            );
          },
        },
        { type: "separator" },
        ...(state.dualPane
          ? [
              {
                label: "Copy to other pane",
                icon: "copy" as const,
                onClick: () => void state.moveOrCopyPaths(paths, otherFolder, "copy"),
              },
              {
                label: "Move to other pane",
                icon: "cut" as const,
                onClick: () => void state.moveOrCopyPaths(paths, otherFolder, "move"),
              },
              { type: "separator" as const },
            ]
          : []),
        {
          label: "Rename...",
          icon: "rename",
          disabled: paths.length > 1,
          onClick: () =>
            state.openDialog({
              kind: "prompt",
              title: "Rename",
              label: "New name",
              initialValue: basename(first),
              confirmLabel: "Rename",
              selectStem: true,
              onConfirm: async (name) => {
                state.closeDialog();
                try {
                  await state.renameTo(first, name);
                  if (useSearchStore.getState().workspaceOpen) {
                    await useSearchStore.getState().runSearchNow();
                  }
                } catch (error) {
                  state.toastError(error);
                }
              },
            }),
        },
        {
          label: "Get info",
          icon: "properties",
          onClick: () => void state.openProperties(first),
        },
        {
          label: "Delete",
          icon: "delete",
          danger: true,
          onClick: () =>
            state.openDialog({
              kind: "confirm",
              title: "Delete these items?",
              message:
                paths.length === 1
                  ? `Move ${basename(paths[0])} to the Trash?`
                  : `Move ${paths.length} items to the Trash?`,
              confirmLabel: "Delete",
              destructive: true,
              onConfirm: async () => {
                state.closeDialog();
                await state.confirmDelete(paths, false);
                if (useSearchStore.getState().workspaceOpen) {
                  void useSearchStore.getState().runSearchNow();
                }
              },
            }),
        },
      ];
    }
    if (menu.kind === "blank") {
      return [
        {
          label: "Paste",
          icon: "paste",
          shortcut: platform?.platform === "macos" ? "CmdV" : "Ctrl+V",
          disabled: !clipboard || isHome,
          onClick: () => void state.paste(paneId),
        },
        { type: "separator" },
        { label: "View", icon: "view", submenu: viewMenuItems(paneId) },
        { label: "Sort by", icon: "sort", submenu: sortMenuItems(paneId) },
        { label: "Group by", icon: "view", submenu: groupMenuItems(paneId) },
        { type: "separator" },
        {
          label: "Refresh",
          icon: "refresh",
          shortcut: "F5",
          onClick: () => void state.refresh(paneId),
        },
        {
          label: "New",
          icon: "plus",
          disabled: isHome,
          submenu: [
            { label: "Folder", icon: "folder", onClick: () => void state.promptNewFolder(paneId) },
            { label: "Text Document", icon: "text", onClick: () => void state.promptNewTextFile(paneId) },
            {
              label: "Shortcut",
              icon: "link",
              disabled: selectedEntries.length === 0,
              onClick: () => void state.createShortcut(paneId),
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
          onClick: () => void state.openTerminalHere(paneId),
        },
      ];
    }

    if (menu.kind === "sidebar") {
      const target = menu.target;
      if (target.kind === "recents") {
        return [
          {
            label: "Open Recents",
            icon: "clock",
            bold: true,
            onClick: () => void state.navigate(RECENTS_LOCATION),
          },
          { type: "separator" },
          {
            label: "Clear Recent Items",
            icon: "trash",
            danger: true,
            onClick: () => state.clearRecents(),
          },
        ];
      }
      if (target.kind === "favorite") {
        const pinned = state.isPinned(target.path);
        return [
          {
            label: "Open",
            icon: "folderOpen",
            bold: true,
            onClick: () => void state.navigate(target.path),
          },
          {
            label: "Reveal in Finder",
            icon: "open",
            onClick: () => void api.revealPath(target.path).catch((error) => state.toastError(error)),
          },
          { type: "separator" },
          {
            label: pinned ? "Remove from Favorites" : "Add to Favorites",
            icon: pinned ? "unpin" : "pin",
            onClick: () => {
              if (pinned) state.unpinPath(target.path);
              else state.pinPath(target.path);
            },
          },
        ];
      }
      if (target.kind === "networkConnection") {
        const connection = state.networkConnections.find(
          (item) => item.id === target.connectionId,
        );
        if (!connection) return [];
        const mounted = state.locations.find(
          (location) =>
            location.kind === "network" &&
            location.isVolume &&
            connection.mountPath != null &&
            samePath(location.path, connection.mountPath),
        );
        return [
          {
            label: mounted ? "Open" : "Connect",
            icon: mounted ? "folderOpen" : "network",
            bold: true,
            onClick: () => void state.openNetworkConnection(connection.id),
          },
          ...(mounted
            ? [
                {
                  label: "Reconnect",
                  icon: "network" as const,
                  onClick: () => void state.connectNetworkConnection(connection.id),
                },
              ]
            : []),
          {
            label: "Copy address",
            icon: "copy",
            onClick: () => {
              void copyTextToClipboard(connection.address).then((ok) =>
                state.toast({
                  title: ok ? "Server address copied" : "Couldn't copy the address",
                  tone: ok ? "success" : "error",
                }),
              );
            },
          },
          { type: "separator" },
          {
            label: "Edit Server...",
            icon: "rename",
            onClick: () => state.openNetworkConnectionDialog(connection.id),
          },
          {
            label: "Remove Server...",
            icon: "delete",
            danger: true,
            onClick: () =>
              state.openDialog({
                kind: "confirm",
                title: `Remove "${connection.name}"?`,
                message:
                  "The saved server is removed from Network. The server itself and any mounted volume are not changed.",
                confirmLabel: "Remove Server",
                destructive: true,
                onConfirm: () => state.removeNetworkConnection(connection.id),
              }),
          },
        ];
      }
      if (target.kind === "tag") {
        const tag = state.tag(target.tagId);
        if (!tag) return [];
        const paneId = state.activePane;
        const filtering = state.panes[paneId].tagFilterId === tag.id;
        const selectedPaths = state.selectedEntries(paneId).map((entry) => entry.path);
        return [
          {
            label: filtering ? "Clear Tag Filter" : "Filter Active Pane",
            icon: filtering ? "close" : "tag",
            bold: true,
            checked: filtering,
            onClick: () => state.setTagFilter(tag.id),
          },
          {
            label: selectedPaths.length
              ? `Assign to ${selectedPaths.length} selected`
              : "Assign to selection",
            icon: "tag",
            disabled: selectedPaths.length === 0,
            onClick: () => {
              state.assignTag(selectedPaths, tag.id);
              state.toast({
                title: `${tag.name} applied`,
                detail: `Tagged ${selectedPaths.length} ${selectedPaths.length === 1 ? "item" : "items"}.`,
                tone: "success",
              });
            },
          },
          { type: "separator" },
          {
            label: "Edit Tag...",
            icon: "rename",
            onClick: () => state.openTagEditor(tag.id),
          },
          {
            label: "Delete Tag...",
            icon: "delete",
            danger: true,
            onClick: () =>
              state.openDialog({
                kind: "confirm",
                title: `Delete the tag "${tag.name}"?`,
                message:
                  "The tag is removed from every item that uses it. Files and folders are not deleted.",
                confirmLabel: "Delete Tag",
                destructive: true,
                onConfirm: () => state.deleteTag(tag.id),
              }),
          },
        ];
      }
      const pinned = state.isPinned(target.path);
      const canEject = target.isVolume && target.locationId !== "root";
      return [
        {
          label: "Open",
          icon: "folderOpen",
          bold: true,
          onClick: () => void state.navigate(target.path),
        },
        {
          label: "Reveal in Finder",
          icon: "open",
          onClick: () => void api.revealPath(target.path).catch((error) => state.toastError(error)),
        },
        { type: "separator" },
        {
          label: pinned ? "Remove from Favorites" : "Add to Favorites",
          icon: pinned ? "unpin" : "pin",
          disabled: target.locationId === "trash",
          onClick: () => {
            if (pinned) state.unpinPath(target.path);
            else state.pinPath(target.path);
          },
        },
        ...(canEject
          ? [
              { type: "separator" as const },
              {
                label: `Eject ${target.name}`,
                icon: "eject" as const,
                onClick: () => void state.ejectVolume(target.path),
              },
            ]
          : []),
      ];
    }

    const entry = selectedEntries.find((item) => item.path === menu.path) ?? selectedEntries[0];
    const filePath = entry?.path ?? menu.path;
    const isDir = entry?.isDir ?? menu.isDir;
    const parent = isDir ? filePath : parentPath(filePath);
    const pinned = isPinned(filePath);
    const multiple = selectedEntries.length > 1;
    const tagPaths = selectedEntries.length
      ? selectedEntries.map((item) => item.path)
      : [filePath];
    const openAll = () => {
      const selected = state.selectedEntries(paneId);
      if (selected.length <= 1) {
        if (entry) void state.openEntry(entry, paneId);
      } else {
        for (const item of selected) {
          if (!item.isDir) void state.openEntry(item, paneId);
        }
      }
    };
    const sendTargets = ["desktop", "documents", "downloads"]
      .map((id) => locations.find((location) => location.id === id))
      .filter((location): location is NonNullable<typeof location> => Boolean(location));

    return [
      { label: "Open", icon: "open", bold: true, onClick: openAll },
      ...(platform?.platform === "macos"
        ? [{
            label: "Open with",
            icon: "openWith" as const,
            disabled: isDir || multiple,
            onClick: () => void state.openWithDialog(filePath),
          }]
        : []),
      {
        label: "Open in new tab",
        icon: "tab",
        disabled: !isDir || multiple,
        onClick: () => {
          if (parent) void state.openInNewTab(isDir ? filePath : parent, paneId);
        },
      },
      {
        label: pinned ? "Unpin from Quick access" : "Pin to Quick access",
        icon: pinned ? "unpin" : "pin",
        disabled: !isDir || multiple,
        onClick: () => {
          if (pinned) state.unpinPath(filePath);
          else state.pinPath(filePath);
        },
      },
      {
        label: "Tags",
        icon: "tag",
        submenu: tagMenuItems(tagPaths, tags),
      },
      {
        label: "Copy as path",
        icon: "copyPath",
        shortcut: platform?.platform === "macos" ? "ShiftCmdC" : "Ctrl+Shift+C",
        onClick: () => void state.copyAsPath(paneId),
      },
      { label: "Share", icon: "share", onClick: () => void state.shareSelection(paneId) },
      { type: "separator" },
      {
        label: "Cut",
        icon: "cut",
        shortcut: platform?.platform === "macos" ? "CmdX" : "Ctrl+X",
        onClick: () => state.cutSelection(paneId),
      },
      {
        label: "Copy",
        icon: "copy",
        shortcut: platform?.platform === "macos" ? "CmdC" : "Ctrl+C",
        onClick: () => state.copySelection(paneId),
      },
      {
        label: "Create shortcut",
        icon: "link",
        onClick: () => void state.createShortcut(paneId),
      },
      {
        label: "Duplicate",
        icon: "copy",
        onClick: () => void state.duplicateSelection(paneId),
      },
      {
        label: "Send to",
        icon: "share",
        submenu: sendTargets.map((target) => ({
          label: target.name,
          icon: target.icon === "desktop" ? "desktop" : target.icon === "documents" ? "documents" : "downloads",
          onClick: () => void state.sendSelectionTo(target.path, "cut", paneId),
        })),
      },
      { type: "separator" },
      {
        label: "Delete",
        icon: "delete",
        danger: true,
        shortcut: "Delete",
        onClick: () => state.deleteSelection(false, paneId),
      },
      {
        label: "Rename",
        icon: "rename",
        shortcut: "F2",
        disabled: selectedEntries.length !== 1,
        onClick: () => state.promptRename(paneId),
      },
      {
        label: "Properties",
        icon: "properties",
        shortcut: platform?.platform === "macos" ? "CmdI" : "Alt+Enter",
        onClick: () => void state.openProperties(filePath),
      },
    ];
  }, [clipboard, isHome, isPinned, locations, menu, paneId, platform?.platform, selectedEntries, tags]);

  if (!menu) return null;
  const width = menu.kind === "blank" || menu.kind === "sidebar" ? 270 : 304;
  const estimatedHeight = menu.kind === "blank" || menu.kind === "sidebar" ? 430 : 470;
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
