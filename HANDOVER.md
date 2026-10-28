# Handover — Windows 11 File Explorer for macOS

| Field | Value |
| --- | --- |
| Document version | 1.0 |
| Handover date | 2026-10-28 |
| Project version | 0.1.0 |
| Repository | https://github.com/helloraj1986/win11-explorer-macos (private) |
| Release | https://github.com/helloraj1986/win11-explorer-macos/releases/tag/v0.1.0 |

---

## 1. What this is

A native macOS desktop application that recreates the Windows 11 File Explorer interface
with high visual fidelity, while browsing the **real macOS filesystem**. It is an
independent implementation, not a mockup, screenshot embed, or themed wrapper around a
generic file manager.

| Item | Value |
| --- | --- |
| Stack | Tauri 2 + Rust backend + React 18 + TypeScript + Zustand |
| Bundle ID | `com.replica.win11explorer` |
| App name | Windows 11 Explorer |
| Minimum macOS | 12.0 |
| Architectures | Universal (arm64 + x86_64) |
| Signing | Ad-hoc (`signingIdentity: "-"`), **not notarized** |
| License | MIT (interface recreation; not affiliated with Microsoft) |

### Current status

The project is **feature-complete for the scoped feature set and confirmed working on a
Mac by the project owner on 2026-10-28**. The shipped 0.1.0 DMG launches, renders the
Windows 11 shell, and browses real macOS folders.

Verified before handover:

- macOS 14.8.9 CI build of a universal DMG, plus a smoke launch of the published DMG with
  a real screenshot (`docs/screenshots/macos-smoke.png`).
- Owner-confirmed interactive run on a Mac.
- `npm run typecheck`, `npm test` (26 tests), `cargo test` (10 tests), `npm run build` all
  passing on the Windows development host.
- Windows release build exercised for UI/interaction validation.

