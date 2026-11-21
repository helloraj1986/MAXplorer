# Handover — MAXplorer

| Field | Value |
| --- | --- |
| Document version | 1.4 |
| Handover date | 2026-11-21 |
| Project version | 0.2.1 (aarch64 DMG) + media feature on `feature/stremio-compat` |
| Repository | https://github.com/helloraj1986/MAXplorer (private) |
| Release | https://github.com/helloraj1986/MAXplorer/releases/latest |
| Current branch | `feature/media-ui-wp4a` (branched from `feature/media-ui-wp3`) — read the head with `git log --oneline -1` (a fixed SHA here goes stale the moment anything is committed). Last installable build: 2026-11-21, installed at `/Applications/MAXplorer.app`. **`feature/stremio-compat`, `feature/media-ui-wp1`, `-wp2`, `-wp3` and `-wp4a` are not yet on origin** (`git push origin <branch>`). |

---

## 0. ACTIVE WORK — Media feature (Stremio-compatible) — READ FIRST

**This is the live workstream. Canonical roadmap: `docs/STREMIO_MEDIA.md`. One roadmap
item per session — never batched.**

> ### ▶ START HERE — two documents
>
> 1. **`docs/MEDIA_UI_SPEC.md`** — the *next workstream*. Stremio-parity redesign of
>    the media workspace + player, derived from the user's screenshots: tokens,
>    three screens, component/file inventory, data mapping, keyboard/a11y rules and
>    six work packages (WP1 tokens+shell → WP6 polish; WP4 is split into WP4a
>    chrome / WP4b engine performance). **Implement one WP per session; WP1, WP2,
>    WP3 and WP4a are done, WP4b is next.** Reference images (not in git):
>    `~/hermes-workspace/maxplorer-media/ui-reference/`.
> 2. **`docs/MEDIA_PLAYER_HANDOVER.md`** — the player internals: what works, the
>    three architectures already ruled out **with evidence**, and the as-built
>    record of the libmpv render API. Read before touching playback.
>
> **WP1 (tokens + shell), WP2 (the board), WP3 (detail + streams panel) and WP4a
> (player chrome) are DONE** — components and the as-built notes are in
> `docs/MEDIA_UI_SPEC.md` §10. Gates green: `npx tsc --noEmit`; vitest
> `src/components/media` → 91 passed. WP3 lives on `feature/media-ui-wp3` @
> `cb138ae` (pushed); WP4a lives on `feature/media-ui-wp4a`.

---

## ✅ UI WP4a DONE — player chrome (branch `feature/media-ui-wp4a`, off `feature/media-ui-wp3`)

Frontend only: `src-tauri/src/player.rs` and `render.rs` were **not** touched, so
`framedrop=vo`, the `fileLoaded` → `set_surface_visible` gate and the torrent
readiness Range-probe are all unchanged. As-built detail lives in
`docs/MEDIA_UI_SPEC.md` §10 "WP4a as built"; the load-bearing points:

- **Three strips, no overlay on the stage.** Top strip 72 px (close, title, codec ·
  resolution chip, right cluster = stats pill + fullscreen), bottom region
  = 40 px state row + 88 px bar (transport, elapsed, seek, total, volume,
  fullscreen) + the 2 px hairline. Chrome is a flex sibling of
  `.media-player-stage`, **never** absolutely positioned over it.
- **The stage is what the native surface covers**, so the chrome collapsing is
  what gives the video the full window: idle → strips `display:none`, stage grows,
  the ResizeObserver pushes the new rect to `media_player_set_rect`, and only the
  2 px hairline (progress width) stays. Deliberately **no height transition** —
  animating the height would re-send the native rect every frame (that is WP4b
  item 1 territory).
- **Autohide contract:** visible on mousemove / pause / eof / `Tab`, hides 3 s
  after the last input while playing; `cursor: none` while idle; reduced motion
  drops the seek/volume transitions.
- **Seek:** optimistic drag (local scrub, `player_seek` only on release — one per
  gesture), buffered span from `cacheSeconds`, hover → 7 px track + 14 px knob +
  text time tooltip, `role="slider"` with `aria-valuetext="12:34 of 1:44:59"`,
  arrows ±5 s, Home/End. `−10s`/`+10s` ripple for keyboard seeks.
- **Volume:** icon mutes, slider expands to 90 px on hover/focus, `↑/↓` ±5, `M`
  mute, ephemeral "Volume 40%" readout in the **state row** (not the stage).
- **States:** buffering pill `Buffering 42% · 1.5 MB/s` (from `cacheSummary`),
  `Connecting to the swarm… 37% · 12 peers` while the engine resolves, error card
  (`role="alert"`, reason, `↗ Open in external player`, `Retry` → re-opens the
  player), ended → play icon + chrome pinned, audio-only → poster + title art on
  `--m-bg`.
- **No dead buttons:** `⏮`/`⏭` need an episode playlist and the audio/subtitle/
  speed menus need WP5's `media_player_tracks`, so the bar ships play/pause only
  and its right cluster ends at fullscreen.
- **Store:** `playerSource` gained `poster` (audio-only art) and `quality` (codec
  chip); `openPlayer`/`streamTorrent` take an optional quality and read the poster
  from the selected meta, so no call site fabricates either.
- **Known gap (needs backend, deferred):** the native NSView has no
  `ignoresMouseEvents`/`hitTest` override, so a pointer over the video may never
  reach the webview — the mousemove wake-up is then only reliable over the strips
  and the 2 px hairline, and `Tab` is the guaranteed path. `PlayerOverlay` already
  listens for `media-player://pointer`; emitting it from the NSView's
  `mouseMoved` is a one-line backend change for WP4b/WP5. Confirm behaviour on the
  installed build before deciding.
  **RESOLVED 2026-11-21 (second attempt):** the user reported "I don't see the UI for
  the player". Over the video the NSView was the hit-test target, so `mousemove`
  never arrived and the autohidden chrome never woke. The first fix
  (`setIgnoresMouseEvents: YES`) **crashed the app on the next open** — that property
  belongs to `NSWindow`, not `NSView`, so the selector raised
  `NSInvalidArgumentException` inside the main-thread run-loop callback and aborted
  with SIGABRT (no Rust panic log; only `crash report → asi: abort() called`). The
  correct fix is an NSView subclass whose `hitTest:` returns nil
  (`video_surface_class()` in `player.rs`, built with `ClassBuilder` because this
  crate has objc2-foundation only, no typed `NSView`), plus click-the-picture →
  play/pause. `player::surface_tests::video_surface_class_is_registered` asserts the
  class overrides `hitTest:` rather than inheriting it.
- Gates: `npx tsc --noEmit` clean; `npx vitest run src/components/media` → **91
  passed** (74 before; `PlayerOverlay.test.tsx` grew 17 cases: autohide with fake
  timers, key map → `api.*` calls, seek ratio math, buffered-span width, error
  card, slider `aria-valuetext`, single-seek-per-gesture, audio-only art).
- Handover path used: build (background) → `grep -c "media-player-hairline"
  dist/assets/*.js` → install `/Applications/MAXplorer.app` → user compares to
  `crop-player-bottom.png` (which shows **no chrome at all** while playing — the
  idle state is the acceptance shot).

---

## ▶ ACTIVE — UI WP4b: engine performance (one backlog item per session)

**Branch:** `feature/media-ui-wp4b` off `feature/media-ui-wp4a`.
**Done:** item 1 (`emit_state` coalescing) — commit `d325b4b`; measured on a
60 fps fixture: 66 property events/s → **5 IPC messages/s (−92.4 %)**; live
in-app: ~25 events/s → 3.9 msg/s. Item 2 (zero-copy frame ring — see below,
includes the **fps regression fix**: the first cut dropped ~50 % of frames).
Item 8's numbers (mpv `container-fps` / `estimated-vf-fps` / vo+decoder drop
counters, render ms/frame, presenter lag) landed with it.
Also on this branch: `886a629` player-mode takeover fix and `bf5b5a1` fullscreen
de-duplication — **4b itself is 2 of 8 items, NOT finished.**
**Next: BUNDLE A — items 3 + 4** (render cost). The user authorised batching
coupled items on 2026-11-21: same code path ⇒ one session, but **one commit and
one measurement per item**, never one commit for both. Full spec below.

