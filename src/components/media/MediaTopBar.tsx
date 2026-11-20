import { useEffect, useRef } from "react";
import { logDiagnostic } from "../../lib/diagnostics";
import { useMediaStore } from "../../state/mediaStore";
import { MediaIcon } from "./icons";

/**
 * Media top bar (docs/MEDIA_UI_SPEC.md §2.2).
 *
 * 56 px tall, transparent over the hero. Search field centred (⌘F focuses,
 * Esc clears), right cluster = downloads / fullscreen / cast. The window drag
 * strip is kept (`-webkit-app-region: drag`) so the Tauri window stays movable.
 */
export function MediaTopBar() {
  const query = useMediaStore((state) => state.searchQuery);
  const setSearchQuery = useMediaStore((state) => state.setSearchQuery);
  const manifest = useMediaStore((state) => state.manifest);
  const manifestLoading = useMediaStore((state) => state.manifestLoading);
  const downloadActive = useMediaStore((state) => state.engine?.phase === "resolving");
  const closeWorkspace = useMediaStore((state) => state.closeWorkspace);
  const clearSelection = useMediaStore((state) => state.clearSelection);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // ⌘F focuses the search field from anywhere in the media workspace; Esc
  // clears it while it holds focus (spec §2.2).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      // The webview can refuse fullscreen; that must not look like a dead button.
      logDiagnostic("warn", `media fullscreen failed: ${String(error)}`, "media.shell");
    }
  };

  const statusLabel = manifest
    ? `${manifest.name} connected`
    : manifestLoading
      ? "Connecting…"
      : "Offline";

  return (
    <header className="media-topbar">
      <span className={`media-topbar-status ${manifest ? "ok" : "off"}`} aria-live="polite">
        <span className={`media-dot ${manifest ? "ok" : "warn"}`} />
        {statusLabel}
      </span>

      <div className="media-search">
        <MediaIcon name="search" size={16} className="media-search-icon" />
        <input
          ref={inputRef}
          type="search"
          data-media-search
          className="media-search-input"
          placeholder="Search addons"
          aria-label="Search addons"
          value={query}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              if (query) setSearchQuery("");
              else inputRef.current?.blur();
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="media-search-clear"
            aria-label="Clear search"
            onClick={() => {
              setSearchQuery("");
              inputRef.current?.focus();
            }}
          >
            <MediaIcon name="close" size={14} />
          </button>
        ) : (
          <kbd className="media-search-kbd">⌘F</kbd>
        )}
      </div>

      <div className="media-topbar-actions">
        <button
          type="button"
          className="media-topbar-btn"
          aria-label="Downloads"
          title="Downloads — arrives with the downloads screen"
          aria-disabled={true}
          disabled
        >
          <MediaIcon name="downloads" size={20} />
          {downloadActive ? <span className="media-topbar-dot" aria-hidden="true" /> : null}
        </button>
        <button
          type="button"
          className="media-topbar-btn"
          aria-label="Toggle fullscreen"
          title="Toggle fullscreen"
          onClick={() => void onFullscreen()}
        >
          <MediaIcon name="fullscreen" size={20} />
        </button>
        <button
          type="button"
          className="media-topbar-btn"
          aria-label="Cast to a device"
          title="Cast — arrives with the TV and mobile roadmap item"
          aria-disabled={true}
          disabled
        >
          <MediaIcon name="cast" size={20} />
        </button>

        <button
          type="button"
          className="media-topbar-btn media-topbar-close"
          aria-label="Close media"
          title="Close media"
          onClick={() => {
            clearSelection();
            closeWorkspace();
          }}
        >
          <MediaIcon name="close" size={18} />
        </button>
      </div>
    </header>
  );
}
