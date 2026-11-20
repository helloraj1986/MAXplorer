# MAXplorer Media — UI specification (Stremio-parity)

> **Status:** specification, not implementation. Written 2026-11-21 so the next
> session can implement it without re-deriving the design.
> **Read with:** `HANDOVER.md` §0 (feature state), `docs/MEDIA_PLAYER_HANDOVER.md`
> (player internals), `docs/STREMIO_MEDIA.md` (roadmap).
> **Reference images (not in git, ~14 MB):**
> `~/hermes-workspace/maxplorer-media/ui-reference/`
> — `stremio-01-board.png`, `stremio-02-detail-streams.png`,
> `stremio-03-player.png` (Stremio desktop, 3440×1410 ultrawide screenshots), plus
> crops: `crop-rail.png`, `crop-topbar.png`, `crop-search.png`, `crop-hero.png`,
> `crop-card.png`, `crop-meta-block.png`, `crop-streams-panel.png`,
> `crop-stream-row.png`, `crop-player-bottom.png`.

---

## 0. What this document is for

The user's instruction, verbatim in intent: *"rethink the UI as a user would,
think of it as Stremio's UI, implement every aspect; the player should look like
this."* This spec turns those three screenshots into an implementable design:
tokens, layout, component inventory, states, data mapping, keyboard/accessibility
rules, and a work-package order. It **supersedes**
`~/hermes-workspace/maxplorer-media/Maxplorer Media UI Concept.html` for the Media
workspace and the player; the file-explorer chrome (sidebar, CommandBar, Settings)
is **out of scope** and must not be restyled.

Three screens are specified:

| # | Screen | Reference | Replaces today's |
|---|--------|-----------|------------------|
| A | **Board** (home / discover) | `stremio-01-board.png` | `MediaWorkspace` discover view |
| B | **Detail** (title + streams) | `stremio-02-detail-streams.png` | `MediaWorkspace` detail + `StreamsSheet` |
| C | **Player** | `stremio-03-player.png` | `PlayerOverlay` |

Definition of done for the whole spec: with MAXplorer open, a first-time user can
find a title, understand what they are about to watch, pick a source, watch it,
and control audio/subtitles **without** being told where to click, and the screen
looks like the reference images (dark violet, poster-forward, video-first).

---

## 1. Design tokens

Measured from the reference screenshots (hex values sampled from the pixels).
Implement as `src/styles/media-tokens.css` (`--m-*` custom properties) and import
it from `src/styles/media.css`; do **not** hard-code these values in components.

### 1.1 Colour

| Token | Value | Measured from | Use |
|---|---|---|---|
| `--m-bg` | `#0F0E14` | page background strip (shot 1) | app background behind everything |
| `--m-bg-elevated` | `#141219` | streams panel background (shot 2) | panels, dropdowns, sheets |
| `--m-surface` | `#1B1B24` | "All" dropdown, chips, icon buttons | cards/rows/chips/base controls |
| `--m-surface-hover` | `#23222E` | (derived) | hover on surface |
| `--m-surface-active` | `#2B2A38` | (derived) | pressed/selected |
| `--m-rail` | `#0E0E12` | left icon rail, shot 1 | navigation rail (translucent over hero) |
| `--m-hairline` | `rgba(255,255,255,0.08)` | panel row separators | 1px separators, borders |
| `--m-accent` | `#7051F3` | "Watch" pill fill + active rail icon | primary actions, active nav, focus |
| `--m-accent-hover` | `#8168F6` | (derived) | hover on accent |
| `--m-accent-soft` | `rgba(112,81,243,0.16)` | (derived) | selected-row wash, active chip |
| `--m-text` | `#FFFFFF` | titles | primary text |
| `--m-text-dim` | `#B4B7C4` | meta line, values | secondary text |
| `--m-text-muted` | `#7E8291` | labels, file names, sizes | tertiary text, annotations |
| `--m-gold` | `#FE8A0E` | `4K` badge (shot 2) | quality badges: 4K/2160p |
| `--m-quality-hd` | `#8FD3FF` | (derived from HD badges) | 1080p / HD badges |
| `--m-quality-low` | `#B4B7C4` | 720p/480p rows | lower-quality badges |
| `--m-good` | `#4ED07A` | "Ready (RD)", addon name | cached/instant availability, success |
| `--m-warn` | `#F2B33C` | — | buffering, degraded |
| `--m-error` | `#FF6B6B` | error card text | failures |
| `--m-dv` | `linear-gradient(90deg,#8B5CF6,#22D3EE,#F59E0B)` | DV badge | Dolby Vision marker text gradient |
| `--m-overlay-hero` | `linear-gradient(180deg, rgba(15,14,20,0) 0%, rgba(15,14,20,0.55) 55%, #0F0E14 100%)` | hero fade to page | hero → content transition |
| `--m-blur` | `saturate(140%) blur(24px)` | backdrop treatment | hero backdrop, translucent chrome |

**Migration note.** Today's media UI is orange (`#f2a33c` / `#ffb35c` in
`src/styles/media.css`). The reference is violet `#7051F3`. Phase it: add the
tokens, switch the player + media components to them, and keep the orange tokens
only where the file-explorer theme uses them (they are shared names — grep before
renaming, do not delete blindly).

