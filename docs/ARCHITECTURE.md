# Architecture

## Product identity

The product is **MAXplorer**, an advanced desktop file manager. User-facing branding
(product name, tagline, brand statement, product description, and the application icon URL)
is centralised in `src/lib/branding.ts`; the application version is read from
`package.json`. The application icon, bundle metadata, About screen, menus, and the
theme-independent branding rules are documented in [BRANDING.md](BRANDING.md).

## Decision

**Tauri 2 + Rust backend + React/TypeScript frontend** was chosen over Electron or a
SwiftUI recreation.

- **Rust** is the required hot path for directory enumeration, recursive search, metadata,
  and file operations. The user asked for a Rust-based program and performance matters for
  large directories.
- **Tauri** gives a small native shell, native window management, and a WebView that can
  render the precise Windows 11 layout and typography. It avoids shipping a whole browser.
- **React + TypeScript** makes the complex interaction state (tabs, history, selection,
  search, dialogs, menus, virtualized views) explicit and testable.
- **Zustand** is a small dependency that keeps the store usable outside React and avoids
  prop-drilling through dozens of controls.

The same codebase is cross-platform. macOS-specific branches are in the Rust backend
(home folders, `/Volumes`, `/Applications`, `open`, `open -R`, `open -a Terminal`, TCC
usage descriptions). The Windows build is used for interactive validation on the available
host.

## Module map

