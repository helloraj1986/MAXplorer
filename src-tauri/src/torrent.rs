//! Phase 4b: embedded torrent engine (librqbit 8.1.1).
//!
//! The free, no-debrid playback path. Torrentio returns bare info-hashes for
//! most rows; without a debrid key the `▶ Stream` button had nothing to run.
//! This module embeds librqbit so a hash becomes a local, seekable HTTP URL:
//!
//!   * one `Session` + librqbit's **built-in** `HttpApi` server on
//!     `127.0.0.1:18081` (started lazily on first use),
//!   * `GET /torrents/{id_or_hash}/stream/{file_idx}` already speaks HTTP
//!     Range, so the existing `PlayerOverlay` `<video>` element can seek.
//!
//! Debrid stays an optional accelerator chosen per-row — never a requirement.

use librqbit::api::TorrentIdOrHash;
use librqbit::http_api::{HttpApi, HttpApiOptions};
use librqbit::{AddTorrent, AddTorrentOptions, Api, Session, SessionOptions};
use serde::Serialize;
use std::path::PathBuf;
use tokio::net::TcpListener;
use tokio::sync::OnceCell;

/// Loopback port for the embedded stream server. Fixed so the frontend can
/// build stream URLs without an extra round-trip.
const ENGINE_PORT: u16 = 18081;

/// Trackers appended to bare info-hashes (Torrentio omits them). Mirrors the
/// list used by the debrid path so both flows seed the same swarms.
const TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://opentracker.io:6969/announce",
];

struct Engine {
    api: Api,
    base_url: String,
}

/// Started at most once per process; the session + HTTP server live for the
/// life of the app (torrents keep seeding so playback can seek freely).
static ENGINE: OnceCell<Engine> = OnceCell::const_new();

fn engine_error(message: impl Into<String>) -> crate::error::AppError {
    crate::error::AppError::new("torrent_engine", message, None)
}

/// 40-char lowercase hex, or an error. Torrentio hashes are already lowercase
/// but the debrid path tolerates either case, so match that.
fn normalize_hash(info_hash: &str) -> Result<String, crate::error::AppError> {
    let clean: String = info_hash.trim().to_lowercase().replace('-', "");
    if clean.len() != 40 || !clean.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(engine_error(format!("invalid info hash: {info_hash}")));
    }
    Ok(clean)
}

fn build_magnet(info_hash: &str) -> String {
    let trackers = TRACKERS
        .iter()
        .map(|t| format!("&tr={}", percent_encode(t)))
        .collect::<String>();
    format!("magnet:?xt=urn:btih:{info_hash}{trackers}")
}

fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Lazily boot the session + built-in HTTP API. `data_dir` is the Tauri app
/// data directory; torrent payloads land in `<data_dir>/media-cache`.
async fn ensure_engine(data_dir: PathBuf) -> Result<&'static Engine, crate::error::AppError> {
    ENGINE
        .get_or_try_init(|| async move { boot_engine(data_dir, ENGINE_PORT).await })
        .await
}

