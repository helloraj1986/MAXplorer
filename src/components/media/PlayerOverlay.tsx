import { useCallback, useEffect, useRef, useState } from "react";
import { api, isTauri, normalizeError } from "../../lib/api";
import { logDiagnostic } from "../../lib/diagnostics";
import { useMediaStore } from "../../state/mediaStore";
import type { PreparedStream } from "./types";

/**
 * In-app media player.
 *
 * The `<video>` element only decodes what WKWebView supports (MP4/HLS; not MKV,
 * and no AC3/DTS), so the backend first **prepares** the source: ffmpeg remuxes
 * it to fMP4 HLS (video stream-copied, audio transcoded to AAC) and serves it on
 * loopback. This component plays that playlist and reports every buffering
 * state, because a torrent-backed stream can sit silent for a while.
 */
export function PlayerOverlay() {
  const playerSource = useMediaStore((state) => state.playerSource);
  const closePlayer = useMediaStore((state) => state.closePlayer);
  const playerDiagnostics = useMediaStore((state) => state.playerDiagnostics);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<PreparedStream | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [bufferedPct, setBufferedPct] = useState(0);

  // ── Prepare the stream (ffmpeg remux) whenever a source is opened ──────────
  useEffect(() => {
    if (!playerSource) {
      setStream(null);
      setPreparing(false);
      setError(null);
      setBuffering(false);
      setBufferedPct(0);
      return;
    }
    if (!isTauri) return; // unit tests: no backend
    let cancelled = false;
    setStream(null);
    setError(null);
    setPreparing(true);
    logDiagnostic("info", `preparing stream: ${playerSource.title}`, "media.player");

    api
      .playerOpen(playerSource.url, playerSource.title)
      .then((prepared) => {
        if (cancelled) return;
        logDiagnostic(
          "info",
          `stream ready (${prepared.videoMode}, ${prepared.videoCodec}) ${prepared.streamUrl}`,
          "media.player",
        );
        setStream(prepared);
      })
      .catch((caught) => {
        if (cancelled) return;
        const message = normalizeError(caught).message;
        setError(message);
        logDiagnostic("error", `stream preparation failed: ${message}`, "media.player");
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playerSource]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  }, []);

  useEffect(() => {
    if (!playerSource || !stream) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.isContentEditable)) return;
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
          setMuted((value) => !value);
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
  }, [playerSource, stream, togglePlay, seekBy, closePlayer]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = muted;
      video.volume = volume;
    }
  }, [muted, volume, stream]);

  if (!playerSource) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const busy = preparing || buffering;

  return (
    <div className="media-player-overlay" role="dialog" aria-label={`Playing ${playerSource.title}`}>
      <header className="media-player-head">
        <span className="media-player-title">{playerSource.title}</span>
        {stream ? (
          <>
            <span className="media-player-badge">{stream.videoCodec.toUpperCase()}</span>
            <span className="media-player-badge subtle">
              {stream.videoMode === "copy" ? "REMUX" : "TRANSCODE"}
            </span>
          </>
        ) : null}
        <button type="button" className="media-close" onClick={closePlayer} aria-label="Close player">
          ✕
        </button>
      </header>

      <div className="media-player-stage">
        {stream && !error ? (
          <video
            ref={videoRef}
            className="media-player-video"
            src={stream.streamUrl}
            autoPlay
            playsInline
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration);
              setBuffering(false);
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onProgress={(event) => {
              const video = event.currentTarget;
              if (video.buffered.length && Number.isFinite(video.duration) && video.duration > 0) {
                const end = video.buffered.end(video.buffered.length - 1);
                setBufferedPct(Math.min(100, Math.round((end / video.duration) * 100)));
              }
            }}
            onWaiting={() => setBuffering(true)}
            onStalled={() => setBuffering(true)}
            onLoadStart={() => setBuffering(true)}
            onPlaying={() => {
              setBuffering(false);
              setPlaying(true);
            }}
            onCanPlay={() => setBuffering(false)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() =>
              setError(
                "The prepared stream could not be decoded. Try ↗ External, or pick another source.",
              )
            }
            onClick={togglePlay}
          />
        ) : null}

        {busy && !error ? (
          <div className="media-player-busy" role="status" aria-live="polite">
            <div className="media-player-spinner" />
            <div className="media-player-busy-text">
              {preparing ? (
                <>
                  <strong>Preparing stream…</strong>
                  <span>
                    Remuxing MKV / converting audio for the in-app player — this can take a few
                    seconds on a torrent.
                  </span>
                </>
              ) : (
                <>
                  <strong>Buffering…</strong>
                  <span>
                    {bufferedPct > 0
                      ? `${bufferedPct}% downloaded`
                      : "Waiting for data from the swarm"}
                    {" · "}
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </>
              )}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="media-player-error" role="alert">
            <p>Couldn't play this stream in-app.</p>
            <p className="media-error-detail">{error}</p>
            {playerDiagnostics && !playerDiagnostics.ffmpeg ? (
              <p className="media-error-detail">{playerDiagnostics.detail}</p>
            ) : null}
            <button
              type="button"
              className="media-retry"
              onClick={() => {
                void api.playMediaStream(playerSource.url).catch((caught) => {
                  logDiagnostic(
                    "error",
                    `external playback failed: ${normalizeError(caught).message}`,
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
          disabled={!stream || Boolean(error)}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <span className="media-player-time">{formatTime(currentTime)}</span>
        <div
          className="media-player-track"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
          onClick={(event) => {
            const video = videoRef.current;
            if (!video || !Number.isFinite(video.duration)) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            video.currentTime = ratio * video.duration;
          }}
        >
          <div className="media-player-track-buffer" style={{ width: `${bufferedPct}%` }} />
          <div className="media-player-track-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="media-player-time">{formatTime(duration)}</span>
        <button
          type="button"
          className="media-player-icon"
          onClick={() => setMuted((value) => !value)}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <input
          className="media-player-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label="Volume"
          onChange={(event) => {
            const next = Number(event.target.value);
            setVolume(next);
            setMuted(next === 0);
          }}
        />
      </footer>
    </div>
  );
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