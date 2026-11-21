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
//! How the video surface works: mpv renders each frame with the **render API**
//! (`MPV_RENDER_API_TYPE_SW`) into an RGBA buffer we own (`render.rs`), which is
//! wrapped in a `CGImage` and set as the contents of a layer-backed `NSView`
//! placed over the player stage. That is how Stremio embeds mpv, and it is the
//! only path that exists on macOS — mpv's `wid`/NSView option was never merged
//! upstream, so setting it succeeds and is silently ignored (the video then
//! opens in mpv's own window).
//!
//! Everything here is heavily logged via `crate::logging` — engine load path,
//! option/command result codes, end-file reasons and mpv's own log stream — so a
//! future playback failure can be root-caused from `maxplorer.log` alone.

use crate::error::AppError;
use crate::logging;
use crate::mpv::{self, MpvApi, MpvEventEndFile, MpvEventLogMessage, MpvEventProperty, MpvHandle};
use crate::render::SwRenderer;
use objc2::msg_send;
use objc2::runtime::{AnyObject, Bool};
use serde::Serialize;
use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
const PROP_PAUSED_FOR_CACHE: u64 = 10;
const PROP_CACHE_PERCENT: u64 = 11;
const PROP_CACHE_TIME: u64 = 12;
const PROP_CACHE_SPEED: u64 = 13;
const PROP_FILE_LOADED: u64 = 14;

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
    /// mpv is stalled waiting for the network (a torrent stream can do this a lot).
    pub paused_for_cache: bool,
    /// mpv's cache fill, 0-100.
    pub cache_percent: i64,
    /// Seconds of media buffered ahead.
    pub cache_seconds: f64,
    /// Bytes/second arriving from the source.
    pub cache_speed: i64,
    pub file_loaded: bool,
    pub error: Option<String>,
}

/// Volatile playback metrics, pushed on a coalesced tick instead of per frame.
///
/// `time-pos`, `demuxer-cache-time` and `cache-speed` change on almost every
/// decoded frame. Sending the full [`PlayerStatus`] for each of them meant up to
/// ~60 serialised IPC messages per second — each one re-rendering
/// `PlayerOverlay` while the native video surface was compositing. Only these
/// fields are streamed at frame rate; every discrete change (pause, mute,
/// volume, file-loaded, error, eof) still sends the full state immediately.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerTick {
    pub position: f64,
    pub duration: f64,
    pub cache_percent: i64,
    pub cache_seconds: f64,
    pub cache_speed: i64,
    pub paused_for_cache: bool,
}

/// How often coalesced metrics are pushed to the webview.
const TICK_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);

/// Measurement counters behind the `media.player.perf` log line.
static PROP_EVENTS: AtomicU64 = AtomicU64::new(0);
static FULL_EMITS: AtomicU64 = AtomicU64::new(0);
static TICK_EMITS: AtomicU64 = AtomicU64::new(0);