/// Boots a fresh session + HTTP API bound to `port`. Kept separate from
/// `ensure_engine` (which memoizes one instance per process) so a live test can
/// start its own isolated engine on a different port.
async fn boot_engine(
    data_dir: PathBuf,
    port: u16,
) -> Result<Engine, crate::error::AppError> {
    let download_dir = data_dir.join("media-cache");
    std::fs::create_dir_all(&download_dir)
        .map_err(|e| engine_error(format!("create media cache: {e}")))?;
    crate::logging::info(
        "media.torrent",
        format!("starting torrent engine, cache at {}", download_dir.display()),
    );

    let session = Session::new_with_opts(
        download_dir,
        SessionOptions {
            disable_dht: false,
            ..Default::default()
        },
    )
    .await
    .map_err(|e| engine_error(format!("start torrent session: {e}")))?;

    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| {
            engine_error(format!("bind embedded stream server on 127.0.0.1:{port}: {e}"))
        })?;

    let api = Api::new(session.clone(), None, None);
    let http_api = HttpApi::new(
        api.clone(),
        Some(HttpApiOptions {
            read_only: false,
            basic_auth: None,
        }),
    );
    let server = http_api.make_http_api_and_run(listener, None);
    tauri::async_runtime::spawn(async move {
        if let Err(error) = server.await {
            crate::logging::error("media.torrent", format!("stream server stopped: {error}"));
        }
    });

    let base_url = format!("http://127.0.0.1:{port}");
    crate::logging::info("media.torrent", format!("stream server ready at {base_url}"));
    Ok(Engine { api, base_url })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStart {
    pub base_url: String,
    pub registered: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFileEntry {
    pub idx: usize,
    pub name: String,
    pub length: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStatus {
    pub registered: bool,
    pub metadata_ready: bool,
    /// librqbit refuses to stream a torrent that is still initializing/checking
    /// (`streams: invalid state ...` → HTTP 500), so the URL is only handed out
    /// once the torrent is live or paused. Playing before that shows a blank
    /// player, which is what users read as "this video doesn't work".
    pub streamable: bool,
    pub name: Option<String>,
    pub files: Vec<TorrentFileEntry>,
    pub progress: f64,
    /// MB/s, from librqbit's live speed estimator.
    pub download_speed: f64,
    /// Connected peers.
    pub peers: u64,
    /// Peers discovered (connected + connecting + queued + dead), i.e. swarm size seen.
    pub peers_seen: u64,
    pub state: String,
    /// Stream URL for the largest file, once the torrent can actually serve it.
    pub stream_url: Option<String>,
}

/// Adds a torrent (by info-hash) to the embedded engine and returns the local
/// server's base URL so the frontend can poll status and build stream URLs.
#[tauri::command]
pub async fn media_torrent_start(
    app: tauri::AppHandle,
    info_hash: String,
) -> Result<TorrentStart, crate::error::AppError> {
    use tauri::Manager;
    let hash = normalize_hash(&info_hash)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| engine_error(format!("data dir: {e}")))?;
    let engine = ensure_engine(data_dir).await?;

    let idx = TorrentIdOrHash::parse(&hash)
        .map_err(|e| engine_error(format!("parse info hash: {e}")))?;

    // Already running this swarm — don't re-add (keeps seeding state).
    if engine.api.api_torrent_details(idx).is_ok() {
        return Ok(TorrentStart {
            base_url: engine.base_url.clone(),
            registered: true,
        });
    }

    let magnet = build_magnet(&hash);
    let options = AddTorrentOptions {
        overwrite: true,
        ..Default::default()
    };
    engine
        .api
        .api_add_torrent(AddTorrent::from_url(magnet), Some(options))
        .await
        .map_err(|e| engine_error(format!("add torrent: {e}")))?;

    Ok(TorrentStart {
        base_url: engine.base_url.clone(),
        registered: true,
    })
}

/// Reports metadata readiness, per-file sizes, live progress and the stream URL
/// for the largest file. The frontend polls this until `metadataReady`.
#[tauri::command]
pub async fn media_torrent_status(
    app: tauri::AppHandle,
    info_hash: String,
    base_url: String,
    probe: Option<bool>,
) -> Result<TorrentStatus, crate::error::AppError> {
    use tauri::Manager;
    let hash = normalize_hash(&info_hash)?;
    let base_url = if base_url.is_empty() {
        format!("http://127.0.0.1:{ENGINE_PORT}")
    } else {
        base_url
    };

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| engine_error(format!("data dir: {e}")))?;
    let engine = ensure_engine(data_dir).await?;
    let idx = TorrentIdOrHash::parse(&hash)
        .map_err(|e| engine_error(format!("parse info hash: {e}")))?;

    let details = match engine.api.api_torrent_details(idx) {
        Ok(details) => details,
        Err(_) => {
            return Ok(TorrentStatus {
                registered: false,
                metadata_ready: false,
                streamable: false,
                name: None,
                files: Vec::new(),
                progress: 0.0,
                download_speed: 0.0,
                peers: 0,
                peers_seen: 0,
                state: "unknown".to_string(),
                stream_url: None,
            });
        }
    };

    let files: Vec<TorrentFileEntry> = details
        .files
        .as_ref()
        .map(|list| {
            list.iter()
                .enumerate()
                .map(|(idx, file)| TorrentFileEntry {
                    idx,
                    name: file.name.clone(),
                    length: file.length,
                })
                .collect()
        })
        .unwrap_or_default();

    // Largest *video* file is the sensible default target.
    let target = files
        .iter()
        .filter(|file| is_probably_video(&file.name))
        .max_by_key(|file| file.length)
        .or_else(|| files.iter().max_by_key(|file| file.length));

    let (progress, download_speed, peers, peers_seen, state) = match engine.api.api_stats_v1(idx) {
        Ok(stats) => {
            let pct = if stats.total_bytes == 0 {
                0.0
            } else {
                stats.progress_bytes as f64 / stats.total_bytes as f64
            };
            let (speed, peers, seen) = stats
                .live
                .as_ref()
                .map(|live| {
                    let peer_stats = &live.snapshot.peer_stats;
                    (
                        live.download_speed.mbps,
                        peer_stats.live as u64,
                        (peer_stats.live
                            + peer_stats.connecting
                            + peer_stats.queued
                            + peer_stats.dead) as u64,
                    )
                })
                .unwrap_or((0.0, 0, 0));
            (pct, speed, peers, seen, stats.state.to_string())
        }
        Err(_) => (0.0, 0.0, 0, 0, "initializing".to_string()),
    };

    let metadata_ready = !files.is_empty();
    // librqbit's stream handler bails for anything but Live/Paused, which the API
    // surfaces as HTTP 500. Gate the URL on that instead of letting mpv discover it.
    let mut streamable = can_stream(metadata_ready, &state);
    let mut stream_url = if streamable {
        target.map(|file| format!("{base_url}/torrents/{hash}/stream/{}", file.idx))
    } else {
        None
    };

    // The state enum is not a sufficient promise: the first request after a
    // restart has been observed returning HTTP 500 even though metadata was
    // known, and mpv then shows a blank stage. Prove the URL serves bytes before
    // handing it to the player (a 2-byte ranged GET — cheap). Callers that only
    // want stats pass probe=false.
    if probe.unwrap_or(true) && streamable {
        if let Some(url) = stream_url.as_deref() {
            match probe_stream(url).await {
                Ok(detail) => {
                    crate::logging::debug("media.torrent", format!("{hash}: stream probe ok ({detail})"));
                }
                Err(detail) => {
                    // Polled every 3 s while resolving; only log a change of
                    // failure mode, not the same failure repeatedly.
                    use std::collections::HashMap;
                    use std::sync::{Mutex, OnceLock};
                    static LAST_PROBE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
                    let last = LAST_PROBE.get_or_init(|| Mutex::new(HashMap::new()));
                    let changed = match last.lock() {
                        Ok(mut map) => {
                            map.insert(hash.clone(), detail.clone()) != Some(detail.clone())
                        }
                        Err(_) => true,
                    };
                    if changed {
                        crate::logging::warn(
                            "media.torrent",
                            format!("{hash}: stream probe failed, withholding URL: {detail}"),
                        );
                    }
                    streamable = false;
                    stream_url = None;
                }
            }
        }
    }

    log_transition(&hash, &state, streamable, progress, download_speed, peers);

    Ok(TorrentStatus {
        registered: true,
        metadata_ready,
        streamable,
        name: details.name.clone(),
        files,
        progress,
        download_speed,
        peers,
        peers_seen,
        state,
        stream_url,
    })
}

