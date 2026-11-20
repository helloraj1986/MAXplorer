# MAXplorer Media — player handover (2026-11-21)

> Read this before touching the media player. Companion to `HANDOVER.md` §0
> (feature state) and `docs/STREMIO_MEDIA.md` (roadmap).
>
> Branch `feature/stremio-compat`.
>
> **UPDATE (2026-11-21): the render API is implemented — §4 is done, not a plan.**
> Video now renders inside the MAXplorer window via `MPV_RENDER_API_TYPE_SW`
> (`src-tauri/src/render.rs`). Headless proof:
> `cargo test --lib live_sw_render_paints_pixels -- --ignored --nocapture` →
> `sw render: file_loaded=true non_black_pixels=67769` (of 76,800). The remaining
> items are the GL backend upgrade (§4.3 Option A) and audio/subtitle selection
> (§7). Everything in §2 stays true — do not re-try `wid`, libvlc or HLS.

---

## 1. Where we are

### Working (verified)

| Area | State |
| --- | --- |
| Addon protocol + Discover | Cinemeta catalogs, real posters — Phase 1 |
| Stream resolution | Torrentio (`torrentio.strem.fun`), ranked streams sheet — Phase 2 |
| Torrent engine | Embedded librqbit 8.1.1, `media_torrent_start/status`, built-in HTTP stream server on `127.0.0.1:18081` with Range. Verified live: Sintel streams, HTTP 206 + `Content-Range` |
| **Native playback** | libmpv (mpv HEAD), **any container/codec**, hardware decode. Log proof: `Heart.of.the.Beast … hevc 3840x1600`, `eac3 6ch`, `Using hardware decoding (videotoolbox)` |
| **Embedding** | Render API (`sw`): mpv paints into our aligned RGBA buffer, wrapped as a `CGImage` on the NSView's layer — no second window. Verified headlessly (non-black pixels after decode) |
| Debrid | Real-Debrid + TorBox (`debrid.rs`) — optional accelerator |
| Crash fix | teardown now joins the event thread before destroying the mpv handle (was SIGSEGV in `mpv_wait_event`) |
| Buffering UI | Header pill shows cache % + arrival rate when `paused-for-cache`; seek bar shows buffered-ahead span |

### Not working / open

1. **Software-render cost.** One CPU copy per frame (~8 MB at 1080p, ~33 MB at
   4K). Acceptable for 1080p; 4K may drop frames on a busy machine. The fix is
   the GL backend (§4.3 Option A), not more patching of the SW path.
2. **GUI click-through on this box is unverifiable** (display composites blank).
   The user must confirm pixels inside the window (§4.4 step 6).
3. Audio/subtitle track selection (mpv exposes `aid`/`sid`) — not wired to any UI.

---

## 2. The three architectures tried — evidence, not opinion

Do **not** re-litigate these without new evidence. Each was proved on this machine.

### 2.1 libmpv + `wid` NSView embedding — IMPOSSIBLE

- The macOS/NSView `wid` feature comes from **mpv PR #17221, which was CLOSED
  UNMERGED**. mpv master contains **zero** NSView code
  (`curl …/master/DOCS/man/options.rst | grep NSView` → no matches).
- `wid` still exists as a cross-platform option, so `mpv_set_option("wid")`
  returns `0` and the value reads back — a naive "is embedding supported?" probe
  says yes. It is a **false positive**; macOS silently ignores it.
- Proof from the app log: `mpv initialised (vo=Some(""), wid=Some("47169353472"))`
  then `VO: [gpu-next]` — mpv picked its own VO and opened its own window.
- **That false probe cost a build cycle. Never trust it again.**

### 2.2 libvlc `libvlc_media_player_set_nsobject` — NOT USABLE HERE

- The API exists and is exported by the installed VLC 3.0.21.
- But `/Applications/VLC.app/Contents/MacOS/lib/libvlc.dylib` is **x86_64 only**;
  the app is arm64 → `dlopen` fails with "incompatible architecture".
