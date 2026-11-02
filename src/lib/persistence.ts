import type {
  ColumnVisibility,
  GroupBy,
  InterfaceTheme,
  PaneId,
  PersistedPaneState,
  PersistedState,
  PersistedTab,
  PreviewPreferences,
  PreviewPosition,
  PreviewRendererId,
  ShortcutMap,
  NetworkConnection,
  SortDirection,
  SortKey,
  TabState,
  TagAssignment,
  TagDefinition,
  ThemeMode,
  TransferHistoryItem,
  ViewMode,
} from "./types";
import { DEFAULT_PREVIEW_PREFERENCES, HOME_LOCATION } from "./types";
import { normalizeTagColor, normalizeTagName, tagPathKey } from "./tags";
import { networkConnectionName, normalizeNetworkAddress } from "./network";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_INTERFACE_THEME,
  normalizeDisplayPreferences,
  normalizeInterfaceTheme,
  normalizeThemeMode,
} from "./theme";
import { DEFAULT_SHORTCUTS, clampSplitRatio, normalizeAccelerator } from "./panes";

export const STORAGE_KEY = "win11-explorer-state-v1";
export const WINDOW_STORAGE_KEY = "win11-explorer-window-v1";

const DEFAULT_PANE: Omit<PersistedPaneState, "tabs" | "activeTabId"> = {
  viewMode: "details",
  sortKey: "name",
  sortDirection: "asc",
  groupBy: "none",
  showHidden: false,
  showExtensions: true,
  collapsed: false,
  tagFilterId: null,
};

function defaultPane(tab: Pick<TabState, "id" | "location" | "history" | "historyIndex">): PersistedPaneState {
  return {
    tabs: [tab],
    activeTabId: tab.id,
    ...DEFAULT_PANE,
  };
}

export function defaultPersisted(
  tab: Pick<TabState, "id" | "location" | "history" | "historyIndex">,
): PersistedState {
  const left = defaultPane(tab);
  const right = defaultPane({ ...tab, id: `${tab.id}-right` });
  return {
    version: 1,
    tabs: left.tabs,
    activeTabId: left.activeTabId,
    viewMode: left.viewMode,
    sortKey: left.sortKey,
    sortDirection: left.sortDirection,
    groupBy: left.groupBy,
    showHidden: left.showHidden,
    showExtensions: left.showExtensions,
    detailsPane: false,
    previewPane: false,
    preview: { ...DEFAULT_PREVIEW_PREFERENCES },
    theme: "system",
    interfaceTheme: DEFAULT_INTERFACE_THEME,
    display: { ...DEFAULT_DISPLAY_PREFERENCES },
    columnVisibility: { date: true, type: true, size: true },
    commandBarLabels: true,
    sidebarVisible: true,
    folderOpenMode: "sameTab",
    confirmTrashDelete: true,
    columnWidths: {
      name: 272,
      date: 144,
      type: 120,
      size: 80,
      location: 260,
    },
    sidebarWidth: 204,
    pinned: [],
    recents: [],
    dualPane: false,
    activePane: "left",
    splitRatio: 0.5,
    syncNavigation: false,
    panes: { left, right },
    shortcuts: { ...DEFAULT_SHORTCUTS },
    transferHistory: [],
    tags: [],
    tagAssignments: [],
    networkConnections: [],
  };
}

const VIEW_MODES = new Set([
  "extraLarge",
  "large",
  "medium",
  "small",
  "list",
  "details",
  "tiles",
  "content",
]);
const SORT_KEYS = new Set(["name", "date", "type", "size"]);
const GROUP_BY = new Set(["none", "type", "date", "size"]);
const THEMES = new Set(["system", "light", "dark"]);

function parseTabs(value: unknown): PersistedTab[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (tab): tab is PersistedTab =>
        !!tab &&
        typeof tab === "object" &&
        typeof (tab as PersistedTab).id === "string" &&
        typeof (tab as PersistedTab).location === "string" &&
        Array.isArray((tab as PersistedTab).history) &&
        (tab as PersistedTab).history.every((item) => typeof item === "string") &&
        typeof (tab as PersistedTab).historyIndex === "number",
    )
    .map((tab) => ({
      ...tab,
      location: tab.location || HOME_LOCATION,
      history: tab.history.length ? tab.history : [tab.location || HOME_LOCATION],
      historyIndex: Math.max(0, Math.min(tab.historyIndex, Math.max(0, tab.history.length - 1))),
    }));
}

