//! Playback: prepare any source into a stream the in-app player can actually play.
//!
//! ## Why this exists (read before changing the player again)
//!
//! The in-app player is an HTML5 `<video>` in the Tauri webview, which can only
//! decode what WKWebView supports:
//!   * containers: MP4/MOV/M4V, HLS, WebM — **not MKV/AVI/TS**
//!   * audio: AAC/MP3/Opus/FLAC/ALAC — **not AC3/E-AC3/DTS/TrueHD**
//! Torrent releases are overwhelmingly MKV with AC3/DTS, so a raw stream URL
//! fails with "can't play".
//!
//! Two native-embedding alternatives were tried and are **not possible here**:
//!   * libmpv into an NSView via mpv's `wid` option: the macOS/NSView `wid` path
//!     does not exist in mpv (it was proposed in PR #17221 and closed unmerged;
//!     mpv master has no NSView code, and the option is silently ignored on
//!     macOS, so mpv creates its own window).
//!   * libvlc `libvlc_media_player_set_nsobject`: the installed VLC is x86_64
//!     only and cannot be loaded into this arm64 process.
//! libmpv's OpenGL render API remains the only native route; it needs hand-written
//! GL/ObjC that cannot be verified in this environment, so it was not chosen.
//!
//! ## What this does instead (the Jellyfin/Plex approach)
//!
//! Probe the source with ffprobe, then run ffmpeg to write **fMP4 HLS** segments:
//!   * video is **stream-copied** when the codec is webview-playable (H.264/HEVC),
//!     i.e. no quality loss and almost no CPU;
//!   * audio is always transcoded to AAC (cheap, and fixes AC3/DTS/E-AC3);
//!   * anything else falls back to a full H.264/AAC transcode.
//! The segments are served from a loopback HTTP server and the `<video>` element
//! points at the playlist, so seeking and buffering behave normally.

use crate::error::AppError;
use crate::logging;
use axum::extract::Path as AxumPath;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

const LOG: &str = "media.stream";
/// Loopback port for the prepared-stream server.
const STREAM_PORT: u16 = 18082;

/// A running ffmpeg process plus the directory it writes segments into.
struct Session {
    child: tokio::process::Child,
    dir: PathBuf,
    id: String,
    stderr_tail: std::sync::Arc<Mutex<Vec<String>>>,
}

static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
static SERVER: OnceLock<()> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(1);

fn session_slot() -> &'static Mutex<Option<Session>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

fn perr(message: impl Into<String>) -> AppError {
    AppError::new("player", message, None)
}

// ── ffmpeg / ffprobe discovery ──────────────────────────────────────────────

fn tool(name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var(format!("MAXPLORER_{}", name.to_uppercase())) {
        if !path.trim().is_empty() {
            candidates.push(PathBuf::from(path));
        }
    }
    for prefix in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"] {
        candidates.push(PathBuf::from(prefix).join(name));
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .or_else(|| {
            // Fall back to PATH lookup.
            std::env::var_os("PATH").and_then(|paths| {
                std::env::split_paths(&paths)
                    .map(|dir| dir.join(name))
                    .find(|path| path.is_file())
            })
        })
}

fn ffmpeg() -> Result<PathBuf, AppError> {
    tool("ffmpeg").ok_or_else(|| {
        perr("ffmpeg is required for in-app playback but was not found. Install it with \
              `brew install ffmpeg`, or set MAXPLORER_FFMPEG to its path.")
    })
}

// ── Codec probe ─────────────────────────────────────────────────────────────

/// Video codecs WKWebView can decode inside fMP4 HLS. Anything else must be
/// transcoded rather than copied.
const COPYABLE: &[&str] = &["h264", "hevc"];

async fn probe_video_codec(url: &str) -> Result<String, AppError> {
    let ffprobe = tool("ffprobe").ok_or_else(|| perr("ffprobe was not found"))?;
    let output = TokioCommand::new(ffprobe)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "csv=p=0",
            url,
        ])
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| perr(format!("ffprobe failed to start: {error}")))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        logging::error(LOG, format!("ffprobe failed: {detail}"));
        return Err(perr(format!("could not inspect the stream: {detail}")));
    }
    let codec = String::from_utf8_lossy(&output.stdout).trim().to_lowercase();
    logging::info(LOG, format!("source video codec: {codec}"));
    Ok(codec)
}

// ── Loopback segment server ────────────────────────────────────────────────

fn root_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| perr(format!("app data dir: {error}")))?
        .join("media-streams");
    std::fs::create_dir_all(&dir)
        .map_err(|error| perr(format!("create {}: {error}", dir.display())))?;
    Ok(dir)
}