Not verified (see [§8](#8-known-limitations-and-risks)): a formal macOS interaction test
pass, Developer ID signing, notarization, and Mac App Store sandboxing.

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
2. `docs/ARCHITECTURE.md` — data flow, module boundaries, contracts.
3. `docs/FEATURE_MATRIX.md` — every studied Explorer feature and its status.
4. `docs/VALIDATION.md` — what was actually run and observed.
5. `docs/MACOS_DMG.md` — packaging, signing, notarization, Gatekeeper.
6. `docs/REFERENCE.md` — how the Windows 11 reference was captured and measured.
7. `docs/DEVELOPMENT_LOG.md` — chronological build log.

The UI is a faithful replica, so most "why does it look like this?" questions are answered
by `docs/REFERENCE.md` (colors, geometry, control inventory from a real Windows 11 21H2
host plus REA 6.8.0 PE-resource evidence).

---

## 3. Repository map

```
src/                          React + TypeScript UI
  App.tsx                     Root layout and view composition
  components/                 Shell, command bar, sidebar, views, menus, dialogs, panes
    FileArea.tsx              Details/list/icons/tiles/content rendering, selection, drag
    CommandBar.tsx            New / Cut / Copy / Paste / Rename / Delete / Sort / View
    NavigationBar.tsx         Breadcrumbs, editable address bar, search box
    Sidebar.tsx               Quick access, This Mac, volumes, pinned, recents
    TitleBar.tsx              Custom Windows-style title bar and tab strip
    ContextMenu.tsx           File and background context menus with submenus
    Dialogs.tsx               Create, rename, delete, conflict, properties, open-with
    DetailsPane.tsx           Metadata + permissions pane
    PreviewPane.tsx           Image and text preview
    FileGlyph.tsx / Icon.tsx  Original SVG glyph system (no emoji, no bitmaps)
  hooks/                      Keyboard, theme, virtual rows, marquee, window persistence
  lib/                        Typed IPC API, formatting, sorting, history, tabs, persistence
  state/explorerStore.ts      Single Zustand store: tabs, navigation, selection, operations
  styles/                     tokens.css (design tokens) + app.css (all component styling)
src-tauri/                    Rust backend
  src/commands.rs             All 25 Tauri commands; platform launching
  src/listing.rs              Directory reads, metadata, hidden files, symlinks
  src/operations.rs           Copy/move/rename/delete/duplicate/conflict resolution
  src/search.rs               Bounded, cancellable recursive name search
  src/metadata.rs             Properties, folder stats, text preview, sidebar locations
  src/paths.rs                Path/name validation, self-move and protected-root guards
  src/error.rs                Typed error codes surfaced to the UI
  src/types.rs                Serialized IPC contracts
  src/tests.rs                Rust unit/integration tests (tempfile-based)
  tauri.conf.json             Window, CSP, asset protocol, DMG layout, ad-hoc signing
  capabilities/default.json   Tauri permission allowlist
docs/                         Architecture, reference, matrix, validation, DMG, log
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
- **One store, explicit actions.** `explorerStore.ts` (~42 KB) is the only state owner;
  components subscribe via selectors. Adding a feature means adding a store action, not
  local component state.

### Tauri command surface (25 commands)

| Group | Commands |
| --- | --- |
| Environment | `get_platform_info`, `get_initial_path`, `get_sidebar_locations` |
| Navigation | `resolve_path`, `path_exists`, `list_directory` |
| Search | `search_files`, `cancel_search` |
| Create | `create_folder`, `create_text_file`, `create_symlink` |
| Modify | `rename_path`, `copy_paths`, `move_paths`, `delete_paths`, `duplicate_paths` |
| Inspect | `get_properties`, `get_folder_stats`, `read_text_preview`, `list_applications` |
| Launch | `open_path`, `reveal_path`, `open_terminal`, `open_with`, `open_system_settings` |

### Persistence

UI state is stored in `localStorage` (WKWebView website data for the bundle ID), under
`win11-explorer-state-v1` and `win11-explorer-window-v1`. It is versioned and defensively
validated on load (`src/lib/persistence.ts`); malformed data falls back to defaults rather
than crashing. Persisted: tabs, per-tab history, view mode, sort, group, column widths,
sidebar width, pinned folders, recents, theme, panes, hidden/extension toggles, window
bounds.

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
npm test              # vitest, 26 tests
npm run test:cargo    # cargo test, 10 tests
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

### Signing and notarization (the main outstanding distribution task)

The build is ad-hoc signed. On another machine Gatekeeper will block it until the user
right-click → Opens it, or clears quarantine:

```bash
xattr -dr com.apple.quarantine "/Applications/Windows 11 Explorer.app"
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
send to Desktop/Documents/Downloads, Trash and permanent delete with confirmation and
conflict resolution (replace/keep both/skip/cancel), context menus with New/Sort/View/Group/
Send to submenus, details pane (metadata, permissions, owner IDs, folder size), preview pane
(images, text), Properties, Open With, Reveal in Finder, Open Terminal, System Settings
deep-link for denied permissions, dark/light/system themes, and full state persistence.

Per-feature status, including approximations, is in `docs/FEATURE_MATRIX.md`.

---

## 7. Development conventions

- **No emoji and no bitmap icons.** All iconography is original SVG in `Icon.tsx` /
  `FileGlyph.tsx`. Keep it that way.
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
6. **Copy/move progress is indeterminate** — operations run off the UI thread and report
   completion, but bytes are not streamed.
7. **Omitted features:** Gallery, Quick Look, PDF preview, compressed folders, column filter
   dropdowns, Properties tabs beyond General, ACL editing.
8. **Share** copies the path and offers Reveal in Finder instead of the macOS share sheet.
9. **Tabs are a 22H2-informed approximation** (the reference host was 21H2 and had no tabs);
   tab overflow scrolls horizontally instead of using the 22H2 overflow flyout.
10. **Native traffic lights are intentionally not shown** — the title bar uses custom
    Windows-style window controls.
11. **CI cost control is partial.** Docs-only and `reference/`-only pushes are skipped, but
    any source change still rebuilds the universal DMG (~6 min of macOS runner time). Cargo
    and target caching are not configured.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "App is damaged and can't be opened" | Quarantine on an ad-hoc signed build | `xattr -dr com.apple.quarantine "/Applications/Windows 11 Explorer.app"` |
| Gatekeeper blocks first launch | Not notarized | Right-click → Open → Open |
| Empty Desktop/Documents/Downloads | TCC permission denied | Allow in System Settings → Privacy & Security → Files and Folders; the app links there from its error state |
| `tauri:dev` fails on port 1420 | Port in use | Stop the other process; Vite is pinned to 1420 by `tauri.conf.json` |
| `npm ci` fails in CI | Lockfile drift | Regenerate `package-lock.json` and commit it |
| DMG build fails with bundler errors | Missing Rust Apple targets / Xcode CLT | `rustup target add aarch64-apple-darwin x86_64-apple-darwin`, `xcode-select --install` |
| macOS runner stuck "queued" | GitHub macOS capacity | Wait; retry later |
| UI state looks corrupted | Stale localStorage from an older build | Quit app, delete the WebKit container for `com.replica.win11explorer` |
| Search finds nothing in a big tree | Bounds hit | Narrow the folder; bounds are in `src-tauri/src/search.rs` |

---

## 10. Suggested next steps (prioritized)

1. **Developer ID signing + notarization** in CI, so the DMG opens without workarounds.
2. **macOS UI smoke automation** (e.g. AppleScript/`osascript` or XCUITest driving the
   app): open a temp folder, switch views, create a folder, rename, delete, verify on disk.
3. **Streamed operation progress** for copy/move (byte counts + cancel).
4. **Undo for delete/rename/move** (operation journal).
5. **Quick Look and PDF preview**, then Gallery.
6. **Indexed search** (Spotlight `mdfind` bridge) as an opt-in alongside name search.
7. **Properties tabs** (Details/Security equivalents) and ACL viewing.
8. **CI speed**: cache `~/.cargo` and the Rust target directory (docs-only pushes are
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
- [ ] **Node 22+ and Rust stable 1.77.2+**.
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
- `docs/screenshots/` — replica screenshots including the macOS CI smoke capture.

`docs/REFERENCE.md` records exactly which claim came from which capture, and which parts
are informed approximations.

---

## 13. One-paragraph summary for the next owner

This is a Tauri 2 / Rust / React recreation of Windows 11 File Explorer that runs natively
on macOS and operates on the real filesystem. It is feature-complete for its scope and
confirmed working on a Mac, with a universal DMG published as `v0.1.0`. The Rust backend
owns all filesystem access through 25 typed commands; the React UI is a single Zustand store
plus a component layer styled with design tokens. Tests and typechecking pass, and CI builds
and smoke-launches the DMG on macOS 14. The immediate work is distribution polish —
Developer ID signing and notarization — followed by macOS UI automation and streamed file
operation progress. Everything you need to build, test, release, and extend it is in
`README.md` and `docs/`.