```
src/
  App.tsx                     Shell composition, three-layer chrome, OS drag-drop, dialogs
  components/
    TitleBar.tsx              Window chrome only: traffic lights/caption controls, title
    CommandBar.tsx            Unified Layer 1: file ops, organization, workspace, settings
    NavigationBar.tsx         Layer 2: history, breadcrumbs, editable address, search
    PaneTabs.tsx              Layer 3: tab rows, overflow menu, per-pane tab controls
    Sidebar.tsx               Navigation-only: Home, pins, This Mac, volumes, resize
    DualPaneWorkspace.tsx     Split, splitter, collapse rails, per-pane nav/tab layers
    FileArea.tsx              View selection, search state, empty/error/loading, marquee
    HomeView.tsx              Quick access + Recent on virtual Home location
    DetailsPane.tsx           Selection/folder metadata pane
    PreviewPane.tsx           Image/text preview + metadata
    StatusBar.tsx             Item count, selection size, view buttons
    ContextMenu.tsx           File and blank context menus + nested menus
    Menu.tsx                  Shared menu primitive with submenus/checkmarks/shortcuts
    Dialogs.tsx               Confirm/prompt/conflict/properties/open-with + one Settings dialog
    AppErrorBoundary.tsx      React crash fallback with local log path action
    storage/
      StorageWorkspace.tsx    Analyzer shell, volume selector, scan controls, view routing
      StorageOverview.tsx     Capacity bar, category legend, statistics, recommendations
      StorageTreeView.tsx     Lazy expandable folder tree and breadcrumb drill-down
      StorageFilesView.tsx    Filtered/paginated file lists and category/type scopes
      StorageFoldersView.tsx  Ranked descendant folder totals
      StorageFileTypesView.tsx Content-oriented type groups
      StorageTreemap.tsx      Canvas squarified treemap + accessible region list
      StorageDuplicates.tsx   Verified duplicate groups and copy-preservation guards
      StorageCleanup.tsx      Risk-labelled recommendations and cleanup report
      StorageDetails.tsx      Selected file/folder metadata and actions
      StorageSelectionBar.tsx Overlap-aware selection and destructive review dialog
    FileGlyph.tsx             Compatibility facade over FileTypeIcon
    Icon.tsx                  Compatibility facade over the Lucide AppIcon
    icons/
      AppIcon.tsx             Semantic Lucide mapping, sizing and stroke tokens
      FileTypeIcon.tsx        Registry artwork, thumbnails, native app icons
      FolderIcon.tsx          Theme-aware folder artwork and variants
      StorageIcon.tsx         Volumes, network storage and connection state
      SyncStatusIcon.tsx      Real transfer-state indicator
  hooks/
    useVirtualRows.ts         Fixed-height virtual rows with prefix offsets
    useElementSize.ts         ResizeObserver width/height
    useFileNavigation.ts      Click/modifier selection + arrows/page/type-ahead
    useMarqueeSelection.ts    Drag rectangle selection over visible rows
    useKeyboardShortcuts.ts   Global Windows-style shortcut map
    useTheme.ts               Applies data-ui-theme + resolved data-theme, row metrics
    useWindowPersistence.ts   Logical size/position persistence
  lib/
    api.ts                    Typed Tauri invoke wrappers, error normalization
    branding.ts               Product name, tagline, description, icon URL, version
    appIcons.ts               Low-level .app icon loading and LRU cache
    icons/
      fileIconRegistry.ts     Typed extension/MIME/name-to-visual registry
      nativeIconService.ts    Cached native .app artwork facade
      thumbnailService.ts     Bounded thumbnail URL/failure cache
    storage/
      types.ts                Analyzer contracts, category metadata, entry adapters
      selection.ts            Overlap-aware cleanup accounting and duplicate safeguards
      treemap.ts              Deterministic squarified layout and hit testing
    types.ts                  Shared serialized contracts and UI models
    diagnostics.ts            Frontend error/rejection logging bridge
    theme.ts                  Interface theme definitions, normalization, metrics, apply
    format.ts                 Windows-style sizes, dates, type names, paths
    sort.ts                   Sorting and group buckets
    history.ts                Per-tab back/forward history
    tabs.ts                   Tab creation/closing/cycling/duplication
    selection.ts              Range/toggle/prune selection
    persistence.ts            Versioned localStorage persistence + validation + theme bootstrap
  state/explorerStore.ts      Application store and all user actions
  state/storageStore.ts       Volume/scan/query/selection/duplicate/cleanup state
  styles/
    tokens.css                Windows and Finder design tokens (light + dark)
    app.css                   Shared component styling and the theme selector
    finder.css                Structural Finder overrides scoped to data-ui-theme="finder"
    storage.css               Storage Analyzer layout, tables, treemap, review dialog
src-tauri/src/
  lib.rs                      Tauri builder + command registration
  logging.rs                  Rotating local log, panic hook/backtrace, safe catch
  commands.rs                 Async command boundary, platform launchers
  listing.rs                  Directory entries and metadata
  operations.rs               Create/copy/move/rename/delete/duplicate/conflicts
  search.rs                   Bounded recursive search + cancellation
  storage.rs                  Volumes, cancellable scan index, categories, duplicates, cleanup
  storage_cache.rs            Versioned SQLite scan cache and cached children/file queries
  metadata.rs                 Properties, folder stats, previews, sidebar, apps
  app_icons.rs                .app bundle icon lookup + ICNS/PNG extraction
  paths.rs                    Expansion, name validation, unique names, safety
  error.rs                    AppError code/message contract
  types.rs                    Serde contracts shared with TypeScript
```

## Top chrome architecture

The window chrome is split into three horizontal layers with non-overlapping
responsibilities:

1. **Title bar** (`TitleBar.tsx`) owns window controls and the current-location title only.
   It no longer contains tabs or the dual-pane toggle.
2. **Command bar** (`CommandBar.tsx`) is the single global command area: New, Cut, Copy,
   Paste, Rename, Share, Delete, Sort, View, column configuration, navigation-pane
   visibility, the single/dual-pane split control, and one Settings menu. It measures its
   own width and uses regular/compact/narrow tiers; at narrow widths organization and
   secondary operations move into the Settings menu instead of duplicating controls.
3. **Navigation row** (`NavigationBar.tsx`) owns Back/Forward/Up/Refresh, breadcrumbs, the
   editable address, and contextual search. Search behavior is unchanged.
4. **Tab row** (`TabBar` in `PaneTabs.tsx`) owns tab switching, new-tab, and the all-tabs
   overflow menu. Single-pane mode renders one global row below navigation. Dual-pane mode
   renders one row per pane, below that pane's navigation row, with an active-pane badge.