### 1.2 Radius

| Token | Value | Use |
|---|---|---|
| `--m-radius-pill` | `999px` | primary buttons, chips, search field, badges |
| `--m-radius-panel` | `14px` | streams panel, menus, sheets |
| `--m-radius-card` | `10px` | posters, thumbnails |
| `--m-radius-sm` | `6px` | small badges, inputs |

### 1.3 Spacing scale

`4, 8, 12, 16, 20, 24, 32, 40, 56, 72` px. Reference gaps: rail→content 24, hero
text block left inset 130 (from window edge; ≈ 56 px from the rail), card gutter 24,
carousel row vertical rhythm 40, panel padding 20.

### 1.4 Typography

System stack (`-apple-system, "SF Pro Text", "Inter", system-ui`); no webfonts.
Reference uses SF-like geometry with tight tracking on the big row heading.

| Role | Size / weight / tracking | Example |
|---|---|---|
| Hero title | rendered **artwork** (logo PNG from metadata), not text | `NEVER SURRENDER` |
| Hero title fallback | 40px / 800 / -0.02em | when no logo art exists |
| Meta line | 15px / 600 | `2026 · 2h20min · 6.1 · IMDb` |
| Synopsis | 15px / 400 / 1.5 line-height, `--m-text-dim`, clamp 2 lines | |
| Row heading | 22px / 600 | "Continue watching" |
| Card caption | 15px / 600, centered | "Hibla 2" |
| Chip / genre | 15px / 500 | `Thriller` |
| Panel group heading | 12px / 700 / 0.12em uppercase, `--m-text-muted` | `SELECTION` |
| Stream row primary | 15px / 600, `--m-text` | `4K · DV` |
| Stream row detail | 13px / 400, `--m-text-muted` | `WEB-DL · HEVC · 1h:53m:58s` |
| Stream row metric | 13px / 500, `--m-text-dim` | `18.3 GB · 21.4 Mbps` |
| Player time | 13px / 500, tabular numerals | `0:28 / 1:44:59` |
| Button label | 15px / 600 | `Watch` |

### 1.5 Elevation & motion

- Panel shadow: `0 24px 60px rgba(0,0,0,0.55)`; menus/popovers the same.
- Card hover: image `scale(1.04)` + shadow, 160 ms `ease-out`.
- Chrome autohide: 300 ms opacity/translate, `cubic-bezier(.2,.7,.2,1)`.
- Honour `prefers-reduced-motion: reduce` → no scale, no slide (already partially
  handled in `media.css`).

---

## 2. App shell (screen A/B/C share it)

```
┌──┬──────────────────────────────────────────────────────────────────────────┐
│  │  ╭───────────── search addons ─────────────╮            ⌷  ⛶  ◉        │  top bar 56px
│◎ │  └──────────────────────────────────────────┘                            │
│⌂ │  ┌─────────────────────────────────────────────────────────────────────┐ │
│◐ │  │                       HERO (backdrop art)                           │ │
│▤ │  │  LOGO-ART                                                           │ │
│▦ │  │  2026 · 2h20min · 6.1 · [IMDb] · R, Action, Crime                   │ │
│🧩│  │  two-line synopsis…                                                 │ │
│⚙ │  │  [ ▶ Watch ]   ( ⌷ )  ( 🎞 )                                        │ │
│  │  └─────────────────────────────────────────────────────────────────────┘ │
│  │  Continue watching                                                        │
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐             ← horizontal rows │
│72│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                              │
└──┴──────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Left icon rail

- Width **72 px** (measured 92 px at 3440 wide including padding; use 72 pt and
  let it breathe), full height, `--m-rail` at ~85 % opacity over the hero blur,
  hairline on the right edge only when content is scrolled.
- Icons 26–28 px, stroke ~1.8 px, `--m-text-muted`; active item `--m-accent`.
- Order (top → bottom, from `crop-rail.png`):
  1. App mark (MAXplorer play glyph) — brand, non-interactive
  2. **Home** (board) — active by default
  3. **Discover** (compass) — addon catalogs / search by addon
  4. **Library** (box) — My Library (roadmap 6; disabled with tooltip until then)
  5. **Calendar** (agenda) — releases (roadmap 6)
  6. **Addons** (puzzle) — opens the addon manager (roadmap item 5)
  7. **Settings** (gear) — pinned to the **bottom**
- Each item: 44×44 hit target, `aria-label`, tooltip on hover (300 ms delay) with
  the label. Active item gets a subtle wash (`--m-accent-soft`) and no underline.
- Badge dot (2 px green) allowed on Library when new items exist.

### 2.2 Top bar

- Height **56 px**, transparent over the hero, solid `--m-bg` elsewhere.
- **Search field**, horizontally centred: pill, ~320 px wide, 40 px tall,
  `rgba(255,255,255,0.06)` fill, hairline, magnifier 16 px left inset 14,
  placeholder `Search addons` in `--m-text-muted`; focused → `--m-accent` ring,
  fill 10 %. `⌘F` focuses it, `Esc` clears.
- Right cluster, 3 ghost icon buttons (28 px icons, 40 px hit targets):
  `downloads` (tray, with green activity dot when a torrent is downloading),
  `fullscreen`, `cast/remote` (Phase 7 hook — disabled for now).
- Left cluster: nothing (the rail carries navigation). Window traffic lights are
  the OS's; content starts below the 24 px drag strip, which must keep
  `-webkit-app-region: drag` semantics so the window stays movable.
- **Player mode (screen C):** the top bar collapses to an auto-hiding overlay
  (§5.1); the rail is hidden.

---

## 3. Screen A — Board

### 3.1 Hero

| Element | Spec |
|---|---|
| Backdrop | metadata `background` (Cinemeta), `object-fit: cover`, full-bleed, `--m-blur` heavy behind the text column, `--m-overlay-hero` gradient to page bg |
| Title | `logo` art if the addon supplies it (Cinemeta does for most titles), height 56–96 px, else 40 px/800 white text |
| Meta line | `releaseInfo · runtime · imdbRating · [IMDb] badge · genres (comma)`, 15 px/600, gaps 16 px, `--m-text-dim`, `IMDb` badge = gold `#F5C518` pill with black bold 11 px text (measured in shot 2) |
| Synopsis | clamp 2 lines, `--m-text-dim` |
| Primary button | `▶ Watch` — accent pill, height 40, padding 20/22, radius pill, white 15 px/600. Behaviour: if progress exists → `Resume · 12 min left`, else play the best-ranked stream of the chosen addon order |
| Secondary buttons | two 40 px circular icon buttons (`--m-surface`): `add to library` (box) and `episodes` (film) — episodes hidden for movies |
| Placement | text block bottom-left, inset 56 px from the rail, bottom 40 px above the row section; max text width 620 px |
| Hero height | 46 % of the content area at ultrawide (≈ 640 px at 1410), min 420 px, max 720 px |