### BUNDLE A spec (items 3 + 4)

**Item 3 — SW scaler + render-target cap.**
- `player.rs` option set (before `mpv_initialize`, beside `vo=libmpv`):
  `scale=bilinear`, `dscale=bilinear`. The SW VO scales in CPU; bilinear is the
  cheap filter and at this size the difference is invisible after CALayer
  upscaling.
- `render.rs`: cap the render target. In `set_size` (and the initial create),
  given backing `(w, h)`, if `w > TARGET_MAX_WIDTH` scale down preserving aspect
  (`h = h * MAX / w`, `w = MAX`), `TARGET_MAX_WIDTH = 2560`. The NSView frame
  stays the full stage — `CALayer.contentsGravity` defaults to resize, so the
  layer upscales the smaller CGImage for free. Keep `set_size` idempotent: compare
  the **capped** size, else it reallocates the ring on every resize tick.
- Measure: `media.render` → `ms/frame in mpv` and fps on the same 4K 24 fps
  torrent; expect fewer pixels (2560×~1049 ≈ 10.7 MB/frame vs 18.5) and lower
  mpv time. Watch for subtitle softness (mpv rasterises subs into the capped
  buffer) — if it looks bad, raise the cap, don't add a second render pass.
- Live proof: `cargo test --lib live_ring_renders_in_place -- --ignored --nocapture`
  must still paint every frame.

**Item 4 — drop stale frames before dispatch.**
- Today every rendered frame is posted to the main thread unconditionally; when
  the main thread lags, a backlog of stale `CGImage`s is composited in order.
- Add `queued: AtomicU64` (frames dispatched, not yet presented). Before
  `run_on_main_thread`, if `queued >= 1` **skip the dispatch** and let the `Frame`
  drop return its slot (count it in a separate `stale_frames` counter — do NOT
  add it to `dropped_frames`, which means "no buffer available"). Decrement
  `queued` on the main thread after `setContents`.
- Acceptance: `media.render` shows `lag 1` (never >1) and 0 stale drops at steady
  state; during a window drag the stale counter may tick while fps stays 24.

**Cleanup in the same build** (found 2026-11-21): `vo-drops` and
`osd … bars l/t/r/b` print `n/a` — those properties don't exist in mpv
v0.42.0-173. Keep `decoder-frame-drop-count` and `osd WxH` (both print), drop the
dead fields.

### Ultrawide Fit/Fill + surface-rect diagnostics (2026-11-21, after the takeover fix)

- The user's ultrawide (3440×1440) showed the video boxed on all four sides. The
  source (`Black.Doves` S01, ffprobe) is **3840×2160, DAR 16:9, square pixels**,
  so in a 2.44:1 window **left/right bars are correct** — mpv is doing its job.
- **New control:** `media_player_set_fill(fill)` sets mpv `panscan` 1/0;
  `PlayerOverlay` ships a labelled `Fill`/`Fit` button in the bottom bar
  (aria-pressed, default **Fit**, per-title, not persisted). Fill crops ~14 % of
  the frame height for a 16:9 source in this window — the user asked for the
  toggle rather than a default.
- **Diagnostics for the remaining question** (why the picture also sat ~136 px
  below the window top): every `media_player_set_rect` now logs
  `surface rect: css=(…) content_h=… frame=(…) backing=(WxH) view_flipped=…`, and
  the 5 s `media.player.perf` line gained mpv's own picture rect
  `osd WxH bars l t r b`. If `bars t/b` are 0 while the black band persists, the
  bug is the NSView frame/offset; if `bars t` is ~136, mpv is fitting a stale
  surface size.

### Player-mode takeover bug (fixed 2026-11-21, `886a629`)

Screenshot of live torrent playback showed the media rail, CommandBar and status
bar around the video. Root cause: **`mediaStore.streamTorrent` set `playerSource`
without setting `screen: "player"`** (only `openPlayer` did), so `MediaShell` kept
the rail/top bar and the native surface opened at `rect x=72` (inset by the 72 px
rail) — the log line `open requested … rect=(72,88,3368,1096)` is the tell.
Any new path that sets `playerSource` MUST also set `screen: "player"`.
`App.tsx` now hides CommandBar/Sidebar/StatusBar while in player mode (TitleBar
stays for window controls + drag). `capabilities/default.json` gained
`core:window:allow-set-fullscreen`/`allow-is-fullscreen`: F and the fullscreen
button were no-ops (`not allowed by ACL` in `maxplorer.log`).
**Read first:** the backlog below, then `docs/MEDIA_PLAYER_HANDOVER.md` §4.6 and
`src-tauri/src/player.rs` / `render.rs`. This WP is backend + measurement: every
item is one measurable change, one per session, before/after numbers in the
commit message.

### WP4b item 1 — as built (2026-11-21)

- `player.rs`: `is_volatile_property` (`time-pos`, `demuxer-cache-time`,
  `cache-speed`, `cache-buffering-state`, `paused-for-cache`) now only sets an
  `AtomicBool` dirty flag; a `mpv-ticks` thread emits the new compact
  `media-player://tick` payload (`{position, duration, cachePercent,
  cacheSeconds, cacheSpeed, pausedForCache}`) at most once per 250 ms. Everything
  discrete (`pause`, `mute`, `volume`, `duration`, `media-title`, `video-format`,
  `file-loaded`, `eof-reached`, `core-idle`) still sends the full
  `media-player://state` immediately, as do FILE_LOADED / PLAYBACK_RESTART /
  END_FILE.
- Counters `PROP_EVENTS`/`FULL_EMITS`/`TICK_EMITS` log a `media.player.perf` line
  every 5 s: `state ipc: N mpv property events -> X full + Y coalesced across 5.0s
  (Z msg/s)`. That is the in-app number to quote; it also seeds item 8.
- Frontend: `NativePlayerTick` in `types.ts`, `patchPlayerStatus` in
  `mediaStore` (merges into the existing status, never replaces it so discrete
  fields survive), second listener in `PlayerOverlay`. Seek-bar width already has
  `transition: width 250ms linear` (media.css), so 4 Hz ticks look continuous.
- Proof: `cargo test --lib live_property_event_rate -- --ignored --nocapture`
  plays an ffmpeg-built 60 fps fixture through the real libmpv with the real
  observed-property set and asserts the coalesced message count is >5x lower.
  Observed: `326 volatile + 4 discrete (66/s)` → `25 messages = 5/s (92.4% fewer)`.
- Gates: `npx tsc --noEmit` clean; `npx vitest run src/components/media` → 91
  passed; `cargo test --lib` → 110 passed / 7 ignored; built, entitlements checked
  (all four keys), installed to `/Applications/MAXplorer.app`.

### WP4b item 2 — as built (2026-11-21)

`src-tauri/src/render.rs` + a telemetry line in `player.rs`.

- **`Ring`** = `RING_SIZE = 5` × 64-byte-aligned `rgb0` `FrameBuffer`s, each in a
  `Mutex`, plus a **consumer-driven free list** (`VecDeque`, FIFO) and a `recent`
  queue. `present` builds `CGDataProviderCreateWithData(.., release = None)` +
  `CGImage` **over the rendered memory in place** — no `Vec::to_vec`, no per-frame
  allocation. `Frame` (which carries an `Arc<Ring>` + the raw pointer) releases its
  slot on `Drop`; a slot stays out of the free list for `RELEASE_LAG = 2`
  presents (compositor grace), and `acquire` waits up to 40 ms for a slot before
  dropping the frame as real backpressure.
- **⚠️ Regression the first cut shipped, and why the design changed:** the initial
  version guessed from the producer side (`presented_seq >= slot_seq + 2`) with 3
  buffers — zero slack, so *every* frame the presenter landed one behind was
  refused. Measured live: `24.0 fps` before → **4–6 fps, ~50 % dropped**. Buffers
  needed = 1 rendering + `RELEASE_LAG` + presenter lag. A LIFO free list also
  starved the deepest buffer (ring cycled 3 of 4 forever), hence FIFO.