The division of state follows the division of UI. Tab state remains in `TabState`; global
commands read the active pane and its active tab. The command bar never owns navigation or
tab state, and the tab rows never own file operations. In dual-pane mode `activePane` is the
only command target, while each pane retains independent tabs, history, selection, sorting,
grouping, view mode, and collapse state.

## Settings architecture

`Dialogs.tsx` exposes a single `SettingsDialog` with six sections: Appearance, Display,
Layout, Behavior, Keyboard, and Advanced. There is one dialog state (`kind: "settings"` with
an optional initial section). The command bar's Settings menu contains one **Settings...**
entry (plus non-settings commands), so there are no duplicate links to individual sections.
Separate Themes, Options, and Shortcuts dialogs no longer exist.

- Appearance: interface theme cards and the independent system/light/dark control.
- Display: text scale, icon scale, row density/spacing, and the active pane's default view.
- Layout: navigation-pane visibility, command-bar text labels, and reset actions. Pane
  mode, synchronized navigation, and details/preview visibility stay in the command bar and
  View menu so they are available while browsing; they are not duplicated here.
- Behavior: folder-open behavior (same tab or new tab) and Trash confirmation.
- Keyboard: editable accelerators plus the complete shortcut reference.
- Advanced: search-indexing diagnostics, recent-item clearing, and preference reset.
  About remains a single command-bar menu entry.

Display preferences are applied through `data-density`, `data-text-size`, and
`data-icon-size` on `<html>` plus CSS variables. `themeMetrics(theme, density)` supplies the
same compact row heights to the virtualized file views that the CSS uses. Preferences are
persisted in the existing versioned snapshot, so a restart restores the same layout.

## Data flow

1. UI action (click, shortcut, menu) calls a store action.
2. Store action updates tab/UI state and calls a typed function in `lib/api.ts`.
3. Tauri invokes a Rust command with camelCase arguments; commands normalize paths and
   run blocking filesystem work on `spawn_blocking`.
4. Rust returns serialized camelCase structs or an `AppError` object.
5. Store merges only responses that still match the tab's location/request generation.
6. File mutations refresh the affected listing and show a result toast. A completed move
   also reloads every pane that shows one of the source folders, because a paste records
   the destination pane as the transfer source.
7. Persistence subscribes to the store and debounces a validated snapshot.

Search is cancellable by request ID. A stale result cannot overwrite a newer query or a
different tab location.

## Application bundle icons

A macOS `.app` is a directory, so the listing marks it as a folder. `FileTypeIcon` detects
the `.app` suffix and asks `read_app_icon` for a real icon:

1. `app_icons.rs` reads `Contents/Info.plist` (XML or binary, via the `plist` crate) and
   looks for `CFBundleIconFile`/`CFBundleIconName` under `Contents/Resources`.
2. If the plist is missing or the named file is absent, it scans the resource directory for
   `.icns` files, preferring the bundle name, then `AppIcon`, then the largest file.
3. The ICNS container is scanned for PNG chunks (`ic07`–`ic10`, `icp4`–`icp6`). The
   smallest chunk at or above 256 px is chosen, so the IPC payload stays small while the
   preview pane remains sharp. Legacy ICNS files fall back to the macOS `sips` tool.
4. The PNG is returned as a `data:image/png;base64,...` URL. Rust caches the result per
   process (128 entries); `lib/appIcons.ts` caches in the webview (256 entries, LRU) so
   virtualized rows do not re-request icons while scrolling.

If no icon can be read, the row keeps the built-in application glyph. Both interface
themes use the same real icons; only the surrounding chrome changes.

## Icon system

`docs/ICON_SYSTEM.md` is the detailed reference. The important boundaries are:

- `components/icons/AppIcon.tsx` is the only chrome-icon entry point. It maps semantic
  names to named `lucide-react` imports and applies shared size/stroke tokens.
- `lib/icons/fileIconRegistry.ts` is a pure, typed resolver. It classifies by directory
  flag, well-known dotfile/project names, compound extension, extension, MIME hint, then
  deterministic fallback. It never opens or executes a file.