Hover/focus: backdrop slowly scales 1.02 over 8 s (motion-safe off), buttons get
the standard hover wash. Clicking the backdrop does nothing (no accidental nav).

### 3.2 Rows

- Heading 22 px/600, 24 px above the row, 16 px below.
- Cards in a horizontally scrolling strip: `overflow-x: auto`, `scroll-snap-type: x proximity`, hidden scrollbars, gutter 24 px, edge fade 48 px.
- Rows to render, in order:
  1. **Continue watching** — from the local progress store (§7), most recent first, only > 2 % and < 95 % watched. Hidden when empty.
  2. One row per configured addon catalog (`DEFAULT_MEDIA_CATALOGS`: Trending movies, Popular series, …).
- Row chrome: chevron buttons appear on hover (left/right) if the strip overflows; `Scroll →` affordance at the right edge in the reference is optional; skip for v1.
- Skeleton: 6 grey cards with a shimmer (already have `.media-poster-skeleton`).
- Empty/error: single muted line inside the row, e.g. `Cinemeta did not respond.` with a `Retry` text button.

### 3.3 Poster card (`crop-card.png`)

| Property | Spec |
|---|---|
| Aspect ratio | **0.7** (≈ 2:2.86), e.g. 300×428 at scale 1 |
| Radius | `--m-radius-card` (10 px) |
| Image | `poster` from metadata, `object-fit: cover`, `background: --m-surface` while loading |
| Caption | below the art, centered, 15 px/600, 12 px gap, single line ellipsis |
| Progress | **inside** the art, bottom: track `rgba(255,255,255,0.18)`, fill white, height 4, radius 2, inset 14 px left/right, 26 px above the art's bottom edge |
| Badges | top-left corner, 12 px from edges: `HD`/`4K` quality pill (gold/grey per §1.1) if known from the metadata; `NEW` for items released < 30 days |
| Hover | art scales 1.04, 160 ms; overlay `linear-gradient(transparent, rgba(0,0,0,.55))` with a centred 48 px accent play button; caption turns white (already white) |
| Focus | 2 px `--m-accent` ring, 2 px offset; Enter opens the detail screen |
| Series | top-right `S3` chip when the progress store knows the season |
| States | loading (skeleton), no-poster (initial letter on `--m-surface`), broken-image (same fallback) |

---

## 4. Screen B — Detail

### 4.1 Layout

Two columns at ≥ 1600 px wide: content (left, flexible) and **streams panel**
(right, 380–420 px, sticky, own scroll). Below 1600 px the streams panel becomes a
slide-over from the right (as it is today) — same component, different host.

### 4.2 Content column (`crop-meta-block.png`)

1. **Backdrop** — same treatment as the hero but taller (60 % height) and darker:
   the reference dims the art so the streams panel reads clearly.
2. **Title art / text** top-left (56 px inset).
3. **Meta line** — `2026 · 1h54min · 5.5 · [IMDb]` (15 px/600).
4. **Synopsis** — 2–3 lines, `--m-text-dim`.
5. **GENRES row** — chips: `--m-surface`, radius pill, 15 px/500 `--m-text`,
   padding 10×18, gap 10. First chip may be the certification (`R`).
6. **CAST row** — label `CAST` in 12 px uppercase `--m-text-muted` at the left of a
   520 px column, then a wrapping chip grid of actor names (same chip style).