- Numbers (`cargo test --release --lib bench_present_path -- --ignored --nocapture`,
  3416×1700 = 22.2 MB/frame): copy path **0.97 ms/frame** → zero-copy **<0.01 ms**;
  ~1.3 GB/s of allocator churn at 60 fps returned.
- **Telemetry, so "fps is dropping" is a number** (`media.player.perf`, every 5 s,
  logged from the mpv control thread): `playback: source <container-fps> fps, vf
  <estimated-vf-fps> fps, vo-drops, decoder-drops, pos`. `media.render` now adds
  `ms/frame in mpv` and `lag` (rendered − presented) next to its fps/drop counters.
  Attributing a loss: source 24 + both mpv drop counters flat + `media.render` 5
  fps ⇒ ours; drop counters climbing ⇒ decode/VO starvation.
- Proof: `live_ring_renders_in_place` → `24 frames, 5 distinct surface addresses,
  24 painted`; new `ring_absorbs_a_presenter_lagging_one_or_two_frames`;
  `live_sw_render_paints_pixels` still `67769/76800`; `cargo test --lib` →
  113 passed / 9 ignored.

### WP4b backlog — player engine performance (measured from the code, not guessed)

Reading `src-tauri/src/player.rs` + `render.rs` on 2026-11-21 found these; each is
a separate, measurable change. Do them one per session maximum, with before/after
numbers in the commit message.

1. **`emit_state` fires per frame.** `MPV_EVENT_PROPERTY_CHANGE` → `emit_state()`
   for every change, and `time-pos`/`cache-speed`/`demuxer-cache-time` change
   ~per frame → a full `PlayerStatus` JSON to the webview up to 60×/s, each
   re-rendering `PlayerOverlay` while video is compositing. Fix: dirty-flag +
   250 ms coalesced "tick" event `{position, cachePercent, cacheSeconds,
   cacheSpeed}`; immediate full event only for discrete changes (pause, mute,
   volume, file-loaded, error, eof, playback-restart). Expect ~95 % less IPC and
   React work; the bar stays smooth via a CSS transition.
2. ~~**Per-frame full-frame memcpy in `render.rs#present`.**~~ **DONE (item 2 as
   built, above).** `buffer.snapshot()` copied the whole RGB frame (~23 MB at
   3416×1700@2x) plus a fresh `CGDataProvider` + `CGImage` per frame, posted to
   the main thread. Now a 5-buffer ring (free list + two-present grace) with
   `CGImageCreate` over the raw buffer
   and a two-frame lease.
3. **SW scaler / render-target size.** The SW renderer scales in CPU at
   bicubic/lanczos into the full backing size. Set `scale=bilinear`,
   `dscale=bilinear` for the `vo=libmpv` path and cap the target at
   `min(stage backing, 2560 px wide)` — CALayer scales the rest for free.
4. **Main-thread dispatch per frame** — frame-generation counter, drop stale
   frames before dispatch, one reusable block.
5. **Prewarm the session** — create the mpv core + render context when the detail
   screen opens (or keep one idle core), `loadfile` on Play; on torrent rows start
   mpv paused+hidden while the swarm resolves. ~100–300 ms off first frame.
6. **Per-source cache policy** — torrent: `demuxer-readahead-secs=120`,
   `cache-pause-wait=2`, 512 MiB forward; direct HTTP/debrid: `cache=no` (CDN
   links are seekable; buffering only delays start).
7. **Seek path** — `hr-seek=yes` for short jumps; throttle/deduplicate seeks.
8. **Telemetry** — log `vo-drop-frame-count`, `decoder-frame-drop-count` and
   render ms/frame to `media.player.perf` every 5 s, so "it feels slow" is a number.

Acceptance for WP4b: webview CPU during 4K playback, `media.player.perf` drop
counts, time-to-first-frame and seek latency recorded before/after; plus the
existing headless proofs (`cargo test --lib live_sw_render_paints_pixels`,
`live_stream_gate`) still green.

### What exists (all verified live in the installed app)

