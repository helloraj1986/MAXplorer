import { Icon } from "../Icon";
import { useExplorerStore } from "../../state/explorerStore";
import { useSearchStore } from "../../state/searchStore";
import { acceleratorToDisplay, DEFAULT_SHORTCUTS, normalizeAccelerator } from "../../lib/panes";

export function GlobalSearchField() {
  const openOverlay = useSearchStore((state) => state.openOverlay);
  const shortcuts = useExplorerStore((state) => state.shortcuts);
  const platform = useExplorerStore((state) => state.platform);
  const accelerator = acceleratorToDisplay(
    normalizeAccelerator(shortcuts.globalSearch, DEFAULT_SHORTCUTS.globalSearch),
    platform?.platform ?? "macos",
  );

  return (
    <button
      type="button"
      className="global-search-field"
      aria-label="Open Universal Search"
      aria-keyshortcuts={accelerator}
      onClick={() => openOverlay()}
    >
      <Icon name="search" size={15} className="global-search-icon" />
      <span className="global-search-placeholder">Search files, contents, and everywhere...</span>
      <span className="global-search-shortcut" aria-hidden="true">
        {accelerator}
      </span>
    </button>
  );
}