7. **DIRECTORS row** — same shape, label `DIRECTORS`.
8. **Action row** — pill `▶ Trailer` (accent-soft with white label) then 44 px
   circular ghost buttons: `library`, `mark watched / eye`, `thumbs up`,
   `heart`, `share`. Icons `--m-text-dim`, hover `--m-text`.
9. **Seasons/episodes** (series only, roadmap): horizontal episode strip with
   thumbnails, S/E label, "watched" check; not in v1 beyond the season selector.

### 4.3 Streams panel (the important one — `crop-streams-panel.png`, `crop-stream-row.png`)

```
┌──────────────────────────────────────────────┐
│  ╭───────────── All ─────────────▾╮          │  filter: All | Cached | 4K | 1080p | Torrents
│  SELECTION                                   │  group heading, uppercase 12px
│  🍿 4K • 🌈 DV                          ( ▶ ) │  row 1
│  ⌁ Heartland (2026)                          │
│  ◍ WEB-DL · ⚙ HEVC · ◷ 1h:53m:58s            │
│  🍿 Atmos | DD+ · 🔊 5.1 · 🇬🇧 🇷🇺 🇪🇸           │
│  🇬🇧 🇪🇸 🇷🇺  (subtitle languages)             │
│  💾 18.3 GB · 📶 21.4 Mbps                   │
│  ⚡ Ready (RD) · 🧩 ComeTorz                  │
│  ─────────────────────────────────────────   │  hairline separator
│  … more rows …                               │
└──────────────────────────────────────────────┘
```

Panel mechanics:

- Container: `--m-bg-elevated`, radius `--m-radius-panel`, padding 20, shadow,
  max-height = viewport − 2×24, own scroll area.
- **Filter dropdown** at the top: full-width `--m-surface` row, 44 px tall, pill-ish
  radius 10, label left, chevron right. Options: `All`, `Cached / Instant`,
  `4K`, `1080p`, `Torrent` (i.e. only local-engine sources) — filtered client-side
  from already-fetched streams, no refetch.
- **Group headings** (`SELECTION`, then addon/provider groups): uppercase 12 px,
  0.12em tracking, `--m-text-muted`, 20 px above, 8 px below.
- **Row** — padding 14×4, hairline separator under each, hover/selected wash
  `--m-accent-soft` on the whole row, entire row clickable (starts playback).
- Row lines, each a "icon + tokens" line; icons are small glyphs/emoji-like SVGs
  from one icon set (do not import emoji fonts — ship 16 px SVGs):

| Line | Contents | Field mapping (see §7) |
|---|---|---|
| 1 | quality badge(s) + HDR marker; right: circular play button (36 px, appears on hover, always visible for the "best" row) | `quality`, `hdr`/`dv` |
| 2 | file release title, prefixed with a small `⌁` group glyph | `stream.title` (Torrentio `title`) |
| 3 | source · codec · runtime (`WEB-DL · HEVC · 1h:53m:58s`) | parsed from the release name; runtime only when the addon supplies it |
| 4 | audio format · channels · audio-language flags | `audio`/`channels`, `audioLangs` (new parse) |
| 5 | subtitle language flags | `subLangs` (new parse) — omit the line when unknown |
| 6 | size · bitrate | `sizeBytes`, `bitrate` (new parse of `X Mbps`) |
| 7 | availability: `⚡ Ready (RD)` when debrid resolves instantly, `⚡ Ready (engine)` when the local torrent engine already has the file, else `⏳ Torrent · N peers` once the engine reports stats; then the addon/provider name in `--m-good` | `debridReady`, engine status, `addonName` |

- Language flags: render as 16×11 rounded rectangles from a sprite (no emoji), with
  the 2-letter code in a tooltip. Unknown → omit.
- The **play affordance**: hover shows the circular play button; clicking anywhere
  in the row does the same thing. `Enter` on a focused row starts playback.
- **Keyboard**: `↑/↓` move row focus, `Enter` plays, `Esc` returns to content.
  Focus ring 2 px `--m-accent`.
- **Engine-driven states** (ours, not in the reference — required):
  - `resolving`: the row's line 7 becomes `⏳ Starting engine · 37 % · 2.4 MB/s · 12 peers`
    with the values from `media_torrent_status` (the probe-gated URL is what makes
    this safe to show — see `docs/MEDIA_PLAYER_HANDOVER.md` §8).
  - `error`: line 7 turns `--m-error` with the reason; a toast fires once.
- **Row cap**: render the first 60 after filtering, then a `Show all (N)` text
  button; the list is not virtualised in v1 (60 rows × ~7 lines is fine).
- Sorting stays as today (`streams.ts` ranking) and the chosen filter must not
  reorder — document the rank in a tooltip on line 1 (`Rank 1 · 4K direct`).

---

## 5. Screen C — Player

`crop-player-bottom.png` confirms the reference shows **no chrome at all** while
playing: video is full-bleed and every control auto-hides. Chrome appears on mouse
move / on pause / on `Tab`, and hides again after 3 s of no input (`Esc` closes).

### 5.1 Regions

