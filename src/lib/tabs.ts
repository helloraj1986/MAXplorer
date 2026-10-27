import type { TabState } from "./types";
import { createHistory } from "./history";

let counter = 0;

export function nextTabId(): string {
  counter += 1;
  return `tab-${Date.now().toString(36)}-${counter}`;
}

export function createTab(location: string, id = nextTabId()): TabState {
  return {
    id,
    location,
    history: [location],
    historyIndex: 0,
    entries: [],
    listingFor: null,
    loading: false,
    error: null,
    truncated: false,
    readErrors: 0,
    selection: [],
    anchorPath: null,
    searchQuery: "",
    searchResults: null,
    searchLoading: false,
    searchError: null,
    searchRequestId: 0,
    searchTruncated: false,
    searchScanned: 0,
  };
}

export function createTabFrom(
  location: string,
  history: string[],
  historyIndex: number,
  id = nextTabId(),
): TabState {
  const tab = createTab(location, id);
  return {
    ...tab,
    history: history.length ? history : createHistory(location).history,
    historyIndex: Math.max(0, Math.min(historyIndex, Math.max(0, history.length - 1))),
  };
}

export function closeTab(
  tabs: TabState[],
  activeId: string,
  closeId: string,
): { tabs: TabState[]; activeId: string; closedLast: boolean } {
  if (tabs.length === 1) {
    return { tabs, activeId, closedLast: true };
  }
  const index = tabs.findIndex((tab) => tab.id === closeId);
  if (index < 0) return { tabs, activeId, closedLast: false };
  const next = tabs.filter((tab) => tab.id !== closeId);
  let nextActive = activeId;
  if (activeId === closeId) {
    nextActive = next[Math.min(index, next.length - 1)]?.id ?? next[0].id;
  }
  return { tabs: next, activeId: nextActive, closedLast: false };
}

export function closeOtherTabs(
  tabs: TabState[],
  activeId: string,
  keepId: string,
): { tabs: TabState[]; activeId: string } {
  const next = tabs.filter((tab) => tab.id === keepId);
  if (!next.length) return { tabs, activeId };
  return { tabs: next, activeId: activeId === keepId ? activeId : keepId };
}

export function cycleTab(
  tabs: TabState[],
  activeId: string,
  direction: 1 | -1,
): string {
  if (tabs.length <= 1) return activeId;
  const index = tabs.findIndex((tab) => tab.id === activeId);
  if (index < 0) return tabs[0].id;
  return tabs[(index + direction + tabs.length) % tabs.length].id;
}

export function duplicateTab(tab: TabState): TabState {
  return {
    ...createTabFrom(tab.location, tab.history, tab.historyIndex),
    selection: [],
    searchQuery: "",
    searchResults: null,
    searchLoading: false,
    searchError: null,
  };
}
