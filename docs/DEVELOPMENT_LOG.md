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
- Pushed the project to the private GitHub repository `helloraj1986/MAXplorer`.
- Built a universal macOS app and DMG on a macOS 14 GitHub Actions runner:
  run `40490663104`.
- Verified the DMG container, HFS contents, universal Mach-O header, Info.plist, and
  ad-hoc CodeSignature; published the DMG and SHA-256 as a pre-release:
  `https://github.com/helloraj1986/MAXplorer/releases/tag/v0.1.0`.
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
- Removed duplicate settings entry points after review: the Settings menu now has one
  Settings... item instead of separate Appearance/Display/Keyboard links and an Interface
  theme submenu. Layout no longer repeats pane/details/preview toggles that already live in
  the command bar and View menu, and About lives only in the command-bar menu.
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

## Phase 14 - MAXplorer branding documentation (2026-10-30)

- Added [BRANDING.md](BRANDING.md) as the product-identity reference: name, tagline,
  brand statement, palette, application icon, centralised branding values, metadata,
  theme-independent rules, compatibility identifiers, and validation record.
- Updated the current-product documentation from the earlier working name/replica wording
  to MAXplorer in README, ARCHITECTURE, THEMES, FEATURE_MATRIX, REFERENCE, VALIDATION,
  ICON_SYSTEM, MACOS_DMG, HANDOVER, and the screenshot index.
- Documented that the product name, icon, About screen, window identity, and menus stay
  identical in the Windows Explorer and macOS Finder themes.
- Reiterated that `com.replica.win11explorer`, the `win11-explorer-*` localStorage keys,
  `win11://home`, `WIN11_EXPLORER_START_PATH`, and the drag payload type are compatibility
  identifiers and were intentionally not renamed.
- This phase changed documentation only; the branding implementation and verification were
  completed in the earlier rebrand commit.

## Phase 15 - Visual Appearance Platform (2026-10-30)

- Added a complete visual Theme Creator for non-technical users: start options, name,
  look, colours, style, icons, preview and save, with live preview on every step.
- Added 12 ready-made templates, 10 ready-made palettes, automatic matching colour
  generation, WCAG contrast checks with one-click repair, reset per section, reset all,
  undo/redo, keyboard focus handling, and automatic draft recovery.
- Added a persisted custom theme library and icon pack registry. Built-in themes remain
  immutable; duplicating or customising one always creates a separate identity.
- Added Simple and Advanced modes. Advanced Mode exposes a curated token editor, package
  identity, validation details, and an explicit reset, while state is shared across modes.
- Added optional description-based creation through an offline, deterministic provider
  interface. Generated output is normalized through the same schema as hand-made themes;
  unsupported tokens and dangerous values are rejected.
- Added `.maxTheme` and `.maxIcons` export/share/import with validation previews before
  installation. Desktop exports are written to Downloads by the new
  `save_appearance_package` command without overwriting existing files.
- Added a token-driven live MAXplorer preview covering toolbar, sidebar, tabs, address
  bar, list, grid, context menu, selected rows, and dual-pane mode.
- Added beginner documentation with five implementation screenshots:
  [THEME_CREATOR_GUIDE.md](THEME_CREATOR_GUIDE.md). Added the developer schema and security
  model: [THEME_PACKAGE_SPEC.md](THEME_PACKAGE_SPEC.md).
- Verification: `npm run typecheck` clean, `npm test` **246 passed** across 26 files,
  `cargo test` **48 passed**, `npm run build` clean. The screenshots were captured from the
  real Theme Creator and Appearance page in a browser preview at desktop size.
- Known limitations: Export saves to Downloads rather than a native save panel; Share
  copies the package text; the optional AI path is a local style matcher in this build;
  Advanced Mode edits a curated token list rather than arbitrary component CSS.

## Phase 16 - Agent-authoring documentation and annotated theme (2026-10-30)

- Added `docs/AGENT_THEME_AUTHORING.md`, a short copyable checklist for AI agents and
  external tools that create `.maxTheme` files without MAXplorer or a build step.
