//! Native playback engine (Phase 4c): libmpv embedded in the app window.
//!
//! Why this exists: the HTML5 `<video>` player can only decode what WKWebView
//! supports. WKWebView refuses the **MKV** container outright and ships no
//! **AC3/E-AC3/DTS/TrueHD** decoders — which is exactly what torrent releases
//! use. That is why rows said "can't play this stream in-app".
//!
//! libmpv (FFmpeg) demuxes and decodes everything, so this module gives MAXplorer
//! Stremio-like "runs every file" playback, embedded in the app window (no
//! leaving the app).
//!
//! How the video surface works: mpv is pointed at an `NSView` we add as a
//! subview of the Tauri window's content view, via mpv's `wid` option. On macOS
//! this requires a libmpv build that has the `wid`/NSView path (mpv master;
//! `brew install mpv --HEAD`). `media_player_diagnostics` reports whether the
//! installed libmpv supports it, so a missing capability is diagnosable instead
//! of silent.
//!
//! Everything here is heavily logged via `crate::logging` — engine load path,
//! option/command result codes, end-file reasons and mpv's own log stream — so a
//! future playback failure can be root-caused from `maxplorer.log` alone.

use crate::error::AppError;
use crate::logging;
use crate::mpv::{self, MpvApi, MpvEventEndFile, MpvEventLogMessage, MpvEventProperty, MpvHandle};
use objc2::msg_send;
use objc2::runtime::{AnyObject, Bool};
use serde::Serialize;
use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

const LOG_TARGET: &str = "media.player";

/// Property observation ids (any unique u64).
const PROP_PAUSE: u64 = 1;
const PROP_TIME_POS: u64 = 2;
const PROP_DURATION: u64 = 3;
const PROP_EOF: u64 = 4;
const PROP_CORE_IDLE: u64 = 5;
const PROP_VOLUME: u64 = 6;
const PROP_MUTE: u64 = 7;
const PROP_TITLE: u64 = 8;
const PROP_VIDEO_FORMAT: u64 = 9;

/// C layout of NSRect/CGRect comes from objc2-foundation so it implements the
/// `Encode` trait `msg_send!` requires.
use objc2_foundation::{NSPoint, NSRect, NSSize};

impl RectExt for NSRect {
    fn from_points(x: f64, y: f64, width: f64, height: f64) -> Self {
        NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
    }
}

trait RectExt {
    fn from_points(x: f64, y: f64, width: f64, height: f64) -> Self;
}

/// Playback state pushed to the UI.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStatus {
    pub loaded: bool,
    pub paused: bool,
    pub eof: bool,
    pub idle: bool,
    pub position: f64,
    pub duration: f64,
    pub volume: f64,
    pub muted: bool,
    pub title: Option<String>,
    pub video_format: Option<String>,
    pub error: Option<String>,
}

/// Diagnostics for the in-app player (shown in Settings and logged).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDiagnostics {
    pub available: bool,
    pub library_path: Option<String>,
    pub api_version: Option<String>,
    /// Whether this libmpv accepts mpv's `wid` NSView embedding on macOS.
    pub embedding_supported: bool,
    pub detail: String,
}

struct Session {
    api: &'static MpvApi,
    handle: MpvHandle,
    view: *mut AnyObject,
    shared: Arc<Mutex<PlayerStatus>>,
}

// The raw handle/view pointers are only touched through this module; libmpv's
// API is thread-safe and NSView access is marshalled to the main thread.
unsafe impl Send for Session {}

static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(1);

fn session_slot() -> &'static Mutex<Option<Session>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

fn perr(message: impl Into<String>) -> AppError {
    AppError::new("player", message, None)
}

fn cstr(value: &str) -> CString {
    CString::new(value.replace('\0', "")).unwrap_or_default()
}

// ── libmpv helpers ──────────────────────────────────────────────────────────

fn set_option(api: &MpvApi, handle: MpvHandle, name: &str, value: &str) -> c_int {
    let (n, v) = (cstr(name), cstr(value));
    let code = unsafe { (api.mpv_set_option_string)(handle, n.as_ptr(), v.as_ptr()) };
    logging::debug(
        LOG_TARGET,
        format!("set_option {name}={value} -> {}", mpv::error_string(api, code)),
    );
    code
}

fn set_option_i64(api: &MpvApi, handle: MpvHandle, name: &str, mut value: i64) -> c_int {
    let (n, _v) = (cstr(name), cstr(""));
    let code = unsafe {
        (api.mpv_set_option)(
            handle,
            n.as_ptr(),
            mpv::MPV_FORMAT_INT64,
            &mut value as *mut i64 as *mut c_void,
        )
    };
    logging::debug(
        LOG_TARGET,
        format!("set_option {name}={value} (int64) -> {}", mpv::error_string(api, code)),
    );
    code
}

