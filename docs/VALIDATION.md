# Validation

Validation was performed on the available Windows 11 host and on a macOS 14 GitHub Actions
runner. The local workspace has no macOS host; the CI runner was used to build and smoke-
launch the macOS app. That boundary is stated explicitly rather than hidden.

## 1. Environment

| Item | Value |
| --- | --- |
| Build/run host | Windows 11 Pro `10.0.22000` (21H2), 1512 × 921 |
| WebView | WebView2 |
| Node | 22.18.0 (npm 10.9.3) |
| Rust | 1.97.1 MSVC |
| Tauri | 2.12.x |
| REA | 6.8.0 (portable Node 24.22.1) |

macOS-specific code was reviewed and a macOS target was installed for a cross-check, but
`cargo check --target aarch64-apple-darwin` stops at `objc2-exception-helper` because the
Windows host has no macOS C compiler/SDK (`cc`/Apple SDK missing). This is an environment
blocker, not a source compile result for macOS.

## 2. Commands run and results

| Command | Result |
| --- | --- |
| `npm install` | Pass, 111 packages |
| `npm run typecheck` | Pass (strict TypeScript) |
| `npm test` | **49 passed** across 8 files (26 across 5 before the theme work; 43 before app icons) |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Pass |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **18 passed** (10 filesystem + 8 app-icon tests) |
| `npm run build` | Pass; 316.16 kB JS / 59.89 kB CSS |
| `npm run tauri dev` | Launched; interactive UI validation performed |
| `npm run tauri build` | Pass; Windows MSI (1.72 MiB) and NSIS setup (1.22 MiB) |
| Release `win11-explorer.exe` launched with the disposable fixture | Pass; real filesystem listing, image thumbnail, context menu, details pane, dialogs |
| `cargo check --target aarch64-apple-darwin` | **Blocked** by missing macOS C toolchain/SDK |
| REA `inspect-pe-resources` / `inspect-pe-imports` | Pass (evidence files) |

### Post-merge CI on `main`

