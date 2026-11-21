# Media bundle: library + tracks + player UX (one branch, three phases)

**Branch:** `feature/media-library-tracks` (off `feature/media-ui-wp4b`).
User decision 2026-11-21: combine WP5 (A), continue-watching (B) and the player UX
gaps (D) into **one branch, implemented in three ordered phases**, one commit and one
acceptance pass per phase. This file is the session contract — read it before
touching media code, and update the "As built" block at the bottom as phases land.

Why this order: `library.json` is the substrate for *both* resume/Continue watching
**and** the per-title track choice, so it goes first. Track menus are a functional
hole (there is no way to pick a subtitle or audio track today). Player UX extends the
same overlay and benefits from the track plumbing. WP4b items 5–7 stay parked
(HANDOVER §0).

Gates for **every** phase: `cargo test --lib`, `npx tsc --noEmit`,
`npx vitest run src/components/media`, then build + install
(`npm run tauri build -- --bundles app` → verify entitlements → copy to
`/Applications`). Media CSS files are LF; **`app.css` is CRLF — never patch it**.

---

## Phase 1 — `library.json`: progress, resume, Continue watching

Covers the documented WP5 data half plus the board's "Continue watching" row, which
is currently fed by an in-memory stub (`mediaStore.watchProgress`).

### Backend — `src-tauri/src/library.rs` (new)

- Path: Tauri app data dir (`com.replica.win11explorer`) `library.json`.
- Shape (versioned, forward-compatible — unknown keys are preserved on rewrite):

```json
{
  "version": 1,
  "entries": {
    "tt1160419": {
      "type": "movie",
      "name": "Dune",
      "poster": "https://…",
      "positionSec": 812.4,
      "durationSec": 9330,
      "season": null,
      "episode": null,
      "updatedAt": "2026-11-21T13:40:00Z",
      "audioId": 2,
      "subsId": "off"
    }
  }
}
```

  Episode keys are `tt<id>:<season>:<episode>` so a show keeps per-episode progress
  while the board card aggregates on the show id (latest episode wins).
- **Writes are debounced and atomic**: `write → library.json.tmp → fs::rename`
  (a crash mid-write must never truncate the file; a corrupt file is renamed
  `library.json.corrupt-<ts>` and an empty store is used, logged at WARN).
- Retention: keep the 500 most recent entries by `updatedAt`; drop entries whose
  `positionSec/durationSec` is `< 2 %` or `> 95 %` (finished titles leave the row).
- Commands (registered in `lib.rs` `generate_handler!`):

| command | payload | returns |
|---|---|---|
| `media_library_get` | — | `{version, entries}` |
| `media_library_record` | entry patch (`metaId`, `positionSec`, `durationSec`, optional `type/name/poster/season/episode/audioId/subsId`) | the stored entry |
| `media_library_remove` | `metaId` | `ok` |

- Logging: target `media.library` — load path + entry count, each write
  (debounced/forced), retention drops, corrupt-file recovery.

### Player + resume

- `media_player_open` gains `start_seconds: Option<f64>`: `seek absolute <s>` once
  `MPV_EVENT_FILE_LOADED` fires (and before revealing the surface, so the user never
  sees frame 0 of a resumed title).
- `PlayerOverlay` writes progress every 5 s **and** on close/pause/seek-end via
  `media_library_record` (mpv `time-pos`/`duration` already in `PlayerStatus`).

### Frontend

- `mediaStore`: hydrate `watchProgress` from `media_library_get` when the workspace
  opens; drop the in-memory stub; keep `recordProgress` as the write entry point but
  route it through the command (optimistic local update, backend truth on next open).
- `MediaDetail` primary button: progress `> 2 %` → `Resume · 12 min left` (reuse
  `board.ts#formatRuntime` style helper), else `▶ Watch`; plays with `start_seconds`.
- `board.ts#continueWatching` stays the filter/sort helper — now fed by real entries
  (needs `type`, `name`, `poster` stored so the card renders without a catalog fetch).
- `MediaPosterCard`'s in-art progress bar reads the same store.

### Acceptance

1. Watch ~3 min of a movie, quit the app, relaunch → the card is on the board at that
   position with the right "N min left".
2. `▶ Resume` continues from the stored second (not 0) and the first visible frame is
   the resumed one.
3. Watching past 95 % removes the card; dropping below 2 % never creates one.
4. Episode 2 keeps its own position while episode 1 stays where it was left.
5. Killing the app mid-write leaves a parseable `library.json` (unit test with a
   truncated temp file + a corrupt-file test).

---

## Phase 2 — track menus (`media_player_tracks` / `media_player_set_track`)

Today `player.rs` observes no track list at all, so a multi-audio release plays
whatever mpv defaults to and subtitles can only be toggled by luck.

### Backend

- Read mpv's `track-list` (FFI property read, `MPV_FORMAT_NODE` walk — the existing
  `get_property_string` helpers are not enough) into:

```rust
pub struct PlayerTrack { pub id: i64, pub kind: String /* "audio"|"sub" */,
  pub lang: Option<String>, pub title: Option<String>, pub codec: Option<String>,
  pub channels: Option<String>, pub selected: bool, pub default: bool,
  pub forced: bool, pub external: bool }
```

  plus `pub struct TrackState { tracks: Vec<PlayerTrack>, audio_id: Option<i64>,
  subs_id: Option<i64>, secondary_subs_id: Option<i64> }`.
- Commands: `media_player_tracks()` (fresh read, main-thread-safe via the existing
  control path), `media_player_set_track(kind, id)` → `aid`/`sid` (id `0` = off for
  subs; mpv rejects `sid=0` in some builds — use `sid=no` and verify against 0.42).
- Refresh on mpv's `track-list` property change: reuse the event loop, emit
  `media-player://state` with `tracks` (no new event channel needed) and log at
  `media.player`.
- Persist the choice per title in `library.json` (`audioId`, `subsId`), re-apply on
  the next open **after** `file-loaded` (a track id is only valid once the container
  is parsed).

### Frontend — `src/components/media/TrackMenu.tsx` (new)

- Two popovers in the player bottom bar: **Audio** (`English · EAC3 · 5.1 · Default`)
  and **Subtitles** (first row `Off`, then languages; `Forced` badge; `External`
  marker). `TrackMenu` takes `{tracks, activeId, onSelect, onClose}` and is pure —
  no fetching, so it is easy to test.
- Keyboard: opens with `S` (subs) / `A` (audio), arrows move, Enter selects, Esc
  closes; every row is a real `<button>` with `role="menuitemradio"` +
  `aria-checked`.
- `mediaStore`: `tracks`, `activeTrack`, `setTrack` → command, optimistic update.

### Acceptance

1. On the multi-track test release, switching audio to English mid-playback does not
   stall or re-buffer (`decoder-drops` stays flat in `media.player.perf`).
2. Subtitles cycle Off → English → forced with no restart; the choice survives
   closing and reopening the title.
3. A title with no subtitle track shows a disabled Subtitles control (not an empty
   popover).

---

## Phase 3 — player UX gaps

All of these are mpv properties — no new subsystems, and each is a command + a
control, so this phase is deliberately the cheapest of the three.

| Feature | mpv property / command | UI |
|---|---|---|
| Subtitle delay | `sub-delay` (±0.1 s steps, reset) | `−0.1s / +0.1s` in the Subtitles menu footer |
| Subtitle size | `sub-font-size` (30–90) | `A− / A+` in the Subtitles menu |
| Subtitle visibility | `sub-visibility` (toggle) | same popover (`V` key) |
| Audio delay | `audio-delay` | `−0.1s / +0.1s` in the Audio menu |
| Playback speed | `speed` (0.5–2.0) | footer chip `1.0×`, cycles +/− 0.25 |
| External subtitle file | `sub-add <path> [select]` | "Open subtitle file…" → Tauri dialog, `.srt/.ass/.vtt` |
| Next episode | `loadfile <next url>` + progress flush | "Next episode" button when the meta has `videos` |

- **Out of scope on purpose:** online subtitle search (OpenSubtitles etc.). It needs
  an API key, sends the release name to a third party, and the user's standing
  preference is anonymous/offline-first — local `sub-add` plus mpv's
  `sub-auto` (already default) covers the normal case. Revisit only if asked.
- All new values reset on a new session unless the user changes them; nothing is
  persisted except the track ids from Phase 2.
- Logging: one `media.player.settings` line per change (name, old → new) so a
  "subtitles stopped working" report is answerable from the log.

### Acceptance

1. `+0.1s` subtitle delay visibly shifts sync on the same frame; reset restores it.
2. Speed change keeps A/V in sync and the seek bar's time math correct
   (`duration / speed` is *not* applied to the displayed clock).
3. Loading a local `.srt` mid-playback selects it without restarting.
4. "Next episode" plays the next episode and writes progress for the finished one.

---

## As built

### Phase 1 — `library.json` (branch `feature/media-library-p1`)

- `src-tauri/src/library.rs` (new): `MediaLibrary` with a `Mutex<LibraryFile>`,
  debounced writer thread (`DEBOUNCE = 1.5 s`, holds a `Weak` so it stops with the
  store), `write → library.json.tmp → File::sync_all → fs::rename`, corrupt files
  renamed `library.json.corrupt-<epoch ms>` + WARN + empty store, retention
  (`in_window`: > 2 % and < 95 % watched; 500 most recent by parsed `updatedAt`).
  Unknown keys survive because `LibraryFile.extra` / `LibraryEntry.extra` are
  `#[serde(flatten)]` maps. Timestamps are RFC-3339 UTC via Hinnant civil-date
  maths (no `chrono` dependency).
