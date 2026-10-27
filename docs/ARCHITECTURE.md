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
    Dialogs.tsx               Confirm, prompt, conflict, properties, open-with, options
    FileGlyph.tsx             Original SVG folder/file glyphs, real image thumbnails
    Icon.tsx                  Original Fluent-style SVG icon set (no emoji)
  hooks/
    useVirtualRows.ts         Fixed-height virtual rows with prefix offsets
    useElementSize.ts         ResizeObserver width/height
    useFileNavigation.ts      Click/modifier selection + arrows/page/type-ahead
    useMarqueeSelection.ts    Drag rectangle selection over visible rows
    useKeyboardShortcuts.ts   Global Windows-style shortcut map
    useTheme.ts               System/light/dark resolution + data-theme
    useWindowPersistence.ts   Logical size/position persistence
  lib/
    api.ts                    Typed Tauri invoke wrappers, error normalization
    types.ts                  Shared serialized contracts and UI models
    format.ts                 Windows-style sizes, dates, type names, paths
    sort.ts                   Sorting and group buckets
    history.ts                Per-tab back/forward history
    tabs.ts                   Tab creation/closing/cycling/duplication
    selection.ts              Range/toggle/prune selection
    persistence.ts            Versioned localStorage persistence + validation
  state/explorerStore.ts      Application store and all user actions
src-tauri/src/
  lib.rs                      Tauri builder + command registration
  commands.rs                 Async command boundary, platform launchers
  listing.rs                  Directory entries and metadata
  operations.rs               Create/copy/move/rename/delete/duplicate/conflicts
  search.rs                   Bounded recursive search + cancellation
  metadata.rs                 Properties, folder stats, previews, sidebar, apps
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
theme, column widths, sidebar width, pinned paths, recents, clipboard, menus, dialogs,
toasts, and the current operation live in the store.

Persisted (versioned) fields exclude derived/transient state. Invalid stored values are
rejected or clamped. Window bounds are stored separately and clamped to the visible screen.
Theme changes remount the two top bars to work around a WebView2 composited-layer repaint
issue observed during validation.

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