```
┌──────────────────────────────────────────────────────────────┐ ← cursor-visible overlay
│ ✕  HEARTLAND · S1E3 · 23.976 fps · 4K                        │ top strip (72px tall, gradient from black 70%)
│                                                              │
│                     ❰ centred title art ❱                     │  only while paused / loading
│                                                              │
│   ⏳ Buffering 42% · 1.5 MB/s   (or)  ⚠ Playback failed: …     │  state pill, 40px above the bar
│                                                              │
│  ⏮  ⏯  ⏭   0:28 ▬▬▬▬▬▓▓▓▓▓░░░░░░░░░ 1:44:59   🔊 ▁▃▅   ⚙  CC  ⛶ │ bottom bar (88px tall, gradient)
└──────────────────────────────────────────────────────────────┘
```

| Region | Contents |
|---|---|
| Top strip | close `✕` (32 px ghost), title (15 px/600), optional `S/E`, codec + resolution chip, and right-aligned: `stats` (our pill) and `fullscreen` |
| Centre | title **art** while paused or before first frame; fades out 400 ms after playback resumes |
| State pill | buffering %/speed (our `cacheSummary`), or the error text; always **above** the bar so it never covers subtitles |
| Bottom bar | transport (`⏮`/`⏯`/`⏭`, 40 px), elapsed `0:28`, seek bar (flex), total `1:44:59`, volume (icon + 90 px slider, appears on hover of the icon), `audio` menu, `subtitles` menu, `speed`, `fit/aspect`, `⛶` fullscreen |

- Seek bar: 4 px track `rgba(255,255,255,0.22)`, **buffered span** `rgba(255,255,255,0.4)`,
  played span `--m-accent`, hover → 7 px with a 14 px knob; hover shows a
  time tooltip (scrub preview thumbnails are a later roadmap item).
- Volume: icon toggles mute on click; slider expands on hover (90 px).
- Menus (`audio`, `subtitles`, `speed`) are popovers above the bar: `--m-bg-elevated`,
  radius panel, max-height 320 with scroll, rows 36 px, active row shows a check and
  `--m-accent` text. Audio rows: `English · E-AC-3 5.1 (default) · [Original]`;
  subtitle rows: `Off`, then `English (SDH) · forced`, `Russian (Forced)`, each with
  language flag, source (`embedded`/`external`) and `Forced`/`HI`/`Default` chips.
- Keyboard (bind on window, ignore when a menu is open except `Esc`/arrows):

| Key | Action |
|---|---|
| `Space` / `K` | play/pause |
| `←` / `→` | −10 s / +10 s |
| `Shift+←/→` | −60 s / +60 s |
| `↑` / `↓` | volume ±5 |
| `M` | mute |
| `F` / `⛶` | fullscreen |
| `C` | subtitles menu |
| `A` | audio menu |
| `,` / `.` | previous / next episode (series) |
| `Tab` | show chrome and move focus into it |
| `Esc` | close chrome, then close the player |

### 5.2 Layering constraint (must not be violated)

The video is a native `NSView` composited **above** the webview
(`docs/MEDIA_PLAYER_HANDOVER.md` §4.6). Therefore:

- Nothing drawn in the webview can appear over the video. The player chrome lives
  in the strips **outside** the video stage (top/bottom), exactly like the current
  layout, and the stage itself is covered by the surface.
- The centre title and any on-video messaging must come from either
  (a) **mpv OSD** (`show-text`, `osd-msg` — cheap, styled by mpv, not by us), or
  (b) **buffer compositing** — we own the RGBA frame buffer before it becomes a
  `CGImage`, so a future package (WP7) can alpha-blend a title/poster into it.
  v1 uses (a) for the paused title, or omits it if mpv's styling looks wrong;
  do not attempt CSS overlays on the stage.
- The stage must be **hidden** whenever the webview needs to be seen in that area
  (error card, `Connecting to the swarm…`) — the existing
  `media_player_set_surface_visible` command and the `fileLoaded` gate implement
  this; keep both.
- Buffering must never be communicated only by the video freezing: the state pill,
  the seek bar's buffered span, and the top-strip stats are the contract.

### 5.3 Player states

| State | What the user sees |
|---|---|
| Opening (torrent resolving) | Stage hidden, spinner + `Connecting to the swarm… 37 % · 12 peers`, chrome hidden after 3 s |
| Buffering mid-playback | Video holds last frame, `Buffering 42% · 1.5 MB/s` pill, buffered span advances |
| Slow renderer | Nothing visible; `framedrop=vo` keeps audio in sync (log-only detail) |
| Error | Stage hidden, error card centred (`--m-error`), `↗ Open in external player` and `Retry` buttons |
| Ended | Last frame + chrome visible with `⏯` reset to play; `⏭` plays the next episode when known |
| Audio-only source | Stage shows the title art on `--m-bg` (no video track) |

---

## 6. Component inventory & file plan

