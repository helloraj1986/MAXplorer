# Development log

## Phase 1 — Repository reconnaissance

- Inspected `D:\RKM_SYNC\fileExplorer\rea` (REA 6.8.0).
- Read README, AGENTS, native investigation docs, skill instructions, CLI help.
- Found REA requires Node 22.23.4+/24.22.1+; host Node 22.18 fails `npm ci` engine gate.
- `npm ci --force` installed packages; `npm run build:cached` failed because the source
  checkout lacks `native/windows/build/manifest.json` and the native addon.
- Downloaded portable Node 24.22.1 and ran REA 6.8.0 via `npm exec`.
- Ran PE resource and import inspection on `C:\Windows\explorer.exe`; retained JSON
  evidence (572 resources, 28 icon groups, 1,151 examined entries).
- Established that REA's native UI capture is macOS ScreenCaptureKit/AX; used Windows UI
  Automation + Win32 capture for the actual GUI.

## Phase 2 — Reference specification

- Captured real Windows 11 Explorer at 1510×871 in dark and light themes.
- Captured Details, List, Large icons, Small icons, details pane, view/sort/new menus,
  file context menu, blank context menu, and empty folder.
- Dumped UI Automation geometry for toolbars, nav pane, list, columns, rows, status.
- Sampled colors and compared font sizes.
- Discovered the host is Windows 11 21H2 (build 22000): no tabs, no Home surface.
- Recorded tabs/Home as informed 22H2 approximations.
- Built the feature matrix and reference document.

## Phase 3 — Architecture and foundation

- Chose Tauri 2 + Rust + React 18 + strict TypeScript + Zustand.
- Scaffolded Vite/React/Tauri, icons, Info.plist, capabilities, and macOS CI.
- Implemented typed Rust commands for listing, metadata, search, operations, locations,
  previews, launching, and settings.
- Implemented store, tab model, per-tab history, selection model, sorting/grouping,
  persistence, theme, and window-state hooks.
- Added 10 Rust filesystem tests and 26 TypeScript behavior tests.

## Phase 4 — High-fidelity UI

- Built custom title bar/tabs/caption controls, command bar, address bar/search,
  navigation pane, details/list/grid/tiles/content views, status bar, details/preview
  panes, menus, context menus, dialogs, toasts, and operation overlay.
- Matched observed 25 px headers, 31 px rows, 272/144/120/80 columns, 16 px icons,
  34 px address pill, 32 px search, 204 px sidebar, status 24 px, menu 30/36 px rhythm.
- Added original SVG icon set and folder/file glyphs with real image thumbnails.
- Added light/dark tokens matching sampled reference colors.

## Phase 5 — Functional implementation

- Real browsing, navigation history, breadcrumbs, address entry with invalid-path state,
  recursive cancellable search, view switching, sort/group, column resize, selection,
  keyboard navigation, marquee, drag/drop, tabs, pins, recents.
- Real create/rename/copy/cut/paste/move/duplicate/delete-to-Trash/permanent delete,
  symlinks, conflict handling, send-to, properties, image/text preview, open/reveal.
- Error/permission states and safety guards.

## Phase 6 — Validation

- Ran typecheck, frontend tests, Rust tests, frontend production build, Tauri dev.
- Exercised real filesystem workflows against a disposable fixture: navigation, tabs,
  search, address errors, create/rename, copy/paste, delete confirmation/Trash, properties,
  details/preview panes, image/text previews, light/dark theme, refresh.
- Captured dozens of screenshots and compared layout/color against the reference.
- Fixed: Zustand selector blank render, theme repaint, tooltip over menu, mojibake,
  address error persistence, submenu offset, same-folder cut, search-status text.
- Attempted macOS cross-check; blocked by missing macOS C toolchain/SDK.
- Built the Windows release bundle with Tauri.

## Phase 7 — Delivery

- Wrote README, reference evidence, feature matrix, architecture, validation, and this log.
- Added macOS CI build workflow and packaging instructions.
- Pushed the project to the private GitHub repository `helloraj1986/win11-explorer-macos`.
- Built a universal macOS app and DMG on a macOS 14 GitHub Actions runner:
  run `40490663104`.
- Verified the DMG container, HFS contents, universal Mach-O header, Info.plist, and
  ad-hoc CodeSignature; published the DMG and SHA-256 as a pre-release:
  `https://github.com/helloraj1986/win11-explorer-macos/releases/tag/v0.1.0`.
- Added and ran `macos-smoke.yml`: downloaded the DMG, mounted it, launched the app on
  macOS 14, confirmed the process stayed alive, and captured a real macOS screenshot
  (`docs/screenshots/macos-smoke.png`).
- Documented unsupported features and the remaining full-interaction macOS gap.

## Phase 8 — Dual interface themes

- Verified the baseline before the change: typecheck clean, `npm test` 26/26.
- Created branch `feature/dual-theme`.
- Added a second presentation axis, `interfaceTheme` (`windows` | `finder`), independent
  of the existing light/dark `theme`.
- Added Finder design tokens in `tokens.css` (dark and light), structural overrides in
  `finder.css`, and shared picker/sidebar-footer styles in `app.css`.
- Added `lib/theme.ts` (definitions, normalization, appearance resolution, attributes,
  `THEME_METRICS`) and extended persistence with `parsePersisted`,
  `parseThemePreferences`, and `loadThemePreferences`.
- Added the store's `interfaceTheme` state/action and seeded initial theme preferences so
  the first render matches the bootstrapped document attributes.
- Added an inline pre-paint bootstrap in `index.html` and a matching call in `main.tsx`;
  removed the previous theme remount keys from `TitleBar`/`CommandBar`.
- Built the Finder layout: traffic lights (same Tauri window APIs), unified toolbar,
  source-list sidebar headings and footer, 28/24 px rows, Finder menus/selection,
  centered modal titles, and responsive toolbar behavior.
- Added the Appearance dialog with two CSS/SVG preview cards, active badge, keyboard
  focus, and an independent system/light/dark control; entry points in the sidebar
  footer, More menu, and Options dialog.
- Added 17 frontend tests for themes and persistence: **43 passed** across 7 files.
- Visually validated both themes in light and dark on the Windows dev host, including
  details/list/icon views, context and More menus, a 1080x720 resize, a rename across a
  live theme switch, and persistence across an app restart.
- Updated README, architecture, feature matrix, and added `docs/THEMES.md`.

## Phase 9 � Real application bundle icons

- Reproduced the reported problem: `.app` bundles were categorized as generic
  executables, so every application in `/Applications` showed the same page glyph.
- Added `app_icons.rs`: reads `Contents/Info.plist` (XML or binary), resolves
  `CFBundleIconFile`/`CFBundleIconName`, falls back to the resource directory, and
  extracts the best PNG chunk from ICNS (smallest at or above 256 px). Legacy ICNS uses
  macOS `sips`.
- Added the `read_app_icon` Tauri command, returning a PNG data URL, with a 128-entry
  process cache.
- Added `lib/appIcons.ts` (LRU cache, in-flight dedupe, pre-paint peek) and wired
  `FileGlyph` to show real icons in details/list/icon/tiles/content views and both
  panes, with a generic application glyph as the loading/no-icon fallback.
- Added 8 Rust tests and 6 frontend tests: **49 frontend / 18 Rust** passing.
- Validated on Windows with synthetic `.app` bundles (plist-named icon, resource
  fallback, missing icon) in both themes and at 16/96/112 px. Real macOS
  `/Applications` browsing remains to be exercised interactively.
