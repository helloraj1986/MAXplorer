import { basename, isPathInside, joinPath, parentPath } from "./format";
import { createTab, createTabFrom } from "./tabs";
import type {
  PaneId,
  PaneState,
  PersistedPaneState,
  PersistedState,
  ShortcutMap,
  TabState,
  ViewMode,
} from "./types";
import { HOME_LOCATION } from "./types";

export const PANE_IDS: PaneId[] = ["left", "right"];

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  toggleDualPane: "Mod+Shift+M",
  copyToOtherPane: "F5",
  moveToOtherPane: "F6",
  switchPane: "Tab",
};

export interface PaneDefaults {
  viewMode?: ViewMode;
  showHidden?: boolean;
  showExtensions?: boolean;
}

export function createPane(location: string, defaults: PaneDefaults = {}): PaneState {
  const tab = createTab(location);
  return {
    tabs: [tab],
    activeTabId: tab.id,
    viewMode: defaults.viewMode ?? "details",
    sortKey: "name",
    sortDirection: "asc",
    groupBy: "none",
    showHidden: defaults.showHidden ?? false,
    showExtensions: defaults.showExtensions ?? true,
    collapsed: false,
  };
}

export function activeTabOf(pane: PaneState): TabState {
  return pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
}

export function otherPane(paneId: PaneId): PaneId {
  return paneId === "left" ? "right" : "left";
}

export function folderForTab(tab: TabState, home: string | null | undefined): string {
  return tab.location === HOME_LOCATION ? home ?? "/" : tab.location;
}

export function paneFolder(pane: PaneState, home: string | null | undefined): string {
  return folderForTab(activeTabOf(pane), home);
}

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.82, Math.max(0.18, value));
}

/**
 * Maps a navigation target from one pane's anchor to the other pane. Returns
 * `null` when the target is outside the source anchor, in which case the other
 * pane must be left unchanged.
 */
export function mapSynchronizedPath(
  fromAnchor: string,
  toAnchor: string,
  target: string,
): string | null {
  if (!fromAnchor || !toAnchor || fromAnchor === toAnchor) return null;
  const source = fromAnchor.replace(/[\\/]+$/, "");
  const destination = toAnchor.replace(/[\\/]+$/, "");
  if (!isPathInside(target, source)) return null;
  if (target === source) return destination;
  const suffix = target.slice(source.length).replace(/^[\\/]+/, "");
  if (!suffix) return destination;
  const separator = destination.includes("\\") ? "\\" : "/";
  return joinPath(destination, suffix, separator);
}

export interface SyncAnchors {
  left: string;
  right: string;
}

/**
 * Establishes the relative mapping used by synchronized navigation. Folders
 * with the same name are mapped through their parents (so sibling project
 * trees correspond); otherwise the current folders themselves are anchors.
 * Navigation outside an anchor never moves the other pane.
 */
export function deriveSyncAnchors(left: string, right: string): SyncAnchors | null {
  if (!left || !right || left === right) return null;
  if (left === HOME_LOCATION || right === HOME_LOCATION) return null;
  if (basename(left).toLowerCase() === basename(right).toLowerCase()) {
    const leftParent = parentPath(left);
    const rightParent = parentPath(right);
    if (leftParent && rightParent) {
      return { left: leftParent, right: rightParent };
    }
  }
  return { left, right };
}

export function sameFolder(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}

export interface ConflictInfo {
  names: string[];
  existing: string[];
}

/**
 * Finds destination name collisions using the already-loaded listing. The
 * backend still enforces all policies; this function only drives the UI prompt
 * so an operation never silently overwrites.
 */
export function detectConflicts(
  sourcePaths: string[],
  destinationEntries: Array<{ name: string; path: string }>,
): ConflictInfo {
  const names = new Map<string, string>();
  for (const entry of destinationEntries) {
    names.set(entry.name.toLowerCase(), entry.path);
  }
  const conflicts: string[] = [];
  const existing: string[] = [];
  for (const path of sourcePaths) {
    const match = names.get(basename(path).toLowerCase());
    if (match) {
      conflicts.push(basename(path));
      existing.push(match);
    }
  }
  return { names: conflicts, existing };
}

/** True when a source path is the destination folder or one of its ancestors. */
export function isRecursiveTransfer(sourcePaths: string[], destination: string): boolean {
  return sourcePaths.some((source) => isPathInside(destination, source));
}

/**
 * Pane ids that are showing the original location of at least one source path.
 * After a move those listings are stale even when the transfer was attributed to
 * the destination pane, so they have to be reloaded.
 */
export function panesShowingSources(
  folders: Record<PaneId, string>,
  sourcePaths: string[],
): PaneId[] {
  const parents = new Set<string>();
  for (const path of sourcePaths) {
    const parent = parentPath(path);
    if (parent) parents.add(parent);
  }
  return PANE_IDS.filter((paneId) => parents.has(folders[paneId]));
}

export interface AcceleratorEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const SPECIAL_KEYS = new Set([
  "Tab",
  "Enter",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  " ",
]);