New/changed files (keep `media-` class prefix; the mock's generic names collided
with global CSS — see the skill's note):

| Component | File | Notes |
|---|---|---|
| tokens | `src/styles/media-tokens.css` (new) | §1 |
| shell | `src/components/media/MediaShell.tsx` (new) | rail + top bar + content slot; hosts A/B/C |
| rail | `src/components/media/MediaRail.tsx` (new) | §2.1, `role="navigation"` |
| top bar | `src/components/media/MediaTopBar.tsx` (new) | §2.2, search field + right cluster |
| hero | `src/components/media/MediaHero.tsx` (new) | §3.1, used by board and (variant) detail |
| carousel + card | `src/components/media/MediaCarousel.tsx`, `MediaPosterCard.tsx` (new) | §3.2/§3.3 |
| detail | `src/components/media/MediaDetail.tsx` (new, extracted from `MediaWorkspace`) | §4.2 |
| streams panel | `src/components/media/StreamsPanel.tsx` (replaces `StreamsSheet`) | §4.3 |
| stream row | `src/components/media/StreamRow.tsx` (new, extracted) | 7-line anatomy |
| icons | `src/components/media/icons.tsx` (new) | 16/20/28 px SVG set: rail glyphs, stream-row glyphs, player glyphs |
| player | `src/components/media/PlayerOverlay.tsx` (rewrite) | §5; keep the effect that opens/sizes the native surface |
| menus | `src/components/media/TrackMenu.tsx` (new) | audio/subtitle/speed popovers |
| state | `src/state/mediaStore.ts` (extend) | add `screen` (`board`/`detail`/`player`), `watchProgress`, `tracks`, `activeTrack`, `filter`, `surfaceError` |
| backend | `src-tauri/src/player.rs` | add `media_player_tracks`, `media_player_set_track(kind, id)`, `media_player_chapters` (later) |
| backend | `src-tauri/src/media.rs` | pass through `logo`, `background`, `runtime`, `cast`, `director`, `genres` (Cinemeta already returns them) |
| progress | `src-tauri/src/library.rs` (new, roadmap 6 seeds it) | JSON at app data `library.json`: `{imdbId: {position, duration, updatedAt, season, episode}}`; mandatory for "Continue watching" |
| tests | `src/components/media/*.test.tsx` | structural render tests per component (no jest-dom — use `toBeTruthy()`/`textContent`) |

CSS: extend `src/styles/media.css`, but **`app.css` is CRLF** — never rewrite it
with the patch tool (see the skill). Media CSS files are LF and safe.

---

## 7. Data mapping

| UI element | Source of truth | Status |
|---|---|---|
| Hero art, logo, meta, synopsis, genres, cast, director | Cinemeta catalog/meta response via `media_catalog`/`media_addon_manifest` | available — Cinemeta returns the **full** meta block (logo, background, genres, runtime, cast, director, released) in its *catalog* responses too, and `media.rs` passes those fields through, so the board hero needs no extra round-trip. For the hero itself the `background` URL's `medium` variant must be upgraded to `large` (`board.ts#heroBackdrop`). |
| Poster, rating, release info | same | available |
| Continue watching | new `library.json` progress store + mpv `time-pos`/`duration` from `PlayerStatus` | **new** |
| Stream rows (quality, source, codec, audio, size, HDR) | `src/components/media/streams.ts` parsing of Torrentio `title`/`description` | partially available (quality/codec/size/HDR) |
| Bitrate (`21.4 Mbps`), audio/subtitle language flags | **new** regexes in `streams.ts` | **new** |
| `Ready (RD)` / `Ready (engine)` | `debrid.rs` resolution result; librqbit status `progress/finished` for the local engine | available/partly |
| `N peers`, speed | `media_torrent_status` → `peers`, `peersSeen`, `downloadSpeed` (MB/s) | available (peers only; **no seeder split exists** in librqbit stats — do not fake one) |
| Buffering %, buffered seconds, arrival rate | `PlayerStatus.cachePercent/cacheSeconds/cacheSpeed` | available |
| Audio/subtitle tracks | **new** `media_player_tracks` reading mpv `track-list` (aid/sid, lang, title, codec, channels, default/forced) | **new** |
| Watch progress writes | mpv `time-pos` → IPC throttle (every 5 s) → `library.json` | **new** |

---

## 8. Accessibility & input

- Every control is a real `<button>`/`<a>` with `aria-label`; icon-only buttons need
  labels (`Play`, `Add to library`, `Subtitles`, …).
- Focus visible everywhere: 2 px `--m-accent` ring, 2 px offset; never remove the
  outline without a replacement. Roving focus for carousels (one tab stop per row).
- Live regions: `role="status"` on the buffering pill and the swarm note; `role="alert"`
  on the error card (`PlayerOverlay` already does this — keep it).
- Contrast: body text ≥ 4.5:1 on `--m-bg`; muted text is for annotations only.
- Reduced motion: no card scale, no hero pan, no chrome slide (fade only).
- TV/D-pad ready (roadmap item 7): every interactive element must be reachable with
  arrows + Enter; keep hit targets ≥ 44 px and avoid hover-only affordances for
  the primary path (play button visible on the best row without hover).
- `Esc` semantics: menus → chrome → player → detail → board.

---

## 9. Responsiveness

| Width | Behaviour |
|---|---|
| ≥ 2560 (ultrawide, reference) | rail visible, hero at 46 % height, streams panel docked as a column |
| 1600–2560 | same, hero 40 %, streams panel docked |
| 1200–1600 | streams panel becomes a slide-over; hero 36 %; carousels show 4–5 cards |
| < 1200 (min window 960) | rail collapses to 56 px with tooltips, hero 30 %, cards 150 px wide, streams panel full-width sheet |

Card width = `clamp(150px, 8.5vw, 300px)`; poster height derives from the 0.7 ratio.

---

## 10. Work packages (each independently shippable, one per session)

| WP | Deliverable | Acceptance |
|---|---|---|
| **WP1** ✅ | Tokens + shell: `media-tokens.css`, `MediaShell`, `MediaRail`, `MediaTopBar`, icons | Board renders inside the new shell at 3440 and 1440; rail keyboard-navigable; `tsc` + vitest green; screenshots from the user match the reference chrome |
| **WP2** | Board: `MediaHero`, `MediaCarousel`, `MediaPosterCard` | Cinemeta rows render with 0.7 posters, hover play overlay, progress bars drawn from a stub store; loading + error states |
| **WP3** | Detail + `StreamsPanel` + new `StreamRow` (7-line anatomy, filter, in-row engine states) | Torrentio rows show quality/codec/size/bitrate/langs; filter works; selecting a row plays; the previous `StreamsSheet` is gone |
| **WP4** | Player chrome: autohide strips, transport, seek with buffered span, volume, state pill, error card, keyboard map | Plays a 4K HEVC MKV; chrome hides after 3 s; buffered span tracks `cacheSeconds`; error card visible (surface hidden) |
| **WP5** | Track menus + watch progress: `media_player_tracks`/`media_player_set_track`, `TrackMenu`, `library.json` writes, "Continue watching" fed by real progress | Switch audio to English on the 6-track test release; subtitles off/on/forced; quit and resume at the same position; Continue watching appears on the board |
| **WP6** | Polish: responsiveness table, a11y pass, reduced motion, skeletons, `Show all` cap | Keyboard-only walkthrough of A→B→C; contrast checks; `prefers-reduced-motion` honoured |

### WP1 as built (2026-11-21, branch `feature/media-ui-wp1`)

- `src/styles/media-tokens.css` — every `--m-*` token from §1, scoped to
  `.media-app` (so the file-explorer chrome keeps its theme), imported at the top
  of `media.css`. Orange media colours in `media.css` are untouched — they move to
  tokens per component in WP2–WP4.
- `src/components/media/icons.tsx` — namespaced glyph set (`MediaIcon`,
  `MediaBrandMark`) over lucide; the explorer's `AppIcon` is left alone.
- `MediaShell.tsx` (rail + floating top bar + content slot), `MediaRail.tsx`
  (72 px; Home/Discover live, Library/Calendar/Addons/Settings inert with tooltips;
  roving tabindex with ↑/↓/Home/End), `MediaTopBar.tsx` (56 px, ⌘F search +
  Esc clear, downloads/fullscreen/cast, close).
- `MediaWorkspace.tsx` now renders inside the shell; the old title bar, 216 px side
  nav and their markup are gone, and the catalog/engine/debrid status strip moved to
  `.media-statusline` at the end of the board.
- `mediaStore.ts` — `screen` (`board|detail|player`) and `searchQuery`;
  `selectMeta`/`clearSelection`/`openPlayer`/`closePlayer` maintain `screen`, and the
  shell hides rail + top bar in `player` mode (§2.2).
- Top bar floats **over** the content (`position: absolute` inside `.media-app-main`)
  so WP2's hero can bleed under it; `.media-main` clears it with
  `padding-top: var(--m-topbar-h) + 16px` until the hero lands.
- Gates: `npx tsc --noEmit` clean; `npx vitest run src/components/media` → 21 passed
  (14 before, 7 new in `MediaShell.test.tsx`). No eslint config exists in this repo,
  so lint is not part of the gate.

Later (separate, only if the user asks): **WP7** centre-title/overlay compositing
into the frame buffer; scrub thumbnails; downloads screen behind the top-bar tray;
episode strip for series; TV/D-pad layout (roadmap 7).

### WP2 as built (2026-11-21, branch `feature/media-ui-wp2`)

- `src/components/media/MediaHero.tsx` — full-bleed backdrop, logo art with a text
  fallback (and an `onError` fallback), meta line + gold IMDb pill + genres, 2-line
  synopsis clamp, accent `▶ Watch` pill and the library/episodes circles.
- `src/components/media/MediaCarousel.tsx` + `MediaPosterCard.tsx` — 0.7-ratio
  posters at `clamp(150px, 8.5vw, 300px)`, in-art progress, quality/`NEW` badges,
  `S3` chip, snap scrolling with a 48 px edge fade, hover chevrons when the strip
  overflows, skeletons, per-row error + `Retry`, roving tabindex (one tab stop per
  row, ↑/↓-style arrow keys move within it).
- `src/components/media/board.ts` — pure helpers: `formatRuntime` (`173 min` →
  `2h53min`), `isNew` (30-day window), `heroMetaLine`, `continueWatching`
  (> 2 % / < 95 %, most recent first), `heroBackdrop`.
- `MediaWorkspace.tsx` — board rewritten around those components; Continue
  watching renders first and hides when empty; the top-bar search now filters the
  loaded catalogs and hides the hero while a query is active; the pinned-addons
  panel is gone and its information lives in quiet footer chips next to the
  engine status.
- `mediaStore.ts` — `watchProgress` + `recordProgress`, and `playerSource.metaId`.
  `PlayerOverlay` writes mpv's real `time-pos`/`duration` every 5 s (and once more
  when the player closes), so "Continue watching" is fed by actual playback; the
  store is in-memory only until WP5 persists it to `library.json`.