function parsePane(value: unknown): PersistedPaneState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PersistedPaneState>;
  const tabs = parseTabs(raw.tabs);
  if (!tabs.length) return null;
  const activeTabId =
    typeof raw.activeTabId === "string" && tabs.some((tab) => tab.id === raw.activeTabId)
      ? raw.activeTabId
      : tabs[0].id;
  return {
    tabs,
    activeTabId,
    viewMode: VIEW_MODES.has(raw.viewMode ?? "") ? raw.viewMode! : "details",
    sortKey: SORT_KEYS.has(raw.sortKey ?? "") ? raw.sortKey! : "name",
    sortDirection: raw.sortDirection === "desc" ? "desc" : "asc",
    groupBy: GROUP_BY.has(raw.groupBy ?? "") ? raw.groupBy! : "none",
    showHidden: Boolean(raw.showHidden),
    showExtensions: raw.showExtensions !== false,
    collapsed: Boolean(raw.collapsed),
    tagFilterId: typeof raw.tagFilterId === "string" ? raw.tagFilterId : null,
  };
}

function parseShortcutMap(value: unknown): ShortcutMap {
  if (!value || typeof value !== "object") return { ...DEFAULT_SHORTCUTS };
  const raw = value as Partial<Record<keyof ShortcutMap, unknown>>;
  const read = (key: keyof ShortcutMap) =>
    typeof raw[key] === "string"
      ? normalizeAccelerator(raw[key] as string, DEFAULT_SHORTCUTS[key])
      : DEFAULT_SHORTCUTS[key];
  return {
    toggleDualPane: read("toggleDualPane"),
    copyToOtherPane: read("copyToOtherPane"),
    moveToOtherPane: read("moveToOtherPane"),
    switchPane: read("switchPane"),
    globalSearch: read("globalSearch"),
  };
}

const TRANSFER_STATUSES = new Set([
  "queued",
  "scanning",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

function parseTransferHistory(value: unknown): TransferHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is TransferHistoryItem =>
        !!item &&
        typeof item === "object" &&
        typeof (item as TransferHistoryItem).id === "string" &&
        typeof (item as TransferHistoryItem).destination === "string" &&
        Array.isArray((item as TransferHistoryItem).sources) &&
        typeof (item as TransferHistoryItem).completedAt === "number" &&
        TRANSFER_STATUSES.has((item as TransferHistoryItem).status),
    )
    .slice(0, 40);
}


function parsePreviewPreferences(
  value: unknown,
  legacyVisible: boolean,
): PreviewPreferences {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_PREVIEW_PREFERENCES, visible: legacyVisible };
  }
  const raw = value as Partial<PreviewPreferences>;
  const positions = new Set<PreviewPosition>(["left", "right", "bottom"]);
  const enabled = Array.isArray(raw.renderers)
    ? new Set(
        raw.renderers.filter((item): item is PreviewRendererId =>
          DEFAULT_PREVIEW_PREFERENCES.renderers.includes(item as PreviewRendererId),
        ),
      )
    : null;
  return {
    visible: raw.visible === true,
    position: positions.has(raw.position as PreviewPosition)
      ? (raw.position as PreviewPosition)
      : DEFAULT_PREVIEW_PREFERENCES.position,
    focusMode: raw.focusMode === true,
    width: clampNumber(raw.width, 240, 560, DEFAULT_PREVIEW_PREFERENCES.width),
    height: clampNumber(raw.height, 180, 620, DEFAULT_PREVIEW_PREFERENCES.height),
    autoPlayMedia: raw.autoPlayMedia === true,
    textLimit: clampNumber(
      raw.textLimit,
      16 * 1024,
      4 * 1024 * 1024,
      DEFAULT_PREVIEW_PREFERENCES.textLimit,
    ),
    renderers: (() => {
      const values = enabled
        ? DEFAULT_PREVIEW_PREFERENCES.renderers.filter((item) => enabled.has(item))
        : [...DEFAULT_PREVIEW_PREFERENCES.renderers];
      if (!values.includes("metadata")) values.push("metadata");
      return values;
    })(),
  };
}

function parseColumnVisibility(value: unknown): ColumnVisibility {
  if (!value || typeof value !== "object") return { date: true, type: true, size: true };
  const raw = value as Partial<ColumnVisibility>;
  return {
    date: raw.date !== false,
    type: raw.type !== false,
    size: raw.size !== false,
  };
}

