# Validation

Validation was performed on the available host, a Windows 11 machine. The target
deliverable is a macOS application; no macOS host was available in this environment.
That boundary is stated explicitly rather than hidden.

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
| `npm test` | **26 passed** across 5 files |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Pass |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **10 passed** (real temp-directory filesystem tests) |
| `npm run build` | Pass; 297.60 kB JS / 41.25 kB CSS |
| `npm run tauri dev` | Launched; interactive UI validation performed |
| `npm run tauri build` | Pass; Windows MSI (1.72 MiB) and NSIS setup (1.22 MiB) |
| Release `win11-explorer.exe` launched with the disposable fixture | Pass; real filesystem listing, image thumbnail, context menu, details pane, dialogs |
| `cargo check --target aarch64-apple-darwin` | **Blocked** by missing macOS C toolchain/SDK |
| REA `inspect-pe-resources` / `inspect-pe-imports` | Pass (evidence files) |

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

All destructive tests use `tempfile::tempdir()` and never touch user folders.

### Frontend tests

`src/lib/*.test.ts` covers:

- Windows-style size formatting including `31.2 KB`, `1,250 KB`, `17,969 KB`, `2,295 KB`;
- date formatting, type names, Windows/macOS path parsing, extension hiding;
- folder-first ascending/descending sorting, size sorting without mutation;
- type grouping;
- history truncation and forward/back behavior;
- tab close/cycle/duplicate behavior;
- selection toggle/range/prune/byte totals.

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
| Text preview | Pass | `app-text-preview.png` |
| Light/dark theme + Options | Pass | `app-preferences-v2.png`, `app-light-resized.png` |
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
- Theme switching left composited top bars dark in WebView2; the top bars are remounted on
  resolved-theme changes.
- Contextual submenu vertical offset was relative to the wrong element; fixed.
- Internal drag to the same folder could rename to `(2)`; same-parent cuts are now no-ops.
- Delete to Trash validation left a test item in the Recycle Bin; removed by original path.

## 5. Remaining gaps and blockers

1. **macOS runtime/package unverified.** No macOS host or Apple SDK in the environment.
   The project includes macOS-specific code, Info.plist usage descriptions, a macOS
   universal CI workflow, and macOS commands. It must be built and smoke-tested on a Mac.
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

## 7. DMG artifact

A genuine `.dmg` was **not** produced here. Creating it requires macOS: Tauri must compile
the Rust backend for `aarch64-apple-darwin` / `x86_64-apple-darwin` and run Apple's
`xcrun`, `codesign`, and `hdiutil` tooling. This host is Windows 11 with no macOS SDK or
Apple toolchain; a cross-check was already blocked at `objc2-exception-helper`.

Prepared for the user:

- `scripts/build-macos-dmg.sh` — one-command universal macOS app + DMG build, verification,
  checksum.
- `.github/workflows/macos-build.yml` — macOS 14 CI build with optional signing secrets,
  DMG verification, checksum, and artifacts.
- `src-tauri/tauri.conf.json` — explicit DMG window/icon/Applications positions.
- `docs/MACOS_DMG.md` — local Mac, CI, signing, notarization, Gatekeeper, and
  troubleshooting instructions.

Run on a Mac:

```bash
cd fileExplorer
bash scripts/build-macos-dmg.sh
```

Expected output:
`src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg`.

Without access to a Mac or an authenticated GitHub/CI runner, I cannot honestly claim to
have built or tested the DMG.