- `src-tauri/src/media.rs` — `CatalogMeta` now carries `genres`, `cast`,
  `director`, `runtime` and `released`, all optional. Cinemeta ships them in
  **catalog** responses, so the hero needs no second round-trip.
- `media.css` — the board's remaining orange (`#f2a33c` hero/addon accents) is
  gone; the board draws only `--m-*` tokens. The player chrome and the streams
  panel are deliberately still on the old palette (WP4 / WP3).
- Deviations from §3, both measured off the reference rather than read from the
  spec's prose: the hero is **57 %** of the content column (the reference's first
  row heading sits at 57.5 % of the window height; §3.1 said 46 %), and its logo
  art renders up to 140 px tall (the reference logo is ~134 px for two lines).
  Cinemeta's `medium` background is a 1280×720 crop and is often very dark, so
  `heroBackdrop` upgrades `images.metahub.space/background/medium/…` to `large`
  — with `medium` the hero read as an empty dark slab.
- Gates: `npx tsc --noEmit` clean; `npx vitest run src/components/media` → **49
  passed** (21 before, 28 new across `board.test.ts`, `MediaHero.test.tsx`,
  `MediaCarousel.test.tsx`, `MediaWorkspace.test.tsx`). No eslint config exists in
  this repo, so lint is not part of the gate. The 9 failures in
  `ThemeCreator.test.tsx` / `storageStore.test.ts` in the full suite are
  **pre-existing** (reproduced on a pristine `HEAD` worktree).