fn set_property_flag(api: &MpvApi, handle: MpvHandle, name: &str, mut value: c_int) -> c_int {
    let n = cstr(name);
    unsafe {
        (api.mpv_set_property)(
            handle,
            n.as_ptr(),
            mpv::MPV_FORMAT_FLAG,
            &mut value as *mut c_int as *mut c_void,
        )
    }
}

fn set_property_double(api: &MpvApi, handle: MpvHandle, name: &str, mut value: f64) -> c_int {
    let n = cstr(name);
    unsafe {
        (api.mpv_set_property)(
            handle,
            n.as_ptr(),
            mpv::MPV_FORMAT_DOUBLE,
            &mut value as *mut f64 as *mut c_void,
        )
    }
}

fn get_property_string(api: &MpvApi, handle: MpvHandle, name: &str) -> Option<String> {
    let n = cstr(name);
    unsafe {
        let ptr = (api.mpv_get_property_string)(handle, n.as_ptr());
        if ptr.is_null() {
            return None;
        }
        let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        (api.mpv_free)(ptr as *mut c_void);
        Some(value)
    }
}

fn command(api: &MpvApi, handle: MpvHandle, args: &[&str]) -> Result<(), AppError> {
    let owned: Vec<CString> = args.iter().map(|a| cstr(a)).collect();
    let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
    ptrs.push(std::ptr::null());
    let code = unsafe { (api.mpv_command)(handle, ptrs.as_ptr()) };
    if code < 0 {
        let message = format!(
            "mpv command {args:?} failed: {}",
            mpv::error_string(api, code)
        );
        logging::error(LOG_TARGET, &message);
        return Err(perr(message));
    }
    logging::debug(LOG_TARGET, format!("command {args:?} ok"));
    Ok(())
}

// ── NSView surface ──────────────────────────────────────────────────────────

/// Create the NSView subview and add it to the window's content view.
/// Must run on the main thread.
unsafe fn create_view(window: *mut AnyObject, rect: NSRect) -> *mut AnyObject {
    let content_view: *mut AnyObject = msg_send![window, contentView];
    if content_view.is_null() {
        return std::ptr::null_mut();
    }
    let view: *mut AnyObject = msg_send![objc2::class!(NSView), alloc];
    let view: *mut AnyObject = msg_send![view, initWithFrame: rect];
    if view.is_null() {
        return std::ptr::null_mut();
    }
    // Layer-back the view so mpv's output composites correctly.
    let _: () = msg_send![view, setWantsLayer: Bool::YES];
    let _: () = msg_send![content_view, addSubview: view];
    view
}

unsafe fn set_view_frame(view: *mut AnyObject, rect: NSRect) {
    if view.is_null() {
        return;
    }
    let _: () = msg_send![view, setFrame: rect];
}

unsafe fn content_view_height(window: *mut AnyObject) -> f64 {
    let content_view: *mut AnyObject = msg_send![window, contentView];
    if content_view.is_null() {
        return 0.0;
    }
    let bounds: NSRect = msg_send![content_view, bounds];
    bounds.size.height
}

unsafe fn remove_view(view: *mut AnyObject) {
    if view.is_null() {
        return;
    }
    let _: () = msg_send![view, removeFromSuperview];
}

/// Convert a top-left-origin CSS rect (points) into an NSView frame.
unsafe fn frame_from_css(window: *mut AnyObject, x: f64, y: f64, w: f64, h: f64) -> NSRect {
    let height = content_view_height(window);
    NSRect::from_points(x, height - (y + h), w, h)
}

fn with_main_thread<T, F>(app: &tauri::AppHandle, work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let app = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(work());
    })
    .map_err(|error| perr(format!("could not reach the main thread: {error}")))?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| perr(format!("main-thread work timed out: {error}")))
}

fn ns_window(app: &tauri::AppHandle) -> Result<*mut AnyObject, AppError> {
    use tauri::Manager;
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
        .ok_or_else(|| perr("no application window is open"))?;
    let raw = window
        .ns_window()
        .map_err(|error| perr(format!("could not access the native window: {error}")))?;
    if raw.is_null() {
        return Err(perr("the native window was not available"));
    }
    Ok(raw as *mut AnyObject)
}

// ── Session lifecycle ───────────────────────────────────────────────────────