- Documented that `.maxTheme`/`.maxIcons` are strict JSON: `//` comments are invalid.
  Notes belong in an ignored root `_comments` object, which imports safely and is not
  retained after installation.
- Added `scripts/validate-theme.ts` and documented the command in `themes/README.md`.
  The validator uses the application's real `parseThemePackage` and
  `validateThemeDesign` functions and reports contrast ratios.
- Added `themes/midnight-black-colour-pop.maxTheme`, an annotated midnight-black example
  with violet highlights, cyan selection, coral folders, and field notes in `_comments`.
- Updated README, HANDOVER, THEMES, the beginner guide, the package specification, and the
  feature matrix with the agent workflow and Appearance Platform capability rows.
- Verification: the example package parses and validates with no issues; text contrast is
  18.16:1 against the main panel.

## Phase 17 - Storage Space Analyzer (2026-10-30)

- Added a dedicated, full-window Storage Analyzer workspace independent of single/dual-pane
  browser state. Entry points: Sidebar → Tools, command-bar drive button, and Settings menu.
- Added real volume discovery: `/` and `/Volumes/*` on macOS, `statvfs` capacity, mount-table
  filesystem types, and `diskutil info -plist` enrichment for internal/external/removable/
  virtual/APFS-container classification. Windows uses `Win32_LogicalDisk` through PowerShell.
- Added a cancellable, progress-emitting `WalkDir` scanner in `src-tauri/src/storage.rs`:
  symlinks are never followed, nested mounts and reserved metadata folders are skipped,
  permission errors are counted, hard-linked inodes are counted once, directory aggregates are
  computed bottom-up, and entry caps are reported honestly.
- Added location-first, one-category-per-file storage categories plus separate file-type
  groups. No file is opened or executed for classification.
- Added in-memory scan queries for one folder's children and filtered/paginated file lists, so
  large trees never cross IPC wholesale. Top files/folders/categories/types and cleanup
  recommendations are returned with the scan summary.
- Added the overview dashboard: capacity bar, inspected vs uninspected space, category legend,
  largest file/folder, cleanup estimate, duplicate status, recent/stale large files, and scan
  transparency notes.
- Added the folder tree with lazy expansion, breadcrumbs, largest file per directory,
  allocated/logical sizes, share of parent, and per-folder rescan.
- Added largest-file and largest-folder views with thresholds/filters/sorting, file-type
  analysis, and recent/old large-file scopes.
- Added a squarified canvas treemap with hover details, drill-down, breadcrumbs, keyboard
  region navigation, and an equivalent accessible list.
- Added staged duplicate detection: size grouping, first/last-64 KiB fingerprints, streaming
  SHA-256, changed-file detection, same-volume reporting, and a guard that keeps at least one
  verified copy.
- Added risk-labelled cleanup recommendations for Trash, caches, logs, Xcode/package/build
  storage, Android/Docker/backups, application support, Mail, downloads, installers, archives,
  databases, VM disks, and old large files. Recommendations explain their reasoning and note
  when an owning tool should be used instead.
- Added overlap-aware cleanup selection and a review dialog with exact paths, deduplicated
  estimate, risk warnings, Trash vs permanent deletion, and mandatory acknowledgement for
  permanent deletion.
- Added backend deletion revalidation: scan membership, existence, type/size/modification
  match, canonical containment, protected system prefixes, and volume/home guards. Cleanup
  reports completed/failed/changed/overlap results and measured free-space deltas, then
  automatically rescans the same root.
- Added `docs/STORAGE_ANALYZER.md` with capabilities, architecture, calculation methodology,
  categorization, safety, privacy, performance, limitations, and testing procedures.
- Verification: `npm run typecheck` clean, `npm test` **265 passed** across 30 files,
  `cargo test` **61 passed**, `npm run build` clean. All destructive Rust tests use
  `tempfile` directories only.
