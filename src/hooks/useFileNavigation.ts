import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { FileEntry } from "../lib/types";
import { displayName } from "../lib/format";
import { useExplorerStore } from "../state/explorerStore";

export interface FileNavigationOptions {
  entries: FileEntry[];
  columns?: number;
  scrollToPath: (path: string) => void;
  containerRef: RefObject<HTMLDivElement>;
}

export function useFileNavigation({
  entries,
  columns = 1,
  scrollToPath,
  containerRef,
}: FileNavigationOptions) {
  const platform = useExplorerStore((state) => state.platform);
  const showExtensions = useExplorerStore((state) => state.showExtensions);
  const activeTab = useExplorerStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const setSelection = useExplorerStore((state) => state.setSelection);
  const toggleAt = useExplorerStore((state) => state.toggleAt);
  const selectRangeTo = useExplorerStore((state) => state.selectRangeTo);
  const openEntry = useExplorerStore((state) => state.openEntry);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const typeAhead = useRef({ value: "", time: 0 });

  const selected = activeTab?.selection ?? [];
  const anchor = activeTab?.anchorPath ?? null;

  const selectEntry = useCallback(
    (entry: FileEntry, additive: boolean) => {
      if (additive) {
        const current = useExplorerStore.getState().activeTab().selection;
        if (current.includes(entry.path)) {
          setSelection(current.filter((path) => path !== entry.path), entry.path);
        } else {
          setSelection([...current, entry.path], entry.path);
        }
      } else {
        setSelection([entry.path], entry.path);
      }
      setFocusedPath(entry.path);
      scrollToPath(entry.path);
    },
    [scrollToPath, setSelection],
  );

  const handleRowClick = useCallback(
    (event: ReactMouseEvent, entry: FileEntry) => {
      containerRef.current?.focus();
      const modifier = platform?.modifier === "cmd" ? event.metaKey || event.ctrlKey : event.ctrlKey || event.metaKey;
      if (event.shiftKey) {
        selectRangeTo(entry, modifier);
        setFocusedPath(entry.path);
        scrollToPath(entry.path);
      } else if (modifier) {
        toggleAt(entry);
        setFocusedPath(entry.path);
        scrollToPath(entry.path);
      } else {
        selectEntry(entry, false);
      }
    },
    [containerRef, platform?.modifier, scrollToPath, selectEntry, selectRangeTo, toggleAt],
  );

  const currentIndex = useCallback(() => {
    const focus = focusedPath ?? anchor ?? selected[selected.length - 1] ?? null;
    if (!focus) return -1;
    return entries.findIndex((entry) => entry.path === focus);
  }, [anchor, entries, focusedPath, selected]);

  const moveTo = useCallback(
    (index: number, extend: boolean, toggle: boolean) => {
      if (!entries.length) return;
      const clamped = Math.max(0, Math.min(entries.length - 1, index));
      const entry = entries[clamped];
      setFocusedPath(entry.path);
      if (extend) {
        selectRangeTo(entry, toggle);
      } else if (toggle) {
        toggleAt(entry);
      } else {
        setSelection([entry.path], entry.path);
      }
      scrollToPath(entry.path);
    },
    [entries, scrollToPath, selectRangeTo, setSelection, toggleAt],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLInputElement) return;
      const index = currentIndex();
      const extend = event.shiftKey;
      const toggle = event.ctrlKey || event.metaKey;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index + columns, extend, toggle);
          return;
        case "ArrowUp":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index - columns, extend, toggle);
          return;
        case "ArrowRight":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index + 1, extend, toggle);
          return;
        case "ArrowLeft":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index - 1, extend, toggle);
          return;
        case "Home":
          event.preventDefault();
          moveTo(0, extend, toggle);
          return;
        case "End":
          event.preventDefault();
          moveTo(entries.length - 1, extend, toggle);
          return;
        case "PageDown":
          event.preventDefault();
          moveTo(index < 0 ? 10 : index + 10, extend, toggle);
          return;
        case "PageUp":
          event.preventDefault();
          moveTo(index < 0 ? 0 : index - 10, extend, toggle);
          return;
        case " ":
          event.preventDefault();
          if (index >= 0) {
            toggleAt(entries[index]);
            setFocusedPath(entries[index].path);
          }
          return;
        case "Enter":
          if (selected.length) {
            event.preventDefault();
            const target = entries.find((entry) => entry.path === selected[selected.length - 1]);
            if (target) void openEntry(target);
          }
          return;
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
    [columns, currentIndex, entries, moveTo, openEntry, selectEntry, selected, showExtensions, toggleAt],
  );

  const onFocus = useCallback(() => {
    if (!selected.length && entries.length) {
      setFocusedPath(entries[0].path);
    }
  }, [entries, selected.length]);

  return { onKeyDown, handleRowClick, selectEntry, focusedPath, onFocus };
}
