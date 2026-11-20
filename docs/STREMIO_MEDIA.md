# MAXplorer Media — Roadmap (Stremio-compatible)

> Canonical roadmap for the Media feature on branch `feature/stremio-compat`.
> One roadmap item per session — never batched.

## DONE

### Phase 1 — Addon protocol + Discover mode (@ 67c7cc2)
- `src-tauri/src/media.rs`: `media_addon_manifest` / `media_catalog` (reqwest 0.12, rustls).
- `MediaWorkspace` + `mediaStore` + `media.css`: live Cinemeta catalogs with posters, opened from the CommandBar Media toggle.

### Phase 2 — Stream resolution (@ 7f388d3, fixes e8882d4/41b4139)
- `media_streams` command + ranked streams sheet (quality → direct → size, HDR/4K flags).
- **Torrentio moved to `torrentio.strem.fun`** (`.strem.io` no longer resolves).

### Phase 3 — Playback (@ c73a1a0, 35f05fa)
- In-app HTML5 `PlayerOverlay` (design-matched, keyboard: space/←/→/m/Esc) for direct HTTP/HLS.
- `media_play` command: external player detection IINA > VLC > mpv > default.

### Phase 4 — Debrid integration (@ dde5c1e)
- `src-tauri/src/debrid.rs`: Real-Debrid + TorBox APIs, torrent hash → direct URL.
- Config in app data `debrid-config.json`; `save/get/test_key` commands.
- ⚠️ **Debrid is an accelerator, NOT a requirement** (user feedback 2026-11-20).

### Phase 4b — Torrent engine, the free no-debrid path
- `src-tauri/src/torrent.rs`: embedded **librqbit 8.1.1** (`rust-tls` + `http-api`
  + `tracing-subscriber-utils` features). One `Session` + librqbit's **built-in
  `HttpApi`** server on `127.0.0.1:18081`, started lazily on first use.
- Commands `media_torrent_start(infoHash)` / `media_torrent_status(infoHash, baseUrl)`.
  The frontend polls status until metadata resolves, then plays the largest video
  file at `http://127.0.0.1:18081/torrents/{hash}/stream/{idx}` in `PlayerOverlay`.
- `▶ Stream` on a torrent row now works with **no debrid key**; debrid stays an
  optional per-row accelerator.
- Verified live: webtorrent **Sintel** streams over the built-in server with HTTP
  `206` + correct `Content-Range` from a 5 MB seek offset. Note librqbit 8.1.1
  honours only the open-ended `bytes=N-` Range form (closed `bytes=0-1023` is
  ignored) — the form media elements use to seek.

### Phase 4c — Native playback engine (libmpv), "runs every file"
- `src-tauri/src/mpv.rs` (dlopen'd libmpv FFI) + `src-tauri/src/player.rs`
  (commands, event loop). Playback is no longer bounded by what WKWebView can
  decode. ⚠️ Correction: this phase originally claimed the video was embedded by
  pointing mpv at the NSView via its `wid` option — **macOS ignores `wid`**, so the
  picture went to mpv's own window. Real embedding arrived in Phase 4d.
- Why it was needed: the HTML5 `<video>` cannot open **MKV** containers and ships
  no **AC3/E-AC3/DTS/TrueHD** decoders, which is exactly what torrent releases
  use. Verified live: a generated MKV/H.264/AC3 fixture decodes in libmpv
  (`video=h264 audio=ac3`).
- Requires a libmpv with the **render API** (any modern build; this machine uses
  mpv HEAD `v0.42.0-173-g59e00d3` via `brew install mpv --HEAD`). `MAXPLORER_LIBMPV`
  can point at another dylib.

### Phase 4d — In-window video via the libmpv render API
- `src-tauri/src/render.rs`: `MPV_RENDER_API_TYPE_SW` paints each frame into an
  aligned `rgb0` buffer on a dedicated render thread; the buffer becomes a `CGImage`
  on the layer of an NSView over the player stage. No second window, no `wid`.
- Verified headlessly: `cargo test --lib live_sw_render_paints_pixels -- --ignored
  --nocapture` (non-black pixels after a real decode). Details + constants:
  `docs/MEDIA_PLAYER_HANDOVER.md` §4.

### Phase 4e — Blank-player fixes + live stream stats
- The stream URL is Range-probed before it reaches mpv (librqbit answers HTTP 500
  while a torrent is still setting up — that was the "blank video" cause), and the
  native surface stays hidden until `file-loaded` so the spinner/error card is
  visible. Header shows `↓ speed · Ns buffered · N peers`. See
  `docs/MEDIA_PLAYER_HANDOVER.md` §8.

### Next: Stremio-parity UI redesign
- `docs/MEDIA_UI_SPEC.md` — the active workstream (WP1…WP6, one per session).
  `media_player_diagnostics` probes `wid` on a throwaway handle and reports
  `embeddingSupported`, so a missing capability is diagnosable rather than silent.
- Commands: `media_player_open/close/set_rect/set_pause/seek/seek_relative/
  set_volume/set_muted/status/diagnostics`; state is pushed to the UI on the
  `media-player://state` event. The UI reports the stage rect, which the backend
  converts from top-left CSS points to a bottom-left NSView frame.
- All of it logs under the `media.player` target (engine load path/version,
  option and command result codes, mpv's own log stream, end-file reason/error),
  so a future playback failure is root-causable from `maxplorer.log` alone.

## ROADMAP (ordered)

0. **Phase 4d — Embed the player (NEXT)** — video currently renders in mpv's own
   window; macOS has no `wid` path, so the **libmpv render API** is the only route.
   Full plan, API constants and acceptance criteria: `docs/MEDIA_PLAYER_HANDOVER.md`.
   Same doc also lists the pending buffering UI (`PlayerStatus.pausedForCache` etc.
   are already wired backend-side).
1. **Phase 5 — Addon manager UI** — install/remove by manifest URL, pinned-addons rail (from the mock), addon config pages in an iframe/webview tab.
2. **Phase 6 — Library & sync** — My Library, watch progress, Trakt scrobbling; self-hostable sync profile.
3. **Phase 7 — ⭐ TV / mobile (remote-friendly)** — VERY IMPORTANT, do not cut. The addon protocol is pure HTTP+JSON, so the core already works from any client:
   - **Android TV / Android app**: Tauri 2 has Android support (same Rust core; frontend needs D-pad/focus navigation, TV-safe margins, "10-foot" UI density). Stream resolution must run server-side (desktop machine or a small always-on box) so the TV streams a plain HTTP URL — never torrent traffic on the TV itself.
   - **iOS / Apple TV**: Tauri 2 iOS support, or fall back to a lightweight React Native/web client that speaks the same JSON surface exposed by the Rust core.
   - **Architecture prerequisite (build it in Phases 2–6, not after)**: keep a clean `media-core` boundary in the Rust backend so it can be exposed as a local HTTP API (JSON: catalogs, metas, streams, library) that any client consumes. TV/mobile then connects over LAN to the desktop's session (remote-control + secondary-screen style), matching the self-hosted/local-first preference.
   - D-pad remote control, voice-search passthrough, and auto "TV mode" layout are acceptance criteria.

## Non-goals / accepted limits
- Addons that inject JavaScript into Stremio's own webapp UI can't run natively; iframe escape-hatch is the ceiling.