- Known limitations: the full analyzer index is in-memory for the current process; APFS
  snapshots/System Data/purgeable space cannot be attributed to individual files; tool-native
  cleanup commands are recommended but not executed; cloud placeholders are never downloaded;
  duplicate detection is I/O-heavy and optional; network-volume latency follows the mount.

## Phase 18 - Local crash diagnostics (2026-10-30)

- Added `src-tauri/src/logging.rs`: rotating local log under the Tauri app-data directory,
  timestamped levels, startup metadata, panic hook with forced backtrace, and `catch` wrapper
  that converts a panic in volume/scan/duplicate/cleanup tasks into a normal command error.
- Added storage lifecycle logging for volume discovery, scan start/result/cancel, duplicate
  detection start/result, cleanup start/result/cancel, and in-memory index clearing.
- Added frontend diagnostics: global `error`, `unhandledrejection`, Storage Analyzer API
  failures, and a React `AppErrorBoundary` that keeps the window open and exposes the log path.
- Added **Settings → Reveal diagnostic log** and `npm run logs` / `npm run logs -- --tail N`.
- Added [DIAGNOSTICS.md](DIAGNOSTICS.md) with log locations, contents, rotation, panic
  containment, privacy notes, and crash-reporting steps.
- The new log immediately identified an existing crash: `extract_pdf` truncated a UTF-8
  string at a non-character boundary (`src/search/extract.rs`) inside the background content
  indexer. The truncation now backs up to a valid character boundary, the indexer records any
  future extraction panic as a per-file error and continues, and the release profile uses
  `panic = "unwind"` so the panic hook/guards can keep the window alive.
- Clarified truncated scans: uninspected bytes are now labelled **Not scanned /
  system-managed** with an explicit "scan stopped at entry limit" explanation, a direct
  "Deep scan Home folder" action, and a Deep scan ceiling of 5,000,000 entries.
- Verification: `npm run typecheck` clean, `npm test` **266 passed** across 30 files,
  `cargo test` **63 passed**, `npm run build` clean, `cargo check --release` clean. A real
  `tauri:dev` launch created the log and captured the PDF panic; after the fix, subsequent
  launches logged clean setup/frontend diagnostics with no new panic.
- Known limitation: logs from a fatal crash before Tauri setup cannot be captured by the file
  logger; normal startup, command, panic, and React failures are covered.

## Phase 19 - Scan scope and video classification (2026-10-31)

- Investigated a report that a 208 GB `My Library` folder with ~1,200 video files showed only
  two videos. The log showed a whole-volume scan stopping at its 2,000,000-entry cap long
  before reaching that nested folder, so the videos were never inspected.
- Added **Scan folder...** to the analyzer header: an absolute-path prompt that scans one
  folder directly, avoiding the whole-volume cap. The existing **Rescan this folder** action
  remains for folders already in the tree.
- Raised the Deep scan ceiling to 5,000,000 entries; truncated scans are labelled **Not
  scanned / system-managed**, with explicit warnings that the remainder is not a cleanup
  estimate and direct actions for Deep scan Home folder or Deep scan volume.
- Expanded video classification to MP4, MOV, M4V, AVI, MKV, WMV, WebM, FLV, MPEG/MPG,
  3G2/3GP, ASF, DivX, DV, F4V, M2TS/MTS, MXF, OGV, RM/RMVB, TS, VOB, VRO, and MOD. Backend
  category and file-type grouping and the shared frontend video-extension set now agree.
- Verification: `npm run typecheck` clean, `npm test` **266 passed** across 30 files,
  `cargo test` **63 passed**, `npm run build` clean.
- Known limitation: a single folder can still exceed the 5,000,000-entry hard cap. Whole-volume
  coverage depends on file count, not byte count; scan the specific data folder for complete
  results.

## Phase 20 - Persistent storage-scan cache (2026-10-31)

- Added `src-tauri/src/storage_cache.rs`, a versioned SQLite cache at
  `<app-data>/storage/cache.sqlite3`. It stores the full scan summary plus one row per file and
  directory, with indexes for parent, size, category, and file type.
