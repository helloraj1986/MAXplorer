import type { ReactNode } from "react";
import { useMediaStore } from "../../state/mediaStore";
import { MediaRail } from "./MediaRail";
import { MediaTopBar } from "./MediaTopBar";

/**
 * Media app shell (docs/MEDIA_UI_SPEC.md §2) — hosts the board, detail and
 * player screens: left icon rail + 56 px top bar + content slot.
 *
 * In player mode the rail and top bar are hidden: the video is a native surface
 * above the webview and the reference shows no chrome at all while playing
 * (spec §5.1). Player chrome (WP4) is drawn inside the player itself.
 */
export function MediaShell({ children }: { children: ReactNode }) {
  const screen = useMediaStore((state) => state.screen);
  const playerMode = screen === "player";

  return (
    <section className="media-app" aria-label="Media">
      {!playerMode ? <MediaRail /> : null}
      <div className="media-app-main">
        {!playerMode ? <MediaTopBar /> : null}
        <div className="media-app-content">{children}</div>
      </div>
    </section>
  );
}