- `components/icons/FileTypeIcon.tsx` renders registry artwork, uses native `.app` icons
  when available, and uses the asset protocol for image thumbnails. Thumbnail failures
  are cached and fall back to category artwork.
- `FolderIcon`, `StorageIcon` and `SyncStatusIcon` keep theme-specific artwork and state
  separate from behavior. The Windows folder is gold; the Finder folder is blue. Volume
  connection state is a separate status dot. Sync state is only rendered from real
  transfer state.
- Thumbnail and native-icon caches are bounded; virtualized rows only render visible
  artwork. Directory enumeration never waits for icon or thumbnail work.

## Filesystem correctness and safety

- **No fake data in production.** Every entry comes from `read_dir`; every preview comes
  from the selected file; thumbnails use the real file via Tauri's asset protocol.
- **Metadata**: `symlink_metadata` first; symlinks resolve target type/size but keep their
  link identity. Broken links remain visible and are not followed into loops.
- **Hidden files**: macOS dot names plus `UF_HIDDEN`; Windows hidden attribute.
- **Name validation**: rejects empty, `.`, `..`, separators, control characters, and
  Windows-invalid characters. Names are trimmed and length-bounded.
- **Conflicts**: backend never silently overwrites by default. The UI detects conflicting
  names and asks Replace / Keep both / Skip / Cancel. Copy/move accept an explicit policy.
- **Folder-into-itself** is rejected by canonical path comparison.
- **Destructive safety**: deleting `/`, the home directory itself, `/System`, `/Library`,
  `/usr`, `/bin`, `/sbin`, `/etc`, `/private`, `/dev`, or `/Applications` is refused.
  Trash deletion confirms by default (configurable in Settings → Behavior); permanent
  delete always has its own stronger confirmation.
- **Trash**: uses the `trash` crate, so macOS deletion goes through the system Trash.
- **Permission errors**: I/O kinds map to `permission_denied`, `not_found`,
  `already_exists`, `invalid_request`, or `io_error`; the UI has a dedicated permission
  state with an Open System Settings action.
- **Protection of user data during tests**: Rust tests use `tempfile` directories only.
  UI validation used a disposable fixture under `reference/fixture`.

## Storage Analyzer

[STORAGE_ANALYZER.md](STORAGE_ANALYZER.md) is the detailed reference. The architectural
boundaries are:

- `src-tauri/src/storage.rs` is the only new filesystem authority for this feature. It
  discovers volumes through `statvfs`, the mount table, and (on macOS) `diskutil info -plist`;
  walks with `walkdir` without following symlinks; aggregates directories bottom-up; and
  keeps the current file/directory index in memory under a scan ID. Contract types are
  serialized camelCase to `src/lib/storage/types.ts`.
- Volume capacity is never inferred from file totals. `statvfs` total/free/available are
  stored separately from inspected logical and allocated bytes, and the UI exposes the
  uninspected remainder as system/snapshot/purgeable/protected space.
- Categorization is location-first and assigns exactly one category per file. File-type
  groups are a separate content-oriented axis. No file is opened for classification.
- The scan is cancellable and emits `storage-scan-progress`. It budgets entries by available
  memory (Quick scan 500,000 entries; Deep scan auto-sizes to 55% of reclaimable RAM, absolute
  ceiling 50,000,000), skips nested mounts and reserved metadata directories, detects
  permission errors without aborting, and deduplicates hard-linked inodes.
- Large lists never cross IPC wholesale. The frontend requests `get_storage_children` for one
  folder or `query_storage_files` for one filtered page. The result payload contains only
  aggregates, top files/folders, and recommendations. Once a scan is persisted, both commands
  read the indexed `files`/`directories` rows instead of scanning an in-memory vector; the
  in-memory file list is released after the write so steady-state memory stays near the
  directory map, and delete verification uses the same rows.
- Duplicate verification is staged: file size → first/last 64 KiB fingerprint → SHA-256 in
  128 KiB chunks. Files changing during hashing are excluded. At least one copy of every
  group must remain selected.