- Completed scans are cached in a background thread after the scan result is returned. A
  rolling eight-scan history is retained, same-root scans are replaced, and a stale write
  cannot overwrite a newer result.
- On launch or volume switch, the backend restores the latest cached scan belonging to that
  volume. `get_storage_children` and `query_storage_files` transparently fall back to cached
  SQLite rows when no live in-memory index is loaded, so folder drill-down, category filters,
  and file-type lists work after restart/reinstall.
- Cached results are explicitly read-only for cleanup. The selection bar replaces the review
  action with **Rescan to enable cleanup**, and the backend guard also rejects cached cleanup
  attempts. **Clear analysis results** clears both memory and cache.
- App-data survives replacing the `.app` bundle, so a normal reinstall/update keeps the last
  scan. Deleting app-data removes the cache.
- Verification: `npm run typecheck` clean, `npm test` **268 passed** across 30 files,
  `cargo test` **64 passed**, `npm run build` clean.
- Known limitation: a very large full-volume cache can take a few seconds to write in the
  background; app-data cleanup removes it. Cached data must be rescanned before destructive
  actions.

## Phase 21 - Theme-aware dual-pane divider (2026-10-31)

- Root cause: the old `.pane-splitter` used `background: var(--surface)`, exactly the same
  surface as both panes, and drew only a 1 px, 34 px-tall grip. The 6 px bar therefore read
  as empty space rather than a separator, and its visible pointer target was far too small.
- Added `src/components/PaneDivider.tsx`: a reusable separator with a slim theme-token line
  (2 px default, 1–8 px allowed) inside a 14 px pointer target (12–28 px allowed), hover,
  focus, and dragging states, an optional three-dot grip, and a token-driven focus ring.
- Added `src/lib/divider.ts` for pure ratio geometry, preferred/absolute pane minimums, and
  keyboard steps. `DualPaneWorkspace` now clamps the rendered ratio without overwriting the
  saved `splitRatio`, so transient window resizes no longer permanently move the divider.
- Added semantic tokens for the divider, grip, active-pane indicator, pane header, and pane
  focus ring. Built-in Windows/Finder light and dark themes define all values; custom themes
  derive contrast-checked fallbacks through the existing colour utilities.
- Extended the theme schema with optional `components.paneDivider`: width, hit area, normal,
  hover, dragging and grip colours, grip visibility, active-indicator style, corner radius,
  and optional pane-header colours. Missing configuration inherits safe defaults; invalid
  values are clamped and returned as import warnings. Existing `.maxTheme` files still load.
- Added active-pane indication through an inset accent border by default, with `top-line`,
  `header`, and `none` variants. All indicators use box-shadow/background changes, so focus
  changes never alter pane dimensions.
- Accessibility: `role="separator"`, accessible name, min/max/current value text, focus
  visibility, arrow keys, Home/End, Enter/Space reset, Shift for a larger step, and full
  pointer-cancel/blur/unmount cleanup. Resizing does not trigger file selection or drag.
- Verification: `npm run typecheck` clean, `npm test` **302 passed** across 33 files,
  `npm run build` clean. New suites: `lib/divider.test.ts`,
  `components/PaneDivider.test.tsx`, `lib/appearance/divider-theme.test.ts`.
- Known limitation: the divider is a layout control only; cross-pane file drag-and-drop is
  untouched and still targets the pane rows. Theme-defined dimensions are clamped to safe
  ranges and cannot disable the minimum pointer target.


## Phase 21 - Search engine audit, repair and cost control (2026-11-06)

- Symptom: typing `resume` in Universal Search showed a spinner that never resolved.
- Audit (`docs/SEARCH_AUDIT.md`) traced it to index hygiene, not to the loading state.
  The live index held **6,350,597 rows in 20.1 GB**, of which **6,003,687 rows (94.5 %)**
  came from a single tool cache tree (`~/.local/share/opencode`); `~/.lmstudio`,
  `~/.vscode`, `~/.gradle`, `~/.nvm`, `~/.nuget` and `~/.hermes/cache` made up most of the
  rest.