| Phase | Commit | What ships |
| --- | --- | --- |
| 1 | `67c7cc2` | Stremio addon protocol client (`src-tauri/src/media.rs`: `media_addon_manifest`, `media_catalog` via reqwest) + `MediaWorkspace` discover UI rendering **live Cinemeta** catalogs with real posters. Opened via CommandBar Media toggle (play icon). |
| 2 | `7f388d3`, `e8882d4`, `41b4139` | `media_streams` command + ranked streams sheet. Click a poster → ranked rows (quality → direct/debrid → size), HDR/4K flags, size parsed from release titles. **Torrentio moved to `torrentio.strem.fun`** (`.strem.io` no longer resolves) — fixed mid-phase. |
| 3 | `c73a1a0`, `35f05fa` | In-app playback: `PlayerOverlay` (design-matched dark HTML5 video, space/←/→/m/Esc keys, seek bar, volume, buffering spinner, error card) for direct HTTP/HLS URLs; `media_play` command detects external player (IINA > VLC > mpv > default; VLC on this machine, verified with real network stream). Rows: `▶ Play` (in-app) + `↗ External`. |
| 4 | `dde5c1e` | Debrid integration (`src-tauri/src/debrid.rs`): Real-Debrid + TorBox APIs convert torrent info-hashes to direct stream URLs (`media_debrid_resolve`), config persisted in app data `debrid-config.json` (`save/get/test_key` commands). Torrent rows show `▶ Stream` button. |
| 4b | `torrent.rs` | Embedded **librqbit** torrent engine (`media_torrent_start`/`media_torrent_status`) + librqbit's built-in HTTP stream server on `127.0.0.1:18081`. `▶ Stream` works with **no debrid key**; range/seek verified live with Sintel. |
| 4c | `mpv.rs`, `player.rs` | Native **libmpv** playback replacing the HTML5 `<video>`. ⚠️ This row originally claimed in-window embedding via mpv's `wid` option — **that was wrong** (macOS ignores `wid`; video opened in mpv's own window). Superseded by 4d. Plays MKV/HEVC/AC3/DTS — what the webview refused. Needs mpv **master** (`brew install mpv --HEAD`); `media_player_diagnostics` reports support. |
| 4d | `render.rs` (new), `player.rs`, `PlayerOverlay.tsx` | **Video now renders inside the app window** via the libmpv **render API** (`MPV_RENDER_API_TYPE_SW` → CGImage on the NSView layer). No second window, no `wid`. Buffering pill (cache % + MB/s) + buffered span on the seek bar. Headless proof: `cargo test --lib live_sw_render_paints_pixels -- --ignored --nocapture` → `non_black_pixels=67769/76800`. |
| 4e | `torrent.rs`, `player.rs`, `PlayerOverlay.tsx` | **Blank-player fixes + live stats.** The stream URL is now Range-probed before it reaches mpv (librqbit answered HTTP 500 while a torrent was still setting up, and mpv's own "couldn't resolve" retry made it look random). The native surface starts hidden and is revealed on `file-loaded`, so the spinner/error card is never covered by a black rectangle. Header shows `↓ speed · Ns buffered · N peers`; stream rows show speed + peers while resolving; `framedrop=vo` keeps A/V in sync on a slow SW render; render fps is logged every 5 s. |
| UI WP3 | `feature/media-ui-wp3` | Screen B per §4: `MediaDetail` (dimmed backdrop, logo art, meta + IMDb pill, synopsis, GENRES/CAST/DIRECTORS chips, action row), `StreamsPanel` (docked at ≥1600 px / slide-over below, filter `All · Cached/Instant · 4K · 1080p · Torrents`, `Show all` past 60 rows, skeletons + retry) and the 7-line `StreamRow` on `--m-*` tokens with in-row engine states; `streams.ts` now parses bitrate, runtime, audio formats/channels, HDR, release group and the addon's flag-emoji languages, and the old inline sheet is gone. |
| UI WP1 | (this branch) | Media app shell per `docs/MEDIA_UI_SPEC.md` §1–2: `media-tokens.css` (violet `#7051F3` token set scoped to `.media-app`), `MediaShell`/`MediaRail`/`MediaTopBar`/`icons.tsx`; the old title bar and 216 px side nav are gone, the status strip moved into the board, and the store gained `screen` + `searchQuery`. |
| UI WP2 | `feature/media-ui-wp2` | The board per §3: `MediaHero` (full-bleed Cinemeta art upgraded to the `large` metahub variant, logo art with text fallback, meta line + gold IMDb pill, 2-line synopsis, accent Watch pill + library/episodes circles), `MediaCarousel` + `MediaPosterCard` (0.7 posters, in-art progress, NEW badges, snap scroll with edge fade, hover play overlay, skeletons, per-row Retry), a 57 %-height hero that bleeds under the floating top bar, Continue watching first from the progress stub store, the pinned-addons panel folded into quiet footer chips, and `media.rs` now passing `genres`/`runtime`/`cast`/`director`/`released` through `CatalogMeta`. |

### ⚠️ CRITICAL USER FEEDBACK (why the next session exists)

**Debrid must be OPTIONAL.** The user rejected "Stream requires a paid debrid key".
Torrentio without a key returns only torrent hashes, so `▶ Stream` used to do nothing
without debrid configured. **Phase 4b fixed this**: the embedded librqbit engine is the
missing free path, and debrid is now a per-row accelerator, never a requirement.

### Phase 4b — torrent engine (DONE)

`src-tauri/src/torrent.rs` embeds **librqbit 8.1.1** and runs librqbit's **built-in
`HttpApi`** server on `127.0.0.1:18081` (started lazily on first use). `▶ Stream` on
a torrent row now resolves to a local, seekable URL with **no debrid key** — the
free path the user demanded. Debrid stays a per-row accelerator.

API facts that were re-confirmed against the vendored 8.1.1 source:

- `TorrentIdOrHash::parse(&str)` handles 40-char hex; there is NO `InfoHash` variant.
- `Api::api_torrent_list/api_torrent_details/api_stats_v1` are **synchronous**;
  `api_add_torrent` is async. `Api::new(session, rust_log_tx, line_broadcast)` takes
  **three** args once librqbit's `tracing-subscriber-utils` feature is on (see below).
- `TorrentDetailsResponse.files = Option<Vec<TorrentDetailsResponseFile { name, length, .. }>>`
  (index = position, `None` until metadata resolves).
- **Feature set matters:** `http-api` pulls in handlers that call the
  `tracing-subscriber-utils`-gated `api_log_lines_stream`, so librqbit must be pulled
  with `default-features = false, features = ["rust-tls", "http-api",
  "tracing-subscriber-utils"]` — without the last one librqbit itself fails to build
  (`no method api_log_lines_stream`).
- `HttpApi::new(api, Some(HttpApiOptions { read_only: false, basic_auth: None }))`
  + `make_http_api_and_run(listener, None)` gives the full server, including
  `GET /torrents/{id_or_hash}/stream/{file_idx}`. **Range caveat:** it honours only
  the open-ended `bytes=N-` form; a closed `bytes=0-1023` is ignored and returns 200 +
  the full body. Open-ended is what media elements send to seek, so playback/seeking
  works; don't "fix" a closed-range 200 as a bug.

Verified live from the Rust test harness (no UI needed):
`cargo test --lib live_engine -- --ignored --nocapture` boots a real session, adds
webtorrent **Sintel** (`08ada5a7a6183aae1e09d831df6748d566095a10`), waits for metadata,
and gets `HTTP 206 Partial Content`, `Content-Range: bytes 5000000-129241751/129241752`.

### Build & environment quirks learned

- DMG bundling fails with `hdiutil: couldn't unmount diskN - Resource busy` when stale
  `rw.*` DMG mounts linger → `hdiutil detach /Volumes/dmg.* -force`, rerun
  `npm run tauri build -- --bundles dmg`.
- App requires macOS 12+, Tauri 2; frontend gates: `npx tsc --noEmit` +
  `npx vitest run src/components/media` (10 tests); Rust gates: `cargo test --lib media` (5)
  + debrid tests.
- Media test files need `// @vitest-environment jsdom` header (default env is node).
- `fireEvent.click` required in tests — plain `.click()` does not trigger React synthetic
  events reliably here.

### UI redesign (Stremio-parity) — READ BEFORE ANY MEDIA UI WORK

The media workspace + player are being redesigned to match Stremio's desktop UI
(user-supplied 3440x1410 screenshots). The complete implementable spec — tokens,
layout, three screens, component/file inventory, data mapping, keyboard + a11y
rules, and six work packages — is **`docs/MEDIA_UI_SPEC.md`**. Reference images
(not in git) live in `~/hermes-workspace/maxplorer-media/ui-reference/`.
It supersedes `Maxplorer Media UI Concept.html` for the media area only; the
file-explorer chrome is out of scope. Implement it WP by WP, one per session.

### Verified state of this build (2026-11-21)

- `cd src-tauri && cargo test --lib` → **110 passed / 6 ignored**; live proofs:
  `live_sw_render_paints_pixels` (render API paints pixels),
  `live_stream_gate` (torrent URL serves 206 before the player gets it),
  `live_engine` (Range seek), `live_decodes_mkv` (MKV/H.264/AC3).
- `npx tsc --noEmit` clean; `npx vitest run src/components/media` → 21 passed (UI WP1).
- Build + install: `npm run tauri build` (background, ~6–8 min), then copy
  `src-tauri/target/release/bundle/macos/MAXplorer.app` to `/Applications`.
- **Live torrent tests need the app quit first** (a second librqbit session fails
  with `error initializing persistent DHT`).
- Unknown/unverified by the agent: what the picture actually looks like on screen
  (this box composites blank) — the user confirms visually; ask for
  `~/Library/Application Support/com.replica.win11explorer/logs/maxplorer.log`
  (`media.render` fps lines answer "slow" vs "no data").
- Deferred by measurement: the GL render backend. Logs show the SW renderer
  matching source frame rate at 4K (`render: 24.0 fps` / `60.0 fps` at
  3024x1458), so do **not** start it unless a future log shows fps below the
  source rate.

### Remaining media roadmap (one per session)

**0. (current) The Stremio-parity UI redesign — `docs/MEDIA_UI_SPEC.md` WP1…WP6,
   one work package per session.** The numbered roadmap below resumes after WP6.

5. Addon manager UI (install/remove by manifest URL, pinned-addons rail)
6. Library & sync (My Library, progress, Trakt; self-hostable sync)
7. ⭐ VERY IMPORTANT — TV/mobile remote-friendly (Android TV via Tauri 2 Android,
   iOS/Apple TV via Tauri 2 iOS or RN/web client; prerequisite: media-core exposed as a
   local HTTP JSON API so TV/mobile stream from the desktop/LAN box, never P2P on TV;
   D-pad + TV-safe UI are acceptance criteria)

Optional engineering follow-up (not a roadmap phase): swapping the SW render backend
for `MPV_RENDER_API_TYPE_OPENGL`. **Do not start it without new evidence** — see the
deferred-by-measurement note above. Plan and rules: `docs/MEDIA_PLAYER_HANDOVER.md`
§4.3 Option A.

---

## 1. What this is

MAXplorer is a native macOS desktop file manager that browses the **real macOS
filesystem**. It includes interchangeable Windows Explorer and macOS Finder themes, each
with light and dark appearances. It is an independent implementation, not a mockup,
screenshot embed, or themed wrapper around a generic file manager.

| Item | Value |
| --- | --- |
| Stack | Tauri 2 + Rust backend + React 18 + TypeScript + Zustand |
| Bundle ID | `com.replica.win11explorer` |
| App name | MAXplorer |
| Minimum macOS | 12.0 |
| Architectures | Universal (arm64 + x86_64) |
| Signing | Ad-hoc (`signingIdentity: "-"`), **not notarized** |
| License | MIT (independent file manager; not affiliated with Microsoft or Apple) |

### Current status

The project is **feature-complete for the scoped feature set**. The shipped 0.1.0 DMG
launches, renders the Windows 11 shell, and browses real macOS folders; the project owner
confirmed it working on a Mac on 2026-10-28.

Since that release, the project has gained these changes:

- **MAXplorer identity** — product name, application icon, About screen, bundle metadata,
  window titles, menus, and packaging now use the MAXplorer brand.
- **Unified three-layer chrome** — window-only title bar, one global command bar (file
  operations, organization, workspace, Settings), a dedicated navigation/search row, and a
  dedicated tab row. Dual-pane mode repeats navigation and tabs per pane. The single/dual
  toggle moved into the command bar; Appearance left the sidebar; Themes/Options/Shortcuts
  became one Settings dialog.
- **Dual interface themes** — Windows 11 Explorer and macOS Finder, each in light and dark,
  switchable from Settings → Appearance or the command-bar Settings menu. Behavior, state,
  and filesystem access are shared; only tokens and layout CSS differ.
- **Real `.app` icons** — application bundles in `/Applications` show their own ICNS/PNG
  artwork instead of a generic executable glyph.
- **Premium icon system** — Lucide functional icons with shared sizing/stroke tokens, a
  typed file-type registry, theme-aware folder/storage artwork, real transfer-state
  indicators, and lazy image thumbnails. See `docs/ICON_SYSTEM.md`.
- **Visual Appearance Platform** — a six-step Theme Creator for non-technical users,
  12 ready-made templates, coordinated palette generation, contrast repair, optional
  icon packs, live MAXplorer previews, automatic drafts, undo/redo, and one-click save,
  export, share, and import of `.maxTheme` / `.maxIcons` packages. See
  `docs/THEME_CREATOR_GUIDE.md` and `docs/THEME_PACKAGE_SPEC.md`. Theme files are strict
  JSON and can be authored by AI agents using `docs/AGENT_THEME_AUTHORING.md`; use the
  ignored root `_comments` object for notes, and validate with
  `scripts/validate-theme.ts`.
- **Dual-pane workspace** — independent left/right panes, resizable/collapsible split,
  real streamed copy/move with conflict prompts and progress, read-only folder comparison,
  and optional synchronized navigation. See `docs/ARCHITECTURE.md` and
  `docs/FEATURE_MATRIX.md`.

Cut/paste fix (2026-10-29, now merged): Cmd+X then Cmd+V looked like a copy on macOS. The
move itself worked; `paste()` attributed the transfer to the destination pane, so the pane
the items came from kept listing them, and cut items had no visual state. Moves now also
reload every pane showing a source folder, and cut entries are dimmed like Explorer. See
`docs/DEVELOPMENT_LOG.md` (Phase 11). The interactive macOS confirmation is still pending.

Merged after that: the **premium icon system** (Phase 12) and **Universal Search**: a
single navigation search field, a command
overlay, full search workspace, local SQLite/FTS5 index, bounded live scan, Spotlight, and
duplicate verification. `FileGlyph` and `Icon` remain compatibility facades over
`FileTypeIcon` and `AppIcon`. See `docs/ICON_SYSTEM.md` and `docs/UNIVERSAL_SEARCH.md`.

The current branch adds the **unified three-layer command center** (Phase 13): dedicated
chrome layers, a responsive global command bar, one consolidated Settings dialog, display
scaling/density, sidebar collapse, column visibility, and per-pane navigation/tab rows in
dual-pane mode. See `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT_LOG.md`.

All changes are validated on the Windows development host (WebView2) and on the macOS
development host for typecheck/tests/build; the icon system was also visually inspected in
a temporary browser preview. The published 0.1.0 DMG predates them.

Verified before this handover:

- macOS 14.8.9 CI build of a universal DMG, plus a smoke launch of the published DMG with
  a real screenshot (`docs/screenshots/macos-smoke.png`).
- macOS 14 CI build of the merged `main` tree succeeded on 2026-10-28 (run `40648095307`,
  5m19s: typecheck, 49 frontend tests, 18 Rust tests, universal build, DMG verification).
- Owner-confirmed interactive run on a Mac for the 0.1.0 baseline.
- The owner's macOS `transferHistory` (read from the app's WKWebView localStorage)
  confirmed that cut+paste ran as `mode: move` / `completed`, which isolated the
  2026-10-29 report to stale source-pane reloads rather than a copy fallback.