fn content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "m3u8" => "application/vnd.apple.mpegurl",
        "m4s" => "video/iso.segment",
        "mp4" => "video/mp4",
        "ts" => "video/mp2t",
        _ => "application/octet-stream",
    }
}

async fn serve_segment(
    state: axum::extract::State<PathBuf>,
    AxumPath((id, file)): AxumPath<(String, String)>,
    _headers: HeaderMap,
) -> Response {
    // Reject anything that could escape the session directory.
    if id.contains('/') || id.contains("..") || file.contains('/') || file.contains("..") {
        return (StatusCode::BAD_REQUEST, "bad path").into_response();
    }
    let path = state.join(&id).join(&file);
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static(content_type(&file)),
            );
            headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            );
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            (StatusCode::OK, headers, bytes).into_response()
        }
        Err(error) => {
            logging::debug(LOG, format!("serve miss {}: {error}", path.display()));
            (StatusCode::NOT_FOUND, "not found").into_response()
        }
    }
}

/// Start the loopback server once, serving `<root>/<id>/<file>`.
async fn ensure_server(root: PathBuf) -> Result<(), AppError> {
    if SERVER.get().is_some() {
        return Ok(());
    }
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", STREAM_PORT))
        .await
        .map_err(|error| perr(format!("bind stream server on {STREAM_PORT}: {error}")))?;
    let router = Router::new()
        .route("/media/{id}/{file}", get(serve_segment))
        .with_state(root);
    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            logging::error(LOG, format!("stream server stopped: {error}"));
        }
    });
    let _ = SERVER.set(());
    logging::info(LOG, format!("stream server listening on 127.0.0.1:{STREAM_PORT}"));
    Ok(())
}

// ── Session lifecycle ──────────────────────────────────────────────────────