- Measured on that database: `SELECT COUNT(*) FROM files WHERE is_dir = 0` took **47.3 s**,
  and the `name_lower LIKE '%resume%' OR path_lower LIKE '%resume%'` candidate query took
  **49.9 s**. `SearchService::execute_search` ran five such aggregates through `status()`
  on **every** query, then the full scan, with the cancel flag only checked between
  providers. Every keystroke therefore queued minutes of work behind the previous one, and
  the store cleared `loading` only on a response that never arrived.
- `search/live.rs` now owns a single exclusion policy (all dot-directories, package and
  build output, OS metadata, bundle packages) used by the indexer walker, the live
  fallback, the FSEvents filter and the prune path. `path_is_excluded` is evaluated
  relative to the indexed root, so an explicitly added location is never excluded and a
  file such as `.env` is not treated as a directory.
- Schema v2 adds `files_name_fts` (FTS5 `trigram` over name and path) and
  `location_counts`. Substring queries of three or more characters now use the trigram
  index; shorter and case-sensitive queries keep the `LIKE`/`instr` path.
- Counters (`counts.*`, `location_counts`) are materialised by the indexer;
  `status()` reads six primary-key rows instead of scanning the table.
- Query cost control: one in-flight query per service (a new query cancels every older
  one), a SQLite progress handler for statement-level cancellation, a 5 s query budget,
  a 12 000-row candidate cap, and a per-root `mdfind` call with `-onlyin` and a 1.5 s
  deadline that kills the child on timeout.
- Indexer: 400 000-entry cap per pass, counter and name-index refresh on a 5-minute tick.
- New maintenance commands `prune_search_index`, `optimize_search_index` and
  `rebuild_search_name_index`, surfaced in the indexing dashboard as **Clean excluded
  folders** and **Compact database**. Prune drops the FTS triggers and secondary indexes
  for the duration of the deletion and rebuilds them from the survivors; optimize rebuilds
  both FTS tables and then vacuums.
- Frontend: `runSearchNow` arms a 12 s watchdog that clears the spinner, keeps partial
  results and explains the delay. The live filesystem fallback now runs only when the
  scope is not the index or the index is empty, instead of on every query because a
  location was permanently `partial`.
- Verification on the real 20 GB index (`examples/search_maintenance`):
  `status()` **47.3 s → 4.8 ms**; search for `resume` **35.6 s → 380 ms** warm
  (1733 matches, name + content); mid-word `esum` **26 ms** (185 matches); prune removed
  6.19 M rows in ~4 min total and left 156,732 rows (140,197 files, 50,137 with text);
  trigram rebuild 6.8 s; counters 0.32 s; reopen 1.2 ms.
- Tests: `cargo test` **77 passed** (new: trigram substring and mid-word matching,
  path-only matches through the join, exclusion-aware prune, materialised counters,
  location coverage without table scans); `npm test` **336 passed / 9 failed**, where all
  nine failures are the pre-existing `storageStore.test.ts` and `ThemeCreator.test.tsx`
  suites that read `window.localStorage` under the `node` test environment; neither file
  is touched by this work. `npm run typecheck` clean.

## Phase 22 - Memory-budgeted storage scans (2026-11-07)

- Removed the 5,000,000-entry hard cap that stopped the Storage Space Analyzer mid-volume.
  Deep scan now sends `maxEntries = 0`, which the backend reads as "auto":
  `resolve_scan_budget` sizes the walk to 55% of the memory the machine can actually reclaim
  (macOS `host_statistics64` free + speculative + inactive + purgeable; Linux `MemAvailable`;
  4 GiB fixed elsewhere), floored at 192 MiB so small machines still get a usable scan. The
  absolute count ceiling is now 50,000,000 and is only a walker safety valve.