- Destructive operations go through `delete_storage_paths`, not generic UI deletion. The
  backend checks the scan ID, membership in the verified index, existence, type, size,
  modification time, canonical containment inside the scanned root, protected system
  prefixes, volume roots, and the home folder before calling `operations::delete_paths`.
  Trash is the default; permanent deletion requires a second UI acknowledgement.
- The workspace is independent of pane/tab state. `src/App.tsx` swaps the normal workspace
  for `StorageWorkspace` while `storageWorkspaceOpen` is true, leaving pane state untouched.
  Sidebar and command-bar entry points call the same store action.
- The live index is in memory for the current process. Completed scans are also persisted to
  a versioned SQLite cache under app-data (`storage/cache.sqlite3`) with a rolling eight-scan
  history. On launch or volume switch, the backend restores the latest cached scan for that
  volume; folder children and paginated file queries fall back to SQLite when no live index is
  loaded. Cached results are read-only for cleanup until a fresh rescan. Opening the analyzer
  still shows capacity immediately and never forces a scan.

## Diagnostics

[DIAGNOSTICS.md](DIAGNOSTICS.md) is the operational reference. Rust initializes a rotating
local log under the Tauri app-data directory during setup, installs a panic hook that records
thread/message/location/backtrace, and writes startup, search-index, volume, scan, duplicate,
and cleanup events. Storage filesystem tasks use `logging::catch` so a panic becomes a normal
command error and the window remains available. The React tree is wrapped in
`AppErrorBoundary`; global `error` and `unhandledrejection` handlers forward failures through
`log_frontend_event`. The Settings menu reveals the log, and `npm run logs` prints it from the
terminal. No diagnostic data leaves the machine.

## Performance

- Directory reads are capped at 50,000 entries with a banner when truncated.
- Search is capped at 500 results / 8 seconds / 200,000 scanned entries and skips heavy
  system directories; it can be cancelled.
- Details/list/grid views are virtualized, rendering only visible rows plus overscan.
- Folder size scans are separate async commands with 20 s / 500k entry bounds and surface
  partial results.
- Text previews read at most 128 KB; image thumbnails use the WebView's native decoder
  with lazy loading, bounded URL/failure caches, and registry-artwork fallbacks. Native
  `.app` icon lookups are deduplicated and LRU-cached.
- No byte copies happen in the UI process.
- Storage scans run on `spawn_blocking`, report progress without invented percentages, and
  can be cancelled. Folder children and file queries are paged. The treemap is a single
  canvas with hit regions, not thousands of DOM nodes. Duplicate hashing streams 128 KiB at a
  time and is bounded by candidate limits. Cleanup revalidates only selected paths.

## State and persistence

`TabState` owns location, history, listing, loading/error state, selection, anchor,
search query/results/request generation. View mode, sort, grouping, panes, hidden/extensions,
`theme` (light/dark axis), `interfaceTheme` (Windows/Finder axis), display scale/density,
column widths/visibility, sidebar width/visibility, command-bar labels, folder-open behavior,
Trash confirmation, pinned paths, recents, clipboard, menus, dialogs, toasts, and the current
operation live in the store.

The Storage Analyzer has its own `storageStore`: workspace visibility, volumes, the current
scan result and progress, view/folder/file-query state, children cache, cleanup picks,
duplicate results, and cleanup outcome. The selected volume path is a browser preference; the
completed scan index is persisted separately in the versioned app-data SQLite cache and
restored into the store on launch/volume switch. Cached scans are read-only for cleanup until
a rescan. Analyzer actions never mutate pane tabs, histories, or selections.

Persisted (versioned) fields exclude derived/transient state. Invalid stored values are
rejected or clamped. Window bounds are stored separately and clamped to the visible screen.
Dual-pane fields (`dualPane`, `activePane`, `splitRatio`, `syncNavigation`, `panes`,
`shortcuts`, `transferHistory`) are optional extensions of the same version-1 snapshot;
legacy snapshots without `panes` are read as a left pane plus a fresh right pane. Display,
layout, behavior, and column preferences are tolerant optional fields: missing values fall
back to comfortable density, default text/icons, visible sidebar, same-tab folder opening,
and Trash confirmation.
The theme pair is also read by a tiny inline bootstrap in `index.html` (mirrored in
`main.tsx`) so the first paint already uses the saved design; theme changes are applied by
mutating `data-ui-theme` / `data-theme` on `<html>`, without remounting the shell.