- `npm run typecheck`, `npm test` (**246 tests / 26 files**), `cargo test` (**48 tests**),
  `npm run build` all passing on the development host (dual-pane feature pass, cut/paste
  fix, premium icon system, Universal Search, unified command center, and Appearance
  Platform).
- Windows release build exercised for UI/interaction validation.
- Theme switching, persistence, keyboard activation, both appearances, and synthetic
  `.app` icons exercised in the Windows dev build; see `docs/VALIDATION.md`.

Not verified (see [§8](#8-known-limitations-and-risks)): a formal macOS interaction pass
for the theme, app-icon, and cut/paste work; Developer ID signing, notarization; and Mac
App Store sandboxing.

### Next session at a glance

Start here; everything else in this document is reference.

1. `git pull` on `main`. The dual-theme/app-icon work, cut/paste fix, and premium icon
   system are merged; history is linear.
2. Re-run the four checks in [§5](#tests-and-checks-run-before-every-push) to confirm the
   tree is clean.
3. On a Mac, build and launch the current source, then run the pending interaction pass:
   switch to the Finder theme in both appearances, browse real `/Applications`, and confirm
   real bundle icons, the new file/folder artwork, traffic lights, menus, and TCC prompts.
   Also cut a file in one pane, paste it in the other, and confirm the source pane clears
   immediately and no copy is left on disk.
4. Record what you observe in `docs/VALIDATION.md` and add screenshots to
   `docs/screenshots/`. If anything fails, fix it before starting new features.
5. Only then move on to the distribution work in [§10](#10-suggested-next-steps-prioritized).

The published `v0.2.0` DMG is built from `main`; `v0.1.0` predates these changes and should be ignored.

---

## 2. Five-minute orientation

```bash
git clone https://github.com/helloraj1986/MAXplorer.git
cd MAXplorer
npm install
npm run tauri:dev          # dev app against your real home folder
```

Read in this order:

1. `README.md` — feature list, quick start, limitations.
2. `docs/BRANDING.md` — product identity, application icon, metadata, and theme independence.
3. `docs/ARCHITECTURE.md` — data flow, module boundaries, contracts.
4. `docs/THEMES.md` — interface theme model, tokens, persistence, adding a theme.
5. `docs/THEME_CREATOR_GUIDE.md` — create a theme visually, no coding required.
6. `docs/AGENT_THEME_AUTHORING.md` — short checklist for AI-authored theme files.
7. `docs/THEME_PACKAGE_SPEC.md` — `.maxTheme` / `.maxIcons` schema and validation.
8. `docs/FEATURE_MATRIX.md` — every studied Explorer feature and its status.
9. `docs/VALIDATION.md` — what was actually run and observed.
10. `docs/MACOS_DMG.md` — packaging, signing, notarization, Gatekeeper.
11. `docs/REFERENCE.md` — how the Windows 11 reference was captured and measured.
12. `docs/DEVELOPMENT_LOG.md` — chronological build log.

The UI follows the Windows Explorer reference closely, so most "why does it look like this?"
questions are answered by `docs/REFERENCE.md` (colors, geometry, control inventory from a
real Windows 11 21H2
host plus REA 6.8.0 PE-resource evidence).

---

## 3. Repository map

```
src/                          React + TypeScript UI
  App.tsx                     Root layout and view composition
  components/                 Shell, command bar, sidebar, views, menus, dialogs, panes
    FileArea.tsx              Details/list/icons/tiles/content rendering, selection, drag
    CommandBar.tsx            Layer 1 unified commands, workspace toggle, Settings menu
    NavigationBar.tsx         Layer 2 breadcrumbs, editable address bar, search box
    PaneTabs.tsx              Layer 3 tab rows, overflow menu, per-pane tab controls
    DualPaneWorkspace.tsx     Split, collapse rails, per-pane navigation/tab layers
    Sidebar.tsx               Navigation-only: quick access, This Mac, volumes, pins
    TitleBar.tsx              Window-only title bar and Finder traffic lights
    ContextMenu.tsx           File and background context menus with submenus
    Dialogs.tsx               File dialogs plus the consolidated Settings dialog
    DetailsPane.tsx           Metadata + permissions pane
    PreviewPane.tsx           Image, text, and app-icon preview
    FileGlyph.tsx / Icon.tsx  Compatibility facades over the central icon system
    icons/                    AppIcon (Lucide), FileTypeIcon, FolderIcon, StorageIcon,
                              SyncStatusIcon
  hooks/                      Keyboard, theme, virtual rows, marquee, window persistence
  lib/                        Typed IPC API, themes, app icons, formatting, sorting, history,
                              tabs, persistence
    appearance/               Theme model, colour maths, templates, packages, token map,
                              offline description matcher, icon packs
    icons/                    File-type registry, native icon service, thumbnail service
  state/explorerStore.ts      Single Zustand store: panes, tabs, navigation, selection,
                              clipboard, transfers, dialogs
  state/appearanceStore.ts    Custom theme library, active theme, icon packs, drafts
  styles/                     tokens.css + app.css + finder.css (scoped Finder layout)
                              + appearance.css (creator, preview, custom themes)
src-tauri/                    Rust backend
  src/commands.rs             All 32 Tauri commands; platform launching
  src/listing.rs              Directory reads, metadata, hidden files, symlinks
  src/operations.rs           Copy/move/rename/delete/duplicate/conflict resolution
  src/transfer.rs             Streamed copy/move queue: 256 KB chunks, progress, pause/cancel
  src/compare.rs              Read-only folder comparison with optional byte verification
  src/search.rs               Bounded, cancellable recursive name search
  src/metadata.rs             Properties, folder stats, text preview, sidebar locations
  src/app_icons.rs            `.app` icon lookup, ICNS extraction, PNG data URLs
  src/paths.rs                Path/name validation, self-move and protected-root guards
  src/error.rs                Typed error codes surfaced to the UI
  src/types.rs                Serialized IPC contracts
  src/tests.rs                Rust unit/integration tests (tempfile-based)
  tauri.conf.json             Window, CSP, asset protocol, DMG layout, ad-hoc signing
  capabilities/default.json   Tauri permission allowlist
docs/                         Architecture, themes, reference, matrix, validation, DMG, log
themes/                       Ready-to-import .maxTheme examples and annotations
reference/                    Windows 11 screenshots, UIA dumps, fixtures, REA JSON
scripts/                      build-macos-dmg.sh + verification helpers + theme validator
.github/workflows/            macos-build.yml, macos-smoke.yml
```

`rea/` (reverse-engineering tooling) and build outputs are git-ignored.

---

## 4. How it works

### Data flow

```
React component
  -> src/lib/api.ts            typed invoke() wrapper
    -> Tauri command          src-tauri/src/commands.rs
      -> module               listing / operations / search / metadata / paths
        -> std::fs, trash, dirs, Command (open, open -R, osascript)
```

Rules the codebase follows:

- **The Rust side owns every filesystem read and write.** The UI never fabricates entries.
- **All IPC is typed** in `src/lib/types.ts` and `src-tauri/src/types.rs`.
- **Errors are coded**, not stringly-typed: `src-tauri/src/error.rs` maps I/O failures to
  permission / not-found / conflict / invalid-name / protected-path / generic, and the UI
  renders distinct states (including an "Open System Settings" action for TCC denials).
- **One store, explicit actions.** `explorerStore.ts` (~70 KB) is the only state owner;
  components subscribe via selectors. Adding a feature means adding a store action, not
  local component state.

### Presentation layers (do not fork behavior)

- **Interface theme** is a separate axis from light/dark: `interfaceTheme` is `"windows"`
  or `"finder"` and is persisted independently from `theme` (`system`/`light`/`dark`).
  `data-ui-theme` and `data-theme` on `<html>` select tokens; `finder.css` only contains
  scoped layout overrides. Both themes call the same store actions and Tauri commands.
- **App icons** are content, not chrome. `FileTypeIcon` asks the backend for a PNG data
  URL for `.app` bundles through `nativeIconService`; both themes use the same icons. If
  extraction fails, built-in application artwork is used.
- **Icon system** is centralized. `AppIcon` owns Lucide chrome icons and their
  size/stroke/tone tokens; `lib/icons/fileIconRegistry.ts` owns file classification;
  `FileTypeIcon`, `FolderIcon`, `StorageIcon`, and `SyncStatusIcon` own their visual
  states. Theme switching changes tokens only.

### Tauri command surface (32 commands)

| Group | Commands |
| --- | --- |
| Environment | `get_platform_info`, `get_initial_path`, `get_sidebar_locations` |
| Navigation | `resolve_path`, `path_exists`, `list_directory` |
| Search | `search_files`, `cancel_search` |
| Create | `create_folder`, `create_text_file`, `create_symlink` |
| Modify | `rename_path`, `copy_paths`, `move_paths`, `delete_paths`, `duplicate_paths` |
| Transfer | `transfer_paths`, `cancel_transfer`, `pause_transfer` |
| Compare | `compare_folders`, `cancel_compare` |
| Inspect | `get_properties`, `get_folder_stats`, `read_text_preview`, `list_applications`, `read_app_icon` |
| Launch | `open_path`, `reveal_path`, `open_terminal`, `open_with`, `open_system_settings` |
| Appearance | `save_appearance_package` |

### Persistence

UI state is stored in `localStorage` (WKWebView website data for the bundle ID), under
`win11-explorer-state-v1` and `win11-explorer-window-v1`. It is versioned and defensively
validated on load (`src/lib/persistence.ts`); malformed data falls back to defaults rather
than crashing. Persisted: tabs, per-tab history, view mode, sort, group, column widths and
visibility, sidebar width/visibility, command-bar labels, text/icon scale, row density,
folder-open behavior, Trash confirmation, pinned folders, recents, light/dark theme,
**interface theme**, panes, hidden/extension toggles, window bounds.

The theme pair is also read by an inline script in `index.html` and applied to `<html>`
before the first paint, so the window never flashes the wrong design. Keep that script and
`src/lib/theme.ts` in sync when changing theme ids or defaults.

To reset to a first-run state: quit the app, then delete the app's WebKit data container
(search `~/Library` for `com.replica.win11explorer`).

### Development-only start path

`WIN11_EXPLORER_START_PATH=/path/to/folder npm run tauri:dev` opens that folder on launch.
Used by screenshots and the CI smoke run so no personal folders are touched. It has no
effect on normal launches.

---

## 5. Build and release

### Local development

```bash
npm install
npm run tauri:dev
```

### Tests and checks (run before every push)

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest, 219 tests / 24 files
npm run test:cargo    # cargo test, 48 tests (filesystem, app icons, transfer, comparison, search/index)
npm run build         # tsc -b && vite build
```

### Build the macOS app and DMG locally (on a Mac)

```bash
bash scripts/build-macos-dmg.sh        # alias: npm run build:mac
```

This is the single build entry point — there is no separate `tauri build` step to remember,
and CI runs the same script. It refuses to run on non-macOS, checks Xcode CLT/Node/Rust,
resolves the signing identity from `tauri.conf.json` (and verifies the certificate is in the
keychain), installs deps, runs all checks, builds `universal-apple-darwin`, produces the
`.dmg` and `.app.zip`, verifies signature and disk image, then stages everything into
`dist-macos/` with `SHA256SUMS.txt`.

Faster loops: `--native`, `--skip-tests`, `--skip-install`, `--no-zip`, `--out <dir>`.
Raw bundler output stays in
`src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/`.

### CI

`.github/workflows/macos-build.yml` runs on `macos-latest` for pushes/PRs to `main` that
touch code or build configuration (docs-only and `reference/`-only changes are ignored), and
on demand. Steps: checkout → Node 22 → Rust stable with both Apple targets →
`bash scripts/build-macos-dmg.sh` with `APPLE_SIGNING_IDENTITY="-"` (CI holds no certificate,
so it signs ad-hoc) → upload `dist-macos/*.dmg` + `SHA256SUMS.txt` and `dist-macos/*.app.zip`
as artifacts (`maxplorer-macos`, `maxplorer-app`).
Typical duration ~6 minutes; macOS runners can queue.

`.github/workflows/macos-smoke.yml` is manual (`workflow_dispatch`). It downloads the
published `v0.1.0` DMG, mounts it, copies the app out, clears quarantine, launches it,
asserts the process is alive, screenshots the screen, and uploads evidence.

### Releasing a new version

1. Bump `version` in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
   (all three must match).
2. Run the checks above; commit and push to `main`.
3. Wait for the `macOS build` run to succeed; download the `windows11-explorer-macos`
   artifact (DMG + `.sha256`).
4. `gh release create vX.Y.Z --repo helloraj1986/MAXplorer --notes-file NOTES.md --prerelease --target main <dmg> <dmg>.sha256`
5. Point `macos-smoke.yml` at the new tag (it currently hardcodes `v0.1.0`) and run it to
   confirm the published artifact launches.

### Shipped 0.1.0 artifact

| Field | Value |
| --- | --- |
| Build run | https://github.com/helloraj1986/MAXplorer/actions/runs/40490663104 |
| Smoke run | https://github.com/helloraj1986/MAXplorer/actions/runs/40492290652 |
| Asset | `Windows.11.Explorer_0.1.0_universal.dmg` (GitHub replaced spaces with dots) |
| Size | 3,310,805 bytes |
| SHA-256 | `AE6A6758D2007DDD954E39DAB7B1665CBED8FB3BC49A026F738F4ACC20B845CA` |

Structural verification performed on the DMG: valid UDIF container with HFS filesystem;
contains `Windows 11 Explorer.app`, an `Applications` shortcut, `.VolumeIcon.icns`;
`Contents/MacOS/win11-explorer` has a universal Mach-O fat header (`CA FE BA BE`, 2 archs);
`Info.plist` carries the expected bundle ID, version, `LSMinimumSystemVersion 12.0`, and
TCC usage descriptions; `_CodeSignature` present.

> This artifact predates the dual-theme and real-app-icon work. Rebuild from current
> `main` (or download a newer CI artifact) to exercise those changes.

### Signing and notarization (the main outstanding distribution task)

The build is ad-hoc signed. On another machine Gatekeeper will block it until the user
right-click → Opens it, or clears quarantine:

```bash
xattr -dr com.apple.quarantine "/Applications/MAXplorer.app"
```

For a proper Developer ID build, set `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD` (app-specific), and `APPLE_TEAM_ID` as CI secrets (or env vars locally),
change `signingIdentity` in `src-tauri/tauri.conf.json`, and let Tauri notarize. Full
steps: `docs/MACOS_DMG.md`.

---

## 6. What works (verified)

Navigation (back/forward/up/refresh, breadcrumbs, editable address bar, invalid-path
feedback), tabs (new/close/switch/duplicate/reorder/restore), all eight view modes with
resizable and sortable details columns, grouping, recursive name search (cancellable,
bounded), full selection model (click, Cmd/Ctrl-click, Shift-range, select all, keyboard,
marquee, drag), create folder/file/symlink, copy/cut/paste/rename/duplicate/move/drag-move,
send to Desktop/Documents/Downloads, Trash delete (confirmation configurable) and permanent
delete with mandatory confirmation, conflict resolution (replace/keep both/skip/cancel),
context menus with New/Sort/View/Group/
Send to submenus, details pane (metadata, permissions, owner IDs, folder size), preview pane
(images, text, real app icons), Properties, Open With, Reveal in Finder, Open Terminal,
System Settings deep-link for denied permissions, dark/light/system appearance, and full
state persistence.

Cut and paste: a completed move reloads every pane that is showing one of the source
folders, not only the pane that received the paste, so a move cannot be mistaken for a
copy. Entries on the clipboard in cut mode are dimmed in details, list, and icon views
until they are pasted or the cut is replaced.

Interface themes: **Windows 11 Explorer** and **macOS Finder**, each in light and dark.
The Finder theme adds traffic lights backed by the same Tauri window APIs, a compact
command toolbar, a source-list navigation sidebar, 28/24 px rows, macOS menus, and centered
modal titles. Appearance lives in the consolidated Settings dialog, not the sidebar.
Switching preserves the current folder, tabs, history, selection, search, sort, display
preferences, and in-flight state without remounting the app or reloading the filesystem.

Application icons: `.app` bundles show their own icon in every view and both panes, read
from `Contents/Info.plist` and `Contents/Resources/*.icns`, with a built-in application
glyph when no icon is readable.

Icon system: Lucide functional icons with shared sizing/stroke tokens; a typed registry
for documents, images, media, archives, disk images, development files, applications,
fonts, certificates, databases and configuration; Windows/Finder folder artwork; volume
and connection-state artwork; real transfer-status indicators; lazy image thumbnails with
fallbacks. `FileGlyph` and `Icon` remain compatibility facades. See
`docs/ICON_SYSTEM.md`.

Per-feature status, including approximations, is in `docs/FEATURE_MATRIX.md`; theme
architecture is in `docs/THEMES.md`.

---

## 7. Development conventions

- **No emoji.** Chrome iconography is Lucide through `AppIcon.tsx`; file/folder artwork is
  original SVG through `FileTypeIcon`/`FolderIcon`. Real application artwork loaded from
  `.app` bundles and image thumbnails are the bitmap exceptions.
- **Themes change presentation, never behavior.** Add tokens and scoped CSS; do not fork
  store actions, Tauri commands, or filesystem code per theme. Keep
  `src/lib/theme.ts`, `index.html`, and the persisted `interfaceTheme` in sync.
- **No dead controls.** If a button is visible it must do something real. Omitted Windows
  features (Gallery, Quick Look, Compressed folder, Undo) are absent rather than stubbed.
- **Design tokens first.** Colors, radii, spacing, and type live in `src/styles/tokens.css`;
  component styling is in `app.css`. Reuse tokens instead of hard-coding colors.
- **Platform paths.** Use `/Volumes` for drives, never `C:\`; "This Mac" replaces "This PC";
  never hard-code Windows paths in UI copy.
- **Destructive operations** must be confirmed and must go through `paths.rs` guards.
- **TypeScript** is strict; `npm run typecheck` must stay clean.
- **Commits** are plain imperative summaries; the repo history is linear on `main`.

---

## 8. Known limitations and risks

Honest boundaries of 0.1.0, ordered by importance to a successor:

1. **No automated macOS interaction tests.** Startup, Home rendering, real filesystem
   access, and process stability are verified on macOS. Clicking, drag/drop, context menus,
   and file operations were exercised on the Windows dev build and by Rust unit tests, not
   by macOS UI automation. Highest-value next step is a scripted macOS UI test.
2. **Ad-hoc signing only.** Not notarized, so downloaded copies trigger Gatekeeper. This is
   the main blocker for distributing beyond the current owner.
3. **No app sandbox.** Fine for direct distribution; Mac App Store would require
   entitlements and review work.
4. **Search is name-based** and bounded (500 results / 8 s / 200,000 entries), skipping
   `Library`, `.git`, `node_modules`. No indexed content search.
5. **No undo stack.** Delete confirms and moves to Trash; there is no Windows-style Undo.
6. **Copy/move progress is streaming but coarse.** `transfer.rs` streams 256 KB chunks and
   reports speed/ETA, but the size/item scan runs before the operation starts; there is no
   per-file pause between chunks.
7. **Omitted features:** Gallery, Quick Look, PDF preview, compressed folders, column filter
   dropdowns, Properties tabs beyond General, ACL editing.
8. **Share** copies the path and offers Reveal in Finder instead of the macOS share sheet.
9. **Tabs are a 22H2-informed approximation** (the reference host was 21H2 and had no tabs);
   tab overflow scrolls horizontally instead of using the 22H2 overflow flyout.
10. **Window controls differ by theme.** The Windows theme uses custom Windows-style
    controls; the Finder theme renders CSS traffic lights that call the same Tauri
    close/minimize/maximize APIs. They are not AppKit buttons.
11. **Finder theme scope.** It recreates toolbar, source list, menus, selection, typography,
    and spacing. Finder column view, Quick Look, tags, resizable column headers, and
    alternating row stripes are intentionally absent; list view keeps the shared
    name-only rows. Native translucent materials are approximated with tokens.
12. **App icons are macOS-only content.** The backend reads the bundle on macOS; the
    Windows dev build was validated with synthetic `.app` bundles. Legacy ICNS files
    without PNG chunks depend on macOS `sips` and were not exercised. Icons are cached
    per session, so replacing an app while the window is open keeps the old icon until
    restart.
13. **CI cost control is partial.** Docs-only and `reference/`-only pushes are skipped, but
    any source change still rebuilds the universal DMG (~6 min of macOS runner time). Cargo
    and target caching are not configured.
14. **Background-tab staleness after a move.** The post-transfer refresh reloads the active
    tab of each affected pane. A background tab that shows a moved-from folder is only
    reloaded when it is activated, so it can briefly list a file that has already moved.
15. **Native artwork is limited to `.app` bundles.** Arbitrary file/folder native icons
    and QuickLook video thumbnails would require a new Rust/AppKit or QuickLook bridge.
    Image thumbnails use the existing asset protocol and are decoded by the WebView, not
    pre-sized by Rust.
16. **Storage connection state is component-only.** `StorageIcon` supports disconnected
    volumes, but the backend currently enumerates only existing `/Volumes` paths, so no
    disconnected volume is listed. `SyncStatusIcon` is wired to real transfer state; there
    is no background sync engine.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "App is damaged and can't be opened" | Quarantine on an ad-hoc signed build | `xattr -dr com.apple.quarantine "/Applications/MAXplorer.app"` |
| Gatekeeper blocks first launch | Not notarized | Right-click → Open → Open |
| Empty Desktop/Documents/Downloads | TCC permission denied | Allow in System Settings → Privacy & Security → Files and Folders; the app links there from its error state |
| `tauri:dev` fails on port 1420 | Port in use | Stop the other process; Vite is pinned to 1420 by `tauri.conf.json` |
| `npm ci` fails in CI | Lockfile drift | Regenerate `package-lock.json` and commit it |
| DMG build fails with bundler errors | Missing Rust Apple targets / Xcode CLT | `rustup target add aarch64-apple-darwin x86_64-apple-darwin`, `xcode-select --install` |
| macOS runner stuck "queued" | GitHub macOS capacity | Wait; retry later |
| UI state looks corrupted | Stale localStorage from an older build | Quit app, delete the WebKit container for `com.replica.win11explorer` |
| Search finds nothing in a big tree | Bounds hit | Narrow the folder; bounds are in `src-tauri/src/search.rs` |
| `.app` rows show the generic application glyph | No readable `Info.plist` icon, or a legacy ICNS without PNG chunks and `sips` failed | Check `Contents/Info.plist` (`CFBundleIconFile`) and `Contents/Resources/*.icns`; quit and relaunch to clear the icon cache |

---

## 10. Suggested next steps (prioritized)

1. **Finish the macOS interaction pass for themes, app icons, the icon system, and
   cut/paste** (the only unverified user-facing work). Install the rebuilt bundle from
   `src-tauri/target/universal-apple-darwin/release/bundle/macos/` (or rebuild), then check
   the Finder theme in light and dark, real `/Applications` icons, the new file/folder
   artwork, traffic lights, menus, TCC prompts, drag/drop, and Open With; and cut in one
   dual pane, paste in the other, and confirm the source pane clears at once with no copy
   left behind. Record evidence in `docs/VALIDATION.md`.
2. **Developer ID signing + notarization** in CI, so the DMG opens without workarounds.
3. **macOS UI smoke automation** (e.g. AppleScript/`osascript` or XCUITest driving the
   app): open a temp folder, switch views and themes, create a folder, rename, delete,
   verify on disk.
4. **Streamed operation progress** for copy/move (byte counts + cancel).
5. **Undo for delete/rename/move** (operation journal).
6. **Quick Look and PDF preview**, then Gallery.
7. **Native artwork bridge**: expose AppKit/QuickLook icons and video thumbnails through
   the Rust IPC layer, then use them in `FileTypeIcon` before falling back to the registry.
8. **Indexed search** (Spotlight `mdfind` bridge) as an opt-in alongside name search.
9. **Properties tabs** (Details/Security equivalents) and ACL viewing.
10. **CI speed**: cache `~/.cargo` and the Rust target directory (docs-only pushes are
    already skipped).

---

## 11. Access and ownership checklist

Whoever takes this over needs:

- [ ] **GitHub repository access** — `helloraj1986/MAXplorer` (private). Transfer
      ownership or add a collaborator; the current owner is `helloraj1986`.
- [ ] **GitHub Actions enabled** on the repo (required for the DMG build).
- [ ] **`workflow` OAuth scope** on the local `gh`/git credential, otherwise pushes that
      touch `.github/workflows/` are rejected.
- [ ] **Apple Developer Program membership** (only if signing/notarizing): Developer ID
      Application certificate, Team ID, app-specific password.
- [ ] **A Mac** (Apple Silicon recommended) with Xcode Command Line Tools for local builds.
- [ ] **Node 22+ and Rust stable 1.88+** (`plist` 1.10 raised the crate MSRV from 1.77.2).
- [ ] Awareness that `dist-macos/` (local DMG copies) is git-ignored and must be re-fetched
      from the release or rebuilt.

No secrets are committed to the repository. There is no telemetry, no analytics, and no
network access at runtime.

---

## 12. Reference material in the repo

- `reference/screenshots/` — real Windows 11 Explorer captures (dark/light, views, menus,
  details pane).
- `reference/uia-*.txt` — UI Automation geometry and accessibility dumps for the main
  window, context menu, and the New/Sort/View submenus.
- `reference/fixture/` — disposable test folder used for screenshots and smoke runs.
- `reference/rea-explorer-pe-{resources,imports}.json` — REA 6.8.0 evidence from
  `C:\Windows\explorer.exe` (PE resources and imports), re-encoded from UTF-16 to UTF-8.
- `reference/*.ps1` — the capture/interaction scripts used to drive the real Explorer.
- `docs/screenshots/` — MAXplorer screenshots including the macOS CI smoke capture,
  Windows/Finder theme comparisons, and the synthetic `.app` icon evidence
  (`app-icons-*.png`).

`docs/REFERENCE.md` records exactly which claim came from which capture, and which parts
are informed approximations.

---

## 13. One-paragraph summary for the next owner

This is MAXplorer, a Tauri 2 / Rust / React desktop file manager that runs natively on
macOS and operates on the real filesystem. It is feature-complete for its scope and
confirmed working on a Mac, with a universal DMG published as `v0.2.0`. Since the first release,
`main` adds two interchangeable interface themes (Windows 11 and macOS Finder, each light
and dark), real `.app` bundle icons, and a premium icon system with Lucide chrome icons, a
typed file-type registry, theme-aware folder/storage artwork, real transfer-state
indicators, and lazy image thumbnails. It now also has an optional dual-pane workspace
with independent pane state, real streaming copy/move with progress and conflict handling,
read-only folder comparison, and synchronized navigation. It adds Universal Search (local
SQLite/FTS5 index, live scan, Spotlight) and a unified three-layer chrome with one command
bar, a consolidated Settings dialog, display scaling/density, and per-pane navigation/tab
rows. The Rust backend owns all filesystem access; the React UI is a single Zustand store
plus a component layer styled with design tokens. Tests and typechecking pass (219 frontend
/ 47 Rust), and CI builds and smoke-launches the DMG on macOS 14. The immediate work is to
finish the macOS interaction pass for the themes, icons, cut/paste source-pane reload, and
the new three-layer chrome, then distribution
polish — Developer ID signing and notarization — followed by macOS UI automation, native
AppKit/QuickLook artwork, and streamed file operation progress. Everything you need to
build, test, release, and extend it is in `README.md` and `docs/`.