- The walk measures the live index footprint entry by entry (record size + every heap string +
  allocator/slot/inode overhead) and stops before the byte budget is exceeded, instead of
  trusting a bytes-per-entry guess that a real volume can violate.
- `StorageScanResult.truncationReason` ("entry limit of N entries" / "memory budget of X of
  index space") now tells the UI which guard stopped a truncated scan; the overview warning,
  hero note and usage legend use it, and cancelled scans no longer claim to have hit a limit.
- Verification on this Mac (32 GB, `/System/Volumes/Data` at 855 GB / 11 M inodes): reclaimable
  14,011 MiB -> 7,706 MiB index budget, i.e. roughly 14 M entries at the measured ~550 B each,
  against the previous 5 M ceiling. A 35 s real scan of the home folder processed millions of
  entries with RSS tracking the accounting within a few percent and no truncation.
- Tests: `cargo test` **81 passed** (new: auto budget beats the old ceiling, absolute ceiling
  clamp, macOS VM counters readable, a scan stops on a 12 KB byte budget and reports the
  memory reason); storage component suite **19 passed** including the new memory-budget copy
  test. `npm run typecheck` clean. `npm test` **341 passed / 9 failed**, the same nine
  pre-existing `storageStore.test.ts` and `ThemeCreator.test.tsx` failures caused by
  `window.localStorage` being absent under the `node` test environment.
- Known limitation: the index is still held in memory for the session, so a whole-volume scan
  of an 11 M-entry disk costs several GB of RSS while the analyzer is open. The cache schema
  already stores exactly these rows in SQLite; serving drill-down from the cache instead of a
  RAM index is the next architectural step if multi-TB volumes matter.

## Phase 23 - Storage analyzer scale pass (2026-11-07)

Four linked pieces of work on `perf/storage-analyzer-scale`, each verified on its own.

1. **Query hot path.** Every file paid for a lowercase copy of its whole path twice (category
   and file type), two formatted Strings per path-containment test, a lowercase filename for
   the iCloud probe, and every query rebuilt the directory prefix per row. Containment,
   component and case-insensitive matching are now allocation-free byte comparisons, and a
   paged query only orders the window it returns (partial selection) with a path tiebreak for
   determinism. Filters prepare their needles once per query.
2. **Parallel walk.** Directories go to a work-stealing pool of 2-8 threads; workers only read,
   classify and count, and hard links, per-directory totals and category buckets are resolved
   in one pass after the walk so no thread needs a global inode set. Progress is emitted every
   300ms from the coordinating thread instead of every 1,500 entries (~7,300 IPC events for a
   whole-volume scan). Measured on the home folder, release build: **3.85M entries in 50s =
   76,652 entries/s**, versus 7,300 entries/s single-threaded, a **10.5x** improvement
   (an 11M-entry volume goes from ~25 minutes to ~2.5).
3. **Navigation.** Eight analyzer views became five (Overview, Browse, Files, Treemap, Clean
   up); largest folders, file types and duplicates stay routable from the Overview cards and
   the Clean up tabs. Scan volume / Deep scan / Scan folder... collapsed into one Scan menu;
   the duplicated coverage warning in the hero is gone; the pre-scan marketing card became a
   single action card; four per-row icon buttons became one actions menu.
4. **SQLite-backed index.** After a scan is persisted, the in-memory file vector is released
   and `get_storage_children` / `query_storage_files` read the indexed `files` table (parent,
   size, file_type, category). Directory aggregates and the scan summary stay in RAM (about 2%
   of entries). Delete verification uses `has_path` against the same rows, so the safety net
   is unchanged. Cached-scan restore already used this path.
   - Query plans were the real risk here: `EXPLAIN QUERY PLAN` showed folder listings using
     `directories_size` (a 435 ms scan and sort of every directory) and the recursive filter
     using `substr(path, ...)`, which fell back to an unrelated index (1.85 s). Composite
     `(scan_id, parent, size)` indexes and a range predicate on `path` fixed both, and the
     cache schema went to v2 with the indexes dropped for the bulk load and rebuilt once at
     the end (1.2M files + 271k dirs in 13.6 s instead of maintaining five indexes per row).
   - Measured on a 1.2M-file persisted scan: folder drill-down **0.5 ms** (in-memory path
     15 ms) and a folder page **0.3 ms** (in-memory 11.7 ms). A recursive "directory contains"
     query over the whole scan is now 0.9 s because it counts and sums every match; the
     default views do not issue it.

Verification: `cargo test` **89 passed** (new: parallel walk visits every directory in a wide
tree, hard-link totals across workers, SQL parity for children and paged queries, delete
through a persisted index, and the state releasing its file records after persisting); storage component suite **19 passed**; `npm run typecheck` clean;
`npm test` **341 passed / 9 failed**, the same pre-existing `storageStore.test.ts` and
`ThemeCreator.test.tsx` failures caused by `window.localStorage` under the node test
environment. The temporary probes used for the two performance numbers were removed.

## Phase 24 - Search index rescan loop, write amplification and index size (2026-11-07)

Four defects shared one loop: every completed scan was followed by another one within a
second, each scan rewrote every row, and the resulting lock contention made writes fail.

1. **Rescan storm.** `drain_events` treated a watcher backlog over 4 000 paths by
   back-dating `last_reconcile` by six hours, which scheduled a full scan immediately. A
   scan takes minutes; the FSEvents backlog that accumulated while it ran was then read as
   "the index is stale", so scan -> backlog -> scan repeated forever (8 scans in 2 hours,
   6-19 min each). An overflow now sets a `reconcile_requested` flag, reconciles are
   throttled to one per 20 minutes (`RECONCILE_MIN_GAP`), and the backlog collected during
   a scan is discarded once that scan finishes. A backlog arriving while the indexer is
   idle is dropped without scheduling anything.
2. **Write amplification.** `write_batch` upserted every walked entry, so a rescan rewrote
   128 k rows and fired the `AFTER UPDATE OF name, content` trigger for each one - the
   entire content index was deleted and re-inserted per scan. `scan_entries` now loads
   `known_entries(root)` once (size, modified, content state) and writes only rows that
   changed; files whose extraction failed (`content_state = 'error'`) are exempt so they
   re-enter the pending queue. `finish_scan` deletes exactly the paths present in the
   snapshot and absent from the walk.
3. **Transient lock failures.** `retry_busy` wraps batch writes with two backoff attempts
   for `locked`/`busy` errors, and connections set `journal_size_limit` so bulk
   maintenance cannot leave a WAL as large as the database.
4. **Index size.** Schema 3 makes `files_fts` an external-content table over `files`
   (`content='files'`, `content_rowid='id'`), removing the second copy of every extracted
   document (1.9 GB). The migration drops the old table and defers the rebuild to the
   indexer thread; content search falls back to a live scan until it completes. A
   `vacuum_requested` flag is consumed by the idle maintenance pass, which VACUUMs and
   truncates the WAL. `optimize()` and `prune()` rebuild through the same schema.

The storage-scan cache had the same shape of bug: it holds one file list per volume and
deletes the previous one on every refresh, so its 128 MB working set sat behind 3.6 GB of
freelist. `StorageCache::store` now VACUUMs when more than half the file is free pages;
the existing cache was compacted by hand (3.8 GB -> 309 MB).

Verification on the live 128 579-row index: first launch migrated in 31 s, rebuilt the
content index for 64 926 documents in 141 s, and compacted 7 457 MB -> 5 432 MB (2.7 GB
after the WAL was truncated, from 7.3 GB). A forced full rescan of the home directory
completed in **165 s with 1 421 rows written, 171 removed and no write failures**, against
6.3-18.9 min and 9-57 failures before, and no follow-up scan was scheduled. `cargo test
--lib` **95 passed** (new: unchanged rescan writes nothing, changed file written once,
failed extraction retried, backlog overflow requests a reconcile, idle backlog discarded,
schema-2 index migrated to external content); `cargo check --release` clean.