---

## 11. Do-not list (invariants that already cost us cycles)

1. **Never** draw webview UI over the video stage — the native surface covers it.
   Overlay text on video comes from mpv OSD or (later) buffer compositing.
2. **Never** expose a torrent stream URL to mpv without the readiness Range-probe
   (`media_torrent_status` with `probe=true`).
3. **Never** gate surface visibility on the observed `file-loaded` *property* alone;
   use the `MPV_EVENT_FILE_LOADED` event (see `docs/MEDIA_PLAYER_HANDOVER.md` §8).
4. **Never** fake a seeder count — librqbit exposes peers, not seeds.
5. **Never** `git stash pop` in this repo; use `git worktree` for pristine checks.
6. **Never** rewrite `src/styles/app.css` with the patch tool (CRLF → 500-line diff).
7. **Never** let the media UI reuse generic class names (`.nav`, `.card`, `.stream`)
   — they collide with the app's global CSS. Prefix `media-`.
8. Keep the file-explorer theme, sidebar and Settings visuals unchanged: this is a
   Media-workspace redesign only.
9. **Never** serve the hero Cinemeta's `background/medium` art: it is a 1280×720
   crop and is often near-black, so a full-bleed hero at 3000+ px reads as an empty
   slab. `board.ts#heroBackdrop` upgrades that URL to the `large` variant.
10. **Never** trust this document's measured numbers over the reference PNGs: the
    hero height (57 %, not 46 %) and the logo height were both wrong here and were
    caught by measuring `stremio-01-board.png` directly. The reference is 3440×1410
    at 1×, so pixel ratios on it are directly usable.

---

## 12. Decisions taken for v1 (override freely)

Recorded so the next session does not stall; all reversible:

1. **Accent = violet `#7051F3`** for the media area (it is what the reference
   screenshots show). File-explorer chrome keeps its own theme.
2. **Title art** renders the addon's `logo` PNG when present, text fallback otherwise.
3. **Paused centre title** uses **mpv OSD** in v1 (no webview-over-video); buffer
   compositing (§5.2 option b) stays in WP7.
4. **Trailer button** is hidden when the addon supplies no trailer (no dead buttons).
5. **`⌘F` search** filters already-loaded catalogs in v1; addon `catalog/search` is
   a later addition.
6. **Audio/subtitle track menus** (WP5) are in scope for the redesign even though
   the reference only shows them behind hover — the user's test release has 6 audio
   and 8 subtitle tracks, so this is a real daily-use need.

## 13. Open questions for the user

1. **Accent colour**: adopt the reference violet `#7051F3` for the media area (my
   recommendation, it is what the screenshots show) or keep MAXplorer's orange?
2. **Title art**: are you happy for the hero/centre titles to render the addon's
   `logo` PNG (Cinemeta supplies them) with a text fallback, or do you want text-only?
3. **Player centre title while paused**: mpv OSD (works now, mpv-styled) or wait for
   WP7 buffer compositing (our styling, more work)?
4. **"Trailer" button**: Cinemeta has no trailer for most titles — hide when absent
   (recommended) or render disabled?
5. **`⌘F` search**: search within loaded catalogs only (v1) or query the addon's
   search endpoint (needs a `catalog/search` call — small extra work)?