/// Properties that change at frame rate. They dirty the tick instead of forcing
/// an immediate full-state emit.
fn is_volatile_property(name: &str) -> bool {
    matches!(
        name,
        "time-pos"
            | "demuxer-cache-time"
            | "cache-speed"
            | "cache-buffering-state"
            | "paused-for-cache"
    )
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
    /// Software renderer that paints mpv frames into `view`. `None` only if the
    /// render context could not be created — mpv then opens its own window.
    renderer: Option<SwRenderer>,
    shared: Arc<Mutex<PlayerStatus>>,
    /// Tells the event thread to stop before the handle is destroyed.
    stop: Arc<std::sync::atomic::AtomicBool>,
    /// The event thread; must be joined BEFORE mpv_terminate_destroy, otherwise
    /// it is left inside mpv_wait_event on a freed handle and the process
    /// segfaults (observed: SIGSEGV in mpv_wait_event on thread `mpv-events`).
    thread: Option<std::thread::JoinHandle<()>>,
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

/// Exact playback numbers, logged every 5 s next to the renderer's line.
///
/// Without these, "the frame rate is dropping" cannot be attributed: `media.render`
/// only counts frames *we* rendered. `container-fps` is what the source offers,
/// `estimated-vf-fps` what the VO filter chain is actually emitting, and mpv's two
/// drop counters say whether the loss is in the VO or in the decoder.
///
/// Must run on the mpv control thread (the event loop) — never from the ticker.
fn log_playback_perf(api: &MpvApi, handle: MpvHandle) {
    let read = |name: &str| {
        get_property_string(api, handle, name).unwrap_or_else(|| "n/a".to_string())
    };
    logging::info(
        "media.player.perf",
        format!(
            "playback: source {} fps, vf {} fps, vo-drops {}, decoder-drops {}, osd {}x{} \
             bars l{} t{} r{} b{}, pos {}",
            read("container-fps"),
            read("estimated-vf-fps"),
            read("vo-drop-frame-count"),
            read("decoder-frame-drop-count"),
            read("osd-dimensions/w"),
            read("osd-dimensions/h"),
            read("osd-dimensions/margins-l"),
            read("osd-dimensions/margins-t"),
            read("osd-dimensions/margins-r"),
            read("osd-dimensions/margins-b"),
            read("time-pos"),
        ),
    );
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
    // Own a reference ourselves: presentation closures are queued on the main
    // thread, and one may still run after the view is removed from its superview.
    let _: () = msg_send![view, retain];
    // Layer-back the view so mpv's output composites correctly.
    let _: () = msg_send![view, setWantsLayer: Bool::YES];
    // **Let the pointer through to the webview.** The surface is composited
    // ABOVE the webview, so without this it is the hit-test target for the whole
    // video area: `mousemove` never reaches PlayerOverlay, the autohidden chrome
    // can never wake up (only `Tab` worked), and clicking the video did nothing.
    // The surface itself has no interactive content — every control lives in the
    // chrome strips outside it — so it must be transparent to the mouse.
    let _: () = msg_send![view, setIgnoresMouseEvents: Bool::YES];
    let _: () = msg_send![content_view, addSubview: view];
    // Hidden until the first file actually loads, so the HTML spinner/error card
    // is visible instead of being covered by a black native rectangle.
    let _: () = msg_send![view, setHidden: Bool::YES];
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

/// Size of a CSS rect in **backing pixels** (points × display scale factor).
/// The render surface must match these, or Retina displays get a half-size video.
unsafe fn backing_size(window: *mut AnyObject, x: f64, y: f64, w: f64, h: f64) -> (u32, u32) {
    let content_view: *mut AnyObject = msg_send![window, contentView];
    let mut width = w;
    let mut height = h;
    if !content_view.is_null() {
        let rect = frame_from_css(window, x, y, w, h);
        let backing: NSRect = msg_send![content_view, convertRectToBacking: rect];
        if backing.size.width >= 1.0 && backing.size.height >= 1.0 {
            width = backing.size.width;
            height = backing.size.height;
        }
    }
    (width.round().max(1.0) as u32, height.round().max(1.0) as u32)
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
    let Some(mut session) = slot.take() else {
        return;
    };
    logging::info(LOG_TARGET, "closing player session");

    // Order matters: stop the event thread FIRST (it is blocked in
    // mpv_wait_event), join it, and only then destroy the handle. Destroying
    // while the thread is still waiting dereferences freed memory and the app
    // dies with SIGSEGV in mpv_wait_event.
    session.stop.store(true, Ordering::SeqCst);
    if let Some(thread) = session.thread.take() {
        // mpv_wait_event returns within its 0.25s timeout, so this is quick.
        let _ = thread.join();
    }
    // Render context must be freed before the core is destroyed, and only after
    // the render thread has stopped touching it.
    if let Some(renderer) = session.renderer.take() {
        renderer.stop();
    }
    let _ = command(session.api, session.handle, &["quit"]);
    unsafe { (session.api.mpv_terminate_destroy)(session.handle) };
    if let Some(app) = app {
        let view = session.view as usize;
        let _ = with_main_thread(&app, move || unsafe {
            // Release the reference taken in `create_view` — a queued frame may
            // still be in flight, so the object must outlive its superview.
            let view = view as *mut AnyObject;
            remove_view(view);
            let _: () = msg_send![view, release];
        });
    } else {
        unsafe { remove_view(session.view) };
    }
    drop(slot);
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// Create an mpv instance with MAXplorer's playback options.
fn create_mpv(api: &'static MpvApi) -> Result<MpvHandle, AppError> {
    let handle = unsafe { (api.mpv_create)() };
    if handle.is_null() {
        return Err(perr("libmpv could not create a player instance"));
    }

    // Predictable, self-contained instance: no user config, no terminal, no OSD.
    set_option(api, handle, "config", "no");
    set_option(api, handle, "load-scripts", "no");
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
    // The SW renderer copies every frame on the CPU; if it cannot keep up, drop
    // rendered frames instead of stalling the audio clock (a frozen/blank picture
    // is what the user reads as breakage).
    set_option(api, handle, "framedrop", "vo");
    set_option(api, handle, "cache", "yes");
    set_option(api, handle, "demuxer-max-bytes", "256MiB");

    // Embed the video through the render API: the `libmpv` VO is driven by the
    // render context created right after `mpv_initialize` (render.h requires it
    // to exist before the first VO is created). Without that context, mpv opens
    // its own window instead.
    set_option(api, handle, "vo", "libmpv");

    let code = unsafe { (api.mpv_initialize)(handle) };
    if code < 0 {
        let message = format!("mpv_initialize failed: {}", mpv::error_string(api, code));
        logging::error(LOG_TARGET, &message);
        unsafe { (api.mpv_terminate_destroy)(handle) };
        return Err(perr(message));
    }

    let vo = get_property_string(api, handle, "vo");
    logging::info(
        LOG_TARGET,
        format!("mpv initialised (vo={vo:?}); video is rendered via the SW render API"),
    );

    let level = cstr(if cfg!(debug_assertions) { "v" } else { "info" });
    unsafe { (api.mpv_request_log_messages)(handle, level.as_ptr()) };
    Ok(handle)
}

fn observe(api: &MpvApi, handle: MpvHandle) {
    let props: [(u64, &str, c_int); 14] = [
        (PROP_PAUSE, "pause", mpv::MPV_FORMAT_FLAG),
        (PROP_TIME_POS, "time-pos", mpv::MPV_FORMAT_DOUBLE),
        (PROP_DURATION, "duration", mpv::MPV_FORMAT_DOUBLE),
        (PROP_EOF, "eof-reached", mpv::MPV_FORMAT_FLAG),
        (PROP_CORE_IDLE, "core-idle", mpv::MPV_FORMAT_FLAG),
        (PROP_VOLUME, "volume", mpv::MPV_FORMAT_DOUBLE),
        (PROP_MUTE, "mute", mpv::MPV_FORMAT_FLAG),
        (PROP_TITLE, "media-title", mpv::MPV_FORMAT_STRING),
        (PROP_VIDEO_FORMAT, "video-format", mpv::MPV_FORMAT_STRING),
        // Buffering feedback: a torrent-backed stream stalls constantly, and the
        // UI must be able to say so instead of looking frozen.
        (PROP_PAUSED_FOR_CACHE, "paused-for-cache", mpv::MPV_FORMAT_FLAG),
        (PROP_CACHE_PERCENT, "cache-buffering-state", mpv::MPV_FORMAT_INT64),
        (PROP_CACHE_TIME, "demuxer-cache-time", mpv::MPV_FORMAT_DOUBLE),
        (PROP_CACHE_SPEED, "cache-speed", mpv::MPV_FORMAT_INT64),
        (PROP_FILE_LOADED, "file-loaded", mpv::MPV_FORMAT_FLAG),
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
    stop: Arc<std::sync::atomic::AtomicBool>,
    generation: u64,
) -> std::thread::JoinHandle<()> {
    let handle_addr = handle as usize;
    std::thread::Builder::new()
        .name("mpv-events".into())
        .spawn(move || {
            // Raw pointers are not `Send`; carry the handle as an address.
            let handle = handle_addr as MpvHandle;
            logging::debug(LOG_TARGET, "mpv event loop started");

            // Coalescing tick: volatile properties dirty this flag, and a 250 ms
            // timer pushes at most one compact `PlayerTick` per window. That is
            // the whole fix for the per-frame full-state emit.
            let mut perf_window = std::time::Instant::now();
            let dirty = Arc::new(AtomicBool::new(false));
            let tick_stop = Arc::new(AtomicBool::new(false));
            let ticker = {
                let (tick_app, tick_shared, tick_dirty) =
                    (app.clone(), shared.clone(), dirty.clone());
                let tick_stop = tick_stop.clone();
                std::thread::Builder::new()
                    .name("mpv-ticks".into())
                    .spawn(move || {
                        let mut window = std::time::Instant::now();
                        while !tick_stop.load(Ordering::Relaxed) {
                            std::thread::sleep(TICK_INTERVAL);
                            if GENERATION.load(Ordering::SeqCst) != generation {
                                break;
                            }
                            if tick_dirty.swap(false, Ordering::Relaxed) {
                                emit_tick(&tick_app, &tick_shared);
                            }
                            if window.elapsed() >= std::time::Duration::from_secs(5) {
                                let secs = window.elapsed().as_secs_f64();
                                window = std::time::Instant::now();
                                let props = PROP_EVENTS.swap(0, Ordering::Relaxed);
                                let full = FULL_EMITS.swap(0, Ordering::Relaxed);
                                let ticks = TICK_EMITS.swap(0, Ordering::Relaxed);
                                if props + full + ticks > 0 {
                                    logging::info(
                                        "media.player.perf",
                                        format!(
                                            "state ipc: {props} mpv property events -> {full} full \
                                             + {ticks} coalesced across {secs:.1}s ({:.1} msg/s)",
                                            (full + ticks) as f64 / secs.max(0.001)
                                        ),
                                    );
                                }
                            }
                        }
                    })
                    .expect("spawn mpv tick thread")
            };
            while !stop.load(Ordering::SeqCst) {
                // Playback numbers from mpv itself, on the control thread.
                if perf_window.elapsed() >= std::time::Duration::from_secs(5) {
                    perf_window = std::time::Instant::now();
                    log_playback_perf(api, handle);
                }
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
                        PROP_EVENTS.fetch_add(1, Ordering::Relaxed);
                        // Frame-rate properties only dirty the tick; everything
                        // else is a discrete change the UI must see at once.
                        if is_volatile_property(&name) {
                            dirty.store(true, Ordering::Relaxed);
                        } else {
                            emit_state(&app, &shared);
                        }
                    }
                    mpv::MPV_EVENT_FILE_LOADED => {
                        logging::info(LOG_TARGET, "file loaded; decoding started");
                        if let Ok(mut status) = shared.lock() {
                            status.loaded = true;
                            // Set from the EVENT, not only from the observed
                            // `file-loaded` property: the event is the
                            // authoritative signal, and the UI reveals the
                            // native video surface from this flag. Missing it
                            // leaves audio playing behind a hidden surface.
                            status.file_loaded = true;
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
                                    // Hide the surface too: the UI then shows the
                                    // error card, which the native view would cover.
                                    status.file_loaded = false;
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
            tick_stop.store(true, Ordering::Relaxed);
            let _ = ticker.join();
        })
        .expect("spawn mpv event thread")
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
        "paused-for-cache" if prop.format == mpv::MPV_FORMAT_FLAG => {
            status.paused_for_cache = unsafe { *(prop.data as *const c_int) } != 0
        }
        "cache-buffering-state" if prop.format == mpv::MPV_FORMAT_INT64 => {
            status.cache_percent = unsafe { *(prop.data as *const i64) }
        }
        "demuxer-cache-time" if prop.format == mpv::MPV_FORMAT_DOUBLE => {
            status.cache_seconds = unsafe { *(prop.data as *const c_double) }
        }
        "cache-speed" if prop.format == mpv::MPV_FORMAT_INT64 => {
            status.cache_speed = unsafe { *(prop.data as *const i64) }
        }
        "file-loaded" if prop.format == mpv::MPV_FORMAT_FLAG => {
            status.file_loaded = unsafe { *(prop.data as *const c_int) } != 0
        }
        _ => {}
    }
}

fn emit_state(app: &tauri::AppHandle, shared: &Arc<Mutex<PlayerStatus>>) {
    use tauri::Emitter;
    if let Ok(status) = shared.lock() {
        FULL_EMITS.fetch_add(1, Ordering::Relaxed);
        let _ = app.emit("media-player://state", status.clone());
    }
}

/// Compact metrics event: the only thing that rides the frame rate now.
fn emit_tick(app: &tauri::AppHandle, shared: &Arc<Mutex<PlayerStatus>>) {
    use tauri::Emitter;
    if let Ok(status) = shared.lock() {
        let tick = PlayerTick {
            position: status.position,
            duration: status.duration,
            cache_percent: status.cache_percent,
            cache_seconds: status.cache_seconds,
            cache_speed: status.cache_speed,
            paused_for_cache: status.paused_for_cache,
        };
        drop(status);
        TICK_EMITS.fetch_add(1, Ordering::Relaxed);
        let _ = app.emit("media-player://tick", &tick);
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Reports whether the in-app player can run, and whether this libmpv can embed
/// video via the render API. Logged so failures are traceable.
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

    let embedding_supported = crate::render::probe(&lib.api);

    let detail = if embedding_supported {
        "libmpv supports the software render API; video is embedded in the app window.".to_string()
    } else {
        "This libmpv cannot create a software render context, so video would open in \
         mpv's own window. Reinstall mpv (`brew install mpv --HEAD`) or set \
         MAXPLORER_LIBMPV to a libmpv build with the render API."
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
    let (view_addr, width_px, height_px) = with_main_thread(&app, move || unsafe {
        let window = raw_window as *mut AnyObject;
        let rect = frame_from_css(window, x, y, width, height);
        let (width_px, height_px) = backing_size(window, x, y, width, height);
        (
            create_view(window, rect) as usize,
            width_px,
            height_px,
        )
    })?;
    if view_addr == 0 {
        return Err(perr("could not create the native video surface"));
    }
    let view = view_addr as *mut AnyObject;
    logging::debug(
        LOG_TARGET,
        format!(
            "native video surface created at 0x{view_addr:x} rect=({x},{y},{width},{height}) \
             backing={width_px}x{height_px}px"
        ),
    );

    let handle = create_mpv(api)?;
    // The render context must exist before the first `loadfile`, otherwise mpv
    // creates its own VO (and its own window) instead of rendering into our
    // surface. If it cannot be created we restore `vo=auto` so playback still
    // works in mpv's separate window, and the log says exactly why.
    let renderer = match SwRenderer::create(api, handle, app.clone(), view_addr, width_px, height_px)
    {
        Ok(renderer) => Some(renderer),
        Err(error) => {
            logging::error(
                LOG_TARGET,
                format!(
                    "render context unavailable ({error}); falling back to mpv's own window \
                     for this playback"
                ),
            );
            let (name, value) = (cstr("vo"), cstr("auto"));
            unsafe { (api.mpv_set_property_string)(handle, name.as_ptr(), value.as_ptr()) };
            None
        }
    };
    observe(api, handle);

    let shared = Arc::new(Mutex::new(PlayerStatus {
        volume: 100.0,
        title: Some(title.clone()),
        ..Default::default()
    }));
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let thread = spawn_event_loop(
        app.clone(),
        api,
        handle,
        shared.clone(),
        stop.clone(),
        generation,
    );

    {
        let mut slot = session_slot().lock().unwrap();
        *slot = Some(Session {
            api,
            handle,
            view,
            renderer,
            shared: shared.clone(),
            stop,
            thread: Some(thread),
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
    let (width_px, height_px, trace) = with_main_thread(&app, move || unsafe {
        let window = window as *mut AnyObject;
        let rect = frame_from_css(window, x, y, width, height);
        set_view_frame(view as *mut AnyObject, rect);
        let backing = backing_size(window, x, y, width, height);
        // Diagnostics for the "video is not where the stage is" class of bug:
        // the CSS rect, the content-view height used to flip it, and the frame
        // AppKit actually got. Without these numbers a mismatch is guesswork.
        let height_css = content_view_height(window);
        let flipped: bool = msg_send![view as *mut AnyObject, isFlipped];
        let trace = format!(
            "css=({x:.0},{y:.0},{width:.0},{height:.0}) content_h={height_css:.0} \
             frame=({:.0},{:.0},{:.0},{:.0}) backing=({}x{}) view_flipped={flipped}",
            rect.origin.x, rect.origin.y, rect.size.width, rect.size.height,
            backing.0, backing.1,
        );
        (backing.0, backing.1, trace)
    })?;
    logging::info(LOG_TARGET, format!("surface rect: {trace}"));
    // The surface must track the stage size, or the video is letterboxed into a
    // stale buffer after a resize.
    let slot = session_slot().lock().unwrap();
    if let Some(renderer) = slot.as_ref().and_then(|session| session.renderer.as_ref()) {
        renderer.set_size(width_px, height_px);
    }
    Ok(())
}

/// Shows/hides the native video surface. The UI hides it while loading and on
/// playback errors so the HTML spinner or error card is not covered by a black
/// rectangle (the surface sits above the webview).
#[tauri::command]
pub async fn media_player_set_surface_visible(
    app: tauri::AppHandle,
    visible: bool,
) -> Result<(), AppError> {
    let view = {
        let slot = session_slot().lock().unwrap();
        slot.as_ref().map(|session| session.view as usize)
    };
    let Some(view) = view else { return Ok(()) };
    logging::debug(
        LOG_TARGET,
        format!("native surface visibility -> {visible}"),
    );
    with_main_thread(&app, move || unsafe {
        let view = view as *mut AnyObject;
        let _: () = msg_send![view, setHidden: if visible { Bool::NO } else { Bool::YES }];
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

/// Fit vs Fill. `panscan=1` zooms the video until it covers the surface and
/// crops the overshoot; `0` is mpv's default (whole frame visible, letterboxed).
///
/// This is what an ultrawide window needs: a 16:9 source cannot fill a 2.44:1
/// window without cropping, so the choice belongs to the user per title rather
/// than baked into the layout.
#[tauri::command]
pub fn media_player_set_fill(fill: bool) -> Result<(), AppError> {
    with_session(|api, handle, _shared| {
        let code = set_property_double(api, handle, "panscan", if fill { 1.0 } else { 0.0 });
        if code < 0 {
            return Err(perr(format!(
                "could not set panscan: {}",
                mpv::error_string(api, code)
            )));
        }
        logging::info(LOG_TARGET, format!("video mode: {}", if fill { "fill" } else { "fit" }));
        Ok(())
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
        assert!(
            diagnostics.embedding_supported,
            "libmpv at {} cannot create a SW render context: {}",
            lib.path.display(),
            diagnostics.detail
        );
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

    /// Live (WP4b item 1): measures the real IPC rate of the old per-property
    /// full-state emit against the coalesced 250 ms tick, using the exact
    /// observed-property set and classifier the player runs with.
    ///
    /// `cargo test --lib live_property_event_rate -- --ignored --nocapture`
    #[test]
    #[ignore = "live: needs ffmpeg to build the fixture and libmpv to play it"]
    fn live_property_event_rate_is_coalesced() {
        use std::collections::HashSet;
        use std::time::{Duration, Instant};

        let directory = tempfile::tempdir().unwrap();
        let fixture = directory.path().join("rate.mp4");
        let Some(fixture) = fixture.to_str() else {
            return;
        };
        let built = std::process::Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=1280x720:rate=60:duration=8",
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
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
        set_option(api, handle, "vo", "null");
        set_option(api, handle, "ao", "null");
        assert!(unsafe { (api.mpv_initialize)(handle) } >= 0, "mpv_initialize failed");
        observe(api, handle);
        command(api, handle, &["loadfile", fixture, "replace"]).unwrap();

        let mut loaded = false;
        let load_deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < load_deadline && !loaded {
            let event = unsafe { (api.mpv_wait_event)(handle, 0.25) };
            if event.is_null() {
                break;
            }
            loaded = unsafe { (*event).event_id } == mpv::MPV_EVENT_FILE_LOADED;
        }
        assert!(loaded, "mpv never reported FILE_LOADED");

        // Sample 5 s of real-time playback.
        let start = Instant::now();
        let mut volatile = 0u64;
        let mut discrete = 0u64;
        let mut windows: HashSet<u128> = HashSet::new();
        while start.elapsed() < Duration::from_secs(5) {
            let event = unsafe { (api.mpv_wait_event)(handle, 0.25) };
            if event.is_null() {
                break;
            }
            if unsafe { (*event).event_id } != mpv::MPV_EVENT_PROPERTY_CHANGE {
                continue;
            }
            let data = unsafe { (*event).data as *mut MpvEventProperty };
            if data.is_null() {
                continue;
            }
            let name = cstr_to_string(unsafe { (*data).name });
            if is_volatile_property(&name) {
                volatile += 1;
                windows.insert(start.elapsed().as_millis() / 250);
            } else {
                discrete += 1;
            }
        }
        let secs = start.elapsed().as_secs_f64().max(0.001);
        let before = volatile + discrete;
        let after = windows.len() as u64 + discrete;
        eprintln!(
            "media.player.perf: {secs:.1}s of 60 fps playback -> {volatile} volatile + {discrete} \
             discrete property events ({:.0}/s)\n  before: {before} full-state IPC ({:.0}/s)\n  \
             after:  {after} messages = {:.0}/s ({:.1}% fewer)",
            before as f64 / secs,
            before as f64 / secs,
            after as f64 / secs,
            100.0 * (1.0 - after as f64 / before.max(1) as f64)
        );
        assert!(volatile > 0, "no volatile property events observed — cannot measure");
        assert!(
            after * 5 < before,
            "coalescing should cut IPC by more than 5x: {before} -> {after}"
        );

        unsafe { (api.mpv_terminate_destroy)(handle) };
    }
}
