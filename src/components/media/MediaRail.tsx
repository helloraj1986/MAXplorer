import { useCallback, useRef } from "react";
import { useMediaStore } from "../../state/mediaStore";
import { MediaBrandMark, MediaIcon, type MediaIconName } from "./icons";

/**
 * Left icon rail (docs/MEDIA_UI_SPEC.md §2.1).
 *
 * 72 px wide, brand mark on top, navigation in the middle, Settings pinned to
 * the bottom. Roving tabindex: the active item is the single tab stop and
 * ↑/↓/Home/End move focus between items (D-pad ready — spec §8).
 */
interface RailItem {
  id: string;
  label: string;
  icon: MediaIconName;
  /** Disabled items are rendered inert with an explanation instead of a dead click. */
  unavailable?: string;
}

const NAV_ITEMS: RailItem[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "discover", label: "Discover", icon: "discover" },
  {
    id: "library",
    label: "Library",
    icon: "library",
    unavailable: "Arrives with the library and sync roadmap item",
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: "calendar",
    unavailable: "Arrives with the library and sync roadmap item",
  },
  {
    id: "addons",
    label: "Addons",
    icon: "addons",
    unavailable: "Arrives with the addon manager roadmap item",
  },
];

const FOOT_ITEMS: RailItem[] = [
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    unavailable: "Media settings arrive with the addon manager roadmap item",
  },
];

export function MediaRail() {
  const screen = useMediaStore((state) => state.screen);
  const setScreen = useMediaStore((state) => state.setScreen);
  const clearSelection = useMediaStore((state) => state.clearSelection);
  const downloadActive = useMediaStore((state) => state.engine?.phase === "resolving");

  // Roving focus lives on real buttons; the refs are keyed by item id.
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activate = useCallback(
    (item: RailItem) => {
      if (item.unavailable) return;
      if (item.id === "home") {
        clearSelection();
        setScreen("board");
        return;
      }
      if (item.id === "discover") {
        setScreen("board");
        clearSelection();
        // v1: the search field filters already-loaded catalogs (spec §12.5), so
        // Discover just puts the user in the field.
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>("[data-media-search]")?.focus();
        });
      }
    },
    [clearSelection, setScreen],
  );

  const activeId = screen === "board" ? "home" : screen === "detail" ? "home" : "";

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, itemId: string) => {
    const enabledIds = NAV_ITEMS.filter((entry) => !entry.unavailable).map((entry) => entry.id);
    const index = enabledIds.indexOf(itemId);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % enabledIds.length;
    else if (event.key === "ArrowUp") next = (index - 1 + enabledIds.length) % enabledIds.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabledIds.length - 1;
    else return;
    event.preventDefault();
    buttonRefs.current[enabledIds[next]]?.focus();
  };

  return (
    <nav className="media-rail" aria-label="Media navigation">
      <div className="media-rail-brand" aria-label="MAXplorer Media">
        <MediaBrandMark />
      </div>

      <div className="media-rail-group">
        {NAV_ITEMS.map((item, index) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              ref={(node) => {
                buttonRefs.current[item.id] = node;
              }}
              className={`media-rail-item${active ? " media-rail-item--active" : ""}`}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              aria-disabled={item.unavailable ? true : undefined}
              disabled={Boolean(item.unavailable)}
              title={item.unavailable ?? item.label}
              tabIndex={active || (activeId === "" && index === 0) ? 0 : -1}
              onClick={() => activate(item)}
              onKeyDown={(event) => onKeyDown(event, item.id)}
            >
              <MediaIcon name={item.icon} size={26} />
              {item.id === "library" && downloadActive ? (
                <span className="media-rail-dot" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="media-rail-group media-rail-foot">
        {FOOT_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            ref={(node) => {
              buttonRefs.current[item.id] = node;
            }}
            className="media-rail-item"
            aria-label={item.label}
            aria-disabled={item.unavailable ? true : undefined}
            disabled={Boolean(item.unavailable)}
            title={item.unavailable ?? item.label}
            tabIndex={-1}
            onClick={() => activate(item)}
          >
            <MediaIcon name={item.icon} size={26} />
          </button>
        ))}
      </div>
    </nav>
  );
}
