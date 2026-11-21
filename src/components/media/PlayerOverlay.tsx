import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, isTauri, normalizeError } from "../../lib/api";
import { logDiagnostic } from "../../lib/diagnostics";
import { useMediaStore } from "../../state/mediaStore";
import type { NativePlayerStatus, NativePlayerTick } from "./types";

/**
 * In-app media player chrome (UI WP4a, docs/MEDIA_UI_SPEC.md §5).
 *
 * Playback is **libmpv** rendering into a native NSView that is composited
 * *above* this webview (`src-tauri/src/render.rs`). Two consequences drive the
 * whole layout:
 *
 *  1. Nothing drawn inside `.media-player-stage` can ever be seen once the
 *     surface is visible — only the loading note and the error card live there,
 *     and the surface stays hidden until `fileLoaded` (and on any error).
 *  2. The chrome therefore lives in **strips outside the stage**, so showing the
 *     chrome shrinks the video rect (the stage's ResizeObserver pushes the new
 *     rect to `media_player_set_rect`) and hiding it gives the video the full
 *     window — which is what the reference shows (no chrome at all while
 *     playing). A 2 px progress hairline stays in the layout so position is
 *     readable with everything else hidden.
 */
const IDLE_MS = 3000;
const SEEK_STEP = 5;
const VOLUME_STEP = 5;
const CURTAIN_MS = 1100;
const RIPPLE_MS = 700;