function parseTags(value: unknown): TagDefinition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: TagDefinition[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<TagDefinition>;
    if (typeof raw.id !== "string" || !raw.id.trim()) continue;
    if (seen.has(raw.id)) continue;
    const name = normalizeTagName(typeof raw.name === "string" ? raw.name : "");
    if (!name) continue;
    seen.add(raw.id);
    tags.push({
      id: raw.id,
      name,
      color: normalizeTagColor(raw.color),
      createdAt:
        typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
          ? raw.createdAt
          : Date.now(),
    });
  }
  return tags;
}

function parseTagAssignments(
  value: unknown,
  tags: TagDefinition[],
): TagAssignment[] {
  if (!Array.isArray(value)) return [];
  const validIds = new Set(tags.map((tag) => tag.id));
  const seen = new Map<string, TagAssignment>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<TagAssignment>;
    if (typeof raw.path !== "string" || !raw.path.trim()) continue;
    const tagIds = Array.isArray(raw.tagIds)
      ? [...new Set(raw.tagIds.filter((id): id is string => typeof id === "string"))].filter(
          (id) => validIds.has(id),
        )
      : [];
    if (!tagIds.length) continue;
    const key = tagPathKey(raw.path);
    const existing = seen.get(key);
    if (existing) {
      existing.tagIds = [...new Set([...existing.tagIds, ...tagIds])];
      continue;
    }
    const name =
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name
        : raw.path.split(/[\\/]/).filter(Boolean).pop() || raw.path;
    seen.set(key, {
      path: raw.path,
      name,
      isDir: raw.isDir === true,
      modified:
        typeof raw.modified === "number" && Number.isFinite(raw.modified)
          ? raw.modified
          : null,
      size: typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : null,
      tagIds,
      updatedAt:
        typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
          ? raw.updatedAt
          : Date.now(),
    });
  }
  return [...seen.values()];
}

function parseNetworkConnections(value: unknown): NetworkConnection[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const addresses = new Set<string>();
  const connections: NetworkConnection[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<NetworkConnection>;
    if (typeof raw.id !== "string" || !raw.id.trim()) continue;
    const address = normalizeNetworkAddress(
      typeof raw.address === "string" ? raw.address : "",
    );
    if (!address) continue;
    if (seen.has(raw.id) || addresses.has(address.toLowerCase())) continue;
    seen.add(raw.id);
    addresses.add(address.toLowerCase());
    connections.push({
      id: raw.id,
      name: networkConnectionName(
        typeof raw.name === "string" ? raw.name : "",
        address,
      ),
      address,
      mountPath:
        typeof raw.mountPath === "string" && raw.mountPath.trim()
          ? raw.mountPath
          : null,
      createdAt:
        typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
          ? raw.createdAt
          : Date.now(),
      lastConnectedAt:
        typeof raw.lastConnectedAt === "number" && Number.isFinite(raw.lastConnectedAt)
          ? raw.lastConnectedAt
          : null,
    });
  }
  return connections;
}

/**
 * Pure parser for a persisted snapshot. Returns `null` for missing, malformed,
 * or incompatible data so callers can fall back to defaults.
 */