fn stop_session() {
    let mut slot = session_slot().lock().unwrap();
    if let Some(mut session) = slot.take() {
        logging::info(LOG, format!("stopping stream {}", session.id));
        let _ = session.child.start_kill();
        // Reap so ffmpeg really exits and releases the source connection.
        let _ = std::thread::spawn(move || {
            let _ = session.child.wait();
        });
        let _ = std::fs::remove_dir_all(&session.dir);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedStream {
    /// HLS playlist URL for the `<video>` element.
    pub stream_url: String,
    pub title: String,
    /// "copy" when the video was remuxed untouched, "transcode" otherwise.
    pub video_mode: String,
    pub video_codec: String,
    /// Human-readable note about the audio track.
    pub audio_note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamDiagnostics {
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub server_port: u16,
    pub detail: String,
}

#[tauri::command]
pub fn media_player_diagnostics() -> StreamDiagnostics {
    let ffmpeg_path = tool("ffmpeg");
    let ffprobe_path = tool("ffprobe");
    let ready = ffmpeg_path.is_some() && ffprobe_path.is_some();
    let detail = if ready {
        format!(
            "ffmpeg found at {}; streams are prepared as fMP4 HLS and served on 127.0.0.1:{STREAM_PORT}.",
            ffmpeg_path.as_ref().unwrap().display()
        )
    } else {
        "ffmpeg/ffprobe are required for in-app playback. Install with `brew install ffmpeg`."
            .to_string()
    };
    logging::info(LOG, format!("diagnostics: {detail}"));
    StreamDiagnostics {
        ffmpeg: ffmpeg_path.map(|path| path.display().to_string()),
        ffprobe: ffprobe_path.map(|path| path.display().to_string()),
        server_port: STREAM_PORT,
        detail,
    }
}

/// Prepares `url` for in-app playback and returns the HLS playlist to play.
/// Blocks until the first segment exists so the player never opens on a 404.
#[tauri::command]
pub async fn media_player_open(
    app: tauri::AppHandle,
    url: String,
    title: String,
) -> Result<PreparedStream, AppError> {
    logging::info(LOG, format!("preparing stream for {title} ({url})"));
    let ffmpeg_path = ffmpeg()?;
    let root = root_dir(&app)?;
    ensure_server(root.clone()).await?;
    stop_session();

    let codec = probe_video_codec(&url).await.unwrap_or_else(|error| {
        logging::warn(LOG, format!("codec probe failed ({error}); will transcode"));
        "unknown".to_string()
    });
    let copy_video = COPYABLE.contains(&codec.as_str());

    let id = format!("s{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::SeqCst));
    let dir = root.join(&id);
    std::fs::create_dir_all(&dir)
        .map_err(|error| perr(format!("create {}: {error}", dir.display())))?;
    let playlist = dir.join("index.m3u8");

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-nostdin".into(),
        "-y".into(),
        "-i".into(),
        url.clone(),
    ];
    if copy_video {
        args.extend(["-c:v".into(), "copy".into()]);
    } else {
        // Only reached for exotic video codecs; quality is secondary to playing.
        args.extend([
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "veryfast".into(),
            "-crf".into(), "23".into(),
            "-pix_fmt".into(), "yuv420p".into(),
        ]);
    }
    args.extend([
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "192k".into(),
        "-ac".into(), "2".into(),
        "-f".into(), "hls".into(),
        "-hls_time".into(), "2".into(),
        "-hls_list_size".into(), "0".into(),
        "-hls_playlist_type".into(), "event".into(),
        "-hls_segment_type".into(), "fmp4".into(),
        "-hls_flags".into(), "independent_segments+temp_file".into(),
        playlist.display().to_string(),
    ]);

    logging::info(
        LOG,
        format!(
            "ffmpeg mode={} codec={codec} dir={}",
            if copy_video { "copy" } else { "transcode" },
            dir.display()
        ),
    );

    let mut child = TokioCommand::new(&ffmpeg_path)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| perr(format!("could not start ffmpeg: {error}")))?;

    // Keep the last stderr lines for a useful error message, and log them.
    let stderr_tail = std::sync::Arc::new(Mutex::new(Vec::new()));
    if let Some(stderr) = child.stderr.take() {
        let tail = stderr_tail.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                logging::debug(LOG, format!("ffmpeg: {line}"));
                if let Ok(mut tail) = tail.lock() {
                    tail.push(line);
                    if tail.len() > 12 {
                        tail.remove(0);
                    }
                }
            }
        });
    }

    // Wait for the first playable segment (startup latency of a torrent stream).
    let deadline = Instant::now() + Duration::from_secs(45);
    let mut ready = false;
    while Instant::now() < deadline {
        if playlist.exists() {
            let has_segment = std::fs::read_dir(&dir)
                .map(|entries| {
                    entries
                        .filter_map(|entry| entry.ok())
                        .any(|entry| entry.file_name().to_string_lossy().ends_with(".m4s"))
                })
                .unwrap_or(false);
            if has_segment {
                ready = true;
                break;
            }
        }
        if let Ok(Some(status)) = child.try_wait() {
            let detail = stderr_tail
                .lock()
                .map(|tail| tail.join(" | "))
                .unwrap_or_default();
            logging::error(
                LOG,
                format!("ffmpeg exited early ({status}) before producing a segment: {detail}"),
            );
            let _ = std::fs::remove_dir_all(&dir);
            return Err(perr(format!(
                "This stream could not be prepared for playback. {}",
                if detail.is_empty() { "ffmpeg produced no output.".to_string() } else { detail }
            )));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    if !ready {
        let detail = stderr_tail
            .lock()
            .map(|tail| tail.join(" | "))
            .unwrap_or_default();
        logging::error(LOG, format!("stream not ready before timeout: {detail}"));
        let _ = child.start_kill();
        let _ = std::fs::remove_dir_all(&dir);
        return Err(perr(
            "Timed out preparing this stream. The swarm may be slow — try again, or use \
             ↗ External.",
        ));
    }

    logging::info(LOG, format!("stream ready: {id}"));
    let stream_url = format!("http://127.0.0.1:{STREAM_PORT}/media/{id}/index.m3u8");
    let session = Session { child, dir, id, stderr_tail };
    *session_slot().lock().unwrap() = Some(session);

    Ok(PreparedStream {
        stream_url,
        title,
        video_mode: if copy_video { "copy".into() } else { "transcode".into() },
        video_codec: codec,
        audio_note: "audio transcoded to AAC for in-app playback".to_string(),
    })
}

/// Stops the prepared stream and removes its segments.
#[tauri::command]
pub async fn media_player_close() -> Result<(), AppError> {
    logging::info(LOG, "close requested");
    stop_session();
    Ok(())
}

/// Kept for compatibility with older frontends: nothing to reposition any more.
#[tauri::command]
pub fn media_player_set_rect() -> Result<(), AppError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_types_cover_hls_assets() {
        assert_eq!(content_type("index.m3u8"), "application/vnd.apple.mpegurl");
        assert_eq!(content_type("init.mp4"), "video/mp4");
        assert_eq!(content_type("index0.m4s"), "video/iso.segment");
        assert_eq!(content_type("weird"), "application/octet-stream");
    }

    #[test]
    fn copyable_codecs_are_the_webview_ones() {
        assert!(COPYABLE.contains(&"h264"));
        assert!(COPYABLE.contains(&"hevc"));
        assert!(!COPYABLE.contains(&"mpeg2video"));
        assert!(!COPYABLE.contains(&"vc1"));
    }

    #[test]
    fn tool_lookup_finds_ffmpeg_when_installed() {
        // Not an assertion of presence (CI may lack it) — just must not panic.
        let _ = tool("ffmpeg");
    }
}