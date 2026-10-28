# Architecture

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
  App.tsx                     Shell composition, theme, OS drag-drop, global context menu
  components/
    TitleBar.tsx              Tabs, tab reorder, caption controls, drag region
    CommandBar.tsx            New/cut/copy/paste/rename/share/delete/sort/view/more
    NavigationBar.tsx         History buttons, breadcrumbs, editable address, search
    Sidebar.tsx               Home, pinned paths, This Mac, volumes, resize/drop targets
    FileArea.tsx              View selection, search state, empty/error/loading, marquee
    HomeView.tsx              Quick access + Recent on virtual Home location
    DetailsPane.tsx           Selection/folder metadata pane
    PreviewPane.tsx           Image/text preview + metadata
    StatusBar.tsx             Item count, selection size, view buttons
    ContextMenu.tsx           File and blank context menus + nested menus
    Menu.tsx                  Shared menu primitive with submenus/checkmarks/shortcuts
    Dialogs.tsx               Confirm, prompt, conflict, properties, open-with, options, themes
    FileGlyph.tsx             Original SVG folder/file glyphs, real image thumbnails
    Icon.tsx                  Original Fluent-style SVG icon set (no emoji)
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
    appIcons.ts               .app icon loading, in-memory cache, LRU eviction
    types.ts                  Shared serialized contracts and UI models
    theme.ts                  Interface theme definitions, normalization, metrics, apply
    format.ts                 Windows-style sizes, dates, type names, paths
    sort.ts                   Sorting and group buckets
    history.ts                Per-tab back/forward history
    tabs.ts                   Tab creation/closing/cycling/duplication
    selection.ts              Range/toggle/prune selection
    persistence.ts            Versioned localStorage persistence + validation + theme bootstrap
  state/explorerStore.ts      Application store and all user actions
  styles/
    tokens.css                Windows and Finder design tokens (light + dark)
    app.css                   Shared component styling and the theme selector
    finder.css                Structural Finder overrides scoped to data-ui-theme="finder"
src-tauri/src/
  lib.rs                      Tauri builder + command registration
  commands.rs                 Async command boundary, platform launchers
  listing.rs                  Directory entries and metadata
  operations.rs               Create/copy/move/rename/delete/duplicate/conflicts
  search.rs                   Bounded recursive search + cancellation
  metadata.rs                 Properties, folder stats, previews, sidebar, apps
  app_icons.rs                .app bundle icon lookup + ICNS/PNG extraction
  paths.rs                    Expansion, name validation, unique names, safety
  error.rs                    AppError code/message contract
  types.rs                    Serde contracts shared with TypeScript
```

## Data flow

1. UI action (click, shortcut, menu) calls a store action.
2. Store action updates tab/UI state and calls a typed function in `lib/api.ts`.
3. Tauri invokes a Rust command with camelCase arguments; commands normalize paths and
   run blocking filesystem work on `spawn_blocking`.
4. Rust returns serialized camelCase structs or an `AppError` object.
5. Store merges only responses that still match the tab's location/request generation.
6. File mutations refresh the affected listing and show a result toast.
7. Persistence subscribes to the store and debounces a validated snapshot.

Search is cancellable by request ID. A stale result cannot overwrite a newer query or a
different tab location.

## Application bundle icons

A macOS `.app` is a directory, so the listing marks it as a folder. `FileGlyph` detects the
`.app` suffix and asks `read_app_icon` for a real icon:

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
  Delete is confirmed; permanent delete has its own stronger confirmation.
- **Trash**: uses the `trash` crate, so macOS deletion goes through the system Trash.
- **Permission errors**: I/O kinds map to `permission_denied`, `not_found`,
  `already_exists`, `invalid_request`, or `io_error`; the UI has a dedicated permission
  state with an Open System Settings action.
- **Protection of user data during tests**: Rust tests use `tempfile` directories only.
  UI validation used a disposable fixture under `reference/fixture`.

## Performance

- Directory reads are capped at 50,000 entries with a banner when truncated.
- Search is capped at 500 results / 8 seconds / 200,000 scanned entries and skips heavy
  system directories; it can be cancelled.
- Details/list/grid views are virtualized, rendering only visible rows plus overscan.
- Folder size scans are separate async commands with 20 s / 500k entry bounds and surface
  partial results.
- Text previews read at most 128 KB; image previews use the WebView's native decoder with
  lazy loading and fallback glyphs.
- No byte copies happen in the UI process.

## State and persistence

`TabState` owns location, history, listing, loading/error state, selection, anchor,
search query/results/request generation. View mode, sort, grouping, panes, hidden/extensions,
`theme` (light/dark axis), `interfaceTheme` (Windows/Finder axis), column widths, sidebar
width, pinned paths, recents, clipboard, menus, dialogs, toasts, and the current operation
live in the store.

Persisted (versioned) fields exclude derived/transient state. Invalid stored values are
rejected or clamped. Window bounds are stored separately and clamped to the visible screen.
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
- `finder.css` contains structural overrides (traffic lights, unified toolbar, sidebar
  sections, row heights, menus, status bar) scoped to `[data-ui-theme="finder"]`.
- Shared components keep their behavior. `FileArea` receives row heights from
  `THEME_METRICS` so virtualization stays in sync with the CSS.
- The theme selector (`Dialogs.tsx`) only calls `setInterfaceTheme` / `setTheme`; it never
  touches tabs, navigation, selection, search, or file operations.
- Persistence is part of the existing snapshot (`interfaceTheme` + `theme`), so switching
  is debounced and restored exactly like the other preferences.

## macOS integration

- `Info.plist` includes usage descriptions for Desktop, Documents, Downloads, removable
  and network volumes. The app is **not sandboxed**; TCC prompts apply.
- `dirs` resolves real home folders. `/Volumes` entries become drives; `/Network` is shown
  when present. `/Applications` and `/System/Applications` feed Open With.
- `open` opens the default app; `open -R` reveals in Finder; `open -a Terminal` opens a
  terminal; `open -a <app>` powers Open With.
- No Windows system paths are used on macOS. "This PC" becomes "This Mac"; drive letters
  become volume names.

## Packaging

`npm run tauri:build` produces the platform bundle. The GitHub Actions workflow builds an
unsigned macOS artifact on `macos-14`. Code signing/notarization and App Sandbox
entitlements are deliberately left to the distributor.