/// Tear down any current session. Safe to call when nothing is playing.
fn teardown(app: Option<&tauri::AppHandle>) {
    let mut slot = session_slot().lock().unwrap();
    let Some(session) = slot.take() else {
        return;
    };
    logging::info(LOG_TARGET, "closing player session");
    // Quit playback, then destroy the handle (joins mpv's threads).
    let _ = command(session.api, session.handle, &["quit"]);
    unsafe { (session.api.mpv_terminate_destroy)(session.handle) };
    if let Some(app) = app {
        let view = session.view as usize;
        let _ = with_main_thread(&app, move || unsafe {
            remove_view(view as *mut AnyObject);
        });
    } else {
        unsafe { remove_view(session.view) };
    }
    drop(slot);
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// Create an mpv instance with MAXplorer's playback options.
fn create_mpv(api: &'static MpvApi, viewer_view: *mut AnyObject) -> Result<MpvHandle, AppError> {
    let handle = unsafe { (api.mpv_create)() };
    if handle.is_null() {
        return Err(perr("libmpv could not create a player instance"));
    }

    // Predictable, self-contained instance: no user config, no terminal, no OSD.
    set_option(api, handle, "config", "no");
    set_option(api, handle, "terminal", "no");
    set_option(api, handle, "osc", "no");
    set_option(api, handle, "input-default-bindings", "no");
    set_option(api, handle, "input-vo-keyboard", "yes");
    set_option(api, handle, "keep-open", "no");
    set_option(api, handle, "idle", "yes");
    set_option(api, handle, "force-window", "no");
    set_option(api, handle, "ytdl", "no");
    set_option(api, handle, "volume-max", "200");
    // Hardware decode where safe — needed for HEVC/HDR/4K torrent releases.
    set_option(api, handle, "hwdec", "auto-safe");
    // Network/torrent streams: keep a modest forward buffer.
    set_option(api, handle, "cache", "yes");
    set_option(api, handle, "demuxer-max-bytes", "256MiB");
    // Do NOT start mpv's built-in Lua scripts. They are LuaJIT, and a JIT in a
    // hardened process without the JIT entitlement gets the app killed by the
    // kernel (SIGKILL, "Code Signature Invalid / Invalid Page"). We need none of
    // them: stats overlay, console, select and auto-profiles are all cosmetic
    // and the OSD/OSC are already off.
    for option in [
        "load-scripts",       // config-dir scripts
        "load-stats-overlay", // stats.lua — this is the one that crashed
        "load-console",       // console.lua
        "load-select",        // select.lua
        "load-positioning",   // positioning.lua
        "load-auto-profiles", // auto_profiles.lua
    ] {
        set_option(api, handle, option, "no");
    }

    // Embed into our NSView. On macOS this is the `wid` NSView path.
    let code = set_option_i64(api, handle, "wid", viewer_view as i64);
    if code < 0 {
        logging::warn(
            LOG_TARGET,
            format!(
                "libmpv rejected `wid` ({}); video output will not be embedded. \
                 A libmpv built without the macOS NSView `wid` path (e.g. mpv 0.42 \
                 release) cannot embed; use mpv master via `brew install mpv --HEAD`.",
                mpv::error_string(api, code)
            ),
        );
    }

    let code = unsafe { (api.mpv_initialize)(handle) };
    if code < 0 {
        let message = format!("mpv_initialize failed: {}", mpv::error_string(api, code));
        logging::error(LOG_TARGET, &message);
        unsafe { (api.mpv_terminate_destroy)(handle) };
        return Err(perr(message));
    }

    let vo = get_property_string(api, handle, "vo");
    let wid = get_property_string(api, handle, "wid");
    logging::info(
        LOG_TARGET,
        format!(
            "mpv initialised (vo={vo:?}, wid={wid:?}, embedding={})",
            viewer_view as i64
        ),
    );

    let level = cstr(if cfg!(debug_assertions) { "v" } else { "info" });
    unsafe { (api.mpv_request_log_messages)(handle, level.as_ptr()) };
    Ok(handle)
}

fn observe(api: &MpvApi, handle: MpvHandle) {
    let props: [(u64, &str, c_int); 9] = [
        (PROP_PAUSE, "pause", mpv::MPV_FORMAT_FLAG),
        (PROP_TIME_POS, "time-pos", mpv::MPV_FORMAT_DOUBLE),
        (PROP_DURATION, "duration", mpv::MPV_FORMAT_DOUBLE),
        (PROP_EOF, "eof-reached", mpv::MPV_FORMAT_FLAG),
        (PROP_CORE_IDLE, "core-idle", mpv::MPV_FORMAT_FLAG),
        (PROP_VOLUME, "volume", mpv::MPV_FORMAT_DOUBLE),
        (PROP_MUTE, "mute", mpv::MPV_FORMAT_FLAG),
        (PROP_TITLE, "media-title", mpv::MPV_FORMAT_STRING),
        (PROP_VIDEO_FORMAT, "video-format", mpv::MPV_FORMAT_STRING),
    ];
    for (id, name, format) in props {
        let n = cstr(name);
        let code = unsafe { (api.mpv_observe_property)(handle, id, n.as_ptr(), format) };
        if code < 0 {
            logging::warn(
                LOG_TARGET,
                format!(
                    "could not observe {name}: {}",
                    mpv::error_string(api, code)
                ),
            );
        }
    }
}

/// Event loop: translate mpv events into Tauri events and log lines.
fn spawn_event_loop(
    app: tauri::AppHandle,
    api: &'static MpvApi,
    handle: MpvHandle,
    shared: Arc<Mutex<PlayerStatus>>,
    generation: u64,
) {
    let handle_addr = handle as usize;
    std::thread::Builder::new()
        .name("mpv-events".into())
        .spawn(move || {
            // Raw pointers are not `Send`; carry the handle as an address.
            let handle = handle_addr as MpvHandle;
            logging::debug(LOG_TARGET, "mpv event loop started");
            loop {
                let event = unsafe { (api.mpv_wait_event)(handle, 0.25) };
                if event.is_null() {
                    break;
                }
                let event = unsafe { &*event };
                match event.event_id {
                    mpv::MPV_EVENT_NONE => continue,
                    mpv::MPV_EVENT_SHUTDOWN => {
                        logging::debug(LOG_TARGET, "mpv event loop: shutdown");
                        break;
                    }
                    mpv::MPV_EVENT_LOG_MESSAGE => {
                        let data = event.data as *mut MpvEventLogMessage;
                        if !data.is_null() {
                            let msg = unsafe { &*data };
                            let level = cstr_to_string(msg.level);
                            let text = cstr_to_string(msg.text);
                            let prefix = cstr_to_string(msg.prefix);
                            match level.as_str() {
                                "fatal" | "error" => {
                                    logging::error(LOG_TARGET, format!("{prefix}{text}"))
                                }
                                "warn" => logging::warn(LOG_TARGET, format!("{prefix}{text}")),
                                "debug" | "trace" => {
                                    logging::debug(LOG_TARGET, format!("{prefix}{text}"))
                                }
                                _ => logging::info(LOG_TARGET, format!("{prefix}{text}")),
                            }
                        }
                    }
                    mpv::MPV_EVENT_PROPERTY_CHANGE => {
                        let data = event.data as *mut MpvEventProperty;
                        if data.is_null() {
                            continue;
                        }
                        let prop = unsafe { &*data };
                        let name = cstr_to_string(prop.name);
                        if let Ok(mut status) = shared.lock() {
                            apply_property(&mut status, &name, prop);
                        }
                        emit_state(&app, &shared);
                    }
                    mpv::MPV_EVENT_FILE_LOADED => {
                        logging::info(LOG_TARGET, "file loaded; decoding started");
                        if let Ok(mut status) = shared.lock() {
                            status.loaded = true;
                            status.error = None;
                        }
                        emit_state(&app, &shared);
                    }
                    mpv::MPV_EVENT_PLAYBACK_RESTART => {
                        logging::debug(LOG_TARGET, "playback restarted (seek/start finished)");
                        emit_state(&app, &shared);
                    }
                    mpv::MPV_EVENT_END_FILE => {
                        let data = event.data as *mut MpvEventEndFile;
                        if !data.is_null() {
                            let end = unsafe { &*data };
                            let reason = match end.reason {
                                mpv::MPV_END_FILE_REASON_EOF => "eof",
                                mpv::MPV_END_FILE_REASON_STOP => "stopped",
                                mpv::MPV_END_FILE_REASON_QUIT => "quit",
                                mpv::MPV_END_FILE_REASON_ERROR => "error",
                                _ => "other",
                            };
                            if end.reason == mpv::MPV_END_FILE_REASON_ERROR {
                                let detail =
                                    mpv::error_string(api, end.error);
                                logging::error(
                                    LOG_TARGET,
                                    format!("playback ended ({reason}): {detail}"),
                                );
                                if let Ok(mut status) = shared.lock() {
                                    status.error = Some(format!(
                                        "Playback failed: {detail}. The file may be corrupt, \
                                         or the stream is unreachable."
                                    ));
                                }
                                emit_state(&app, &shared);
                            } else {
                                logging::info(LOG_TARGET, format!("playback ended ({reason})"));
                                if let Ok(mut status) = shared.lock() {
                                    status.eof = end.reason == mpv::MPV_END_FILE_REASON_EOF;
                                }
                                emit_state(&app, &shared);
                            }
                        }
                    }
                    other => {
                        logging::debug(LOG_TARGET, format!("mpv event {other}"));
                    }
                }

                // Retire the loop once a newer session has replaced this one.
                if GENERATION.load(Ordering::SeqCst) != generation {
                    logging::debug(LOG_TARGET, "mpv event loop superseded; exiting");
                    break;
                }
            }
            logging::debug(LOG_TARGET, "mpv event loop stopped");
        })
        .expect("spawn mpv event thread");
}

fn cstr_to_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned()
    }
}