export function parsePersisted(raw: string | null): PersistedState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PersistedState>;
    if (!value || value.version !== 1) return null;
    const tags = parseTags(value.tags);
    const tagAssignments = parseTagAssignments(value.tagAssignments, tags);
    const networkConnections = parseNetworkConnections(value.networkConnections);
    const preview = parsePreviewPreferences(value.preview, value.previewPane === true);
    if (value.detailsPane && preview.visible) preview.visible = false;
    const validTagIds = new Set(tags.map((tag) => tag.id));
    const legacyTabs = parseTabs(value.tabs);
    const parsedPanes = value.panes as Partial<Record<PaneId, unknown>> | undefined;
    const left =
      parsePane(parsedPanes?.left) ??
      (legacyTabs.length
        ? {
            tabs: legacyTabs,
            activeTabId:
              typeof value.activeTabId === "string" &&
              legacyTabs.some((tab) => tab.id === value.activeTabId)
                ? value.activeTabId
                : legacyTabs[0].id,
            viewMode: VIEW_MODES.has(value.viewMode ?? "") ? (value.viewMode as ViewMode) : "details",
            sortKey: SORT_KEYS.has(value.sortKey ?? "") ? (value.sortKey as SortKey) : "name",
            sortDirection: (value.sortDirection === "desc" ? "desc" : "asc") as SortDirection,
            groupBy: GROUP_BY.has(value.groupBy ?? "") ? (value.groupBy as GroupBy) : "none",
            showHidden: Boolean(value.showHidden),
            showExtensions: value.showExtensions !== false,
            collapsed: false,
            tagFilterId: null,
          }
        : null);
    if (!left) return null;
    const right = parsePane(parsedPanes?.right) ?? {
      ...left,
      tabs: left.tabs.map((tab) => ({ ...tab, id: `${tab.id}-right` })),
      activeTabId: `${left.activeTabId}-right`,
    };
    const sanitizeFilter = (pane: PersistedPaneState): PersistedPaneState => ({
      ...pane,
      tagFilterId:
        pane.tagFilterId && validTagIds.has(pane.tagFilterId) ? pane.tagFilterId : null,
    });
    const columnWidths =
      value.columnWidths && typeof value.columnWidths === "object"
        ? {
            name: clampNumber(value.columnWidths.name, 160, 600, 272),
            date: clampNumber(value.columnWidths.date, 80, 300, 144),
            type: clampNumber(value.columnWidths.type, 70, 300, 120),
            size: clampNumber(value.columnWidths.size, 60, 220, 80),
            location: clampNumber(value.columnWidths.location, 120, 500, 260),
          }
        : { name: 272, date: 144, type: 120, size: 80, location: 260 };
    return {
      version: 1,
      tabs: left.tabs,
      activeTabId: left.activeTabId,
      viewMode: left.viewMode,
      sortKey: left.sortKey,
      sortDirection: left.sortDirection,
      groupBy: left.groupBy,
      showHidden: left.showHidden,
      showExtensions: left.showExtensions,
      detailsPane: Boolean(value.detailsPane),
      previewPane: preview.visible,
      preview,
      theme: THEMES.has(value.theme ?? "") ? value.theme! : "system",
      interfaceTheme: normalizeInterfaceTheme(value.interfaceTheme),
      display: normalizeDisplayPreferences(value.display),
      columnVisibility: parseColumnVisibility(value.columnVisibility),
      commandBarLabels: value.commandBarLabels !== false,
      sidebarVisible: value.sidebarVisible !== false,
      folderOpenMode: value.folderOpenMode === "newTab" ? "newTab" : "sameTab",
      confirmTrashDelete: value.confirmTrashDelete !== false,
      columnWidths,
      sidebarWidth: clampNumber(value.sidebarWidth, 160, 360, 204),
      pinned: Array.isArray(value.pinned)
        ? value.pinned.filter((item): item is string => typeof item === "string")
        : [],
      recents: Array.isArray(value.recents)
        ? value.recents
            .filter(
              (item) =>
                !!item &&
                typeof item.path === "string" &&
                typeof item.name === "string" &&
                typeof item.isDir === "boolean" &&
                typeof item.visitedAt === "number",
            )
            .slice(0, 30)
        : [],
      dualPane: value.dualPane === true,
      activePane: value.activePane === "right" ? "right" : "left",
      splitRatio: clampSplitRatio(
        typeof value.splitRatio === "number" ? value.splitRatio : 0.5,
      ),
      syncNavigation: value.syncNavigation === true,
      panes: { left: sanitizeFilter(left), right: sanitizeFilter(right) },
      shortcuts: parseShortcutMap(value.shortcuts),
      transferHistory: parseTransferHistory(value.transferHistory),
      tags,
      tagAssignments,
      networkConnections,
    };
  } catch {
    return null;
  }
}

export function loadPersisted(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    return parsePersisted(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export interface ThemePreferences {
  interfaceTheme: InterfaceTheme;
  theme: ThemeMode;
}

/**
 * Pure, tolerant reader for the two theme preferences. Used before the first
 * React render so the window never flashes the wrong design or appearance.
 */
export function parseThemePreferences(raw: string | null): ThemePreferences {
  const fallback: ThemePreferences = { interfaceTheme: DEFAULT_INTERFACE_THEME, theme: "system" };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Partial<PersistedState> | null;
    if (!value || typeof value !== "object") return fallback;
    return {
      interfaceTheme: normalizeInterfaceTheme(value.interfaceTheme),
      theme: normalizeThemeMode(value.theme),
    };
  } catch {
    return fallback;
  }
}

export function loadThemePreferences(): ThemePreferences {
  if (typeof window === "undefined") {
    return { interfaceTheme: DEFAULT_INTERFACE_THEME, theme: "system" };
  }
  try {
    return parseThemePreferences(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return { interfaceTheme: DEFAULT_INTERFACE_THEME, theme: "system" };
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function savePersisted(state: PersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable or full; the app continues without persistence.
  }
}

export function clearPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(WINDOW_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