## Interface themes

The two interface themes are a presentation layer over the same application:

```
Windows 11 shell ─┐
                  ├── shared React state + Tauri commands ── real filesystem
Finder shell ─────┘
```

- `lib/theme.ts` is the single source of truth for theme ids, names, normalization,
  appearance resolution, the `data-*` attribute application, and virtualized row metrics.
- `tokens.css` defines Windows tokens at `:root`/`[data-theme="light"]` and Finder
  overrides at `[data-ui-theme="finder"]` plus a more specific
  `[data-ui-theme="finder"][data-theme="light"]` block.
- `finder.css` contains structural overrides (traffic lights, compact command toolbar,
  navigation/tab rows, sidebar sections, row heights, menus, status bar) scoped to
  `[data-ui-theme="finder"]`.
- Shared components keep their behavior. `FileArea` receives row heights from
  `THEME_METRICS` so virtualization stays in sync with the CSS.
- The Appearance section of `SettingsDialog` only calls `setInterfaceTheme` / `setTheme`;
  it never touches tabs, navigation, selection, search, or file operations. Theme switching
  is also available from the command bar's Settings menu.
- Persistence is part of the existing snapshot (`interfaceTheme` + `theme`), so switching
  is debounced and restored exactly like the other preferences.

## Custom themes and package authoring

Custom themes are a third presentation layer, expressed as normalized `ThemeDesign` data
rather than React forks:

```
Theme Creator ─┐
               ├── ThemeDesign ── token map ── <html> CSS properties ── shared components
.maxTheme ─────┘
```

- `lib/appearance/model.ts` owns the schema, normalizer, contrast validation, package
  envelopes, safe token sanitization, and optional component configuration
  (`components.paneDivider`). Legacy themes without that block receive safe defaults.
- `lib/appearance/tokens.ts` converts a user-friendly design into the CSS custom properties
  consumed by the existing shell. `useTheme` applies the design and icon pack to
  `<html>`; `clearThemeDesign` removes them for built-in themes. Divider tokens are part of
  the same map — there is no separate theme system for the split view.
- `state/appearanceStore.ts` owns the custom theme library, active theme, icon packs, and
  automatic drafts. Built-in themes remain immutable.
- `.maxTheme` and `.maxIcons` are strict JSON packages, validated and previewed before
  installation. Standard JSON comments are invalid; annotations use an ignored root
  `_comments` object.
- External and AI-authored packages follow `docs/AGENT_THEME_AUTHORING.md` and
  `docs/THEME_PACKAGE_SPEC.md`. `scripts/validate-theme.ts` runs the same parser and
  validator as the app.
- Desktop export is the `save_appearance_package` command; it writes to Downloads without
  overwriting existing files.

## Dual-pane mode

`PaneId` is `"left" | "right"`; every pane owns its tabs, active tab, view/sort/group,
hidden/extension preferences, and collapsed state. Single-pane mode renders the left pane
in the original shell, so existing behavior and details/preview panes are unchanged.

- `DualPaneWorkspace.tsx` renders the split, the reusable `PaneDivider`, and collapse
  rails. The ratio is clamped to 0.18–0.82; either pane can be collapsed, but both cannot
  collapse at once. `App.tsx` keeps the global title bar, command bar, sidebar, comparison
  dock, and status bar outside the panes. Inside each pane the navigation row comes before
  the tab row, matching the single-pane layer order.
- `PaneDivider.tsx` separates a slim, theme-token-driven visible line (1–8 px, default 2)
  from a wider invisible pointer target (12–28 px, default 14). It supports pointer capture,
  window/pointer cancellation cleanup, double-click reset, Home/End, arrow-key resizing,
  Shift for a larger step, and separator ARIA semantics. `lib/divider.ts` owns the pure
  ratio geometry so pointer and keyboard behaviour share the same minimum-width rules.
