# Handover — MAXplorer

| Field | Value |
| --- | --- |
| Document version | 1.2 |
| Handover date | 2026-10-29 |
| Project version | 0.1.0 (pre-rebrand release); `main` now includes the MAXplorer identity and icon system |
| Repository | https://github.com/helloraj1986/win11-explorer-macos (private) |
| Release | https://github.com/helloraj1986/win11-explorer-macos/releases/tag/v0.1.0 |
| Current branch | `main` (premium icon system merged 2026-10-29) |

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
- `npm run typecheck`, `npm test` (**219 tests / 24 files**), `cargo test` (**47 tests**),
  `npm run build` all passing on the development host (dual-pane feature pass, cut/paste
  fix, premium icon system, Universal Search, and unified command center).
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

Do not assume the published `v0.1.0` DMG reflects `main`: it predates these changes.

---

## 2. Five-minute orientation

```bash
git clone https://github.com/helloraj1986/win11-explorer-macos.git
cd win11-explorer-macos
npm install
npm run tauri:dev          # dev app against your real home folder
```

Read in this order:

1. `README.md` — feature list, quick start, limitations.
2. `docs/BRANDING.md` — product identity, application icon, metadata, and theme independence.
3. `docs/ARCHITECTURE.md` — data flow, module boundaries, contracts.
4. `docs/THEMES.md` — interface theme model, tokens, persistence, adding a theme.
5. `docs/FEATURE_MATRIX.md` — every studied Explorer feature and its status.
6. `docs/VALIDATION.md` — what was actually run and observed.
7. `docs/MACOS_DMG.md` — packaging, signing, notarization, Gatekeeper.
8. `docs/REFERENCE.md` — how the Windows 11 reference was captured and measured.
9. `docs/DEVELOPMENT_LOG.md` — chronological build log.

The UI follows the Windows Explorer reference closely, so most "why does it look like this?"
questions are answered by `docs/REFERENCE.md` (colors, geometry, control inventory from a
real Windows 11 21H2 host plus REA 6.8.0 PE-resource evidence).

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
    icons/                    File-type registry, native icon service, thumbnail service
  state/explorerStore.ts      Single Zustand store: panes, tabs, navigation, selection,
                              clipboard, transfers, dialogs
  styles/                     tokens.css + app.css + finder.css (scoped Finder layout)
src-tauri/                    Rust backend
  src/commands.rs             All 31 Tauri commands; platform launching
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
reference/                    Windows 11 screenshots, UIA dumps, fixtures, REA JSON
scripts/                      build-macos-dmg.sh + verification helpers
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

### Tauri command surface (31 commands)

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
npm run test:cargo    # cargo test, 47 tests (filesystem, app icons, transfer, comparison, search/index)
npm run build         # tsc -b && vite build
```

### Build the macOS app and DMG locally (on a Mac)

```bash
bash scripts/build-macos-dmg.sh
```

This script refuses to run on non-macOS, checks for Xcode CLT/Node/Rust, installs deps,
runs all checks, builds `universal-apple-darwin`, verifies the DMG with `hdiutil`, and
writes a `.sha256`. Artifacts land in
`src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/`.

Manual equivalent:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

### CI

`.github/workflows/macos-build.yml` runs on `macos-14` for pushes/PRs to `main` that touch
code or build configuration (docs-only and `reference/`-only changes are ignored), and on
demand. Steps: checkout → Node 22 → Rust stable with both Apple targets → `npm ci` →
typecheck → frontend tests → Rust tests → universal `tauri build` → `hdiutil verify` →
SHA-256 → upload artifacts (`windows11-explorer-macos`, `windows11-explorer-app`).
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
4. `gh release create vX.Y.Z --repo helloraj1986/win11-explorer-macos --notes-file NOTES.md --prerelease --target main <dmg> <dmg>.sha256`
5. Point `macos-smoke.yml` at the new tag (it currently hardcodes `v0.1.0`) and run it to
   confirm the published artifact launches.

### Shipped 0.1.0 artifact

| Field | Value |
| --- | --- |
| Build run | https://github.com/helloraj1986/win11-explorer-macos/actions/runs/40490663104 |
| Smoke run | https://github.com/helloraj1986/win11-explorer-macos/actions/runs/40492290652 |
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

- [ ] **GitHub repository access** — `helloraj1986/win11-explorer-macos` (private). Transfer
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
confirmed working on a Mac, with a universal DMG published as `v0.1.0`. Since that release,
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
