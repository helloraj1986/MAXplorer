# MAXplorer Media — player handover (2026-11-21)

> Read this before touching the media player. Companion to `HANDOVER.md` §0
> (feature state) and `docs/STREMIO_MEDIA.md` (roadmap).
>
> Branch `feature/stremio-compat`, head at the "revert(media): restore native
> libmpv playback" commit.

---

## 1. Where we are

### Working (verified)

| Area | State |
| --- | --- |
| Addon protocol + Discover | Cinemeta catalogs, real posters — Phase 1 |
| Stream resolution | Torrentio (`torrentio.strem.fun`), ranked streams sheet — Phase 2 |
| Torrent engine | Embedded librqbit 8.1.1, `media_torrent_start/status`, built-in HTTP stream server on `127.0.0.1:18081` with Range. Verified live: Sintel streams, HTTP 206 + `Content-Range` |
| **Native playback** | libmpv (mpv HEAD), **any container/codec**, hardware decode. Log proof: `Heart.of.the.Beast … hevc 3840x1600`, `eac3 6ch`, `Using hardware decoding (videotoolbox)` |
| Debrid | Real-Debrid + TorBox (`debrid.rs`) — optional accelerator |
| Crash fix | teardown now joins the event thread before destroying the mpv handle (was SIGSEGV in `mpv_wait_event`) |

### Not working / open

1. **Video renders in mpv's OWN window, not inside MAXplorer.** This is the
   single blocking defect. Root cause is a platform limitation, see §2.
2. **No buffering indicator in the UI.** The data now exists —
   `PlayerStatus.pausedForCache`, `cachePercent`, `cacheSeconds`, `cacheSpeed`,
   `fileLoaded` — but `PlayerOverlay` does not render it yet.
3. Player chrome still says generic copy; badges should show codec + engine.

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

## 4. THE PLAN — embed mpv with the render API

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

1. **Rendering backend**: start with the software renderer (verifiable, CPU cost)
   and move to GL later, or go straight to GL (correct, unverifiable here)?
2. **Fallback while embedding is unfinished**: is mpv's own window acceptable as
   a stop-gap if it plays everything instantly (it already does today), or should
   the player refuse rather than open a second window?
3. **Audio/subtitle track selection** (mpv exposes `aid`/`sid` lists): needed for
   the next milestone, or later?
4. `objc2` + `libloading` remain in `Cargo.toml`; remove once the render backend
   is settled (they are still used by the ObjC surface helpers).