- Would only become viable with an arm64/universal VLC, i.e. a new hard
  dependency. Not chosen.

### 2.3 ffmpeg remux → fMP4 HLS → HTML5 `<video>` — WRONG MODEL

Tried, shipped, **reverted**. It works for small/local files but is unsuited to
torrent sources:

- it must **buffer ahead** before playback can start (we waited for the first
  segment; on a cold swarm that is minutes);
- **MP4 is pathological**: ffprobe/ffmpeg must read the `moov` atom, which for
  4K WEB-DL MP4s sits at the **end of the file** → "preparing" effectively
  downloads the whole multi-GB file. Observed: `preparing stream for
  Obsession.2025.MA.WEB-DL.2160p.DV.mp4` never reached `source video codec`;
  it was stuck in **ffprobe with no timeout** → spinner forever.
- it burns CPU on every play and loses instant seeking.

Lesson: **do not transcode/prepare a torrent stream up front.** Let the player
demux on demand (which is exactly what mpv already does).

---

## 3. How Stremio does it (and why ours differs)

| | Stremio desktop | MAXplorer today |
| --- | --- | --- |
| Player | **mpv/libmpv, embedded in its own window** | libmpv, **separate window** |
| Input | raw torrent/debrid URL, untouched | same |
| Start latency | ~1 s | ~1 s |
| Codecs | everything (FFmpeg) | everything (FFmpeg) |
| Transcode | **none** | none |
| Rendering | mpv render API into a native view | mpv's own cocoa window |

So we are already behaviourally equivalent **except embedding**. Stremio's macOS
build embeds via the **libmpv render API** (`mpv_render_context_*`), not `wid`.
That is the missing piece, and it is the whole of the next task.

---

## 4. IMPLEMENTED — embed mpv with the render API

### 4.1 Shape

Replace the "give mpv an NSView via `wid`" step with:

```
mpv_create → set options → mpv_initialize → mpv_render_context_create(OPENGL|SW)
    → render into a native surface we own, driven by mpv's update callback
```

Keep everything else (`mpv.rs` FFI, commands, `PlayerStatus`, event loop).
The `wid` option and `create_view`/`set_view_frame` become unused.

### 4.2 API facts (from `/opt/homebrew/include/mpv/render.h`, client API 2.6)

```c
#define MPV_RENDER_API_TYPE_OPENGL "opengl"   // line 483
#define MPV_RENDER_API_TYPE_SW     "sw"       // line 485

// mpv_render_param_type
MPV_RENDER_PARAM_API_TYPE            = 1
MPV_RENDER_PARAM_OPENGL_INIT_PARAMS  = 2
MPV_RENDER_PARAM_OPENGL_FBO          = 3
MPV_RENDER_PARAM_FLIP_Y              = 4
MPV_RENDER_PARAM_DEPTH               = 5
MPV_RENDER_PARAM_ADVANCED_CONTROL    = 10
MPV_RENDER_PARAM_SW_SIZE             = 17
MPV_RENDER_PARAM_SW_FORMAT           = 18   // "rgb0"/"bgr0"
MPV_RENDER_PARAM_SW_STRIDE           = 19
MPV_RENDER_PARAM_SW_POINTER          = 20

struct mpv_opengl_init_params { get_proc_address(ctx,name), get_proc_address_ctx, extra_exts };
struct mpv_opengl_fbo         { int fbo; int w; int h; int internal_format; };
struct mpv_render_param       { int type; void *data; };   // array, terminated by {0,NULL}
```

Functions to resolve in `mpv.rs` (add to `MpvApi`):

```
mpv_render_context_create(mpv_render_context **res, mpv_handle *mpv, mpv_render_param *params)
mpv_render_context_set_update_callback(ctx, void(*cb)(void*), void *cb_ctx)
mpv_render_context_update(ctx) -> uint64          // bit 1 = MPV_RENDER_UPDATE_FRAME
mpv_render_context_render(ctx, mpv_render_param *params)
mpv_render_context_report_swap(ctx)               // only with ADVANCED_CONTROL
mpv_render_context_free(ctx)
```