/// Range-GET two bytes from the embedded server. Returns a short description on
/// success, or the HTTP status + body snippet on failure, so the log explains
/// exactly why the player was not given a URL.
async fn probe_stream(url: &str) -> Result<String, String> {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .build()
            .unwrap_or_default()
    });
    let response = match client
        .get(url)
        .header("Range", "bytes=0-1")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return Err(format!("request failed: {error}")),
    };
    let status = response.status();
    if status.is_success() {
        let length = response.content_length().unwrap_or(0);
        return Ok(format!("{status}, content-length {length}"));
    }
    let body = response.text().await.unwrap_or_default();
    Err(format!(
        "{status}: {}",
        body.chars().take(200).collect::<String>()
    ))
}

/// Logs torrent state transitions once each, so a "blank video" complaint can be
/// answered from the log: was the swarm still initializing, or did playback die
/// for another reason?
fn log_transition(
    hash: &str,
    state: &str,
    streamable: bool,
    progress: f64,
    speed_mbps: f64,
    peers: u64,
) {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    static LAST: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let last = LAST.get_or_init(|| Mutex::new(HashMap::new()));
    let key = format!("{state}|{streamable}");
    let changed = match last.lock() {
        Ok(mut map) => map.insert(hash.to_string(), key.clone()) != Some(key),
        Err(_) => true,
    };
    if changed {
        crate::logging::info(
            "media.torrent",
            format!(
                "{hash}: state={state} streamable={streamable} progress={:.1}% \
                 speed={speed_mbps:.2} MB/s peers={peers}",
                progress * 100.0
            ),
        );
    }
}

