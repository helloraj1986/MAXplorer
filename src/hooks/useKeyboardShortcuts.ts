import { useEffect } from "react";
import { useExplorerStore } from "../state/explorerStore";
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
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const state = useExplorerStore.getState();
      const modifier = platform?.modifier === "cmd" ? event.metaKey : event.ctrlKey;
      const editable = isEditable(event.target);
      const key = event.key;
      const lower = key.toLowerCase();

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
        if (state.activeTab().searchQuery || state.activeTab().searchResults) {
          state.clearSearch();
          event.preventDefault();
          return;
        }
        focusEvent("explorer:focus-list");
        return;
      }

      if (editable) return;

      // The file list owns these keys while it has focus.
      if (
        isFileList(event.target) &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " "].includes(key)
      ) {
        return;
      }

      if (modifier && !event.shiftKey && lower === "t") {
        event.preventDefault();
        void state.newTab();
        return;
      }
      if (modifier && lower === "w") {
        event.preventDefault();
        void state.closeActiveTab();
        return;
      }
      if (modifier && key === "Tab") {
        event.preventDefault();
        void state.cycleActiveTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (modifier && lower === "l") {
        event.preventDefault();
        focusEvent("explorer:focus-address");
        return;
      }
      if (modifier && (lower === "f" || lower === "e")) {
        event.preventDefault();
        focusEvent("explorer:focus-search");
        return;
      }
      if (modifier && lower === "n" && event.shiftKey) {
        event.preventDefault();
        void state.promptNewFolder();
        return;
      }
      if (modifier && lower === "n" && !event.shiftKey) {
        event.preventDefault();
        void state.newTab();
        return;
      }
      if (modifier && lower === "a") {
        event.preventDefault();
        state.selectAll();
        return;
      }
      if (modifier && lower === "c" && event.shiftKey) {
        event.preventDefault();
        void state.copyAsPath();
        return;
      }
      if (modifier && lower === "c") {
        event.preventDefault();
        state.copySelection();
        return;
      }
      if (modifier && lower === "x") {
        event.preventDefault();
        state.cutSelection();
        return;
      }
      if (modifier && lower === "v") {
        event.preventDefault();
        void state.paste();
        return;
      }
      if (modifier && lower === "r") {
        event.preventDefault();
        void state.refresh();
        return;
      }
      if (modifier && lower === "i") {
        event.preventDefault();
        void state.openProperties();
        return;
      }
      if (modifier && event.shiftKey && VIEW_SHORTCUTS[event.code]) {
        event.preventDefault();
        state.setViewMode(VIEW_SHORTCUTS[event.code]);
        return;
      }
      if (modifier && lower === "d" && event.shiftKey) {
        event.preventDefault();
        state.deleteSelection(false);
        return;
      }
      if (event.altKey && key === "ArrowLeft") {
        event.preventDefault();
        void state.goBack();
        return;
      }
      if (event.altKey && key === "ArrowRight") {
        event.preventDefault();
        void state.goForward();
        return;
      }
      if (event.altKey && key === "ArrowUp") {
        event.preventDefault();
        void state.goUp();
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
        const tab = state.tabs[index];
        if (tab) {
          event.preventDefault();
          void state.activateTab(tab.id);
        }
        return;
      }
      if (key === "F5") {
        event.preventDefault();
        void state.refresh();
        return;
      }
      if (key === "F2") {
        event.preventDefault();
        state.promptRename();
        return;
      }
      if (key === "Delete") {
        event.preventDefault();
        state.deleteSelection(event.shiftKey);
        return;
      }
      if (key === "Backspace") {
        if (state.activeTab().searchQuery) return;
        event.preventDefault();
        void state.goUp();
        return;
      }
      if (key === "Enter" && !modifier) {
        const selected = state.selectedEntries();
        if (selected.length === 1) {
          event.preventDefault();
          void state.openEntry(selected[0]);
        }
        return;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [platform?.modifier]);
}