Ordering constraint: create the render context **before loading the first
file**; otherwise mpv falls back to a VO that makes its own window (the exact
symptom we have now).

### 4.3 Two implementation options — pick B first

**Option B — software renderer (`MPV_RENDER_API_TYPE_SW`).** *Recommended first.*
- No GL context, no NSOpenGLView, no `get_proc_address` plumbing.
- `mpv_render_context_render` fills a plain RGBA buffer (`SW_POINTER/STRIDE/SIZE/FORMAT`).
- Blit that buffer into a `CALayer` (`contents = CGImage`) inside the existing
  NSView, or into a `CGContext` in `drawRect`.
- **Decisive advantage: it is verifiable headlessly** — after rendering a frame,
  assert the buffer is not uniformly black (count non-zero pixels). That is real
  proof the video is painting, which no GL path can give us in this environment.
- Cost: CPU copy per frame. Fine for 1080p; marginal for 4K/HDR — acceptable as
  a first working version, then swap the backend to GL.

**Option A — `MPV_RENDER_API_TYPE_OPENGL`.** Correct end state, more risk.
- Needs an `NSOpenGLView` (or NSOpenGLContext + layer) whose pixel format is
  core-profile 4.1, a current context per render, `get_proc_address` backed by
  `dlsym` on the OpenGL framework, and a display-link-driven render loop.
- Use `MPV_RENDER_PARAM_OPENGL_FBO` with `fbo = 0` (default framebuffer), `w/h`
  in **backing pixels** (multiply points by `scale_factor`), plus `FLIP_Y`.
- Cannot be verified without seeing the screen; treat as a follow-up once SW
  proves the pipeline.

### 4.4 Concrete steps (next session)

1. **`mpv.rs`** — add the six render functions above to `MpvApi` and to
   `load_libmpv`'s symbol table (a missing symbol currently makes that candidate
   fail, so keep them optional-safe or bump the error text).
2. **`player.rs`** —
   - drop `wid` + `create_view/set_view_frame/content_view_height` usage;
   - add `RenderSurface { ctx, buffer: Vec<u8>, size, stride }` owned by `Session`;
   - `create_mpv` no longer takes a view; after `mpv_initialize` call
     `mpv_render_context_create` with `API_TYPE=SW`, `SW_SIZE=(w,h)`,
     `SW_FORMAT="rgb0"`;
   - `mpv_render_context_set_update_callback` → post to main thread → render →
     wrap the buffer as a `CGImage` (via `CGBitmapContextCreate` +
     `CGBitmapContextCreateImage`, or `NSBitmapImageRep`) → assign to the NSView
     layer's `contents`;
   - call `mpv_render_context_free` **before** `mpv_terminate_destroy`, and only
     after the event thread is joined (teardown order already fixed — keep it).
3. **Resize** — `media_player_set_rect` already marshals to the main thread:
   update `SW_SIZE`, recreate the CGImage backing store, and re-render.
4. **Verify headlessly** (new example or a probe binary): render the MKV fixture,
   then read the software buffer and assert ≥1 non-black pixel and that
   `mpv_render_context_update` reported a frame. That is the acceptance gate for
   "video is embedded".
5. **UI** — render the buffering state (`pausedForCache`, `cachePercent`,
   `cacheSeconds`, `cacheSpeed`, `fileLoaded`) as a panel over the stage, plus
   codec/engine badges. Fields already exist on `PlayerStatus`.
6. Rebuild, install, and have the user confirm pixels — the one step that cannot
   be automated here (this box composites blank).

### 4.5 Acceptance criteria

- Playing a 4K HEVC/E-AC3 MKV shows video **inside the MAXplorer window**
  (no second window).
