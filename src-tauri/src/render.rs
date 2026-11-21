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
//! Cost: **zero copies of the frame**. mpv renders into one of a 5-buffer ring
//! of `rgb0` surfaces and each frame's `CGImage` is created directly over that
//! raw memory (`CGDataProviderCreateWithData`, no release callback). A buffer is
//! only handed back to mpv once its image has been replaced on the layer by at
//! least two newer frames, so the compositor never sees memory that is being
//! overwritten. The ring is capped at [`TARGET_MAX_WIDTH`] and the CALayer
//! upscales the smaller image, which keeps the CPU scale cost bounded on a
//! ultrawide stage. Before this ring existed every frame was `memcpy`'d
//! (`Vec::to_vec`, ~23 MB at 3416×1700) and wrapped in a fresh provider, which is
//! why `framedrop=vo` was needed to keep A/V in sync.

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

// ── Frame buffer ring ───────────────────────────────────────────────────────

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

// The buffer is only used behind a slot mutex / the ring's free-list discipline.
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

    /// Raw base pointer, for a zero-copy `CGImage` over the surface.
    fn data_ptr(&self) -> *const u8 {
        self.ptr
    }

    fn byte_len(&self) -> usize {
        self.len
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

/// How many surfaces mpv alternates between.
///
/// Budget: one being rendered + `RELEASE_LAG` still inside the recycle grace +
/// the presenter's own lag. Five covers a presenter two frames behind with one
/// spare; four (the first cut) left **zero** slack, so every present that landed
/// a frame late cost a rendered frame — measured 24 fps → 4–6 fps with ~50 % of
/// frames dropped.
const RING_SIZE: usize = 5;

/// How many presentation steps a slot stays out of the free list. The image just
/// replaced may still be in flight in Core Animation, so a buffer is only handed
/// back to mpv once two newer frames have replaced it on the layer.
const RELEASE_LAG: usize = 2;

/// How long the render thread waits for a slot before dropping the frame.
const ACQUIRE_TIMEOUT: Duration = Duration::from_millis(40);

/// Widest surface mpv renders into (WP4b item 3).
///
/// The NSView stays the full stage size — `CALayer.contentsGravity` defaults to
/// resize, so the layer upscales this smaller image for free. A 3416 px ultrawide
/// stage therefore costs 2560×~1049 (~10.7 MB/frame) instead of 3416×1700 (~22 MB),
/// and the SW VO's CPU scale work drops by the same ratio. mpv rasterises subtitles
/// into this buffer, so if they look soft raise the cap rather than adding a second
/// render pass.
const TARGET_MAX_WIDTH: u32 = 2560;

/// Clamp a backing-pixel size to [`TARGET_MAX_WIDTH`], preserving aspect ratio.
fn cap_target(width: u32, height: u32) -> (u32, u32) {
    if width == 0 || height == 0 || width <= TARGET_MAX_WIDTH {
        return (width, height);
    }
    let scaled = (height as u64 * TARGET_MAX_WIDTH as u64 / width as u64) as u32;
    (TARGET_MAX_WIDTH, scaled.max(1))
}

/// The ring of surfaces mpv renders into.
///
/// Ownership is **consumer-driven**: the render thread takes a slot from `free`,
/// and the main thread returns it (`Frame::drop` → `release`) after it has set
/// that image as the layer's contents. `recent` implements the recycle grace.
/// This replaced a producer-side guess (`presented_seq` vs a frame counter) that
/// could not tell a busy buffer from a merely-1-frame-behind presenter.
struct Ring {
    /// Each slot is a `Mutex` purely for interior mutability: only the thread
    /// holding the index off `free` touches it, so it is never contended.
    slots: Vec<Mutex<FrameBuffer>>,
    /// Indices mpv may render into right now (FIFO, so every buffer rotates in).
    free: Mutex<std::collections::VecDeque<usize>>,
    /// Slots presented but still inside the recycle grace.
    recent: Mutex<std::collections::VecDeque<usize>>,
    /// Wakes the render thread when a slot comes back.
    released: Condvar,
}

impl Ring {
    fn new(width: u32, height: u32) -> Result<Self, String> {
        let mut slots = Vec::with_capacity(RING_SIZE);
        for _ in 0..RING_SIZE {
            slots.push(Mutex::new(FrameBuffer::new(width, height)?));
        }
        Ok(Self {
            slots,
            free: Mutex::new((0..RING_SIZE).collect()),
            recent: Mutex::new(std::collections::VecDeque::new()),
            released: Condvar::new(),
        })
    }

    fn geometry(&self) -> (u32, u32) {
        self.slots
            .first()
            .and_then(|slot| slot.lock().ok())
            .map(|buffer| (buffer.width, buffer.height))
            .unwrap_or((0, 0))
    }

    /// Take a slot for rendering, waiting briefly for the presenter to return one.
    /// `None` means the presenter is genuinely behind (all buffers busy).
    fn acquire(&self) -> Option<usize> {
        let mut free = self.free.lock().ok()?;
        if let Some(index) = free.pop_front() {
            return Some(index);
        }
        let (mut free, _) = self.released.wait_timeout(free, ACQUIRE_TIMEOUT).ok()?;
        free.pop_front()
    }

    /// Return a slot after its image has been replaced on the layer.
    fn release(&self, index: usize) {
        let Ok(mut recent) = self.recent.lock() else {
            return;
        };
        recent.push_back(index);
        while recent.len() > RELEASE_LAG {
            let oldest = recent.pop_front();
            if let (Some(oldest), Ok(mut free)) = (oldest, self.free.lock()) {
                free.push_back(oldest);
            }
            self.released.notify_one();
        }
    }

    /// Return a slot whose image never reached the layer (render error, dropped
    /// dispatch) — no grace needed.
    fn release_now(&self, index: usize) {
        if let Ok(mut free) = self.free.lock() {
            free.push_back(index);
        }
        self.released.notify_one();
    }

    #[cfg(test)]
    fn free_count(&self) -> usize {
        self.free.lock().map(|free| free.len()).unwrap_or(0)
    }
}

/// One rendered frame awaiting presentation.
///
/// Holding `ring` keeps the surface memory alive while the main thread wraps the
/// raw pointer in a `CGImage`; dropping the `Frame` returns the slot, so a resize
/// in between cannot free memory that is still being read.
struct Frame {
    ring: Arc<Ring>,
    index: usize,
    /// Base pointer of the slot's pixels (raw: no `Send` on a pointer field).
    data: usize,
    width: u32,
    height: u32,
    stride: usize,
    seq: u64,
}

impl Drop for Frame {
    fn drop(&mut self) {
        self.ring.release(self.index);
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
    /// The ring mpv paints into; `None` until the stage has a usable size.
    ring: Mutex<Option<Arc<Ring>>>,
    /// Monotonic rendered-frame sequence, used for the lease/lag telemetry.
    frame_seq: AtomicU64,
    /// Highest sequence whose image has been handed to the layer.
    presented_seq: AtomicU64,
    /// Frames not rendered because every buffer was still owned by the presenter.
    dropped_frames: AtomicU64,
    /// Time spent inside `mpv_render_context_render`, in nanoseconds.
    render_nanos: AtomicU64,
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
        let (width, height) = cap_target(width, height);
        let ring = Arc::new(Ring::new(width, height)?);
        let shared = Arc::new(Shared {
            app,
            view,
            signal: Mutex::new(Signal {
                pending: 0,
                redraw: true,
                stop: false,
            }),
            wake: Condvar::new(),
            ring: Mutex::new(Some(ring)),
            frame_seq: AtomicU64::new(0),
            presented_seq: AtomicU64::new(0),
            dropped_frames: AtomicU64::new(0),
            render_nanos: AtomicU64::new(0),
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

    /// Resize the ring (called when the UI stage moves/resizes).
    ///
    /// The old buffers are dropped only once their queued presentation closures
    /// finish — those closures hold an `Arc` to the buffer they are presenting,
    /// so a resize cannot free memory the main thread is still reading.
    pub fn set_size(&self, width: u32, height: u32) {
        // Compare the *capped* geometry: the stage sends raw backing pixels on every
        // resize tick, and comparing those would reallocate the whole ring even when
        // the capped target did not change (item 3).
        let (width, height) = cap_target(width, height);
        let mut ring = match self.shared.ring.lock() {
            Ok(ring) => ring,
            Err(_) => return,
        };
        let same = ring
            .as_ref()
            .map(|ring| ring.geometry() == (width, height))
            .unwrap_or(false);
        if same {
            return;
        }
        match Ring::new(width, height) {
            Ok(fresh) => {
                logging::debug(
                    LOG_TARGET,
                    format!(
                        "render ring resized to {width}x{height} px ({RING_SIZE} x {:.1} MB)",
                        (fresh.slots[0]
                            .lock()
                            .map(|buffer| buffer.byte_len())
                            .unwrap_or(0) as f64)
                            / (1024.0 * 1024.0)
                    ),
                );
                *ring = Some(Arc::new(fresh));
                drop(ring);
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
            Ok(Some(frame)) => {
                shared.rendered.fetch_add(1, Ordering::Relaxed);
                frames_since_report += 1;
                if last_report.elapsed() >= Duration::from_secs(5) {
                    let elapsed = last_report.elapsed().as_secs_f64();
                    let nanos = shared.render_nanos.swap(0, Ordering::Relaxed);
                    let render_ms = if frames_since_report > 0 {
                        nanos as f64 / 1_000_000.0 / frames_since_report as f64
                    } else {
                        0.0
                    };
                    logging::info(
                        LOG_TARGET,
                        format!(
                            "render: {:.1} fps at {}x{} px ({:.1} MB/frame, zero-copy), \
                             {:.1} ms/frame in mpv, {} dropped (all buffers busy), lag {}",
                            frames_since_report as f64 / elapsed,
                            frame.width,
                            frame.height,
                            (frame.stride * frame.height as usize) as f64 / (1024.0 * 1024.0),
                            render_ms,
                            shared.dropped_frames.load(Ordering::Relaxed),
                            shared
                                .frame_seq
                                .load(Ordering::Relaxed)
                                .saturating_sub(shared.presented_seq.load(Ordering::Relaxed)),
                        ),
                    );
                    last_report = std::time::Instant::now();
                    frames_since_report = 0;
                }
                let view = shared.view;
                let app = shared.app.clone();
                let failed = shared.present_failed.load(Ordering::Relaxed);
                let seq = frame.seq;
                // `frame` carries the ring, so the pixels stay valid until the main
                // thread has set them as the layer's contents — and dropping it is
                // what returns the slot to the ring (two-frame recycle grace).
                let presented = shared.clone();
                if let Err(error) = app.run_on_main_thread(move || unsafe {
                    if present(view, &frame) {
                        presented.presented_seq.fetch_max(seq, Ordering::AcqRel);
                    } else if !failed {
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

/// Render one frame into a free ring slot.
///
/// `Ok(None)` means "nothing rendered this round": no surface yet, or every
/// buffer was still owned by the presenter after a short wait. Dropping is the
/// right move there — rendering into a slot still on screen would tear, and
/// `acquire` already waited for a release, so a drop is real backpressure.
fn render_frame(
    api: &MpvApi,
    ctx: MpvRenderContext,
    shared: &Shared,
) -> Result<Option<Frame>, String> {
    let ring = {
        let guard = shared
            .ring
            .lock()
            .map_err(|_| "ring mutex poisoned".to_string())?;
        match guard.as_ref() {
            Some(ring) => Arc::clone(ring),
            None => return Ok(None),
        }
    };
    let Some(index) = ring.acquire() else {
        shared.dropped_frames.fetch_add(1, Ordering::Relaxed);
        return Ok(None);
    };
    let mut slot = match ring.slots[index].lock() {
        Ok(slot) => slot,
        Err(_) => {
            ring.release_now(index);
            return Err("slot mutex poisoned".into());
        }
    };
    let (width, height, stride) = (slot.width, slot.height, slot.stride);
    let started = std::time::Instant::now();
    let rendered = render_into(api, ctx, &mut slot);
    shared.render_nanos.fetch_add(
        started.elapsed().as_nanos() as u64,
        Ordering::Relaxed,
    );
    let data = slot.data_ptr() as usize;
    drop(slot);
    if let Err(error) = rendered {
        ring.release_now(index);
        return Err(error);
    }
    let seq = shared.frame_seq.fetch_add(1, Ordering::Relaxed) + 1;
    Ok(Some(Frame {
        ring,
        index,
        data,
        width,
        height,
        stride,
        seq,
    }))
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

/// Wrap the frame's raw surface in a CGImage and make it the layer's contents.
///
/// **Zero copy**: the provider is created directly over the ring buffer with no
/// release callback, so Core Graphics reads mpv's pixels in place. Ownership is
/// handled by the ring lease (`Slot::seq` vs `Shared::presented_seq`) — a buffer
/// is not re-rendered while an image made from it can still be composited.
///
/// Must run on the main thread (AppKit/CALayer).
unsafe fn present(view: usize, frame: &Frame) -> bool {
    let (width, height, stride) = (frame.width as usize, frame.height as usize, frame.stride);
    if view == 0 || width == 0 || height == 0 {
        return false;
    }
    let data = frame.data as *const c_void;
    let size = stride * height;
    let provider = CGDataProviderCreateWithData(ptr::null_mut(), data, size, None);
    if provider.is_null() {
        return false;
    }
    let space = CGColorSpaceCreateDeviceRGB();
    let image = CGImageCreate(
        width,
        height,
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

    /// Item 3's contract: the render target is capped by width, aspect preserved,
    /// and an already-capped (or smaller) request is returned untouched — that
    /// last part is what keeps `set_size` idempotent across resize ticks.
    #[test]
    fn render_target_is_capped_by_width_keeping_aspect() {
        assert_eq!(cap_target(3416, 1700), (2560, 1274));
        assert_eq!(cap_target(3440, 1410), (2560, 1049));
        // At or under the cap nothing changes (a windowed stage stays 1:1).
        assert_eq!(cap_target(1920, 1080), (1920, 1080));
        assert_eq!(cap_target(TARGET_MAX_WIDTH, 720), (TARGET_MAX_WIDTH, 720));
        // Capping is idempotent — a resize tick cannot reallocate the ring.
        let (w, h) = cap_target(5120, 2160);
        assert_eq!(cap_target(w, h), (w, h));
        assert_eq!(w, TARGET_MAX_WIDTH);
        // Degenerate sizes are passed through for the caller to reject.
        assert_eq!(cap_target(0, 0), (0, 0));
    }

    /// The ring's contract: the renderer can only take a slot the presenter has
    /// returned, and a presented slot is held for `RELEASE_LAG` presents before it
    /// comes back. This is the part that was wrong in the first cut (a producer-side
    /// counter with no slack dropped half the frames).
    #[test]
    fn ring_returns_slots_only_after_the_release_lag() {
        let ring = Ring::new(64, 48).unwrap();
        assert_eq!(ring.free_count(), RING_SIZE);

        let indices: Vec<usize> = (0..RING_SIZE).map(|_| ring.acquire().unwrap()).collect();
        assert_eq!(ring.free_count(), 0, "all buffers are out with mpv");
        assert!(ring.acquire().is_none(), "nothing left to render into");

        // Present them in order: the slot stays out of the ring for RELEASE_LAG
        // presents, then comes back.
        ring.release(indices[0]);
        assert_eq!(ring.free_count(), 0, "one present is not enough");
        ring.release(indices[1]);
        assert_eq!(ring.free_count(), 0, "the grace is not satisfied yet");
        ring.release(indices[2]);
        assert_eq!(ring.free_count(), 1, "the first slot is now recyclable");

        // A frame whose image never reached the layer comes back at once.
        ring.release_now(indices[3]);
        assert_eq!(ring.free_count(), 2);
    }

    #[test]
    fn ring_absorbs_a_presenter_lagging_one_or_two_frames() {
        // The regression this guards: the first cut refused a buffer whenever the
        // presenter was one frame behind — which is *always* — and playback fell from
        // 24 fps to 4–6 fps with half the frames dropped.
        for lag in 1..=RELEASE_LAG {
            let ring = Ring::new(16, 16).unwrap();
            let mut in_flight: Vec<usize> = Vec::new();
            let mut acquired = 0;
            for step in 0..60 {
                let Some(index) = ring.acquire() else {
                    panic!("dropped a frame at presenter lag {lag} on step {step}");
                };
                acquired += 1;
                in_flight.push(index);
                if in_flight.len() > lag {
                    let oldest = in_flight.remove(0);
                    ring.release(oldest);
                }
            }
            assert_eq!(acquired, 60, "lag {lag}: every frame got a buffer");
        }
    }

    #[test]
    fn ring_allocates_one_surface_per_slot() {
        let ring = Ring::new(333, 7).unwrap();
        assert_eq!(ring.slots.len(), RING_SIZE);
        assert_eq!(ring.geometry(), (333, 7));
        let addresses: std::collections::HashSet<usize> = ring
            .slots
            .iter()
            .map(|slot| slot.lock().unwrap().data_ptr() as usize)
            .collect();
        assert_eq!(addresses.len(), RING_SIZE, "each slot owns its own memory");
    }

    /// Build a `CGImage` over caller-owned pixels (no release callback).
    fn image_over(data: *const c_void, size: usize, w: usize, h: usize, stride: usize) -> *mut c_void {
        unsafe {
            let provider = CGDataProviderCreateWithData(ptr::null_mut(), data, size, None);
            assert!(!provider.is_null());
            let space = CGColorSpaceCreateDeviceRGB();
            let image = CGImageCreate(
                w,
                h,
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
            assert!(!image.is_null());
            image
        }
    }

    /// Before/after numbers for WP4b item 2, at the real capture size.
    ///
    /// The old path copied the whole surface (`Vec::to_vec`) before wrapping it;
    /// the new path wraps the ring buffer in place. Run on demand:
    /// `cargo test --lib bench_present_path -- --ignored --nocapture`
    #[test]
    #[ignore = "bench: run manually for before/after numbers"]
    fn bench_present_path_copy_vs_zero_copy() {
        use std::time::Instant;
        const WIDTH: u32 = 3416;
        const HEIGHT: u32 = 1700;
        const FRAMES: u32 = 60;

        let buffer = FrameBuffer::new(WIDTH, HEIGHT).unwrap();
        let bytes = buffer.byte_len();
        let (w, h, stride) = (WIDTH as usize, HEIGHT as usize, buffer.stride);
        println!(
            "surface {}x{} px, {:.1} MB/frame",
            WIDTH,
            HEIGHT,
            bytes as f64 / (1024.0 * 1024.0)
        );

        // Old path: full-frame memcpy + provider over the copy, every frame.
        let started = Instant::now();
        for _ in 0..FRAMES {
            let pixels = unsafe { std::slice::from_raw_parts(buffer.data_ptr(), bytes) }.to_vec();
            let image = image_over(pixels.as_ptr() as *const c_void, bytes, w, h, stride);
            unsafe { CGImageRelease(image) };
            drop(pixels);
        }
        let copy_ms = started.elapsed().as_secs_f64() * 1000.0 / FRAMES as f64;

        // New path: CGImage straight over the ring buffer.
        let started = Instant::now();
        for _ in 0..FRAMES {
            let image = image_over(buffer.data_ptr() as *const c_void, bytes, w, h, stride);
            unsafe { CGImageRelease(image) };
        }
        let zero_copy_ms = started.elapsed().as_secs_f64() * 1000.0 / FRAMES as f64;

        println!(
            "per frame: copy {copy_ms:.2} ms ({:.0} MB/s) -> zero-copy {zero_copy_ms:.2} ms; \
             saved {:.2} ms/frame, {:.0} MB/s of memcpy removed",
            (bytes as f64 / (1024.0 * 1024.0)) / (copy_ms / 1000.0),
            copy_ms - zero_copy_ms,
            (bytes as f64 / (1024.0 * 1024.0)) / (copy_ms / 1000.0)
        );
        assert!(
            zero_copy_ms < copy_ms,
            "zero-copy must be cheaper than a full-frame copy"
        );
    }

    /// WP4b item 3's before/after: the same 4K source through the SW VO into the
    /// uncapped ultrawide target vs the capped one ([`TARGET_MAX_WIDTH`]).
    ///
    /// `cargo test --release --lib bench_render_target_cap -- --ignored --nocapture`
    /// (a debug build only shows the ratio; absolute ms needs `--release`).
    #[test]
    #[ignore = "bench: needs ffmpeg for a 4K fixture; run manually"]
    fn bench_render_target_cap() {
        use crate::mpv;
        use std::time::{Duration, Instant};

        let directory = tempfile::tempdir().unwrap();
        let fixture = directory.path().join("fixture4k.mkv");
        let Some(fixture) = fixture.to_str() else {
            return;
        };
        let built = std::process::Command::new("ffmpeg")
            .args([
                "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "testsrc=size=3840x2160:rate=24:duration=6",
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
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
        // 3840x2160 at 24 fps: the SW VO's scaling cost is the thing being measured,
        // and `untimed=yes` renders as fast as the CPU allows instead of pacing to
        // the frame clock (which is what hides the cost in the live player).
        // "before" = what shipped through item 2: full 3416 px target and mpv's
        // default (spline) scaler. "after" = item 3: capped target + bilinear.
        for (label, width, height, cheap_scaler) in [
            ("before 3416x1700 default scaler", 3416u32, 1700u32, false),
            ("after  2560x1274 bilinear      ", 2560u32, 1274u32, true),
        ] {
            let handle = unsafe { (api.mpv_create)() };
            assert!(!handle.is_null());
            let set = |name: &str, value: &str| {
                let (n, v) = (CString::new(name).unwrap(), CString::new(value).unwrap());
                unsafe { (api.mpv_set_option_string)(handle, n.as_ptr(), v.as_ptr()) };
            };
            for (name, value) in [
                ("config", "no"),
                ("terminal", "no"),
                ("vo", "libmpv"),
                ("ao", "null"),
                ("keep-open", "no"),
                ("untimed", "yes"),
            ] {
                set(name, value);
            }
            if cheap_scaler {
                set("scale", "bilinear");
                set("dscale", "bilinear");
            }
            assert!(unsafe { (api.mpv_initialize)(handle) } >= 0);
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
            assert!(
                unsafe { (api.mpv_render_context_create)(&mut ctx, handle, params.as_mut_ptr()) } >= 0,
                "render context failed"
            );
            let mut buffer = FrameBuffer::new(width, height).unwrap();
            let load = {
                let (cmd, path) =
                    (CString::new("loadfile").unwrap(), CString::new(fixture).unwrap());
                let args = [cmd.as_ptr(), path.as_ptr(), ptr::null()];
                unsafe { (api.mpv_command)(handle, args.as_ptr()) }
            };
            assert!(load >= 0, "loadfile failed");

            let mut loaded = false;
            let deadline = Instant::now() + Duration::from_secs(30);
            let mut samples: Vec<f64> = Vec::new();
            while Instant::now() < deadline && samples.len() < 40 {
                let event = unsafe { (api.mpv_wait_event)(handle, 0.05) };
                if !event.is_null() && unsafe { (*event).event_id } == mpv::MPV_EVENT_FILE_LOADED {
                    loaded = true;
                }
                if !loaded {
                    continue;
                }
                let flags = unsafe { (api.mpv_render_context_update)(ctx) };
                if flags & MPV_RENDER_UPDATE_FRAME == 0 {
                    continue;
                }
                let started = Instant::now();
                render_into(api, ctx, &mut buffer).expect("render failed");
                samples.push(started.elapsed().as_secs_f64() * 1000.0);
            }
            let measured: Vec<f64> = samples.iter().skip(5).copied().collect();
            let mean = measured.iter().sum::<f64>() / measured.len().max(1) as f64;
            let peak = measured.iter().copied().fold(0.0, f64::max);
            let mb_per_frame =
                (buffer.stride * buffer.height as usize) as f64 / (1024.0 * 1024.0);
            println!(
                "{label}: {mean:.2} ms/frame mean, {peak:.2} ms peak over {} frames, \
                 {mb_per_frame:.1} MB/frame",
                measured.len()
            );
            assert!(!measured.is_empty(), "{label}: never rendered a frame");
            assert!(buffer.non_black_pixels() > 1000, "{label}: surface stayed black");
            unsafe { (api.mpv_render_context_free)(ctx) };
            unsafe { (api.mpv_terminate_destroy)(handle) };
        }
    }

    /// Live proof that the ring path paints from three rotating surfaces and that
    /// the addresses it hands to Core Graphics are stable (i.e. nothing is
    /// re-allocated per frame — the memcpy is gone).
    /// `cargo test --lib live_ring_renders_in_place -- --ignored --nocapture`
    #[test]
    #[ignore = "live: needs ffmpeg to build a fixture and libmpv to play it"]
    fn live_ring_renders_in_place() {
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
                "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=3",
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
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
        for (name, value) in [
            ("config", "no"),
            ("terminal", "no"),
            ("vo", "libmpv"),
            ("ao", "null"),
            ("keep-open", "no"),
            ("untimed", "yes"),
        ] {
            set(name, value);
        }
        assert!(unsafe { (api.mpv_initialize)(handle) } >= 0);
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
        assert!(unsafe { (api.mpv_render_context_create)(&mut ctx, handle, params.as_mut_ptr()) } >= 0);

        let ring = Ring::new(320, 240).unwrap();
        let load = {
            let (cmd, path) = (CString::new("loadfile").unwrap(), CString::new(fixture).unwrap());
            let args = [cmd.as_ptr(), path.as_ptr(), ptr::null()];
            unsafe { (api.mpv_command)(handle, args.as_ptr()) }
        };
        assert!(load >= 0);

        let deadline = Instant::now() + Duration::from_secs(25);
        let mut loaded = false;
        let mut addresses: Vec<usize> = Vec::new();
        let mut painted = 0usize;
        let mut frames = 0usize;
        while Instant::now() < deadline && frames < 24 {
            let event = unsafe { (api.mpv_wait_event)(handle, 0.05) };
            if !event.is_null() && unsafe { (*event).event_id } == mpv::MPV_EVENT_FILE_LOADED {
                loaded = true;
            }
            if !loaded {
                continue;
            }
            if unsafe { (api.mpv_render_context_update)(ctx) } & MPV_RENDER_UPDATE_FRAME == 0 {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            let index = ring.acquire().expect("a slot must be available");
            let (painted_this_frame, data) = {
                let mut slot = ring.slots[index].lock().unwrap();
                render_into(api, ctx, &mut slot).expect("render failed");
                (slot.non_black_pixels() > 1000, slot.data_ptr() as usize)
            };
            addresses.push(data);
            if painted_this_frame {
                painted += 1;
            }
            // Simulate the main-thread present: the slot is returned through the
            // two-present grace, exactly as `Frame::drop` does it.
            ring.release(index);
            frames += 1;
        }

        let unique: std::collections::HashSet<_> = addresses.iter().collect();
        println!(
            "ring render: {frames} frames, {} distinct surface addresses, {painted} painted",
            unique.len()
        );
        unsafe { (api.mpv_render_context_free)(ctx) };
        unsafe { (api.mpv_terminate_destroy)(handle) };

        assert!(loaded, "mpv never loaded the fixture");
        assert!(frames >= 6, "not enough frames rendered: {frames}");
        assert_eq!(unique.len(), RING_SIZE, "the ring must rotate over every buffer");
        assert!(painted >= 4, "too few frames actually painted ({painted})");
    }
}