function parseAccelerator(accelerator: string): {
  modifiers: Set<string>;
  key: string;
} {
  const tokens = accelerator
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  const modifiers = new Set<string>();
  let key = "";
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (["mod", "cmd", "meta", "ctrl", "control", "alt", "option", "shift"].includes(lower)) {
      modifiers.add(lower === "control" ? "ctrl" : lower === "option" ? "alt" : lower === "cmd" || lower === "meta" ? "meta" : lower);
      continue;
    }
    key = token;
  }
  return { modifiers, key };
}

export function matchesShortcut(
  event: AcceleratorEvent,
  accelerator: string,
  modifier: "cmd" | "ctrl",
): boolean {
  const { modifiers, key } = parseAccelerator(accelerator);
  if (!key) return false;
  const wantsMod = modifiers.has("mod");
  const wantsMeta = modifiers.has("meta") || (wantsMod && modifier === "cmd");
  const wantsCtrl = modifiers.has("ctrl") || (wantsMod && modifier === "ctrl");
  if (event.metaKey !== wantsMeta) return false;
  if (event.ctrlKey !== wantsCtrl) return false;
  if (event.altKey !== modifiers.has("alt")) return false;
  if (event.shiftKey !== modifiers.has("shift")) return false;

  const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
  if (/^f\d{1,2}$/i.test(key)) return event.key.toLowerCase() === key.toLowerCase();
  if (SPECIAL_KEYS.has(key)) return event.key === key;
  return event.key.length === 1
    ? event.key.toLowerCase() === normalizedKey
    : event.key.toLowerCase() === normalizedKey.toLowerCase();
}

/** Keeps a stored/user-entered accelerator only when it names a real key. */
export function normalizeAccelerator(value: string, fallback: string): string {
  const trimmed = value.trim().slice(0, 40);
  if (!trimmed) return fallback;
  return parseAccelerator(trimmed).key ? trimmed : fallback;
}

export function acceleratorToDisplay(accelerator: string, platform: "macos" | "windows" | "linux"): string {
  return accelerator
    .split("+")
    .map((token) => {
      const lower = token.trim().toLowerCase();
      if (lower === "mod") return platform === "macos" ? "⌘" : "Ctrl";
      if (lower === "meta" || lower === "cmd") return platform === "macos" ? "⌘" : "Cmd";
      if (lower === "ctrl" || lower === "control") return platform === "macos" ? "⌃" : "Ctrl";
      if (lower === "alt" || lower === "option") return platform === "macos" ? "⌥" : "Alt";
      if (lower === "shift") return platform === "macos" ? "⇧" : "Shift";
      if (token.length === 1) return token.toUpperCase();
      return token;
    })
    .join(platform === "macos" ? "" : "+");
}

export function persistedPaneFromState(pane: PaneState): PersistedPaneState {
  return {
    tabs: pane.tabs.map((tab) => ({
      id: tab.id,
      location: tab.location,
      history: tab.history,
      historyIndex: tab.historyIndex,
    })),
    activeTabId: pane.activeTabId,
    viewMode: pane.viewMode,
    sortKey: pane.sortKey,
    sortDirection: pane.sortDirection,
    groupBy: pane.groupBy,
    showHidden: pane.showHidden,
    showExtensions: pane.showExtensions,
    collapsed: pane.collapsed,
  };
}

export function paneFromPersisted(
  persisted: PersistedPaneState | undefined,
  fallback: string,
): PaneState {
  const base = createPane(fallback);
  if (!persisted || !persisted.tabs.length) return base;
  const tabs = persisted.tabs.map((tab) =>
    createTabFrom(tab.location, tab.history, tab.historyIndex, tab.id),
  );
  const activeTabId = tabs.some((tab) => tab.id === persisted.activeTabId)
    ? persisted.activeTabId
    : tabs[0].id;
  return {
    tabs,
    activeTabId,
    viewMode: persisted.viewMode,
    sortKey: persisted.sortKey,
    sortDirection: persisted.sortDirection,
    groupBy: persisted.groupBy,
    showHidden: persisted.showHidden,
    showExtensions: persisted.showExtensions,
    collapsed: persisted.collapsed,
  };
}

/** Reads the pane snapshot from either the new or the legacy persisted shape. */
export function panesFromPersisted(
  persisted: PersistedState | null,
  fallback: string,
): Record<PaneId, PaneState> {
  if (!persisted) {
    return { left: createPane(fallback), right: createPane(fallback) };
  }
  if (persisted.panes?.left) {
    return normalizeCollapsed({
      left: paneFromPersisted(persisted.panes.left, fallback),
      right: paneFromPersisted(persisted.panes.right, fallback),
    });
  }
  const legacy: PersistedPaneState = {
    tabs: persisted.tabs,
    activeTabId: persisted.activeTabId,
    viewMode: persisted.viewMode,
    sortKey: persisted.sortKey,
    sortDirection: persisted.sortDirection,
    groupBy: persisted.groupBy,
    showHidden: persisted.showHidden,
    showExtensions: persisted.showExtensions,
    collapsed: false,
  };
  return {
    left: paneFromPersisted(legacy, fallback),
    right: createPane(fallback),
  };
}

/** A split with both sides collapsed would have no visible file list. */
function normalizeCollapsed(panes: Record<PaneId, PaneState>): Record<PaneId, PaneState> {
  if (!panes.left.collapsed || !panes.right.collapsed) return panes;
  return { ...panes, right: { ...panes.right, collapsed: false } };
}