- The active pane is marked by a theme-token-driven inset accent border by default (no layout
  shift); imported themes may choose a tab top line, a tinted header, or no indicator through
  `components.paneDivider.activeIndicator`. Clicking, focusing, selecting, or navigating in
  a pane activates it; hovering does not.
- The divider position is the existing persisted `splitRatio`. Window resizes clamp the
  rendered ratio without overwriting the saved preference, so a transient narrow window does
  not permanently move the divider. Theme changes preserve both the ratio and both panes'
  navigation state.
- `PaneTabs.tsx`, `NavigationBar.tsx`, `FileArea.tsx`, `HomeView.tsx`, and the keyboard
  hooks accept an explicit `paneId`; the active pane is the default target. Tab/shortcut
  actions are active-pane scoped.
- `lib/panes.ts` contains the pure helpers: pane creation, split clamping, synchronized
  path mapping, conflict detection, recursive-transfer guard, accelerator parsing, and
  persistence mapping. `deriveSyncAnchors` only maps between related folder trees and
  returns `null` for unrelated or Home locations, so synchronized navigation stays a
  no-op until a valid mapping exists.
- Transfers are queued in the store and executed by real Rust code in `transfer.rs`
  (`transfer_paths`, `cancel_transfer`, `pause_transfer`). Files stream in 256 KB chunks to
  a temporary `.part` file and are renamed into place only after a successful sync; moves
  remove the source only after success. Conflicts are resolved by the backend policy
  (`error`/`replace`/`rename`/`skip`) and are never silent. Progress is emitted as
  `transfer-progress`, including speed and ETA. The store's clipboard carries `copy` or
  `cut`; cut entries are dimmed in every view, and `panesShowingSources` decides which
  panes to reload after a move so the operation never reads as a copy.
- Folder comparison is read-only. `compare.rs` lists both folders, compares names, sizes,
  timestamps, and optionally file bytes, and emits `compare-progress`. `ComparisonPanel`
  exposes differences-only filtering and content-verification; no comparison command
  mutates the filesystem.
- Drag payloads carry `application/x-win11-explorer-paths` plus the source pane. Folder
  rows, blank pane space, Home, and pane tabs accept the payload; Alt/Meta means copy and
  the default is move. Drop hints mirror the effective operation.
- Defaults: `Mod+Shift+M` toggles dual-pane, `F5` copies to the opposite pane, `F6` moves,
  and `Tab` switches panes while the file list has focus. All are editable in Preferences
  and persisted. In single-pane mode F5 keeps its original refresh meaning.

## macOS integration

- `Info.plist` includes usage descriptions for Desktop, Documents, Downloads, removable
  and network volumes, plus `NSLocalNetworkUsageDescription` and `NSBonjourServices` for
  SMB discovery. The app is **not sandboxed**, so security-scoped bookmarks are not used;
  TCC's Local Network and Network Volumes controls still apply.
- Network servers are mounted through macOS **NetFS** (`NetFSMountURLSync`), the same
  framework Finder uses, so the native authentication sheet and Keychain work without
  routing through Finder. Discovery combines Bonjour, WS-Discovery, and NetBIOS; mount
  paths are detected with `statfs(2)`. See [NETWORK_ACCESS.md](NETWORK_ACCESS.md).
- `dirs` resolves real home folders. `/Volumes` entries become drives; mounted network
  filesystems become Network locations even if TCC temporarily denies their contents;
  `/Network` is shown when present. `/Applications` and `/System/Applications` feed Open With.
- `open` opens the default app; `open -R` reveals in Finder; `open -a Terminal` opens a
  terminal; `open -a <app>` powers Open With.
- No Windows system paths are used on macOS. "This PC" becomes "This Mac"; drive letters
  become volume names.

## Packaging

`npm run tauri:build` produces the platform bundle. The GitHub Actions workflow builds an
unsigned macOS artifact on `macos-14`. Code signing/notarization and App Sandbox
entitlements are deliberately left to the distributor.