fn apply_property(status: &mut PlayerStatus, name: &str, prop: &MpvEventProperty) {
    if prop.format == mpv::MPV_FORMAT_NONE {
        // e.g. time-pos is unavailable before playback starts.
        if name == "time-pos" {
            status.position = 0.0;
        }
        return;
    }
    match name {
        "pause" if prop.format == mpv::MPV_FORMAT_FLAG => {
            status.paused = unsafe { *(prop.data as *const c_int) } != 0
        }
        "eof-reached" if prop.format == mpv::MPV_FORMAT_FLAG => {
            status.eof = unsafe { *(prop.data as *const c_int) } != 0
        }
        "core-idle" if prop.format == mpv::MPV_FORMAT_FLAG => {
            status.idle = unsafe { *(prop.data as *const c_int) } != 0
        }
        "mute" if prop.format == mpv::MPV_FORMAT_FLAG => {
            status.muted = unsafe { *(prop.data as *const c_int) } != 0
        }
        "time-pos" if prop.format == mpv::MPV_FORMAT_DOUBLE => {
            status.position = unsafe { *(prop.data as *const c_double) }
        }
        "duration" if prop.format == mpv::MPV_FORMAT_DOUBLE => {
            status.duration = unsafe { *(prop.data as *const c_double) }
        }
        "volume" if prop.format == mpv::MPV_FORMAT_DOUBLE => {
            status.volume = unsafe { *(prop.data as *const c_double) }
        }
        "media-title" if prop.format == mpv::MPV_FORMAT_STRING => {
            status.title = Some(unsafe { cstr_to_string(*(prop.data as *const *const c_char)) });
        }
        "video-format" if prop.format == mpv::MPV_FORMAT_STRING => {
            status.video_format =
                Some(unsafe { cstr_to_string(*(prop.data as *const *const c_char)) });
        }
        _ => {}
    }
}

