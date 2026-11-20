//! Software-render video surface for the in-app player (Phase 4d).
//!
//! Embeds libmpv with **`MPV_RENDER_API_TYPE_SW`** — the render API rather than
//! window embedding (`wid`). mpv paints each decoded frame into a plain RGBA
//! buffer we own; we wrap that buffer in a `CGImage` and hand it to the layer of
//! a native `NSView` placed over the player stage. No GL context, no second
//! window, no platform-specific `wid` path (which does not exist on macOS).
//!
//! Threading (render.h, "Threading"): all `mpv_render_*` calls happen on one
//! dedicated render thread, fed by mpv's update callback through a condvar.
//! The callback itself never calls mpv. Presentation (CGImage → CALayer) is
//! posted to the main thread, because AppKit must not be touched elsewhere.
//!
//! Cost: one CPU copy of the frame per display update. Fine for 1080p; a 4K
//! frame is ~33 MB per frame, which is the known limitation of this backend and
//! the reason the GL backend is the planned follow-up.

use crate::logging;
use crate::mpv::{self, MpvApi, MpvHandle, MpvRenderContext, MpvRenderParam};
use objc2::msg_send;
use objc2::runtime::AnyObject;
use std::ffi::{c_int, c_void, CString};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

const LOG_TARGET: &str = "media.render";

// ── render API constants (mpv/render.h, client API 2.6) ─────────────────────
const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
const MPV_RENDER_PARAM_SW_SIZE: c_int = 17;
const MPV_RENDER_PARAM_SW_FORMAT: c_int = 18;
const MPV_RENDER_PARAM_SW_STRIDE: c_int = 19;
const MPV_RENDER_PARAM_SW_POINTER: c_int = 20;
const MPV_RENDER_UPDATE_FRAME: u64 = 1;

/// kCGImageAlphaNoneSkipLast: bytes are R,G,B,X with X ignored.
const CG_ALPHA_NONE_SKIP_LAST: u32 = 5;

// ── CoreGraphics FFI (no extra crate: CoreGraphics is a system framework) ────
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGDataProviderCreateWithData(
        info: *mut c_void,
        data: *const c_void,
        size: usize,
        release: Option<unsafe extern "C" fn(*mut c_void, *const c_void, usize)>,
    ) -> *mut c_void;
    fn CGDataProviderRelease(provider: *mut c_void);
    fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
    fn CGColorSpaceRelease(space: *mut c_void);
    fn CGImageCreate(
        width: usize,
        height: usize,
        bits_per_component: usize,
        bits_per_pixel: usize,
        bytes_per_row: usize,
        space: *mut c_void,
        bitmap_info: u32,
        provider: *mut c_void,
        decode: *const c_void,
        should_interpolate: bool,
        intent: c_int,
    ) -> *mut c_void;
    fn CGImageRelease(image: *mut c_void);
}

unsafe extern "C" fn release_snapshot(info: *mut c_void, _data: *const c_void, _size: usize) {
    if !info.is_null() {
        // Reclaim the Box<Vec<u8>> allocated in `present`.
        drop(unsafe { Box::from_raw(info as *mut Vec<u8>) });
    }
}

// ── Frame buffer ────────────────────────────────────────────────────────────

/// An aligned RGBA ("rgb0") surface mpv renders into.
///
/// `stride` is rounded up to 64 bytes: render.h asks for pointer *and* stride to
/// be 64-byte aligned, otherwise mpv may copy the whole frame or use slow paths.
pub struct FrameBuffer {
    ptr: *mut u8,
    len: usize,
    layout: std::alloc::Layout,
    pub width: u32,
    pub height: u32,
    pub stride: usize,
}

// The buffer is only used behind the surface mutex.
unsafe impl Send for FrameBuffer {}

impl FrameBuffer {
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        if width == 0 || height == 0 {
            return Err("frame surface has zero size".into());
        }
        let stride = ((width as usize * 4) + 63) / 64 * 64;
        let len = stride * height as usize;
        let layout = std::alloc::Layout::from_size_align(len, 64)
            .map_err(|error| format!("invalid frame layout: {error}"))?;
        let ptr = unsafe { std::alloc::alloc_zeroed(layout) };
        if ptr.is_null() {
            return Err("out of memory allocating the video surface".into());
        }
        Ok(Self {
            ptr,
            len,
            layout,
            width,
            height,
            stride,
        })
    }

    fn as_mut_ptr(&mut self) -> *mut u8 {
        self.ptr
    }

    fn snapshot(&self) -> Vec<u8> {
        unsafe { std::slice::from_raw_parts(self.ptr, self.len).to_vec() }
    }

    /// Count pixels whose RGB is not black — the headless proof that mpv
    /// actually painted something into the surface.
    #[cfg(test)]
    pub fn non_black_pixels(&self) -> usize {
        let bytes = unsafe { std::slice::from_raw_parts(self.ptr, self.len) };
        let mut count = 0;
        for row in 0..self.height as usize {
            let start = row * self.stride;
            for column in 0..self.width as usize {
                let pixel = &bytes[start + column * 4..start + column * 4 + 3];
                if pixel.iter().any(|&channel| channel > 8) {
                    count += 1;
                }
            }
        }
        count
    }
}