- Buffering panel appears when the swarm stalls, with % and seconds buffered.
- No crash when opening/closing repeatedly (teardown order preserved).
- `cargo test --lib` green, `tsc --noEmit` clean.

---

### 4.6 As-built (2026-11-21)

`src-tauri/src/render.rs` (new) + slimmed `player.rs`:

- `MpvApi` resolves the five render symbols: `mpv_render_context_create`,
  `set_update_callback`, `update`, `render`, `free`. A candidate libmpv missing
  any of them fails to load with the symbol named.
- `SwRenderer` owns the context and a dedicated **`mpv-render` thread**. All
  `mpv_render_*` calls happen on that thread; the update callback only bumps a
  counter and signals a condvar (it never calls mpv — render.h forbids it).
  Frames are presented by posting to the main thread, where the RGBA snapshot is
  wrapped in a `CGImage` (`CGDataProviderCreateWithData`, owned by the layer)
  and assigned to the view layer's `contents`. CoreGraphics is a system
  framework — no new crate, so `Cargo.lock` is unchanged.
- Surface: `FrameBuffer` is 64-byte-aligned (`render.h` alignment rule), stride
  rounded to 64, format `rgb0`, size in **backing pixels** via
  `convertRectToBacking` (Retina would otherwise play at half resolution).
- Ordering, all load-bearing: `vo=libmpv` before `mpv_initialize` → render
  context → `loadfile`; on teardown, join the event thread → detach the update
  callback → join the render thread → `mpv_render_context_free` → `quit` →
  `mpv_terminate_destroy` → remove the NSView.