fn emit_state(app: &tauri::AppHandle, shared: &Arc<Mutex<PlayerStatus>>) {
    use tauri::Emitter;
    if let Ok(status) = shared.lock() {
        let _ = app.emit("media-player://state", status.clone());
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Probes whether this libmpv accepts mpv's `wid` NSView embedding on macOS by
/// attempting to set the option on a throwaway handle (unknown options return a
/// negative code).
pub(crate) fn probe_embedding_support(api: &MpvApi) -> bool {
    unsafe {
        let probe = (api.mpv_create)();
        if probe.is_null() {
            return false;
        }
        let name = cstr("wid");
        let mut value: i64 = 1;
        let code = (api.mpv_set_option)(
            probe,
            name.as_ptr(),
            mpv::MPV_FORMAT_INT64,
            &mut value as *mut i64 as *mut c_void,
        );
        (api.mpv_terminate_destroy)(probe);
        code >= 0
    }
}

/// Reports whether the in-app player can run, and whether this libmpv build
/// supports macOS NSView embedding. Logged so failures are traceable.
#[tauri::command]
pub fn media_player_diagnostics() -> PlayerDiagnostics {
    let lib = match mpv::libmpv() {
        Ok(lib) => lib,
        Err(error) => {
            logging::warn(LOG_TARGET, format!("libmpv unavailable: {error}"));
            return PlayerDiagnostics {
                available: false,
                library_path: None,
                api_version: None,
                embedding_supported: false,
                detail: error,
            };
        }
    };

    let embedding_supported = probe_embedding_support(&lib.api);

    let detail = if embedding_supported {
        "libmpv supports embedded video output.".to_string()
    } else {
        "This libmpv does not accept mpv's `wid` NSView embedding on macOS \
         (the 0.42 Homebrew release lacks it). Install mpv master with \
         `brew install mpv --HEAD`, or set MAXPLORER_LIBMPV to a build that has it."
            .to_string()
    };
    logging::info(
        LOG_TARGET,
        format!(
            "diagnostics: libmpv {} at {} (embedding={embedding_supported})",
            lib.version,
            lib.path.display()
        ),
    );
    PlayerDiagnostics {
        available: true,
        library_path: Some(lib.path.to_string_lossy().into_owned()),
        api_version: Some(lib.version.clone()),
        embedding_supported,
        detail,
    }
}

/// Opens `url` in the embedded player, sized to the rect (CSS px) the UI
/// reserves for the video surface.
#[tauri::command]
pub async fn media_player_open(
    app: tauri::AppHandle,
    url: String,
    title: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<PlayerStatus, AppError> {
    logging::info(
        LOG_TARGET,
        format!("open requested: {title} ({url}) rect=({x},{y},{width},{height})"),
    );
    let lib = mpv::libmpv().map_err(|error| {
        logging::error(LOG_TARGET, format!("libmpv unavailable: {error}"));
        perr(format!(
            "The in-app player needs libmpv, which is not installed. {error}"
        ))
    })?;
    let api: &'static MpvApi = &lib.api;
    let window = ns_window(&app)?;

    teardown(Some(&app));

    // Create the native surface on the main thread (pointer passed as usize,
    // since raw pointers are not `Send`).
    let raw_window = window as usize;
    let view_addr = with_main_thread(&app, move || unsafe {
        let window = raw_window as *mut AnyObject;
        let rect = frame_from_css(window, x, y, width, height);
        create_view(window, rect) as usize
    })?;
    if view_addr == 0 {
        return Err(perr("could not create the native video surface"));
    }
    let view = view_addr as *mut AnyObject;
    logging::debug(
        LOG_TARGET,
        format!("native video surface created at 0x{view_addr:x} rect=({x},{y},{width},{height})"),
    );

    let handle = create_mpv(api, view)?;
    observe(api, handle);

    let shared = Arc::new(Mutex::new(PlayerStatus {
        volume: 100.0,
        title: Some(title.clone()),
        ..Default::default()
    }));
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    spawn_event_loop(app.clone(), api, handle, shared.clone(), generation);

    {
        let mut slot = session_slot().lock().unwrap();
        *slot = Some(Session {
            api,
            handle,
            view,
            shared: shared.clone(),
        });
    }

    command(api, handle, &["loadfile", &url, "replace"])?;
    logging::info(LOG_TARGET, format!("loadfile issued for {title}"));

    let initial = shared.lock().unwrap().clone();
    Ok(initial)
}

/// Moves/resizes the native video surface as the UI layout changes.
#[tauri::command]
pub async fn media_player_set_rect(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    let view = {
        let slot = session_slot().lock().unwrap();
        slot.as_ref().map(|session| session.view as usize)
    };
    let Some(view) = view else { return Ok(()) };
    let window = ns_window(&app)? as usize;
    with_main_thread(&app, move || unsafe {
        let window = window as *mut AnyObject;
        let rect = frame_from_css(window, x, y, width, height);
        set_view_frame(view as *mut AnyObject, rect);
    })
}

#[tauri::command]
pub fn media_player_set_pause(paused: bool) -> Result<PlayerStatus, AppError> {
    with_session(|api, handle, shared| {
        let code = set_property_flag(api, handle, "pause", if paused { 1 } else { 0 });
        if code < 0 {
            return Err(perr(format!(
                "could not set pause: {}",
                mpv::error_string(api, code)
            )));
        }
        let mut status = shared.lock().unwrap();
        status.paused = paused;
        Ok(status.clone())
    })
}

#[tauri::command]
pub fn media_player_seek(seconds: f64) -> Result<PlayerStatus, AppError> {
    with_session(|api, handle, shared| {
        command(api, handle, &["seek", &format!("{seconds:.3}"), "absolute"])?;
        let mut status = shared.lock().unwrap();
        status.position = seconds;
        Ok(status.clone())
    })
}

#[tauri::command]
pub fn media_player_seek_relative(delta: f64) -> Result<PlayerStatus, AppError> {
    with_session(|api, handle, shared| {
        command(api, handle, &["seek", &format!("{delta:.3}"), "relative"])?;
        Ok(shared.lock().unwrap().clone())
    })
}

#[tauri::command]
pub fn media_player_set_volume(volume: f64) -> Result<PlayerStatus, AppError> {
    with_session(|api, handle, shared| {
        let clamped = volume.clamp(0.0, 200.0);
        let code = set_property_double(api, handle, "volume", clamped);
        if code < 0 {
            return Err(perr(format!(
                "could not set volume: {}",
                mpv::error_string(api, code)
            )));
        }
        let mut status = shared.lock().unwrap();
        status.volume = clamped;
        Ok(status.clone())
    })
}

#[tauri::command]
pub fn media_player_set_muted(muted: bool) -> Result<PlayerStatus, AppError> {
    with_session(|api, handle, shared| {
        let code = set_property_flag(api, handle, "mute", if muted { 1 } else { 0 });
        if code < 0 {
            return Err(perr(format!(
                "could not set mute: {}",
                mpv::error_string(api, code)
            )));
        }
        let mut status = shared.lock().unwrap();
        status.muted = muted;
        Ok(status.clone())
    })
}

#[tauri::command]
pub fn media_player_status() -> PlayerStatus {
    session_slot()
        .lock()
        .unwrap()
        .as_ref()
        .map(|session| session.shared.lock().unwrap().clone())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn media_player_close(app: tauri::AppHandle) -> Result<(), AppError> {
    logging::info(LOG_TARGET, "close requested");
    teardown(Some(&app));
    Ok(())
}

/// Development probe (used by `examples/embed_probe.rs`): creates a real AppKit
/// window, embeds mpv into an NSView inside it via `wid`, loads `url`, and
/// reports what mpv actually did. **Must be called from the main thread** —
/// that is why it lives in an example binary rather than a `#[test]`, since the
/// test harness runs tests on worker threads and AppKit aborts there.
#[doc(hidden)]
pub fn dev_probe_embed(url: &str, seconds: u64) -> Result<String, AppError> {
    use std::time::{Duration, Instant};

    let lib = mpv::libmpv().map_err(|error| perr(error))?;
    let api: &'static MpvApi = &lib.api;

    unsafe {
        let app: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
        let _: () = msg_send![app, setActivationPolicy: 1i64]; // Accessory
        let window: *mut AnyObject = msg_send![objc2::class!(NSWindow), alloc];
        let window: *mut AnyObject = msg_send![
            window,
            initWithContentRect: NSRect::from_points(0.0, 0.0, 640.0, 360.0),
            styleMask: 0u64,
            backing: 2u64, // NSBackingStoreBuffered
            defer: Bool::NO
        ];
        if window.is_null() {
            return Err(perr("could not create a probe window"));
        }
        // NOTE: deliberately no makeKeyAndOrderFront — the production path never
        // orders a window (it only adds a subview to the existing Tauri window),
        // and ordering blocks on a headless/disconnected display.

        let view = create_view(window, NSRect::from_points(0.0, 0.0, 640.0, 360.0));
        if view.is_null() {
            return Err(perr("could not create the probe video surface"));
        }

        let handle = (api.mpv_create)();
        if handle.is_null() {
            return Err(perr("libmpv could not create a player instance"));
        }
        set_option(api, handle, "config", "no");
        set_option(api, handle, "terminal", "no");
        set_option(api, handle, "ao", "null");
        for option in [
            "load-scripts",
            "load-stats-overlay",
            "load-console",
            "load-select",
            "load-positioning",
            "load-auto-profiles",
        ] {
            set_option(api, handle, option, "no");
        }
        let wid_code = set_option_i64(api, handle, "wid", view as i64);
        let init_code = (api.mpv_initialize)(handle);
        if init_code < 0 {
            return Err(perr(format!(
                "mpv_initialize failed: {}",
                mpv::error_string(api, init_code)
            )));
        }
        observe(api, handle);
        let vo_before = get_property_string(api, handle, "vo");

        command(api, handle, &["loadfile", url, "replace"])?;

        let deadline = Instant::now() + Duration::from_secs(seconds);
        let (mut loaded, mut reconfig) = (false, false);
        while Instant::now() < deadline && !(loaded && reconfig) {
            let event = (api.mpv_wait_event)(handle, 0.25);
            if event.is_null() {
                break;
            }
            match (*event).event_id {
                mpv::MPV_EVENT_FILE_LOADED => loaded = true,
                mpv::MPV_EVENT_VIDEO_RECONFIG => reconfig = true,
                _ => {}
            }
        }

        let vo_after = get_property_string(api, handle, "vo");
        let video = get_property_string(api, handle, "video-format");
        let audio = get_property_string(api, handle, "audio-codec-name");
        (api.mpv_terminate_destroy)(handle);

        Ok(format!(
            "libmpv={} wid_rc={wid_code} init_rc={init_code} vo={vo_before:?}->{vo_after:?} \
             video={video:?} audio={audio:?} file_loaded={loaded} vo_reconfig={reconfig}",
            lib.version
        ))
    }
}

/// Run `work` against the live session, or fail if nothing is playing.
fn with_session<T>(
    work: impl FnOnce(&MpvApi, MpvHandle, &Arc<Mutex<PlayerStatus>>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let slot = session_slot().lock().unwrap();
    let session = slot.as_ref().ok_or_else(|| perr("no media is playing"))?;
    work(session.api, session.handle, &session.shared)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_rect_converts_to_bottom_left_origin() {
        // A 1000pt-tall window, stage at CSS y=100 height=200 -> NS y=700.
        let rect = NSRect::from_points(0.0, 1000.0 - (100.0 + 200.0), 640.0, 200.0);
        assert_eq!(rect.origin.y, 700.0);
        assert_eq!(rect.size.height, 200.0);
    }

    #[test]
    fn property_updates_are_applied() {
        let mut status = PlayerStatus::default();
        let mut paused: c_int = 1;
        let prop = MpvEventProperty {
            name: std::ptr::null(),
            format: mpv::MPV_FORMAT_FLAG,
            data: &mut paused as *mut c_int as *mut c_void,
        };
        apply_property(&mut status, "pause", &prop);
        assert!(status.paused);

        let mut pos: f64 = 42.5;
        let prop = MpvEventProperty {
            name: std::ptr::null(),
            format: mpv::MPV_FORMAT_DOUBLE,
            data: &mut pos as *mut f64 as *mut c_void,
        };
        apply_property(&mut status, "time-pos", &prop);
        assert_eq!(status.position, 42.5);
    }

    #[test]
    fn unknown_properties_are_ignored() {
        let mut status = PlayerStatus::default();
        let mut value: c_int = 1;
        let prop = MpvEventProperty {
            name: std::ptr::null(),
            format: mpv::MPV_FORMAT_FLAG,
            data: &mut value as *mut c_int as *mut c_void,
        };
        apply_property(&mut status, "chapter", &prop);
        assert_eq!(status.position, 0.0);
        assert!(!status.paused);
    }

    /// Live: reports what the installed libmpv supports. Run with
    /// `cargo test --lib player_diagnostics -- --ignored --nocapture`.
    #[test]
    #[ignore = "live: requires libmpv on this machine"]
    fn player_diagnostics_are_reported() {
        let lib = mpv::libmpv().expect("libmpv should load");
        let diagnostics = super::media_player_diagnostics();
        eprintln!(
            "libmpv {} at {}\n  available={} embedding_supported={}\n  {}",
            lib.version,
            lib.path.display(),
            diagnostics.available,
            diagnostics.embedding_supported,
            diagnostics.detail
        );
        assert!(diagnostics.available);
    }

    /// Live: the core RCA claim — libmpv decodes a container/codec pair the
    /// HTML5 `<video>` player refuses (MKV + AC3). This is what "runs every
    /// file" means in practice. Run with
    /// `cargo test --lib live_decodes_mkv -- --ignored --nocapture`.
    #[test]
    #[ignore = "live: needs ffmpeg to build the fixture and libmpv to play it"]
    fn live_decodes_mkv_with_ac3_audio() {
        use std::time::{Duration, Instant};

        let directory = tempfile::tempdir().unwrap();
        let fixture = directory.path().join("fixture.mkv");
        let Some(fixture) = fixture.to_str() else {
            return;
        };

        // 2s H.264 + AC3 in an MKV: the exact shape of a torrent release.
        let built = std::process::Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x240:rate=15:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "ac3",
                "-b:a",
                "128k",
                fixture,
            ])
            .status();
        match built {
            Ok(status) if status.success() => {}
            Ok(status) => {
                eprintln!("ffmpeg could not build the fixture ({status}); skipping");
                return;
            }
            Err(error) => {
                eprintln!("ffmpeg unavailable ({error}); skipping");
                return;
            }
        }

        let lib = mpv::libmpv().expect("libmpv should load");
        let api = &lib.api;
        let handle = unsafe { (api.mpv_create)() };
        assert!(!handle.is_null());
        set_option(api, handle, "config", "no");
        set_option(api, handle, "terminal", "no");
        set_option(api, handle, "vo", "null"); // decode without a window
        set_option(api, handle, "ao", "null"); // decode without an audio device
        let code = unsafe { (api.mpv_initialize)(handle) };
        assert!(code >= 0, "mpv_initialize failed");
        observe(api, handle);

        command(api, handle, &["loadfile", fixture, "replace"]).unwrap();

        let deadline = Instant::now() + Duration::from_secs(20);
        let mut loaded = false;
        while Instant::now() < deadline && !loaded {
            let event = unsafe { (api.mpv_wait_event)(handle, 0.25) };
            if event.is_null() {
                break;
            }
            if unsafe { (*event).event_id } == mpv::MPV_EVENT_FILE_LOADED {
                loaded = true;
            }
        }
        assert!(loaded, "mpv never reported FILE_LOADED for the MKV fixture");

        let video = get_property_string(api, handle, "video-format");
        let audio = get_property_string(api, handle, "audio-codec-name");
        let duration = get_property_string(api, handle, "duration");
        eprintln!(
            "decoded MKV: video={video:?} audio={audio:?} duration={duration:?} (libmpv {})",
            lib.version
        );
        assert_eq!(video.as_deref(), Some("h264"), "video codec not decoded");
        assert_eq!(audio.as_deref(), Some("ac3"), "AC3 audio not decoded");

        unsafe { (api.mpv_terminate_destroy)(handle) };
    }
}