impl Drop for FrameBuffer {
    fn drop(&mut self) {
        unsafe { std::alloc::dealloc(self.ptr, self.layout) };
    }
}

// ── Shared state between the mpv callback, the render thread and the UI ─────

struct Signal {
    pending: u64,
    redraw: bool,
    stop: bool,
}

struct Shared {
    app: tauri::AppHandle,
    view: usize,
    signal: Mutex<Signal>,
    wake: Condvar,
    /// The surface mpv paints into; `None` while the stage has no usable size.
    surface: Mutex<Option<FrameBuffer>>,
    rendered: AtomicU64,
    present_failed: AtomicBool,
}

/// The update callback mpv invokes when a new frame (or a reconfigure) is ready.
/// Must not call any mpv API — it only bumps the counter and wakes the render
/// thread.
unsafe extern "C" fn on_update(callback_ctx: *mut c_void) {
    if callback_ctx.is_null() {
        return;
    }
    let shared = unsafe { &*(callback_ctx as *const Shared) };
    if let Ok(mut signal) = shared.signal.lock() {
        if signal.stop {
            return;
        }
        signal.pending = signal.pending.saturating_add(1);
        shared.wake.notify_one();
    }
}

// ── The renderer ────────────────────────────────────────────────────────────

/// Owns mpv's SW render context and the thread that drives it.
pub struct SwRenderer {
    api: &'static MpvApi,
    ctx: MpvRenderContext,
    /// `Arc` handed to mpv as the callback context; reclaimed in `Drop`.
    shared: Arc<Shared>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl SwRenderer {
    /// Create the render context. **Must be called after `mpv_initialize` and
    /// before the first `loadfile`**, otherwise mpv creates its own VO/window
    /// before a render context exists and the video never reaches our surface.
    ///
    /// `width`/`height` are in backing pixels (points × scale factor).
    pub fn create(
        api: &'static MpvApi,
        handle: MpvHandle,
        app: tauri::AppHandle,
        view: usize,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        let surface = FrameBuffer::new(width, height)?;
        let shared = Arc::new(Shared {
            app,
            view,
            signal: Mutex::new(Signal {
                pending: 0,
                redraw: true,
                stop: false,
            }),
            wake: Condvar::new(),
            surface: Mutex::new(Some(surface)),
            rendered: AtomicU64::new(0),
            present_failed: AtomicBool::new(false),
        });

        let api_type = CString::new("sw").unwrap();
        let mut params = [
            MpvRenderParam {
                type_: MPV_RENDER_PARAM_API_TYPE,
                data: api_type.as_ptr() as *mut c_void,
            },
            MpvRenderParam {
                type_: 0,
                data: ptr::null_mut(),
            },
        ];
        let mut ctx: MpvRenderContext = ptr::null_mut();
        let code =
            unsafe { (api.mpv_render_context_create)(&mut ctx, handle, params.as_mut_ptr()) };
        if code < 0 || ctx.is_null() {
            return Err(format!(
                "mpv_render_context_create(sw) failed: {}",
                mpv::error_string(api, code)
            ));
        }
        logging::info(
            LOG_TARGET,
            format!("render API (sw) initialised at {width}x{height} px"),
        );

        // The callback context is a raw Arc pointer: the Arc itself is kept in
        // `self.shared` and outlives the context (cleared in `stop`).
        let callback_ctx = Arc::as_ptr(&shared) as *mut c_void;
        unsafe {
            (api.mpv_render_context_set_update_callback)(ctx, Some(on_update), callback_ctx)
        };

        let ctx_addr = ctx as usize;
        let thread_shared = shared.clone();
        let thread = std::thread::Builder::new()
            .name("mpv-render".into())
            .spawn(move || render_loop(api, ctx_addr as MpvRenderContext, thread_shared))
            .map_err(|error| format!("could not start the render thread: {error}"))?;

        Ok(Self {
            api,
            ctx,
            shared,
            thread: Some(thread),
        })
    }

    /// Resize the surface (called when the UI stage moves/resizes).
    pub fn set_size(&self, width: u32, height: u32) {
        let mut surface = match self.shared.surface.lock() {
            Ok(surface) => surface,
            Err(_) => return,
        };
        let same = surface
            .as_ref()
            .map(|buffer| buffer.width == width && buffer.height == height)
            .unwrap_or(false);
        if same {
            return;
        }
        match FrameBuffer::new(width, height) {
            Ok(buffer) => {
                logging::debug(
                    LOG_TARGET,
                    format!("render surface resized to {width}x{height} px"),
                );
                *surface = Some(buffer);
                drop(surface);
                if let Ok(mut signal) = self.shared.signal.lock() {
                    signal.redraw = true;
                    self.shared.wake.notify_one();
                }
            }
            Err(error) => logging::warn(LOG_TARGET, format!("resize failed: {error}")),
        }
    }

    /// Stop the render thread and destroy the render context.
    ///
    /// Order is load-bearing: detach the callback first (it must never run while
    /// the context is being freed), then join the thread, then free the context.
    /// `mpv_render_context_free` must itself happen before `mpv_terminate_destroy`.
    pub fn stop(mut self) {
        // Detach the callback so a late mpv wakeup cannot touch `shared`.
        unsafe {
            (self.api.mpv_render_context_set_update_callback)(self.ctx, None, ptr::null_mut())
        };
        if let Ok(mut signal) = self.shared.signal.lock() {
            signal.stop = true;
            self.shared.wake.notify_all();
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        unsafe { (self.api.mpv_render_context_free)(self.ctx) };
        self.ctx = ptr::null_mut();
        logging::info(
            LOG_TARGET,
            format!(
                "renderer stopped after {} frames",
                self.shared.rendered.load(Ordering::Relaxed)
            ),
        );
    }
}

// ── Render loop ─────────────────────────────────────────────────────────────

fn render_loop(api: &'static MpvApi, ctx: MpvRenderContext, shared: Arc<Shared>) {
    logging::debug(LOG_TARGET, "render thread started");
    // Periodic fps log: proves whether the SW path keeps up with the source, which
    // is the difference between "video is broken" and "CPU scaling is too slow".
    let mut last_report = std::time::Instant::now();
    let mut frames_since_report: u64 = 0;
    loop {
        {
            let mut signal = match shared.signal.lock() {
                Ok(signal) => signal,
                Err(_) => break,
            };
            loop {
                if signal.stop {
                    return;
                }
                if signal.pending > 0 || signal.redraw {
                    break;
                }
                signal = match shared.wake.wait_timeout(signal, Duration::from_millis(500)) {
                    Ok((signal, _)) => signal,
                    Err(_) => return,
                };
            }
            signal.pending = 0;
            signal.redraw = false;
        }

        let flags = unsafe { (api.mpv_render_context_update)(ctx) };
        if flags & MPV_RENDER_UPDATE_FRAME == 0 {
            // No new frame; the surface may still need a repaint after a resize.
            // `mpv_render_context_render` redraws the last frame, so proceed.
        }

        match render_frame(api, ctx, &shared) {
            Ok(Some((pixels, width, height, stride))) => {
                shared.rendered.fetch_add(1, Ordering::Relaxed);
                frames_since_report += 1;
                if last_report.elapsed() >= Duration::from_secs(5) {
                    let elapsed = last_report.elapsed().as_secs_f64();
                    logging::info(
                        LOG_TARGET,
                        format!(
                            "render: {:.1} fps at {width}x{height} px ({:.1} MB/frame)",
                            frames_since_report as f64 / elapsed,
                            (stride * height as usize) as f64 / (1024.0 * 1024.0)
                        ),
                    );
                    last_report = std::time::Instant::now();
                    frames_since_report = 0;
                }
                let view = shared.view;
                let app = shared.app.clone();
                let failed = shared.present_failed.load(Ordering::Relaxed);
                if let Err(error) = app.run_on_main_thread(move || unsafe {
                    if !present(view, pixels, width, height, stride) && !failed {
                        logging::warn(LOG_TARGET, "could not present the video frame to the layer");
                    }
                }) {
                    logging::warn(LOG_TARGET, format!("present dispatch failed: {error}"));
                }
            }
            Ok(None) => {}
            Err(error) => {
                logging::error(LOG_TARGET, format!("render failed: {error}"));
                shared.present_failed.store(true, Ordering::Relaxed);
            }
        }
    }
}

/// Render one frame into the surface and snapshot it for presentation.
fn render_frame(
    api: &MpvApi,
    ctx: MpvRenderContext,
    shared: &Shared,
) -> Result<Option<(Vec<u8>, u32, u32, usize)>, String> {
    let mut surface = shared
        .surface
        .lock()
        .map_err(|_| "surface mutex poisoned".to_string())?;
    let Some(buffer) = surface.as_mut() else {
        return Ok(None);
    };
    let (width, height, stride) = (buffer.width, buffer.height, buffer.stride);
    render_into(api, ctx, buffer)?;
    Ok(Some((buffer.snapshot(), width, height, stride)))
}

/// One `mpv_render_context_render` into `buffer` (SW backend params only).
pub(crate) fn render_into(
    api: &MpvApi,
    ctx: MpvRenderContext,
    buffer: &mut FrameBuffer,
) -> Result<(), String> {
    let mut size: [c_int; 2] = [buffer.width as c_int, buffer.height as c_int];
    let format = CString::new("rgb0").unwrap();
    let mut stride = buffer.stride;
    let params = [
        MpvRenderParam {
            type_: MPV_RENDER_PARAM_SW_SIZE,
            data: size.as_mut_ptr() as *mut c_void,
        },
        MpvRenderParam {
            type_: MPV_RENDER_PARAM_SW_FORMAT,
            data: format.as_ptr() as *mut c_void,
        },
        MpvRenderParam {
            type_: MPV_RENDER_PARAM_SW_STRIDE,
            data: &mut stride as *mut usize as *mut c_void,
        },
        MpvRenderParam {
            type_: MPV_RENDER_PARAM_SW_POINTER,
            data: buffer.as_mut_ptr() as *mut c_void,
        },
        MpvRenderParam {
            type_: 0,
            data: ptr::null_mut(),
        },
    ];
    let code = unsafe { (api.mpv_render_context_render)(ctx, params.as_ptr() as *mut _) };
    if code < 0 {
        return Err(mpv::error_string(api, code));
    }
    Ok(())
}

/// Wrap the RGBA snapshot in a CGImage and make it the view layer's contents.
/// Must run on the main thread (AppKit/CALayer).
unsafe fn present(view: usize, pixels: Vec<u8>, width: u32, height: u32, stride: usize) -> bool {
    if view == 0 || width == 0 || height == 0 {
        return false;
    }
    let boxed = Box::new(pixels);
    let data = boxed.as_ptr() as *const c_void;
    let size = stride * height as usize;
    let info = Box::into_raw(boxed) as *mut c_void;
    let provider = CGDataProviderCreateWithData(info, data, size, Some(release_snapshot));
    if provider.is_null() {
        drop(Box::from_raw(info as *mut Vec<u8>));
        return false;
    }
    let space = CGColorSpaceCreateDeviceRGB();
    let image = CGImageCreate(
        width as usize,
        height as usize,
        8,
        32,
        stride,
        space,
        CG_ALPHA_NONE_SKIP_LAST,
        provider,
        ptr::null(),
        false,
        0,
    );
    CGDataProviderRelease(provider);
    CGColorSpaceRelease(space);
    if image.is_null() {
        return false;
    }

    let view = view as *mut AnyObject;
    let layer: *mut AnyObject = msg_send![view, layer];
    if layer.is_null() {
        CGImageRelease(image);
        return false;
    }
    // CALayer retains its contents, so releasing our CGImage afterwards is safe.
    let _: () = msg_send![layer, setContents: image as *mut AnyObject];
    CGImageRelease(image);
    true
}

// ── Capability probe ────────────────────────────────────────────────────────

/// Does this libmpv support the SW render API? Probed on a throwaway core, so a
/// failure is diagnosable instead of silent.
///
/// Deliberately NOT `mpv_set_option("wid")`: setting that returns success on
/// macOS even though the NSView `wid` feature was never merged, which is a false
/// positive (video then opens in mpv's own window).
pub fn probe(api: &'static MpvApi) -> bool {
    unsafe {
        let probe = (api.mpv_create)();
        if probe.is_null() {
            return false;
        }
        for (name, value) in [
            ("config", "no"),
            ("terminal", "no"),
            ("vo", "libmpv"),
            ("ao", "null"),
        ] {
            let (n, v) = (CString::new(name).unwrap(), CString::new(value).unwrap());
            (api.mpv_set_option_string)(probe, n.as_ptr(), v.as_ptr());
        }
        let initialised = (api.mpv_initialize)(probe) >= 0;
        let mut ok = false;
        if initialised {
            let api_type = CString::new("sw").unwrap();
            let mut params = [
                MpvRenderParam {
                    type_: MPV_RENDER_PARAM_API_TYPE,
                    data: api_type.as_ptr() as *mut c_void,
                },
                MpvRenderParam {
                    type_: 0,
                    data: ptr::null_mut(),
                },
            ];
            let mut ctx: MpvRenderContext = ptr::null_mut();
            let code = (api.mpv_render_context_create)(&mut ctx, probe, params.as_mut_ptr());
            if code >= 0 && !ctx.is_null() {
                (api.mpv_render_context_free)(ctx);
                ok = true;
            }
        }
        (api.mpv_terminate_destroy)(probe);
        ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live headless proof that the SW render path paints real pixels: builds a
    /// tiny H.264/AC3 MKV, plays it through libmpv, renders into our surface, and
    /// requires a substantial number of non-black pixels. This is the acceptance
    /// gate for "the video is embedded", and it needs no window at all.
    /// `cargo test --lib live_sw_render_paints_pixels -- --ignored --nocapture`
    #[test]
    #[ignore = "live: needs ffmpeg to build a fixture and libmpv to play it"]
    fn live_sw_render_paints_pixels() {
        use crate::mpv;
        use std::time::{Duration, Instant};

        let directory = tempfile::tempdir().unwrap();
        let fixture = directory.path().join("fixture.mkv");
        let Some(fixture) = fixture.to_str() else {
            return;
        };
        let built = std::process::Command::new("ffmpeg")
            .args([
                "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "ac3", "-b:a", "128k",
                fixture,
            ])
            .status();
        match built {
            Ok(status) if status.success() => {}
            _ => {
                eprintln!("ffmpeg unavailable; skipping");
                return;
            }
        }

        let lib = mpv::libmpv().expect("libmpv should load");
        let api = &lib.api;
        let handle = unsafe { (api.mpv_create)() };
        assert!(!handle.is_null());
        let set = |name: &str, value: &str| {
            let (n, v) = (CString::new(name).unwrap(), CString::new(value).unwrap());
            unsafe { (api.mpv_set_option_string)(handle, n.as_ptr(), v.as_ptr()) };
        };
        set("config", "no");
        set("terminal", "no");
        set("vo", "libmpv");
        set("ao", "null");
        set("keep-open", "no");
        let code = unsafe { (api.mpv_initialize)(handle) };
        assert!(code >= 0, "mpv_initialize failed");

        let api_type = CString::new("sw").unwrap();
        let mut params = [
            MpvRenderParam {
                type_: MPV_RENDER_PARAM_API_TYPE,
                data: api_type.as_ptr() as *mut c_void,
            },
            MpvRenderParam {
                type_: 0,
                data: ptr::null_mut(),
            },
        ];
        let mut ctx: MpvRenderContext = ptr::null_mut();
        let ctx_code =
            unsafe { (api.mpv_render_context_create)(&mut ctx, handle, params.as_mut_ptr()) };
        assert!(ctx_code >= 0, "render context failed: {}", mpv::error_string(api, ctx_code));

        let mut buffer = FrameBuffer::new(320, 240).unwrap();
        let load = {
            let (cmd, path) = (CString::new("loadfile").unwrap(), CString::new(fixture).unwrap());
            let args = [cmd.as_ptr(), path.as_ptr(), ptr::null()];
            unsafe { (api.mpv_command)(handle, args.as_ptr()) }
        };
        assert!(load >= 0, "loadfile failed");

        let deadline = Instant::now() + Duration::from_secs(20);
        let mut loaded = false;
        let mut best = 0usize;
        while Instant::now() < deadline {
            let event = unsafe { (api.mpv_wait_event)(handle, 0.05) };
            if !event.is_null() && unsafe { (*event).event_id } == mpv::MPV_EVENT_FILE_LOADED {
                loaded = true;
            }
            if loaded {
                let flags = unsafe { (api.mpv_render_context_update)(ctx) };
                if flags & MPV_RENDER_UPDATE_FRAME != 0 {
                    render_into(api, ctx, &mut buffer).expect("render failed");
                    best = best.max(buffer.non_black_pixels());
                    if best > 1000 {
                        break;
                    }
                } else {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
        println!("sw render: file_loaded={loaded} non_black_pixels={best}");
        unsafe { (api.mpv_render_context_free)(ctx) };
        unsafe { (api.mpv_terminate_destroy)(handle) };
        assert!(loaded, "mpv never loaded the fixture");
        assert!(
            best > 1000,
            "the software render surface stayed essentially black ({best} px)"
        );
    }

    #[test]
    fn frame_buffer_stride_is_64_byte_aligned() {
        let buffer = FrameBuffer::new(333, 7).unwrap();
        assert_eq!(buffer.stride % 64, 0);
        assert!(buffer.stride >= 333 * 4);
        assert_eq!(buffer.non_black_pixels(), 0);
    }
}