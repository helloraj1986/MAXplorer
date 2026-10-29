import { useEffect } from "react";
import { useExplorerStore } from "../state/explorerStore";
import { useSearchStore } from "../state/searchStore";
import { matchesShortcut } from "../lib/panes";
import { hasSelectAllModifier } from "../lib/interaction";
import type { ViewMode } from "../lib/types";

const VIEW_SHORTCUTS: Record<string, ViewMode> = {
  Digit1: "extraLarge",
  Digit2: "large",
  Digit3: "medium",
  Digit4: "small",
  Digit5: "list",
  Digit6: "details",
  Digit7: "tiles",
  Digit8: "content",
};

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable || tag === "select";
}

function isFileList(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".file-scroll"));
}

function focusEvent(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}

export function useKeyboardShortcuts(): void {
  const platform = useExplorerStore((state) => state.platform);
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const state = useExplorerStore.getState();
      const modifier = platform?.modifier === "cmd" ? event.metaKey : event.ctrlKey;
      const modifierKey = platform?.modifier === "cmd" ? "cmd" : "ctrl";
      const activePane = state.activePane;
      const editable = isEditable(event.target);
      const key = event.key;
      const lower = key.toLowerCase();
      const search = useSearchStore.getState();

      if (search.open) {
        if (key === "Escape") {
          event.preventDefault();
          search.closeOverlay();
          return;
        }
        if (matchesShortcut(event, state.shortcuts.globalSearch, modifierKey)) {
          event.preventDefault();
          search.closeOverlay();
        }
        return;
      }

      if (matchesShortcut(event, state.shortcuts.globalSearch, modifierKey)) {
        event.preventDefault();
        search.openOverlay();
        return;
      }

      // The search workspace owns its own selection, text editing, and result
      // keyboard model. Do not let file-list shortcuts fire underneath it.
      if (
        search.workspaceOpen &&
        event.target instanceof HTMLElement &&
        event.target.closest(".search-workspace")
      ) {
        if (key === "Escape") {
          event.preventDefault();
          search.closeWorkspace();
          return;
        }
        if (modifier && lower === "f") {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("maxplorer:focus-search-workspace"));
          return;
        }
        return;
      }

      if (key === "Escape") {
        if (state.dialog) {
          state.closeDialog();
          event.preventDefault();
          return;
        }
        if (state.contextMenu) {
          state.hideContextMenu();
          event.preventDefault();
          return;
        }
        if (state.activeTab(activePane).searchQuery || state.activeTab(activePane).searchResults) {
          state.clearSearch(activePane);
          event.preventDefault();
          return;
        }
        if (search.workspaceOpen) {
          search.closeWorkspace();
          event.preventDefault();
          return;
        }
        if (state.activeTab(activePane).selection.length) {
          state.clearSelection(activePane);
          event.preventDefault();
        }
        focusEvent("explorer:focus-list");
        return;
      }

      if (editable) return;

      // Pane switching is intentionally limited to the file browser so Tab
      // keeps its normal meaning in inputs, dialogs, and menus.
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        isFileList(event.target) &&
        matchesShortcut(event, state.shortcuts.switchPane, modifierKey)
      ) {
        const target = activePane === "left" ? "right" : "left";
        if (state.dualPane && !state.panes[target].collapsed) {
          event.preventDefault();
          state.setActivePane(target);
          window.dispatchEvent(new CustomEvent("explorer:focus-list", { detail: { paneId: target } }));
        }
        return;
      }

      // The file list owns these keys while it has focus.
      if (
        isFileList(event.target) &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " "].includes(key)
      ) {
        return;
      }

      if (
        matchesShortcut(event, state.shortcuts.toggleDualPane, modifierKey)
      ) {
        event.preventDefault();
        state.toggleDualPane();
        return;
      }
      if (modifier && !event.shiftKey && lower === "t") {
        event.preventDefault();
        void state.newTab(undefined, activePane);
        return;
      }
      if (modifier && lower === "w") {
        event.preventDefault();
        void state.closeActiveTab(activePane);
        return;
      }
      if (modifier && key === "Tab") {
        event.preventDefault();
        void state.cycleActiveTab(event.shiftKey ? -1 : 1, activePane);
        return;
      }
      if (modifier && lower === "l") {
        event.preventDefault();
        focusEvent("explorer:focus-address");
        return;
      }
      if (modifier && (lower === "f" || lower === "e")) {
        event.preventDefault();
        if (search.workspaceOpen) {
          window.dispatchEvent(new CustomEvent("maxplorer:focus-search-workspace"));
        } else {
          focusEvent("explorer:focus-search");
        }
        return;
      }
      if (modifier && lower === "n" && event.shiftKey) {
        event.preventDefault();
        void state.promptNewFolder(activePane);
        return;
      }
      if (modifier && lower === "n" && !event.shiftKey) {
        event.preventDefault();
        void state.newTab(undefined, activePane);
        return;
      }
      if (lower === "a" && !event.shiftKey && hasSelectAllModifier(event, interfaceTheme)) {
        event.preventDefault();
        state.selectAll(activePane);
        return;
      }
      if (modifier && lower === "c" && event.shiftKey) {
        event.preventDefault();
        void state.copyAsPath(activePane);
        return;
      }
      if (modifier && lower === "c") {
        event.preventDefault();
        state.copySelection(activePane);
        return;
      }
      if (modifier && lower === "x") {
        event.preventDefault();
        state.cutSelection(activePane);
        return;
      }
      if (modifier && lower === "v") {
        event.preventDefault();
        void state.paste(activePane);
        return;
      }
      if (modifier && lower === "r") {
        event.preventDefault();
        void state.refresh(activePane);
        return;
      }
      if (modifier && lower === "i") {
        event.preventDefault();
        void state.openProperties();
        return;
      }
      if (modifier && event.shiftKey && VIEW_SHORTCUTS[event.code]) {
        event.preventDefault();
        state.setViewMode(VIEW_SHORTCUTS[event.code], activePane);
        return;
      }
      if (modifier && lower === "d" && event.shiftKey) {
        event.preventDefault();
        state.deleteSelection(false, activePane);
        return;
      }
      if (event.altKey && key === "ArrowLeft") {
        event.preventDefault();
        void state.goBack(activePane);
        return;
      }
      if (event.altKey && key === "ArrowRight") {
        event.preventDefault();
        void state.goForward(activePane);
        return;
      }
      if (event.altKey && key === "ArrowUp") {
        event.preventDefault();
        void state.goUp(activePane);
        return;
      }
      if (event.altKey && key === "Enter") {
        event.preventDefault();
        void state.openProperties();
        return;
      }
      if (event.altKey && lower === "p" && event.shiftKey) {
        event.preventDefault();
        state.setDetailsPane(!state.detailsPane);
        return;
      }
      if (event.altKey && lower === "p") {
        event.preventDefault();
        state.setPreviewPane(!state.previewPane);
        return;
      }
      if (event.altKey && /^[1-9]$/.test(key)) {
        const index = Number(key) - 1;
        const tab = state.panes[activePane].tabs[index];
        if (tab) {
          event.preventDefault();
          void state.activateTab(tab.id, activePane);
        }
        return;
      }
      if (state.dualPane && matchesShortcut(event, state.shortcuts.copyToOtherPane, modifierKey)) {
        event.preventDefault();
        void state.copyToOtherPane();
        return;
      }
      if (state.dualPane && matchesShortcut(event, state.shortcuts.moveToOtherPane, modifierKey)) {
        event.preventDefault();
        void state.moveToOtherPane();
        return;
      }
      if (key === "F5") {
        event.preventDefault();
        void state.refresh(activePane);
        return;
      }
      if (key === "F2") {
        event.preventDefault();
        state.promptRename(activePane);
        return;
      }
      if (key === "Delete") {
        event.preventDefault();
        state.deleteSelection(event.shiftKey, activePane);
        return;
      }
      if (key === "Backspace") {
        if (state.activeTab(activePane).searchQuery) return;
        event.preventDefault();
        void state.goUp(activePane);
        return;
      }
      if (key === "Enter" && !modifier) {
        const selected = state.selectedEntries(activePane);
        if (selected.length === 1) {
          event.preventDefault();
          void state.openEntry(selected[0], activePane);
        }
        return;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [interfaceTheme, platform?.modifier]);
}
