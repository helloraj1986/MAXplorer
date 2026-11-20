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

## ROADMAP (ordered)

1. **Phase 5 — Addon manager UI** — install/remove by manifest URL, pinned-addons rail (from the mock), addon config pages in an iframe/webview tab.
2. **Phase 6 — Library & sync** — My Library, watch progress, Trakt scrobbling; self-hostable sync profile.
3. **Phase 7 — ⭐ TV / mobile (remote-friendly)** — VERY IMPORTANT, do not cut. The addon protocol is pure HTTP+JSON, so the core already works from any client:
   - **Android TV / Android app**: Tauri 2 has Android support (same Rust core; frontend needs D-pad/focus navigation, TV-safe margins, "10-foot" UI density). Stream resolution must run server-side (desktop machine or a small always-on box) so the TV streams a plain HTTP URL — never torrent traffic on the TV itself.
   - **iOS / Apple TV**: Tauri 2 iOS support, or fall back to a lightweight React Native/web client that speaks the same JSON surface exposed by the Rust core.
   - **Architecture prerequisite (build it in Phases 2–6, not after)**: keep a clean `media-core` boundary in the Rust backend so it can be exposed as a local HTTP API (JSON: catalogs, metas, streams, library) that any client consumes. TV/mobile then connects over LAN to the desktop's session (remote-control + secondary-screen style), matching the self-hosted/local-first preference.
   - D-pad remote control, voice-search passthrough, and auto "TV mode" layout are acceptance criteria.

## Non-goals / accepted limits
- Addons that inject JavaScript into Stremio's own webapp UI can't run natively; iframe escape-hatch is the ceiling.