`feature/dual-theme` was merged into `main` with `--ff-only` and pushed as `779c6b7`. The
`macOS build` workflow then succeeded on macOS 14 (run
[40648095307](https://github.com/helloraj1986/win11-explorer-macos/actions/runs/40648095307),
5m19s): typecheck, 49 frontend tests, 18 Rust tests, the universal `tauri build`, `hdiutil`
verification, checksum, and artifact upload all passed. The log contains a Node 20
deprecation notice for the pinned GitHub actions (the runner forces Node 24); it is
informational, not a failure.

This confirms the merged tree builds on macOS. It does **not** replace the pending
interactive pass for the Finder theme and real `/Applications` icons.

### Icon system verification (2026-10-29)

The premium icon system was verified on the macOS development host:

| Command / check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | **161 passed** across 20 files |
| `npm run test:cargo` | **28 passed** |
| `npm run build` | Pass; 417.54 kB JS (118.19 kB gzip) / 81.42 kB CSS |
| `git diff --check` | Clean |

A temporary browser preview rendered the registry artwork, functional icons, folders,
storage and transfer-status indicators in Windows light/dark and Finder dark. The preview
files were removed after inspection. This was a visual component check, not a replacement
for the pending Tauri-window macOS interaction pass.

The new tests cover extension mapping, case-insensitive extensions, compound extensions,
dotfiles, files without extensions, unknown files, MIME fallback, native `.app` icon
failure, thumbnail failure fallback, folder theme switching, list/grid/details rendering,
and accessibility labels.

### Rust tests

`src-tauri/src/tests.rs` covers:

- real directory listing and hidden-file filtering;
- create folder/text file, rename, permanent delete;
- copy file/directory, conflict rename, move, duplicate;
- refusal to copy an item onto itself (source remains intact);
- text/binary preview and folder statistics;
- name validation and unique names;
- recursive search, hidden filtering, cancellation state;
- missing directory error mapping.

`src-tauri/src/app_icons.rs` covers:

- ICNS PNG-chunk selection (prefers the smallest icon at or above 256 px, otherwise the
  largest) and rejection of non-ICNS data;
- icon lookup through a binary `Info.plist` (`CFBundleIconFile`), with the bundle-named
  resource as fallback;
- non-bundle paths and bundles without icons returning `None`.

All destructive tests use `tempfile::tempdir()` and never touch user folders.

### Frontend tests

`src/lib/*.test.ts` covers:

- Windows-style size formatting including `31.2 KB`, `1,250 KB`, `17,969 KB`, `2,295 KB`;
- date formatting, type names, Windows/macOS path parsing, extension hiding;
- folder-first ascending/descending sorting, size sorting without mutation;
- type grouping;
- history truncation and forward/back behavior;
- tab close/cycle/duplicate behavior;
- selection toggle/range/prune/byte totals;
- interface theme ids, names, normalization, appearance resolution, and `data-*` attributes;
- theme row metrics used by the virtualized views;
- persisted `interfaceTheme`/`theme` restoration, invalid-value fallback, and the pre-render
  theme reader (`parseThemePreferences`);
- file-icon registry resolution for documents, media, archives, development formats,
  applications, fonts, certificates, databases, configuration, compound extensions,
  dotfiles, extensionless files, MIME hints and unknown fallbacks;
- icon component rendering in details/list/grid views, folder theme switching, thumbnail
  failure fallback, native `.app` icon success/failure, and decorative/labelled
  accessibility states.

## 3. Interactive validation (running app)

The app was launched against a disposable fixture:

```bash
WIN11_EXPLORER_START_PATH=D:\RKM_SYNC\fileExplorer\reference\fixture npm run tauri dev
```

Observed workflows:

| Workflow | Result | Evidence |
| --- | --- | --- |
| Launch and read real directory | Pass | `docs/screenshots/app-dark-details-1510.png` |
| Details/List/Large/Small icon view switching | Pass | `app-large-icons.png`, `app-list-view-v3.png`, `app-light-large-thumb-v3.png` |
| Single row selection + status bar + details pane | Pass | `app-selected.png`, `app-details-pane.png` |
| File context menu | Pass | `app-context-menu.png` |
| Blank context menu | Pass | `app-blank-menu-v3.png` |
| New / Sort / View / More menus | Pass | `app-new-menu.png`, `app-more-menu.png` |
| Tabs create/Home | Pass | `app-tabs-home.png` |
| Address navigation | Pass | `app-address-nav.png` |
| Search (recursive, name, location column) | Pass | `app-search-results-v3.png` |
| Invalid path feedback + toast | Pass | `app-invalid-path-v4.png` |
| Create folder + rename prompt | Pass | `app-new-folder.png`, `app-renamed-folder.png` |
| Copy + paste into another folder | Pass | `app-copy-paste.png` |
| Delete confirmation + move to Trash | Pass | `app-delete-confirm.png`, `app-deleted-trash.png` |
| Properties dialog | Pass | `app-properties.png` |
| Details pane | Pass | `app-details-pane.png` |
| Image preview + thumbnail | Pass | `app-preview-pane.png`, `app-light-large-thumb-v3.png` |
| `.app` bundle icons (details, large icons, preview pane, both themes) | Pass | `app-icons-finder-details.png`, `app-icons-finder-large.png`, `app-icons-finder-preview.png`, `app-icons-windows-preview.png`, `app-icons-windows-fallback.png`; synthetic bundles with `Info.plist`, resource fallback, and no icon |
| Text preview | Pass | `app-text-preview.png` |
| Light/dark theme + Options | Pass | `app-preferences-v2.png`, `app-light-resized.png` |
| Interface theme selector (two cards, active badge, keyboard focus/activation) | Pass | `themes-dialog-finder-light.png`, `themes-dialog-finder-dark.png`, `themes-dialog-windows-dark.png`; Tab reached both cards, Space applied Finder, focus ring visible |
| Live switch Finder → Windows with tabs/path/selection/search preserved | Pass | `finder-light-details.png` → `windows-light-details.png`; 17 search results and query unchanged; no remount, no reload |
| Finder light details, toolbar, source list, 28 px rows | Pass | `finder-light-details.png` |
| Finder dark details and selection | Pass | `finder-dark-details.png` |
| Finder dark list and icon views | Pass | `finder-dark-list.png`, `finder-dark-icons.png` |
| Windows dark regression check | Pass | `windows-dark-details.png` |
| Finder context menu and More menu | Pass | `finder-dark-context-menu.png`, `finder-dark-more-menu.png` |
| Finder layout at 1080 × 720 (toolbar/search/sidebar) | Pass | `finder-dark-narrow.png`; no overlap, breadcrumb truncates, search remains usable |
| Rename across a live theme switch (temp directory) | Pass | `alpha.txt` → `beta.txt`; file on disk, selection preserved, temp directory removed |
| Theme persistence across restart | Pass | Finder + dark + list view restored from `localStorage` |
| Refresh re-reads disk | Pass | `app-refresh-click.png` |
| OS-level screenshot capture of app | Pass | all `app-*.png` |
| Tab close | Not recorded | Code path + unit tests |
| Back/forward buttons | Not recorded interactively | History unit tests + code path |
| Marquee/drag selection | Not recorded interactively | Code path; visually rendered rectangle |
| Internal/OS drag-and-drop | Not recorded interactively | Code path |
| Maximize/caption controls | Click event fired; window maximized to the work area and restore icon appeared | `app-final-maximized.png` |
| Open With / Share | Not testable on Windows/macOS-specific | Blocked |

### Cleanup after destructive UI tests

- The `Test Folder` created in the fixture and its copied `Project Brief.docx` were
  removed. The test copy that was moved to the Recycle Bin during validation was matched
  by original path and permanently removed.
- The theme rename test used a temporary directory outside the repository
  (`theme-rename-test` with `alpha.txt`) and was deleted after validation.
- No user folders were used as test targets.

## 4. Screenshot comparison

Reference screenshots were captured at 1510 × 871 from the real Windows 11 Explorer. The
replica was captured around 1510–1528 × 871–882 depending on persisted window bounds.

Matched or closely matched:

- Content region starts at y=140 in both (title/command/nav stack).
- Sidebar width ~204 including divider; content starts ~208 vs reference 207.
- Details header 25 px, row step 31 px, first row inset ~221.
- Columns 272 / 144 / 120 / 80 and 16 px icons.
- Command bar ordering, 16 px icons, 2/40/84/89 button rhythm, separator placement.
- Address pill height 34; search height 32; breadcrumbs and folder icon.
- Status bar height 23–24; item count and view buttons.
- Dark `#191919` content, Mica `#1B2228` top bars, light `#FFFFFF`/`#F3F3F3`.
- Context menu grouping, 30 px items, 16 px icons, shortcut alignment.
- Details pane metadata layout and 96 px document icon.
- Light theme after the top-bar repaint fix.

Known visual differences:

- **Tabs** add a 40 px title strip; the 21H2 reference has a 31 px caption strip.
- The reference had 11 pinned quick-access folders from the host user; a fresh replica has
  no pinned paths and shows Home/This Mac immediately.
- File type glyphs are original simplified SVGs; Windows uses per-association product
  icons (e.g. Word, Excel, VLC).
- The reference context menu includes third-party shell extensions; the replica omits them.
- The replica adds a search-summary strip and details-pane total-size/workspace rows.
- Blank menu lacks Undo Delete and Show more options; tab overflow uses scrolling.
- Native tooltips are rendered by the OS while hovering rows; the reference also shows
  native tooltips, but exact styling differs.
- **App icons** were validated on the Windows dev host with synthetic `.app` bundles
  (binary plist parsing is unit-tested, but the real `/Applications` folder was not
  browsed interactively on macOS in this pass). Legacy ICNS files without PNG chunks rely
  on macOS `sips` and were not exercised. Icons are cached per session, so replacing an
  app while the window is open keeps the previous icon until restart.
- **Finder theme** is a web-rendered recreation: list view keeps the shared name-only rows
  (no Finder column headers or alternating stripes), and column view, Quick Look, and tags
  are intentionally absent. Traffic lights are CSS controls (glyphs appear on hover), not
  AppKit buttons. On the Windows dev host, Finder typography falls back to Segoe UI; macOS
  uses the system UI font stack.

- Windows release bundle artifacts:
  `src-tauri/target/release/bundle/msi/Windows 11 Explorer_0.1.0_x64_en-US.msi`
  and `src-tauri/target/release/bundle/nsis/Windows 11 Explorer_0.1.0_x64-setup.exe`.
- Release executable: `src-tauri/target/release/win11-explorer.exe`.
- macOS artifacts must be produced on a Mac (`npm run tauri:build`) or by the included
  GitHub Actions workflow; they are not present in this Windows workspace.

Bugs found and corrected during this pass:

- Zustand selectors returning new arrays caused the first blank render; fixed with
  `useShallow`/memoized derived values.
- New-menu tooltip covered the first menu item; disabled tooltip while the menu is open.
- Search summary text was mojibake after a PowerShell edit; all source non-ASCII was
  normalized to ASCII and verified.
- Address-bar error text persisted after blur; it now clears.
- Theme switching initially left composited top bars dark in WebView2; the earlier
  workaround remounted the top bars. The dual-theme work removed the remounts, applied
  `data-ui-theme`/`data-theme` to `<html>`, and re-validated live switches in both
  directions without stale bars.
- Contextual submenu vertical offset was relative to the wrong element; fixed.
- Internal drag to the same folder could rename to `(2)`; same-parent cuts are now no-ops.
- Delete to Trash validation left a test item in the Recycle Bin; removed by original path.

## 5. Remaining gaps and blockers

1. **macOS runtime coverage is startup-level, not full interaction.** The app was built,
   mounted from the DMG, launched, and screenshotted on macOS 14 CI, with the process
   alive and the real `/Users/runner` filesystem shown. Clicking, drag/drop, context
   menus, and file operations were not automated on macOS; those were exercised on the
   Windows dev build and covered by Rust tests.
2. **Tabs** are an informed 22H2/23H2 approximation because the reference host is 21H2.
3. **Window maximize** is now verified on the Windows release build: the window maximized
   to the working area and the restore glyph appeared. Re-verify minimize/close and the
   same controls on macOS.
4. **Open With and Share** require macOS. Open With is implemented for `.app` bundles;
   Share is a deliberate path-copy + Reveal in Finder fallback.
5. **Drag/drop and marquee** code paths were not automated in this pass. They are visible
   and wired but need interactive regression testing.
6. **Large-directory stress test** used code bounds and virtualization; a 10k–50k file
   visual stress run was not performed.
7. **Full keyboard matrix** under every focus state (dialogs, menus, search, address) was
   not automated. Core shortcuts were exercised (Ctrl+T, Ctrl+Shift+N, F5, theme shortcuts,
   and mouse-driven address editing).
8. **Theme interaction coverage is Windows-hosted.** Both themes were exercised in the
   Windows dev build in light and dark; the theme selector, menus, resize, rename, and
   restart persistence were validated. The Finder theme was not re-run interactively on
   macOS in this pass, so native font rendering, TCC prompts, OS drag-and-drop, and Open
   With remain unverified there. Theme unit tests cover normalization and persistence, not
   pixel layout.
9. **No automated visual regression suite.** Theme parity is checked by unit tests, shared
   code paths, and the screenshots listed above, not by image diffing.

## 7. DMG artifact

A genuine universal macOS DMG **was produced on a macOS 14 GitHub Actions runner**:

- Run: https://github.com/helloraj1986/win11-explorer-macos/actions/runs/40490663104
- Release: https://github.com/helloraj1986/win11-explorer-macos/releases/tag/v0.1.0
- Local file: `dist-macos/Windows 11 Explorer_0.1.0_universal.dmg`
- Size: 3,310,805 bytes
- SHA-256: `AE6A6758D2007DDD954E39DAB7B1665CBED8FB3BC49A026F738F4ACC20B845CA`
- The checksum matches the published `.sha256` asset.

Structural verification on Windows (the DMG cannot be mounted here):

- 7-Zip recognizes a valid UDIF/`Dmg` container with an HFS filesystem.
- The mounted image contains `Windows 11 Explorer.app`, an `Applications` shortcut, and
  `.VolumeIcon.icns`.
- `Contents/MacOS/win11-explorer` begins with a universal Mach-O fat header
  (`CA FE BA BE`, 2 architectures).
- `Contents/Info.plist` has the expected bundle id (`com.replica.win11explorer`), version
  `0.1.0`, minimum system `12.0`, and the macOS TCC usage descriptions.
- `Contents/_CodeSignature` is present (ad-hoc signing configured in `tauri.conf.json`).

Runtime smoke verification on macOS 14 CI:

- Workflow: `.github/workflows/macos-smoke.yml`, run `40492290652` (success, 22 s).
- The published DMG was downloaded, mounted, copied out, quarantine-cleared, and launched.
- `pgrep -fl win11-explorer` showed the app process running from
  `/Users/runner/work/_temp/Windows 11 Explorer.app/Contents/MacOS/win11-explorer`.
- A real macOS screenshot was captured: `docs/screenshots/macos-smoke.png`.
- macOS version: 14.8.9 (23J631).

Owner confirmation (2026-10-28): the application was installed and run successfully on a
Mac by the project owner, including normal browsing.

Still not established:

- Interactive workflows on macOS (clicking, drag/drop, menus, file operations) are not
  covered by automated tests. The smoke run verifies startup, rendering of Home, real
  filesystem locations, and process stability, not the full interaction matrix.
- The build is ad-hoc signed, not Developer ID signed or notarized. Gatekeeper requires
  right-click → Open; for distribution, sign and notarize.

Tooling added for reproducible mac builds:

- `scripts/build-macos-dmg.sh` — one-command universal macOS app + DMG build, verification,
  checksum.
- `.github/workflows/macos-build.yml` — macOS 14 CI build with DMG verification, checksum,
  and artifacts.
- `src-tauri/tauri.conf.json` — explicit DMG window/icon/Applications positions and
  ad-hoc signing.
- `docs/MACOS_DMG.md` — local Mac, CI, signing, notarization, Gatekeeper, and
  troubleshooting instructions.


## Dual-pane mode validation (2026-10-28)

Automated checks run from the repository root on the development host:

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Pass | No TypeScript errors |
| `npm test` | Pass | 83 tests across 11 files (80 from the dual-pane pass plus 3 for the cut/paste fix) |
| `cargo test` | Pass | 28 Rust tests (including 7 transfer and 3 comparison temp-directory tests) |
| `npm run build` | Pass | `tsc -b && vite build` produced the production bundle |

Test coverage added for this feature:

- `src/lib/panes.test.ts` — split clamping, synchronized mapping/anchors, conflicts,
  recursive-transfer guard, accelerator matching/display, legacy pane restore.
- `src/lib/compare.test.ts` — comparison categories, differences-only filtering, per-pane
  indicators, summary counts.
- `src/lib/transfers.test.ts` — queued item creation, percent/ETA/speed formatting,
  out-of-order progress, terminal statuses, result summaries.
- `src/lib/persistence.test.ts` — dual-pane state, active pane, clamped divider, shortcuts,
  transfer history, legacy fallback, invalid-value repair.
- `src-tauri/src/transfer.rs` tests — recursive copy, move source removal, conflict
  policies (`error`/`skip`/`rename`/`replace`), recursive-transfer rejection, relative
  paths, non-directory destination, cancellation.
- `src-tauri/src/compare.rs` tests — name/size/directory comparison without mutation,
  optional byte verification, missing-folder errors.

Not performed in this pass: interactive dual-pane click/drag verification on a Mac. The
automated tests use isolated temp directories and the existing fixture set; Tauri command
wiring compiles but should receive a manual macOS pass before release.


## Cut/paste feedback fix (2026-10-29)

Reported as "Cmd+X and Cmd+V copy-pastes instead of cut-and-pastes" on macOS.

Diagnosis, using the app's own persisted state instead of a guess: the
`transferHistory` entry in `win11-explorer-state-v1` (WKWebView localStorage for
`com.replica.win11explorer`) showed the owner's four most recent operations as
`mode: move`, `status: completed`. The filesystem move was correct; the view was not.

Cause: `paste()` records the destination pane as the transfer's `sourcePane`, so only the
pane that received the paste was reloaded. In dual-pane mode the pane the items were cut
from kept listing them, and cut entries had no visual state, so the result looked like a
copy.

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Pass | No TypeScript errors |
| `npm test` | Pass | 83 tests across 11 files (3 new for `panesShowingSources`) |
| `npm run build` | Pass | `tsc -b && vite build` produced the production bundle |
| `npm run tauri build -- --target universal-apple-darwin` | Pass | Universal `.app` (7.20 MiB) and DMG (3.30 MiB) rebuilt from the fixed tree |

Coverage added: `src/lib/panes.test.ts` — source folders map to the panes showing them
(single pane, both panes, and no match). The universal bundle rebuild was **not** installed
over `/Applications` (stopped at the owner's request), so the interactive macOS
confirmation of the source-pane reload and the dimmed cut state is still outstanding.


## Unified three-layer command center (2026-10-30)

The unified chrome and consolidated Settings work was validated with the automated suite
available in this workspace. No interactive Tauri-window session was available to this
automation pass, so the visual/interaction matrix below is explicitly marked as pending.

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Pass | Strict TypeScript, no errors |
| `npm test` | Pass | **219 tests across 24 files** |
| `npm run test:cargo` | Pass | **47 Rust tests** |
| `npm run build` | Pass | Production bundle built |
| `git diff --check` | Pass | No whitespace errors |

Coverage added or updated:

- `src/lib/theme.test.ts` — display preference normalization, text/icon scales, and compact
  row metrics for both themes.
- `src/lib/persistence.test.ts` — round-trip of display, column visibility, command-bar
  labels, sidebar visibility, folder-open behavior, and Trash confirmation; legacy and
  invalid-value fallbacks.
- `src/components/CommandBar.test.tsx` — file operations disable without a selection and
  enable with one; the dual-pane toggle lives in the command bar; the single Settings menu
  exposes Appearance, Display/Layout, Keyboard, and About.

A temporary browser preview (not a Tauri session) rendered the three layers in Windows
light, Windows compact, Finder dark, and dual-pane layouts, plus the Appearance and Display
sections of the Settings dialog. The preview reproduced the expected layer order, per-pane
badges/tab rows, responsive command bar, and compact rows without console errors. The
preview files were deleted after inspection.

Not yet performed in this pass: interactive Tauri verification of the three new rows, the
narrow-width tiers at the minimum window size, text/icon scaling inside the actual webview,
sidebar collapse, and keyboard traversal of the Settings dialog. These should be exercised
at 760×520, 1080×720, and a wide window in both themes before the next release.
