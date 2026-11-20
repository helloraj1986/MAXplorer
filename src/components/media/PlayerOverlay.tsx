import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaStore } from "../../state/mediaStore";

/**
 * In-app media player overlay (Phase 3, option C step 1).
 * HTML5 <video> plays direct HTTP/HLS streams — what the webview engine
 * supports natively. libmpv takes over this overlay's shell in a later
 * phase for full codec/HDR coverage; torrent streams need the Phase 4
 * engine either way.
 */
export function PlayerOverlay() {
  const playerSource = useMediaStore((state) => state.playerSource);
  const closePlayer = useMediaStore((state) => state.closePlayer);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [playerSource, togglePlay, seekBy, closePlayer]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = muted;
      video.volume = volume;
    }
  }, [muted, volume, playerSource]);

  if (!playerSource) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="media-player-overlay" role="dialog" aria-label={`Playing ${playerSource.title}`}>
      <header className="media-player-head">
        <span className="media-player-title">{playerSource.title}</span>
        <button
          type="button"
          className="media-close"
          onClick={closePlayer}
          aria-label="Close player"
        >
          ✕
        </button>
      </header>
      <div className="media-player-stage">
        {buffering && !error ? <div className="media-player-spinner" aria-label="Buffering" /> : null}
        {error ? (
          <div className="media-player-error" role="alert">
            <p>Couldn't play this stream in-app.</p>
            <p className="media-error-detail">{error}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="media-player-video"
            src={playerSource.url}
            autoPlay
            playsInline
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration);
              setBuffering(false);
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => {
              setBuffering(false);
              setPlaying(true);
            }}
            onPause={() => setPlaying(false)}
            onError={() =>
              setError(
                "The stream could not be decoded or the source is unreachable. Try the external player option.",
              )
            }
            onClick={togglePlay}
          />
        )}
      </div>
      <footer className="media-player-controls">
        <button
          type="button"
          className="media-play"
          onClick={togglePlay}
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
            const ratio = (event.clientX - rect.left) / rect.width;
            video.currentTime = Math.max(0, Math.min(1, ratio)) * video.duration;
          }}
        >
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
          value={volume}
          aria-label="Volume"
          onChange={(event) => {
            setVolume(Number(event.target.value));
            setMuted(Number(event.target.value) === 0);
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