- If the render context cannot be created, playback still proceeds with
  `vo=auto` (mpv's own window) and the log states why — no silent black stage.
- `media_player_diagnostics` now probes by actually creating a throwaway SW
  render context, not by setting `wid` (which is a false positive).
- Buffering UI: `PlayerOverlay` shows a header pill (`Buffering 42% · 1.5 MB/s`)
  and a buffered span on the seek bar. It cannot overlay the stage because the
  native surface covers it.
- Verification: `cargo test --lib` 109 passed / 5 ignored; the new ignored live
  test renders a real H.264+AC3 MKV through the SW path and asserts non-black
  pixels (observed 67,769 of 76,800). `npx tsc --noEmit` clean; media vitest 14
  passed (4 new formatting assertions).

### 4.7 Reference implementations to copy (verified sources)

**Stremio's desktop player does exactly the render API — no `wid`.** Source:
`https://github.com/Stremio/stremio-shell/blob/master/mpv.cpp`

```cpp
mpv_opengl_init_params gl_init_params{get_proc_address_mpv, nullptr, nullptr};
mpv_render_param params[]{
  {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
  {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params},
  {MPV_RENDER_PARAM_INVALID, nullptr}};
mpv_render_context_create(&obj->mpv_gl, obj->mpv, params);
mpv_render_context_set_update_callback(obj->mpv_gl, on_mpv_redraw, obj);

// per frame:
QOpenGLFramebufferObject *fbo = framebufferObject();
mpv_opengl_fbo mpfbo{static_cast<int>(fbo->handle()), fbo->width(), fbo->height(), 0};
int flip_y{0};
mpv_render_param p[] = {
  {MPV_RENDER_PARAM_OPENGL_FBO, &mpfbo},
  {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
  {MPV_RENDER_PARAM_INVALID, nullptr}};
mpv_render_context_render(obj->mpv_gl, p);
```

It subclasses **`QQuickFramebufferObject`**, so the video is a texture inside
Stremio's own scene graph — that is why it is "in app". Also note their playback
tuning, worth copying: `vo=libmpv`, `gpu-hwdec-interop=auto`,
`cache-default=15000`, `cache-backbuffer=15000`, `cache-secs=10`.

**macOS proof with our exact stack:** IINA's `iina/ViewLayer.swift` is a
`CAOpenGLLayer` owning a `CGLContextObj`, calling `mpv_render_context_render`
with `MPV_RENDER_PARAM_OPENGL_FBO` + `FLIP_Y`.
And mpv ships a minimal macOS skeleton ready to adapt:
`mpv-examples/libmpv/cocoa-rendergl/cocoa-rendergl.m` — an `NSOpenGLView`
subclass whose `drawRect` does the render call, with
`mpv_render_context_set_update_callback(mpvGL, glupdate, view)`.

So the ObjC shape for us is: `NSOpenGLView` (or `CAOpenGLLayer`) subview of the
Tauri `contentView` → `makeCurrentContext` → create the render context →
`setNeedsDisplay` from the update callback → `drawRect` renders + `flushBuffer`.

### 4.8 Rendering-thread rules (from render.h — violating these deadlocks or degrades playback)

- Create the render context **before** the first file is loaded, or mpv "will
  revert to a VO that creates its own window" (our current bug).
- Only one `mpv_render_*` call at a time per core; never call them from inside
  the update callback (post to the main thread instead).
- For OpenGL, the GL context must be **current on the calling thread** and be the
  **same** context the render context was created with.
- Do **not** call other libmpv API from the render thread.
- `mpv_render_context_free` **before** `mpv_terminate_destroy` (and after the
  event thread is joined — see `teardown`).
- Do not set `MPV_RENDER_PARAM_ADVANCED_CONTROL` unless you will call
  `mpv_render_context_update` + `report_swap`; otherwise render can deadlock.

## 5. Environment facts (this machine)

| Item | Value |
| --- | --- |
| mpv | **HEAD** `v0.42.0-173-g59e00d3` (`brew unlink mpv && brew install mpv --HEAD`). The 0.42.0 bottle has no macOS `wid` path either. |
| libmpv | `/opt/homebrew/lib/libmpv.dylib` (api 2.6) |
| ffmpeg / ffprobe | `/opt/homebrew/bin` (9.0.2) — no longer needed by the player |
| VLC | 3.0.21, **x86_64 only** |
| Entitlements | `src-tauri/entitlements.plist` must keep all four: `network.client`, `disable-library-validation`, `allow-jit`, `allow-unsigned-executable-memory` |
| Hardened runtime | ON (`codesign flags=0x10000`). Loading Homebrew dylibs needs `disable-library-validation`; mpv's LuaJIT needs both JIT keys, or the kernel SIGKILLs the app (`CODESIGNING / Invalid Page`) |
| mpv scripts | disabled before `mpv_initialize`: `load-scripts`, `load-stats-overlay`, `load-console`, `load-select`, `load-positioning`, `load-auto-profiles` = `no` |

### Verification recipes

```sh
cd src-tauri
cargo test --lib                       # 108 pass, 4 ignored
cargo test --lib live_decodes_mkv -- --ignored --nocapture   # MKV/H.264/AC3 decode
cargo test --lib live_engine -- --ignored --nocapture        # torrent → HTTP 206 + Range
cd .. && npx tsc --noEmit && npx vitest run src/components/media
```

Diagnostics for any playback complaint:
`~/Library/Application Support/com.replica.win11explorer/logs/maxplorer.log`
(targets `media.player`, `media.stream`) plus
`~/Library/Logs/DiagnosticReports/maxplorer-<ts>.ips` (JSON: line 1 meta, rest
body; read `exception.type`, `termination.namespace`, faulting thread frames).

---

## 6. Do-not-repeat list

1. **Do not** try mpv `wid` embedding on macOS — the feature does not exist.
2. **Do not** add a "prepare/remux the stream first" step for torrents.
3. **Do not** trust a capability probe that only sets an option and reads back.
4. **Do not** destroy the mpv handle before joining the event thread.
5. **Do not** rely on `cargo build`/`cargo test` success to prove playback works —
   the packaging (hardened runtime + entitlements) only breaks in the signed app.
6. **Do not** `git stash pop` in this repo — a stale `stash@{0}` (`WIP user
   main.tsx -> MainApp`) conflicts on `src/main.tsx`. Use `git worktree add` +
   symlinked `node_modules` to check pre-existing failures.

---

## 7. Open questions for the user

1. **Rendering backend (partly answered):** the software renderer shipped and is
   verified. Decide whether 4K playback is good enough on this machine or whether
   to do the GL backend next (correct long-term, unverifiable headlessly here).
2. **Fallback while embedding is unfinished**: is mpv's own window acceptable as
   a stop-gap if it plays everything instantly (it already does today), or should
   the player refuse rather than open a second window?
3. **Audio/subtitle track selection** (mpv exposes `aid`/`sid` lists): needed for
   the next milestone, or later?
4. `objc2` + `libloading` remain in `Cargo.toml`; `objc2` is still used for the
   NSView/CALayer surface, `libloading` for the dlopen shim — both required.
---

## 8. Blank video / streams that never start (2026-11-21)

### What the log showed

`maxplorer.log`, target `media.player`, two distinct failures:

```
curlHTTP error 500
curltransfer failed: Failed writing received data to disk/application
streamFailed to open http://127.0.0.1:18081/torrents/<hash>/stream/0
```

and, a second later on another stream:

```
curlerror: Couldn't resolve host name
```

Both are the embedded torrent server refusing the request, not a codec or
network-speed problem: the same URLs served fine minutes later (`HTTP 200`,
`content-length` = the file size). mpv's "couldn't resolve host name" is its
retry path after the server closed the connection — it does **not** mean DNS or
the LAN is at fault.

Root cause: the frontend opened the player as soon as the torrent's **metadata**
(files) existed, but librqbit's stream handler is only reliable once the torrent
is actually serving. A freshly added torrent — and every torrent re-added on app
restart — has files long before that moment.

### What was fixed

1. **Probe before handing the URL to mpv.** `media_torrent_status` now does a
   2-byte `Range: bytes=0-1` GET against the stream URL and withholds
   `streamUrl` unless it returns success (with the failure status + body
   snippet logged once). `probe=false` is used by the playback-time stats poll so
   it never opens extra streams while playing.
2. **State gate.** `streamUrl` also requires librqbit state `live`/`paused`
   (`can_stream`), because its `streams()` rejects other states outright.
3. **The native surface starts hidden.** It is revealed when mpv reports the
   file loaded, and hidden again on playback error. Previously it covered the
   spinner and the error card, so a failed stream looked exactly like "blank
   video" with no message.
   *Important:* set `file_loaded` from the **`MPV_EVENT_FILE_LOADED` event**, not
   only from the observed `file-loaded` property. Symptom of getting this wrong:
   audio plays with the spinner still spinning and no picture (observed in the
   packaged app on 2026-11-21) because the surface never became visible.
4. **`framedrop=vo`** so a renderer that cannot keep up drops frames instead of
   freezing the picture (SW scaling a 4K source is the known cost, §1).
5. **Render fps is logged every 5 s** (`media.render: 23.9 fps at 3024x1458 px`),
   which separates "decode/render too slow" from "no data from the swarm".

### Live stats in the UI

- Player header: `↓ 2.4 MB/s · 8.2s buffered · 18 peers` (mpv `cache-speed` /
  `demuxer-cache-time`, librqbit live peer count), plus the stall pill
  `Buffering 42% · 1.5 MB/s` while `paused-for-cache` is set.
- Stage note while a torrent connects: `Connecting to the swarm… 37% · 12 peers`.
- Stream rows: `↓ 2.4 MB/s · 12 peers` while resolving, with the % inside the
  button.

Note on seeders: librqbit's `api_stats_v1` exposes connected/discovered peer
counts but **not** a seed/leecher split, so the UI reports peers honestly rather
than inventing a seeder figure. A seeder count would need tracker scrapes.
