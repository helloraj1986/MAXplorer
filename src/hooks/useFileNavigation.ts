import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { FileEntry, PaneId } from "../lib/types";
import { displayName } from "../lib/format";
import {
  hasAdditiveSelectionModifier,
  selectionIntent,
  selectionModifierFor,
} from "../lib/interaction";
import { useExplorerStore } from "../state/explorerStore";

export interface FileNavigationOptions {
  entries: FileEntry[];
  columns?: number;
  scrollToPath: (path: string) => void;
  containerRef: RefObject<HTMLDivElement>;
  paneId?: PaneId;
}

/** A modifier click already changed selection on pointerdown. */
interface SuppressedClick {
  path: string;
  until: number;
}

export function useFileNavigation({
  entries,
  columns = 1,
  scrollToPath,
  containerRef,
  paneId,
}: FileNavigationOptions) {
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const activePane = useExplorerStore((state) => state.activePane);
  const id = paneId ?? activePane;
  const showExtensions = useExplorerStore((state) => state.panes[id].showExtensions);
  const activeTab = useExplorerStore(
    (state) => state.panes[id].tabs.find((tab) => tab.id === state.panes[id].activeTabId),
  );
  const setSelection = useExplorerStore((state) => state.setSelection);
  const toggleAt = useExplorerStore((state) => state.toggleAt);
  const selectRangeTo = useExplorerStore((state) => state.selectRangeTo);
  const openEntry = useExplorerStore((state) => state.openEntry);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const typeAhead = useRef({ value: "", time: 0 });
  const suppressedClick = useRef<SuppressedClick | null>(null);
  const collapseOnClick = useRef<string | null>(null);

  const selected = activeTab?.selection ?? [];
  const anchor = activeTab?.anchorPath ?? null;

  const selectEntry = useCallback(
    (entry: FileEntry, additive: boolean) => {
      if (additive) {
        const current = useExplorerStore.getState().activeTab(id).selection;
        if (current.includes(entry.path)) {
          setSelection(current.filter((path) => path !== entry.path), entry.path, id);
        } else {
          setSelection([...current, entry.path], entry.path, id);
        }
      } else {
        setSelection([entry.path], entry.path, id);
      }
      setFocusedPath(entry.path);
      scrollToPath(entry.path);
    },
    [id, scrollToPath, setSelection],
  );

  const focusEntry = useCallback(
    (entry: FileEntry) => {
      setFocusedPath(entry.path);
      scrollToPath(entry.path);
    },
    [scrollToPath],
  );

  /**
   * Selection is committed on pointerdown, matching Windows Explorer and
   * avoiding WebKit's macOS-specific Control-click quirks. The trailing click
   * is used only to collapse a multi-selection to the item that was pressed.
   */
  const handleRowPointerDown = useCallback(
    (event: ReactPointerEvent, entry: FileEntry) => {
      if (event.button !== 0) return;
      containerRef.current?.focus({ preventScroll: true });
      const intent = selectionIntent(event, interfaceTheme);
      suppressedClick.current = null;
      collapseOnClick.current = null;

      if (intent === "range") {
        selectRangeTo(entry, hasAdditiveSelectionModifier(event, interfaceTheme), id);
        suppressedClick.current = { path: entry.path, until: performance.now() + 1200 };
      } else if (intent === "toggle") {
        toggleAt(entry, id);
        suppressedClick.current = { path: entry.path, until: performance.now() + 1200 };
      } else {
        const current = useExplorerStore.getState().activeTab(id).selection;
        if (current.includes(entry.path)) {
          // Keep a multi-selection intact so pressing a selected item can drag
          // the whole group. A completed click collapses it below.
          if (current.length > 1) collapseOnClick.current = entry.path;
        } else {
          setSelection([entry.path], entry.path, id);
        }
      }
      focusEntry(entry);
    },
    [containerRef, focusEntry, id, interfaceTheme, selectRangeTo, setSelection, toggleAt],
  );

  const handleRowClick = useCallback(
    (event: ReactMouseEvent, entry: FileEntry) => {
      containerRef.current?.focus({ preventScroll: true });
      const suppressed = suppressedClick.current;
      if (
        suppressed &&
        suppressed.path === entry.path &&
        performance.now() <= suppressed.until
      ) {
        suppressedClick.current = null;
        collapseOnClick.current = null;
        return;
      }
      suppressedClick.current = null;

      const intent = selectionIntent(event, interfaceTheme);
      if (intent === "range") {
        selectRangeTo(entry, hasAdditiveSelectionModifier(event, interfaceTheme), id);
      } else if (intent === "toggle") {
        toggleAt(entry, id);
      } else if (collapseOnClick.current === entry.path) {
        setSelection([entry.path], entry.path, id);
      }
      collapseOnClick.current = null;
      focusEntry(entry);
    },
    [containerRef, focusEntry, id, interfaceTheme, selectRangeTo, setSelection, toggleAt],
  );

  const currentIndex = useCallback(() => {
    const focus = focusedPath ?? anchor ?? selected[selected.length - 1] ?? null;
    if (!focus) return -1;
    return entries.findIndex((entry) => entry.path === focus);
  }, [anchor, entries, focusedPath, selected]);

  const moveTo = useCallback(
    (index: number, extend: boolean, additive: boolean) => {
      if (!entries.length) return;
      const clamped = Math.max(0, Math.min(entries.length - 1, index));
      const entry = entries[clamped];
      if (extend) {
        selectRangeTo(entry, additive, id);
      } else if (!additive) {
        setSelection([entry.path], entry.path, id);
      }
      // With the additive modifier, arrows move keyboard focus without changing
      // the selection; Space toggles the focused item (Windows Explorer).
      focusEntry(entry);
    },
    [entries, focusEntry, id, selectRangeTo, setSelection],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLInputElement) return;
      const index = currentIndex();
      const extend = event.shiftKey;
      const modifier = selectionModifierFor(interfaceTheme);
      const additive = modifier === "meta" ? event.metaKey : event.ctrlKey || event.metaKey;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index + columns, extend, additive);
          return;
        case "ArrowUp":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index - columns, extend, additive);
          return;
        case "ArrowRight":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index + 1, extend, additive);
          return;
        case "ArrowLeft":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index - 1, extend, additive);
          return;
        case "Home":
          event.preventDefault();
          moveTo(0, extend, additive);
          return;
        case "End":
          event.preventDefault();
          moveTo(entries.length - 1, extend, additive);
          return;
        case "PageDown":
          event.preventDefault();
          moveTo(index < 0 ? 10 : index + 10, extend, additive);
          return;
        case "PageUp":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index - 10, extend, additive);
          return;
        case " ":
          event.preventDefault();
          if (index >= 0) {
            toggleAt(entries[index], id);
            setFocusedPath(entries[index].path);
          }
          return;
        case "Enter": {
          const focusPath = focusedPath ?? anchor ?? selected[selected.length - 1] ?? null;
          const target = focusPath
            ? entries.find((entry) => entry.path === focusPath)
            : undefined;
          if (target) {
            event.preventDefault();
            void openEntry(target, id);
          }
          return;
        }
        default:
          break;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        if (now - typeAhead.current.time > 900) typeAhead.current.value = "";
        typeAhead.current.value += event.key.toLowerCase();
        typeAhead.current.time = now;
        const prefix = typeAhead.current.value;
        const start = index >= 0 ? index + 1 : 0;
        const ordered = [...entries.slice(start), ...entries.slice(0, start)];
        const match = ordered.find((entry) =>
          displayName(entry, showExtensions).toLowerCase().startsWith(prefix),
        );
        if (match) {
          event.preventDefault();
          selectEntry(match, false);
        }
      }
    },
    [
      anchor,
      columns,
      currentIndex,
      entries,
      focusedPath,
      id,
      interfaceTheme,
      moveTo,
      openEntry,
      selectEntry,
      selected,
      showExtensions,
      toggleAt,
    ],
  );

  const onFocus = useCallback(() => {
    if (!selected.length && entries.length) {
      setFocusedPath(entries[0].path);
    }
  }, [entries, selected.length]);

  // Pane switching and Escape dispatch a focus request so keyboard navigation
  // resumes in the file list even when focus was elsewhere. Only the pane named
  // in the event detail (or the active pane for a detail-less request) reacts.
  useEffect(() => {
    const focusList = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId?: PaneId }>).detail;
      if (detail?.paneId && detail.paneId !== id) return;
      if (!detail?.paneId && useExplorerStore.getState().activePane !== id) return;
      containerRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("explorer:focus-list", focusList);
    return () => window.removeEventListener("explorer:focus-list", focusList);
  }, [containerRef, id]);

  return {
    onKeyDown,
    handleRowClick,
    handleRowPointerDown,
    selectEntry,
    focusedPath,
    onFocus,
  };
}
