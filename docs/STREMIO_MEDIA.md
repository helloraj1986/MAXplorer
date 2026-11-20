# MAXplorer Media — Roadmap (Stremio-compatible)

> Canonical roadmap for the Media feature on branch `feature/stremio-compat`.
> One roadmap item per session — never batched.

## DONE

### Phase 1 — Addon protocol + Discover mode (@ 67c7cc2)
- `src-tauri/src/media.rs`: `media_addon_manifest` / `media_catalog` (reqwest 0.12, rustls).
- `MediaWorkspace` + `mediaStore` + `media.css`: live Cinemeta catalogs with posters, opened from the CommandBar Media toggle.
- Gates: tsc / vitest 4 / cargo test 4. App rebuilt + installed.

## ROADMAP (ordered)

1. **Phase 2 — Stream resolution** — click a title → streams sheet ranked quality → debrid/cached → size (mock: "Streams" section of `Maxplorer Media UI Concept.html`). Addon protocol `stream` resource.
2. **Phase 3 — Playback** — mpv/libmpv via the existing preview video pipeline; subtitles from OpenSubtitles addons; progress reporting.
3. **Phase 4 — Torrent streaming engine** — debrid-first (TorBox/Real-Debrid APIs), P2P fallback via a sidecar torrent-to-HTTP bridge.
4. **Phase 5 — Addon manager UI** — install/remove by manifest URL, pinned-addons rail (from the mock), addon config pages in an iframe/webview tab.
5. **Phase 6 — Library & sync** — My Library, watch progress, Trakt scrobbling; self-hostable sync profile.
6. **Phase 7 — ⭐ TV / mobile (remote-friendly)** — VERY IMPORTANT, do not cut. The addon protocol is pure HTTP+JSON, so the core already works from any client:
   - **Android TV / Android app**: Tauri 2 has Android support (same Rust core; frontend needs D-pad/focus navigation, TV-safe margins, "10-foot" UI density). Stream resolution must run server-side (desktop machine or a small always-on box) so the TV streams a plain HTTP URL — never torrent traffic on the TV itself.
   - **iOS / Apple TV**: Tauri 2 iOS support, or fall back to a lightweight React Native/web client that speaks the same JSON surface exposed by the Rust core.
   - **Architecture prerequisite (build it in Phases 2–6, not after)**: keep a clean `media-core` boundary in the Rust backend so it can be exposed as a local HTTP API (JSON: catalogs, metas, streams, library) that any client consumes. TV/mobile then connects over LAN to the desktop's session (remote-control + secondary-screen style), matching the self-hosted/local-first preference.
   - D-pad remote control, voice-search passthrough, and auto "TV mode" layout are acceptance criteria.

## Non-goals / accepted limits
- Addons that inject JavaScript into Stremio's own webapp UI can't run natively; iframe escape-hatch is the ceiling.