/// librqbit's `streams()` only accepts a Live or Paused torrent; every other
/// state yields HTTP 500 ("streams: invalid state <name>").
fn can_stream(metadata_ready: bool, state: &str) -> bool {
    metadata_ready && matches!(state, "live" | "paused")
}

fn is_probably_video(name: &str) -> bool {
    let lower = name.to_lowercase();
    const EXTENSIONS: &[&str] = &[
        ".mp4", ".mkv", ".avi", ".mov", ".m4v", ".webm", ".ts", ".wmv", ".flv", ".mpg", ".mpeg",
    ];
    EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn magnet_includes_hash_and_trackers() {
        let magnet = build_magnet("08ada5a7a6183aae1e09d831df6748d566095a10");
        assert!(magnet.starts_with("magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10"));
        assert!(magnet.contains("&tr="));
    }

    #[test]
    fn hash_validation_accepts_hex_and_rejects_junk() {
        assert_eq!(
            normalize_hash("08ADA5A7A6183AAE1E09D831DF6748D566095A10").unwrap(),
            "08ada5a7a6183aae1e09d831df6748d566095a10"
        );
        assert!(normalize_hash("not-a-hash").is_err());
        assert!(normalize_hash("zzzz").is_err());
    }

    #[test]
    fn stream_url_is_gated_on_a_streamable_state() {
        // Metadata alone is not enough: librqbit 500s while it initializes.
        assert!(!can_stream(true, "initializing"));
        assert!(!can_stream(true, "error"));
        assert!(!can_stream(true, "unknown"));
        assert!(!can_stream(false, "live"));
        assert!(can_stream(true, "live"));
        assert!(can_stream(true, "paused"));
    }

    #[test]
    fn largest_video_file_is_preferred() {
        let files = vec![
            TorrentFileEntry { idx: 0, name: "readme.txt".into(), length: 5_000 },
            TorrentFileEntry { idx: 1, name: "movie.mkv".into(), length: 900 },
            TorrentFileEntry { idx: 2, name: "sample.mkv".into(), length: 100_000_000 },
        ];
        let target = files
            .iter()
            .filter(|f| is_probably_video(&f.name))
            .max_by_key(|f| f.length)
            .unwrap();
        assert_eq!(target.idx, 2);
        assert!(!is_probably_video("subtitles.srt"));
    }

    /// Live: the bug behind "some videos show a blank screen". librqbit's stream
    /// handler 500s until the torrent is live/paused, but metadata (files) appears
    /// first. This measures both instants: the HTTP status the moment metadata is
    /// available, and after the torrent becomes streamable.
    /// `cargo test --lib live_stream_gate -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "live network: needs DHT/tracker connectivity"]
    async fn live_stream_gate_waits_for_a_live_torrent() {
        let hash = "08ada5a7a6183aae1e09d831df6748d566095a10";
        let dir = tempfile::tempdir().unwrap();
        let engine = boot_engine(dir.path().to_path_buf(), 18097).await.unwrap();
        let idx = TorrentIdOrHash::parse(hash).unwrap();
        let magnet = format!(
            "{}&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel%2F",
            build_magnet(hash)
        );
        engine
            .api
            .api_add_torrent(
                AddTorrent::from_url(magnet),
                Some(AddTorrentOptions { overwrite: true, ..Default::default() }),
            )
            .await
            .unwrap();

        // 1. Wait only for metadata (the point at which the old code handed mpv a URL).
        let mut file_idx = None;
        for _ in 0..60 {
            if let Ok(details) = engine.api.api_torrent_details(idx) {
                if let Some(files) = details.files.as_ref() {
                    if let Some((i, _)) = files
                        .iter()
                        .enumerate()
                        .filter(|(_, f)| is_probably_video(&f.name))
                        .max_by_key(|(_, f)| f.length)
                    {
                        file_idx = Some(i);
                        break;
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        let file_idx = file_idx.expect("metadata never arrived");
        let state_at_metadata = engine
            .api
            .api_stats_v1(idx)
            .map(|s| s.state.to_string())
            .unwrap_or_else(|_| "unknown".into());
        let streamable_at_metadata = can_stream(true, &state_at_metadata);

        let url = format!("{}/torrents/{}/stream/{}", engine.base_url, hash, file_idx);
        let client = reqwest::Client::new();
        let early = client.get(&url).send().await.unwrap().status();

        // 2. Wait until the gate says the torrent can serve, then require 200 + Range.
        let mut streamable_now = false;
        for _ in 0..60 {
            let state = engine
                .api
                .api_stats_v1(idx)
                .map(|s| s.state.to_string())
                .unwrap_or_else(|_| "unknown".into());
            if can_stream(true, &state) {
                streamable_now = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        assert!(streamable_now, "torrent never became streamable");
        let response = client
            .get(&url)
            .header("Range", "bytes=0-")
            .send()
            .await
            .unwrap();
        let final_status = response.status();
        drop(response);

        let probe = probe_stream(&url).await;
        eprintln!(
            "early: state={state_at_metadata} streamable={streamable_at_metadata} http={early} | \
             after gate: http={final_status} | probe={probe:?}"
        );
        assert!(probe.is_ok(), "URL probe failed: {probe:?}");
        assert!(
            final_status == reqwest::StatusCode::PARTIAL_CONTENT
                || final_status == reqwest::StatusCode::OK,
            "stream still failing after the gate: {final_status}"
        );
        // Observed on a fresh add: state "initializing" while the stream already
        // serves 200. So the state enum alone does not explain the blank-player
        // 500s; that is why `media_torrent_status` also Range-probes the URL
        // before the frontend opens it. This test pins the eventual success.
        let _ = streamable_at_metadata;
    }

    /// Live end-to-end check of the embedded engine: boots a real librqbit
    /// session + built-in HTTP API, adds webtorrent's Sintel (CC, DHT-seeded,
    /// legal), waits for metadata, then Range-fetches the stream URL the player
    /// uses. Ignored by default because it needs DHT/tracker connectivity —
    /// run with `cargo test --lib live_engine -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "live network: needs DHT/tracker connectivity"]
    async fn live_engine_streams_a_real_torrent_with_range_support() {
        let hash = "08ada5a7a6183aae1e09d831df6748d566095a10";
        let dir = tempfile::tempdir().unwrap();
        let engine = boot_engine(dir.path().to_path_buf(), 18099).await.unwrap();
        let idx = TorrentIdOrHash::parse(hash).unwrap();

        // Add a webseed so the test doesn't depend solely on swarm peers.
        let magnet = format!(
            "{}&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel%2F",
            build_magnet(hash)
        );
        engine
            .api
            .api_add_torrent(
                AddTorrent::from_url(magnet),
                Some(AddTorrentOptions {
                    overwrite: true,
                    ..Default::default()
                }),
            )
            .await
            .unwrap();

        let mut target: Option<(usize, String, u64)> = None;
        for _ in 0..60 {
            if let Ok(details) = engine.api.api_torrent_details(idx) {
                if let Some(files) = details.files.as_ref() {
                    if let Some((i, file)) = files
                        .iter()
                        .enumerate()
                        .filter(|(_, f)| is_probably_video(&f.name))
                        .max_by_key(|(_, f)| f.length)
                    {
                        target = Some((i, file.name.clone(), file.length));
                        break;
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        let (file_idx, name, length) = target.expect("torrent metadata did not arrive within 120s");
        assert!(length > 0, "largest video file is empty");

        let url = format!("{}/torrents/{}/stream/{}", engine.base_url, hash, file_idx);
        let client = reqwest::Client::new();

        // librqbit 8.1.1's built-in server honours only the open-ended
        // `bytes=N-` form (see handlers/streaming.rs: it strips a trailing
        // '-'); that is exactly the form media elements use to seek.
        let seek_offset = 5_000_000u64;
        let response = client
            .get(&url)
            .header("Range", format!("bytes={seek_offset}-"))
            .send()
            .await
            .unwrap();
        let status = response.status();
        let content_range = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        assert_eq!(
            status,
            reqwest::StatusCode::PARTIAL_CONTENT,
            "expected 206 for a Range request, got {status} (content-range: {content_range:?})"
        );
        let expected = format!("bytes {seek_offset}-{}/{length}", length - 1);
        assert_eq!(
            content_range.as_deref(),
            Some(expected.as_str()),
            "unexpected Content-Range"
        );
        // Read just the first chunk and drop the connection — enough to prove
        // bytes flow without pulling the remaining ~124 MB.
        let mut response = response;
        let chunk = response.chunk().await.unwrap();
        assert!(
            chunk.map(|c| !c.is_empty()).unwrap_or(false),
            "no bytes streamed for {name}"
        );
        eprintln!(
            "Range OK: HTTP {status} {content_range:?}, streamed {name} from byte {seek_offset}"
        );
    }
}