- Commands `media_library_get` / `media_library_record` / `media_library_remove`
  registered in `lib.rs`; the store is created lazily on the first call
  (`OnceLock`, app-data dir). `media_library_record` returns
  `{ key, entry | null }` — `entry: null` means the position was outside the
  window and nothing was stored; `key` is `metaId` or `metaId:season:episode`.
  `media_library_remove` writes immediately (no debounce).
  `WindowEvent::CloseRequested` calls `library::flush_global()` so a quit inside
  the debounce window cannot lose the last position.
- `media_player_open(start_seconds: Option<f64>)`: on `MPV_EVENT_FILE_LOADED` it
  issues `seek <s> absolute` and sets neither `loaded` nor `file_loaded` (the UI
  reveals the native surface from those flags) and emits no state event; the
  surface is revealed on `MPV_EVENT_PLAYBACK_RESTART`. A 4 s
  `SEEK_REVEAL_TIMEOUT` forces the reveal if mpv never restarts, so audio cannot
  play behind a hidden surface; a failed seek logs WARN and starts from 0.
- `mediaStore`: `watchProgress` hydrates from `media_library_get` on workspace
  open (`loadLibrary`), `recordProgress` keeps the optimistic local update and
  writes through `media_library_record`, and a position outside the window
  removes an existing entry through `media_library_remove`. Episode keys
  aggregate onto the show id (latest `updatedAt` wins).
- `MediaDetail` gains a primary button (`Watch` / `Resume · 2 h 22 min left`,
  `.media-detail-watch`) driven by `onPlay(startSeconds | null)`; the workspace
  plays the top-ranked stream (direct → `openPlayer`, torrent → `streamTorrent`)
  with that position. `PlayerOverlay` passes `startSeconds` to `player_open` and
  now also writes progress on pause and on seek end, not only every 5 s + close.
- Gates: `cargo test --lib` → 127 passed / 10 ignored (11 new library tests);
  `npx tsc --noEmit` clean; `npx vitest run src/components/media
  src/state/mediaStore.test.ts` → 106 passed (7 new store tests, 2 board, 2 detail).

### Phase 2 — track menus (branch `feature/media-tracks-p2`)

- `src-tauri/src/mpv.rs`: the NODE surface `mpv_get_property` needs for
  `track-list` — `MPV_FORMAT_NODE/ARRAY/MAP`, `MpvNode`/`MpvNodeUnion`/
  `MpvNodeList`/`MpvByteArray`, and the `mpv_free_node_contents` symbol.
- `src-tauri/src/player.rs`: `PlayerTrack` + `TrackState`; `read_tracks()` walks
  the array-of-maps one level deep (audio + `sub` only, video skipped);
  `track-list` is observed as *any format* (`MPV_FORMAT_NONE`) and re-read after
  every change — the event's node payload is never touched, so no node lifetime
  crosses a call boundary. `aid`/`sid` are observed as INT64 (format NONE = off).
  Commands `media_player_tracks` (fresh read) and `media_player_set_track(kind,
  id)` (`sid=no` for id ≤ 0). `PlayerStatus` gained `tracks`/`audioId`/`subsId`.
  On `FILE_LOADED` the per-title choice is re-applied (`aid=…`, `sid=…`) *before*
  the resume seek, then the list is read.
- `media_player_open` gained `audio_id`/`subs_id`; the frontend passes the stored
  choice from `mediaStore.trackChoices`.
- `library.rs`: `TrackChoicePatch` + `media_library_set_tracks` (creates a
  preference-only entry when there is no progress; subs off stored as `"off"`).
  Retention now keeps an entry that carries a track choice even outside the 2–95 %
  window — the Continue-watching row still filters on the ratio, so a
  preference-only entry never shows as a card.
- Frontend: `TrackMenu.tsx` (pure; `trackRows`/`trackLabel`/`trackBadges`/
  `languageName` exported for tests), Audio + CC buttons in the player bar with
  upward popovers, `A`/`S` toggle, Esc closes the menu before the chrome,
  `mediaStore.setTrack` (optimistic → command → persist). CC is disabled with a
  "No subtitle tracks in this file" title when the file has none.
- Live proof (ffmpeg-built MKV, 2 audio + 1 sub):
  `cargo test --lib live_track_list -- --ignored --nocapture` →
  `[eng/ac3 selected, fra/ac3, sub eng "English"/subrip]`, `sid=<id>` selects,
  `sid=no` turns off. mpv 0.42.0-173 does **not** expose `channels`/
  `demux-channel-count` in `track-list` at `file-loaded`, so the channel label is
  usually absent — the menu shows `English · AC3`, not a fabricated `5.1`.
- Gates: `cargo test --lib` → 129 passed / 11 ignored (the new live track
  test is the extra ignored one); `npx tsc --noEmit` clean;
  `npx vitest run src/components/media src/state/mediaStore.test.ts` → 123 passed
  (TrackMenu 9, PlayerOverlay +4, store +5).

_(append one block per phase: commit hash, measurements, gates, deviations)_