export function PlayerOverlay() {
  const playerSource = useMediaStore((state) => state.playerSource);
  const playerStatus = useMediaStore((state) => state.playerStatus);
  const playerDiagnostics = useMediaStore((state) => state.playerDiagnostics);
  const engine = useMediaStore((state) => state.engine);
  const refreshEngineStats = useMediaStore((state) => state.refreshEngineStats);
  const closePlayer = useMediaStore((state) => state.closePlayer);
  const setPlayerStatus = useMediaStore((state) => state.setPlayerStatus);
  const patchPlayerStatus = useMediaStore((state) => state.patchPlayerStatus);
  const recordProgress = useMediaStore((state) => state.recordProgress);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const playButtonRef = useRef<HTMLButtonElement | null>(null);
  const idleTimer = useRef<number | null>(null);
  const dragging = useRef(false);

  const [openError, setOpenError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  /** Local scrub position while dragging (docs: optimistic drag, one seek on release). */
  const [scrub, setScrub] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [curtain, setCurtain] = useState<string | null>(null);
  const [ripple, setRipple] = useState<{ label: string; id: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const status: NativePlayerStatus | null = playerStatus;
  const position = status?.position ?? 0;
  const duration = status?.duration ?? 0;
  const paused = status?.paused ?? false;
  const eof = status?.eof ?? false;
  const muted = status?.muted ?? false;
  const volume = status?.volume ?? 100;
  const fileLoaded = Boolean(status?.fileLoaded || status?.loaded);
  /** An error hides the native surface, so the card in the stage becomes visible. */
  const error = openError ?? status?.error ?? null;
  const metaId = playerSource?.metaId;

  // Watch progress (docs/MEDIA_UI_SPEC.md §3.2): mpv reports the real position,
  // so Continue watching is fed from actual playback. WP2 keeps it in memory;
  // WP5 throttles the same numbers into `library.json`.
  const lastWriteRef = useRef(0);
  const latestRef = useRef<{ position: number; duration: number } | null>(null);

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

    setOpenError(null);
    logDiagnostic(
      "info",
      `opening native player${retryNonce > 0 ? ` (retry ${retryNonce})` : ""}: ${playerSource.title}`,
      "media.player",
    );
    api
      .playerOpen(playerSource.url, playerSource.title, rect())
      .then((initial) => {
        if (cancelled) return;
        setPlayerStatus(initial);
      })
      .catch((caught) => {
        if (cancelled) return;
        const message = normalizeError(caught).message;
        setOpenError(message);
        logDiagnostic("error", `native player could not start: ${message}`, "media.player");
      });

    // Keep the native surface aligned when the window or layout changes. Showing
    // or hiding the chrome changes the stage's height, so this is also what
    // resizes the video between full-bleed and the letterboxed playing frame.
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
  }, [playerSource, setPlayerStatus, retryNonce]);

  // ── Live state from the backend ───────────────────────────────────────────
  useEffect(() => {
    if (!playerSource || !isTauri) return;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<NativePlayerStatus>("media-player://state", (event) => {
      setPlayerStatus(event.payload);
      if (event.payload.error) setOpenError(event.payload.error);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    // 250 ms coalesced metrics (WP4b item 1). Position/cache used to arrive as a
    // full status per mpv property event — up to 60 messages a second, each one
    // re-rendering this overlay while the native surface composited.
    let unlistenTick: UnlistenFn | undefined;
    void listen<NativePlayerTick>("media-player://tick", (event) => {
      patchPlayerStatus(event.payload);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlistenTick = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
      unlistenTick?.();
    };
  }, [playerSource, setPlayerStatus, patchPlayerStatus]);

  // Watch progress: write the position on the first report and then every 5 s
  // while the file plays, plus a final write when the player closes, so a short
  // viewing still lands in Continue watching.
  useEffect(() => {
    if (!metaId || !status || status.duration <= 0) return;
    latestRef.current = { position: status.position, duration: status.duration };
    const now = Date.now();
    if (status.position <= 0) return;
    if (now - lastWriteRef.current < 5000) return;
    lastWriteRef.current = now;
    recordProgress(metaId, status.position, status.duration);
  }, [metaId, status, recordProgress]);

  // The last known position of the title that just closed.
  useEffect(() => {
    const id = metaId;
    if (!id) return;
    return () => {
      const latest = latestRef.current;
      if (latest) recordProgress(id, latest.position, latest.duration);
      latestRef.current = null;
      lastWriteRef.current = 0;
    };
  }, [metaId, recordProgress]);

  // Torrent swarm stats (speed / peers) while a torrent-backed stream plays.
  useEffect(() => {
    if (!playerSource || !engine || engine.phase !== "ready") return;
    void refreshEngineStats();
    const timer = window.setInterval(() => void refreshEngineStats(), 2000);
    return () => window.clearInterval(timer);
  }, [playerSource, engine?.phase, engine?.infoHash, refreshEngineStats]);

  // The native surface sits above the webview, so it must stay hidden until a
  // file is actually loaded — otherwise it covers the spinner and the error card
  // and a failed stream just looks like a blank player.
  const surfaceVisible = fileLoaded && error === null;
  useEffect(() => {
    if (!playerSource || !isTauri) return;
    void api.playerSetSurfaceVisible(surfaceVisible).catch(() => undefined);
  }, [playerSource, surfaceVisible]);

  // ── Autohide contract (§5, item 2) ────────────────────────────────────────
  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    // Paused or ended playback pins the chrome: there is nothing moving to watch.
    if (!playerSource || paused || eof) return;
    idleTimer.current = window.setTimeout(() => {
      idleTimer.current = null;
      setChromeVisible(false);
    }, IDLE_MS);
  }, [clearIdleTimer, playerSource, paused, eof]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    armIdleTimer();
  }, [armIdleTimer]);

  useEffect(() => {
    if (paused || eof) {
      clearIdleTimer();
      setChromeVisible(true);
      return;
    }
    armIdleTimer();
  }, [paused, eof, armIdleTimer, clearIdleTimer]);

  useEffect(() => () => clearIdleTimer(), [clearIdleTimer]);

  // Mouse activity anywhere brings the chrome back. The strips are collapsed
  // while idle, so this listens on the window rather than on the player element.
  useEffect(() => {
    if (!playerSource) return;
    const onMove = () => revealChrome();
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("pointermove", onMove, true);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("pointermove", onMove, true);
    };
  }, [playerSource, revealChrome]);

  // Future-proofing: the native surface swallows pointer events over the video,
  // so a backend pointer-forward (`media-player://pointer`, see HANDOVER WP4a
  // notes) can also wake the chrome. Harmless when nothing emits it.
  useEffect(() => {
    if (!playerSource || !isTauri) return;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen("media-player://pointer", () => revealChrome()).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [playerSource, revealChrome]);

  useEffect(() => {
    if (!curtain) return;
    const timer = window.setTimeout(() => setCurtain(null), CURTAIN_MS);
    return () => window.clearTimeout(timer);
  }, [curtain]);

  useEffect(() => {
    if (!ripple) return;
    const timer = window.setTimeout(() => setRipple(null), RIPPLE_MS);
    return () => window.clearTimeout(timer);
  }, [ripple]);

  useEffect(() => {
    if (!isTauri) return;
    void getCurrentWindow()
      .isFullscreen()
      .then(setFullscreen)
      .catch(() => undefined);
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    if (!useMediaStore.getState().playerStatus) return;
    const next = !(useMediaStore.getState().playerStatus?.paused ?? false);
    void api.playerSetPause(next).then(setPlayerStatus).catch((caught) => {
      const message = normalizeError(caught).message;
      setOpenError(message);
      logDiagnostic("error", `pause failed: ${message}`, "media.player");
    });
  }, [setPlayerStatus]);

  /** One `player_seek` per gesture — called on release, never per pointer move. */
  const commitSeek = useCallback(
    (seconds: number) => {
      const total = useMediaStore.getState().playerStatus?.duration ?? 0;
      if (!(total > 0)) return;
      void api
        .playerSeek(clampSeconds(seconds, total))
        .then(setPlayerStatus)
        .catch((caught) => {
          logDiagnostic("warn", `seek failed: ${normalizeError(caught).message}`, "media.player");
        });
    },
    [setPlayerStatus],
  );

  const seekBy = useCallback((delta: number) => {
    const current = useMediaStore.getState().playerStatus;
    if (!current || !(current.duration > 0)) return;
    const magnitude = Math.abs(delta);
    setRipple({
      label: `${delta > 0 ? "+" : "−"}${magnitude}s`,
      id: Date.now(),
    });
    void api.playerSeekRelative(delta).then(setPlayerStatus).catch(() => undefined);
  }, [setPlayerStatus]);

  const applyVolume = useCallback(
    (next: number) => {
      const value = clampVolume(next);
      revealChrome();
      setCurtain(`Volume ${value}%`);
      void api
        .playerSetVolume(value)
        .then((updated) => {
          setPlayerStatus(updated);
          if (value > 0 && (useMediaStore.getState().playerStatus?.muted ?? false)) {
            return api.playerSetMuted(false).then(setPlayerStatus);
          }
          return undefined;
        })
        .catch((caught) => {
          logDiagnostic("warn", `volume failed: ${normalizeError(caught).message}`, "media.player");
        });
    },
    [setPlayerStatus, revealChrome],
  );

  const toggleMute = useCallback(() => {
    const next = !(useMediaStore.getState().playerStatus?.muted ?? false);
    revealChrome();
    void api
      .playerSetMuted(next)
      .then((updated) => {
        setPlayerStatus(updated);
        setCurtain(next ? "Muted" : `Volume ${Math.round(updated.volume)}%`);
      })
      .catch((caught) => {
        logDiagnostic("warn", `mute failed: ${normalizeError(caught).message}`, "media.player");
      });
  }, [setPlayerStatus, revealChrome]);

  const toggleFullscreen = useCallback(() => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    void win
      .isFullscreen()
      .then((value) => win.setFullscreen(!value))
      .then(() => setFullscreen((previous) => !previous))
      .catch((caught) => {
        logDiagnostic("warn", `fullscreen failed: ${normalizeError(caught).message}`, "media.player");
      });
  }, []);

  // ── Keyboard map (§5) — the native surface has focus, so bind on window ───
  useEffect(() => {
    if (!playerSource) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const onFormControl = Boolean(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      switch (event.key) {
        case " ":
          if (onFormControl) return;
          event.preventDefault();
          togglePlay();
          break;
        case "k":
        case "K":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          if (onFormControl) return;
          event.preventDefault();
          seekBy((event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 60 : 10));
          break;
        }
        case "ArrowUp":
        case "ArrowDown": {
          if (onFormControl) return;
          event.preventDefault();
          const current = useMediaStore.getState().playerStatus?.volume ?? 100;
          applyVolume(current + (event.key === "ArrowUp" ? VOLUME_STEP : -VOLUME_STEP));
          break;
        }
        case "m":
        case "M":
          event.preventDefault();
          toggleMute();
          break;
        case "f":
        case "F":
          event.preventDefault();
          toggleFullscreen();
          break;
        case "Tab":
          // Tab is the discoverable way back from the idle state: reveal the
          // chrome and hand focus to its first control.
          if (!chromeVisible) {
            event.preventDefault();
            revealChrome();
            window.requestAnimationFrame(() => playButtonRef.current?.focus());
          }
          break;
        case "Escape":
          if (chromeVisible) {
            event.preventDefault();
            clearIdleTimer();
            setChromeVisible(false);
            if (target && typeof target.blur === "function") target.blur();
          } else {
            closePlayer();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    playerSource,
    chromeVisible,
    togglePlay,
    toggleMute,
    toggleFullscreen,
    seekBy,
    applyVolume,
    revealChrome,
    clearIdleTimer,
    closePlayer,
  ]);

  if (!playerSource) return null;

  const idle = !chromeVisible;
  const buffering = Boolean(status?.pausedForCache);
  const connecting = !fileLoaded && engine?.phase === "resolving" && error === null;
  // mpv reports `video-format` only for a file that carries a video track: with
  // none, no native frame ever arrives, so the stage shows the title art instead.
  const audioOnly = fileLoaded && !status?.videoFormat && error === null;
  const displayPosition = scrub ?? position;
  const playedPercent = spanPercent(displayPosition, duration);
  const bufferedPercent = bufferedSpanPercent(position, status?.cacheSeconds ?? 0, duration);
  const tooltipRatio = scrub !== null && duration > 0 ? scrub / duration : hoverRatio;
  const chip = [playerSource.quality, status?.videoFormat?.toUpperCase()]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const volumeIcon = muted || volume === 0 ? "🔇" : volume < 50 ? "🔉" : "🔊";

  // ── Seek bar gesture handlers (optimistic: local scrub, one seek on release) ──
  const trackRect = () => seekBarRef.current?.getBoundingClientRect() ?? { left: 0, width: 0 };

  const ratioAt = (clientX: number): number => {
    const box = trackRect();
    return box.width > 0 ? clamp01((clientX - box.left) / box.width) : 0;
  };

  const onSeekPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!(duration > 0)) return;
    dragging.current = true;
    clearIdleTimer();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setHoverRatio(ratioAt(event.clientX));
    setScrub(seekSecondsFromPointer(event.clientX, trackRect(), duration));
  };

  const onSeekPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!(duration > 0)) return;
    const ratio = ratioAt(event.clientX);
    setHoverRatio(ratio);
    if (dragging.current) setScrub(seekSecondsFromPointer(event.clientX, trackRect(), duration));
  };

  const onSeekPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const target = scrub ?? seekSecondsFromPointer(event.clientX, trackRect(), duration);
    setScrub(null);
    commitSeek(target);
    armIdleTimer();
  };

  const onSeekKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(duration > 0)) return;
    const step = event.shiftKey ? 60 : SEEK_STEP;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        commitSeek(displayPosition - step);
        break;
      case "ArrowRight":
        event.preventDefault();
        commitSeek(displayPosition + step);
        break;
      case "Home":
        event.preventDefault();
        commitSeek(0);
        break;
      case "End":
        event.preventDefault();
        commitSeek(duration);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={`media-player${idle ? " is-idle" : ""}${eof ? " is-ended" : ""}`}
      role="dialog"
      aria-label={`Playing ${playerSource.title}`}
      onMouseMove={revealChrome}
    >
      <div className="media-player-stage" ref={stageRef}>
        {/* The native surface covers this element as soon as a file is loaded.
            Only pre-load notes and the failure card are ever visible here. */}
        {error ? (
          <div className="media-player-error" role="alert">
            <p className="media-player-error-title">Playback failed</p>
            <p className="media-player-error-reason">{error}</p>
            {playerDiagnostics && !playerDiagnostics.embeddingSupported ? (
              <p className="media-player-error-note">{playerDiagnostics.detail}</p>
            ) : null}
            <div className="media-player-error-actions">
              <button
                type="button"
                className="media-player-btn is-primary"
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
              <button
                type="button"
                className="media-player-btn"
                onClick={() => {
                  setOpenError(null);
                  setRetryNonce((value) => value + 1);
                }}
              >
                Retry
              </button>
            </div>
          </div>
        ) : !fileLoaded ? (
          <div className="media-player-loading">
            <div className="media-player-spinner" aria-hidden="true" />
            <p className="media-player-stage-note">
              {connecting
                ? `Connecting to the swarm… ${Math.round((engine?.progress ?? 0) * 100)}%${
                    engine?.peers ? ` · ${engine.peers} peers` : ""
                  }`
                : "Opening stream…"}
            </p>
          </div>
        ) : audioOnly ? (
          <div className="media-player-art">
            {playerSource.poster ? (
              <img className="media-player-art-img" src={playerSource.poster} alt="" />
            ) : null}
            <span className="media-player-art-title">{playerSource.title}</span>
          </div>
        ) : null}
      </div>

      {/* ── Top strip: nothing here may overlap the stage ── */}
      <header className="media-player-strip media-player-top">
        <button
          type="button"
          className="media-player-close"
          onClick={closePlayer}
          aria-label="Close player"
        >
          ✕
        </button>
        <h2 className="media-player-title" title={playerSource.title}>
          {playerSource.title}
        </h2>
        {chip ? <span className="media-player-chip">{chip}</span> : null}
        <div className="media-player-top-right">
          {fileLoaded ? (
            <span className="media-player-stats" role="status" aria-label="Stream stats">
              ↓ {formatSpeed(status?.cacheSpeed ?? 0)}
              {status && status.cacheSeconds > 0
                ? ` · ${status.cacheSeconds.toFixed(1)}s buffered`
                : ""}
              {engine?.phase === "ready" && engine.peers !== undefined
                ? ` · ${engine.peers} peers`
                : ""}
            </span>
          ) : null}
        </div>
      </header>

      <footer className="media-player-bottom">
        <div className="media-player-state-slot">
          {buffering || connecting ? (
            <span className="media-player-pill" role="status">
              {buffering
                ? `Buffering ${cacheSummary(status?.cachePercent ?? 0, status?.cacheSpeed ?? 0)}`
                : `Connecting to the swarm… ${Math.round((engine?.progress ?? 0) * 100)}%${
                    engine?.peers ? ` · ${engine.peers} peers` : ""
                  }`}
            </span>
          ) : null}
          {/* Ephemeral volume readout. It lives in the chrome, not the stage:
              the native surface would cover anything drawn there. */}
          {curtain ? (
            <span className="media-player-curtain" role="status">
              {curtain}
            </span>
          ) : null}
        </div>

        <div className="media-player-bar">
          {/* ⏮ / ⏭ need an episode playlist (WP5+), so 4a ships only play/pause
              rather than a dead button. */}
          <button
            type="button"
            className="media-player-transport"
            ref={playButtonRef}
            onClick={togglePlay}
            aria-label={paused || eof ? "Play" : "Pause"}
            disabled={!status}
          >
            {paused || eof ? "▶" : "❚❚"}
          </button>

          <span className="media-player-time" aria-hidden="true">
            {formatTime(displayPosition)}
          </span>

          <div
            className="media-player-seek"
            ref={seekBarRef}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(displayPosition)}
            aria-valuetext={`${formatTime(displayPosition)} of ${formatTime(duration)}`}
            tabIndex={0}
            onPointerDown={onSeekPointerDown}
            onPointerMove={onSeekPointerMove}
            onPointerUp={onSeekPointerUp}
            onPointerCancel={onSeekPointerUp}
            onPointerLeave={() => {
              if (!dragging.current) setHoverRatio(null);
            }}
            onKeyDown={onSeekKeyDown}
          >
            <div className="media-player-seek-track">
              <span className="media-player-seek-buffer" style={{ width: `${bufferedPercent}%` }} />
              <span className="media-player-seek-fill" style={{ width: `${playedPercent}%` }} />
            </div>
            <span className="media-player-seek-knob" style={{ left: `${playedPercent}%` }} />
            {tooltipRatio !== null ? (
              <span
                className="media-player-seek-tip"
                style={{ left: `${clamp01(tooltipRatio) * 100}%` }}
              >
                {formatTime(clamp01(tooltipRatio) * duration)}
              </span>
            ) : null}
            {ripple ? (
              <span key={ripple.id} className="media-player-ripple">
                {ripple.label}
              </span>
            ) : null}
          </div>

          <span className="media-player-time" aria-hidden="true">
            {formatTime(duration)}
          </span>

          <div className="media-player-volume">
            <button
              type="button"
              className="media-player-btn is-icon"
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {volumeIcon}
            </button>
            <div className="media-player-volume-slider">
              <input
                type="range"
                min={0}
                max={100}
                step={VOLUME_STEP}
                value={muted ? 0 : Math.round(volume)}
                aria-label="Volume"
                onChange={(event) => applyVolume(Number(event.target.value))}
              />
            </div>
          </div>

          <button
            type="button"
            className="media-player-btn is-icon"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            ⛶
          </button>
        </div>

        {/* 2 px position hairline: the only chrome left while idle. */}
        <div className="media-player-hairline" aria-hidden="true">
          <span style={{ width: `${playedPercent}%` }} />
        </div>
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

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Played position as a percentage of the track (0 while duration is unknown). */
export function spanPercent(position: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return clamp01(position / duration) * 100;
}

/** Buffered-ahead percentage, anchored at the playhead and clamped to the end. */
export function bufferedSpanPercent(
  position: number,
  cacheSeconds: number,
  duration: number,
): number {
  if (!(duration > 0)) return 0;
  const ahead = Number.isFinite(cacheSeconds) ? Math.max(0, cacheSeconds) : 0;
  return clamp01((position + ahead) / duration) * 100;
}

/** Pointer x inside the track rect → absolute seconds (the drag math, pure). */
export function seekSecondsFromPointer(
  clientX: number,
  rect: { left: number; width: number },
  duration: number,
): number {
  if (!(duration > 0)) return 0;
  const ratio = rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0;
  return ratio * duration;
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampSeconds(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(duration, Math.max(0, value));
}