import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api, isTauri, normalizeError } from "../../lib/api";
import { logDiagnostic } from "../../lib/diagnostics";
import { useMediaStore } from "../../state/mediaStore";
import type { NativePlayerStatus } from "./types";

/**
 * In-app media player (Phase 4c).
 *
 * Playback is handled by **libmpv**, embedded in the app window: the backend
 * places a native video surface (an NSView) over the rect this component
 * reserves, and streams state back through the `media-player://state` event.
 *
 * That is deliberately not an HTML5 `<video>`: WKWebView cannot open MKV
 * containers and has no AC3/DTS decoders, which is what torrent releases use.
 * libmpv plays everything, so the shell here is only the chrome around the
 * native surface.
 */
export function PlayerOverlay() {
  const playerSource = useMediaStore((state) => state.playerSource);
  const playerStatus = useMediaStore((state) => state.playerStatus);
  const playerDiagnostics = useMediaStore((state) => state.playerDiagnostics);
  const closePlayer = useMediaStore((state) => state.closePlayer);
  const setPlayerStatus = useMediaStore((state) => state.setPlayerStatus);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status: NativePlayerStatus | null = playerStatus;
  const position = status?.position ?? 0;
  const duration = status?.duration ?? 0;
  const paused = status?.paused ?? false;
  const muted = status?.muted ?? false;
  const volume = status?.volume ?? 100;

  // ── Open / close the native session ───────────────────────────────────────
  useEffect(() => {
    if (!playerSource) return;
    if (!isTauri) {
      // Outside Tauri (unit tests) there is no native surface to drive.
      return;
    }
    let cancelled = false;
    const stage = stageRef.current;
    if (!stage) return;

    const rect = () => {
      const box = stage.getBoundingClientRect();
      return {
        x: Math.round(box.left),
        y: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };

    setOpening(true);
    setError(null);
    logDiagnostic("info", `opening native player: ${playerSource.title}`, "media.player");
    api
      .playerOpen(playerSource.url, playerSource.title, rect())
      .then((initial) => {
        if (cancelled) return;
        setPlayerStatus(initial);
      })
      .catch((caught) => {
        if (cancelled) return;
        const message = normalizeError(caught).message;
        setError(message);
        logDiagnostic("error", `native player could not start: ${message}`, "media.player");
      })
      .finally(() => {
        if (!cancelled) setOpening(false);
      });

    // Keep the native surface aligned when the window or layout changes.
    const observer = new ResizeObserver(() => {
      void api.playerSetRect(rect()).catch(() => undefined);
    });
    observer.observe(stage);
    const onWindowResize = () => {
      void api.playerSetRect(rect()).catch(() => undefined);
    };
    window.addEventListener("resize", onWindowResize);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [playerSource, setPlayerStatus]);

  // ── Live state from the backend ───────────────────────────────────────────
  useEffect(() => {
    if (!playerSource || !isTauri) return;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<NativePlayerStatus>("media-player://state", (event) => {
      setPlayerStatus(event.payload);
      if (event.payload.error) {
        setError(event.payload.error);
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [playerSource, setPlayerStatus]);

  const togglePlay = useCallback(() => {
    if (!status) return;
    void api.playerSetPause(!status.paused).then(setPlayerStatus).catch((caught) => {
      const message = normalizeError(caught).message;
      setError(message);
      logDiagnostic("error", `pause failed: ${message}`, "media.player");
    });
  }, [status, setPlayerStatus]);

  const seekBy = useCallback((seconds: number) => {
    void api.playerSeekRelative(seconds).then(setPlayerStatus).catch(() => undefined);
  }, [setPlayerStatus]);

  // ── Keyboard shortcuts (the native surface has focus, so bind on window) ──
  useEffect(() => {
    if (!playerSource) return;
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case " ":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          seekBy(10);
          break;
        case "ArrowLeft":
          seekBy(-10);
          break;
        case "m":
          void api
            .playerSetMuted(!(useMediaStore.getState().playerStatus?.muted ?? false))
            .then(setPlayerStatus)
            .catch(() => undefined);
          break;
        case "Escape":
          closePlayer();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playerSource, togglePlay, seekBy, closePlayer, setPlayerStatus]);

  if (!playerSource) return null;

  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const buffered = duration > 0 ? Math.min(100, ((position + (status?.cacheSeconds ?? 0)) / duration) * 100) : 0;
  const buffering = Boolean(status?.pausedForCache);
  const engineUnavailable = error !== null;

  return (
    <div className="media-player-overlay" role="dialog" aria-label={`Playing ${playerSource.title}`}>
      <header className="media-player-head">
        <span className="media-player-title">{playerSource.title}</span>
        {status?.videoFormat ? (
          <span className="media-player-badge">{status.videoFormat.toUpperCase()}</span>
        ) : null}
        {buffering ? (
          <span className="media-player-badge buffering" role="status">
            Buffering {cacheSummary(status?.cachePercent ?? 0, status?.cacheSpeed ?? 0)}
          </span>
        ) : null}
        <button
          type="button"
          className="media-close"
          onClick={closePlayer}
          aria-label="Close player"
        >
          ✕
        </button>
      </header>

      <div className="media-player-stage" ref={stageRef}>
        {/* The native video surface is composited over this element; nothing
            should be drawn here or it would be hidden behind the video. */}
        {opening && !engineUnavailable ? (
          <div className="media-player-spinner" aria-label="Starting playback" />
        ) : null}
        {engineUnavailable ? (
          <div className="media-player-error" role="alert">
            <p>Couldn't play this stream in-app.</p>
            <p className="media-error-detail">{error}</p>
            {playerDiagnostics && !playerDiagnostics.embeddingSupported ? (
              <p className="media-error-detail">{playerDiagnostics.detail}</p>
            ) : null}
            <button
              type="button"
              className="media-retry"
              onClick={() => {
                void api.playMediaStream(playerSource.url).catch((caught) => {
                  logDiagnostic(
                    "error",
                    `external player fallback failed: ${normalizeError(caught).message}`,
                    "media.player",
                  );
                });
              }}
            >
              ↗ Open in external player
            </button>
          </div>
        ) : null}
      </div>

      <footer className="media-player-controls">
        <button
          type="button"
          className="media-play"
          onClick={togglePlay}
          aria-label={paused ? "Play" : "Pause"}
        >
          {paused ? "▶" : "⏸"}
        </button>
        <span className="media-player-time">{formatTime(position)}</span>
        <div
          className="media-player-track"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          tabIndex={0}
          onClick={(event) => {
            if (duration <= 0) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            void api.playerSeek(ratio * duration).then(setPlayerStatus).catch(() => undefined);
          }}
        >
          <div className="media-player-track-buffer" style={{ width: `${buffered}%` }} />
          <div className="media-player-track-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="media-player-time">{formatTime(duration)}</span>
        <button
          type="button"
          className="media-player-icon"
          onClick={() =>
            void api.playerSetMuted(!muted).then(setPlayerStatus).catch(() => undefined)
          }
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <input
          className="media-player-volume"
          type="range"
          min={0}
          max={100}
          step={5}
          value={muted ? 0 : volume}
          aria-label="Volume"
          onChange={(event) => {
            const next = Number(event.target.value);
            void api
              .playerSetVolume(next)
              .then((updated) => {
                setPlayerStatus(updated);
                if (next > 0 && muted) return api.playerSetMuted(false).then(setPlayerStatus);
                return undefined;
              })
              .catch(() => undefined);
          }}
        />
      </footer>
    </div>
  );
}

/**
 * Header label for a stalled torrent stream: cache fill plus arrival rate. The
 * panel can't live over the stage — the native video surface covers it — so the
 * state is reported in the chrome instead.
 */
export function cacheSummary(percent: number, bytesPerSecond: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return `${pct}% · ${formatSpeed(bytesPerSecond)}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bytesPerSecond;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
