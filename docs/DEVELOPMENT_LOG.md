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

## Phase 9 - Real application bundle icons

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

## Phase 10 - Merge and handover refresh

- Merged `feature/dual-theme` into `main` with `--ff-only` (`49085c7`); history stays
  linear. `origin/main` previously stopped at the 0.1.0 handover commit (`4027ecf`).
- Refreshed `HANDOVER.md` to 1.1: current status, a next-session brief, theme and
  app-icon architecture, 26 commands, 49 frontend / 18 Rust tests, MSRV 1.88, new
  limitations, troubleshooting, and prioritized next steps.
- Added README and handover notes that the published `v0.1.0` DMG predates the themes
  and real app icons.
- Pushed `main` (`779c6b7`); the `macOS build` workflow succeeded (run `40648095307`,
  5m19s) with typecheck, 49 frontend tests, 18 Rust tests, the universal build, and DMG
  verification.
- Still outstanding: the macOS interactive pass for the Finder theme, real
  `/Applications` icons, TCC prompts, OS drag/drop, and Open With.

## Phase 11 - Cut/paste looked like a copy (2026-10-29)

- Reported symptom: on macOS, Cmd+X then Cmd+V appears to copy the file instead of
  moving it.
- Ruled out the transfer path with evidence rather than guesswork. The persisted
  `transferHistory` in the app's WebKit localStorage
  (`~/Library/WebKit/com.replica.win11explorer/WebsiteData/.../LocalStorage`) showed the
  owner's last four operations as `mode: move`, `status: completed`, so the filesystem
  move really happened. The stale *view* made it look like a copy.
- Root cause: `paste()` records the destination pane as the transfer's `sourcePane`
  (`requestTransfer(..., { sourcePane: id, destinationPane: id })`), so only the pane that
  received the paste was reloaded. In dual-pane mode (the owner's persisted layout) the
  pane the items were cut from kept listing the moved files, so the file appeared in both
  panes. Cut items also had no visual state, so a registered cut was invisible.
- Added `panesShowingSources(folders, sources)` to `lib/panes.ts` and used it after a
  completed move to refresh every pane showing a source folder, in addition to the
  recorded source/destination panes.
- Dimmed clipboard "cut" entries in details, list, and grid views (`FileArea` `cut` class,
  `app.css` opacity/desaturation), matching Explorer's cut feedback.
- Added 3 tests for the new helper: **83 frontend tests across 11 files**; typecheck and
  `npm run build` clean.
- Rebuilt the universal `.app`/DMG from the fixed tree
  (`src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}`). Installing it
  over `/Applications/Windows 11 Explorer.app` was stopped at the owner's request, so the
  interactive macOS pass for this fix is still pending.
- Known residual: a *background* tab that shows a moved-from folder is only reloaded when
  it is activated, because the post-transfer refresh reloads the active tab of each pane.

## Phase 12 - Premium icon system (2026-10-29)

- Added `lucide-react` as the primary functional icon library. `AppIcon.tsx` maps stable
  semantic names to named Lucide imports and applies shared size/stroke/tone tokens;
  `Icon.tsx` remains a compatibility facade for existing callers.
- Added a typed file-type registry (`lib/icons/fileIconRegistry.ts`) covering documents,
  images, video/audio, archives, disk images, development formats, applications,
  executables, fonts, certificates, databases, configuration files, dotfiles, compound
  extensions and deterministic unknown fallbacks. Resolution never opens or executes a
  file.
- Added `FileTypeIcon`, `FolderIcon`, `StorageIcon` and `SyncStatusIcon`. Folder artwork
  switches between Windows gold and Finder blue; storage connection state is separate
  from volume identity; the status indicator is wired only to real transfer state.
- Kept native `.app` icons through the existing Rust `read_app_icon` command, now behind
  `nativeIconService.ts` with the existing 256-entry webview LRU. Image thumbnails remain
  on the asset protocol with lazy loading, a 512-entry URL cache and a 1,024-entry failure
  cache; failed thumbnails fall back to registry artwork.
- Migrated the command bar, navigation, sidebar, tabs, menus, details/preview panes,
  dialogs and file views to the central components. Existing `FileGlyph`/`Icon` APIs were
  preserved as facades.
- Added 32 icon tests: **161 frontend tests across 20 files**; `npm run typecheck`,
  `npm run test:cargo` (28), `npm run build`, and `git diff --check` pass.
- Merged `feature/premium-icon-system` into `main` with `--ff-only`; history stays linear.
- Still outstanding: the macOS Tauri-window interaction pass. Native artwork for arbitrary
  files/folders and QuickLook video thumbnails would require a new Rust/AppKit bridge.

## Phase 13 - Unified three-layer command center (2026-10-30)

- Consolidated the existing branches onto `main`: committed the pending universal-search
  reveal/selection work and fast-forwarded `feature/universal-search`, then started
  `feature/unified-command-center`.
- Split the top chrome into three explicit layers. `TitleBar` now renders window controls
  and the location title only; `CommandBar` is the single global command area;
  `NavigationBar` owns history/breadcrumbs/address/search; `TabBar` (in `PaneTabs.tsx`) owns
  tabs and the all-tabs overflow menu. Single-pane mode renders one global tab row below
  navigation; dual-pane mode renders one navigation + tab row per pane.
- Moved the single/dual-pane toggle into the command bar as a split control with a
  workspace menu. The workspace menu also exposes navigation-pane visibility, copy/move to
  the other pane, synchronized navigation, and folder comparison.
- Reworked the command bar into responsive regular/compact/narrow tiers. Labels can be
  hidden in Settings; at narrow widths organization and secondary file operations move into
  the one Settings menu instead of being duplicated. All command enabled states remain
  selection/permission/clipboard/location aware.
- Replaced the separate Themes, Options, and Shortcuts dialogs with one `SettingsDialog`
  (Appearance, Display, Layout, Behavior, Keyboard, Advanced). Removed Appearance/theme
  controls from the sidebar footer; the sidebar is navigation-only again.
- Added persisted display/layout/behavior preferences: text scale, icon scale, compact row
  density, column visibility and reset, command-bar labels, sidebar visibility, folder-open
  behavior, and Trash confirmation. Added `Command+,` for Settings and `Command+B` for the
  navigation pane; both are listed in the shortcut reference.
- Added `data-density` / `data-text-size` / `data-icon-size` attributes and CSS variables;
  `themeMetrics(theme, density)` keeps the virtualized rows aligned with the compact CSS.
  Text and icon scale affect the chrome, menus, navigation, tabs, and file artwork.
- Added tests for display normalization/scales/compact metrics, persistence of the new
  preferences and legacy fallbacks, and command-bar context states/settings menu.
- Verification: `npm run typecheck` clean, `npm test` **219 passed** across 24 files,
  `npm run test:cargo` **47 passed**, `npm run build` clean. A temporary browser preview
  rendered Windows light, Windows compact, Finder dark, dual-pane, and the Settings
  Appearance/Display sections without console errors; the preview files were deleted.
  Interactive Tauri-window validation at the minimum window size remains outstanding;
  component behaviour and CSS structure are covered by the tests and the preview.
- Known limitation: compact density applies to details/list/group rows; icon-grid cell
  geometry is controlled by icon scale and the selected view, not by density. The all-tabs
  menu is a scrolling-row complement, not an exact Windows 22H2 overflow flyout.
