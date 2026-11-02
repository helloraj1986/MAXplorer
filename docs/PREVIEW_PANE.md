# Native Preview Pane

MAXplorer's preview pane is a third resizable region beside the navigation
sidebar and the browsing panes. It follows the active pane, reuses the existing
theme tokens, splitter, icons, menus, settings and persistence, and never opens
or executes the previewed content.

## Architecture assessment

MAXplorer is a **Tauri 2 + React 18 + TypeScript** desktop application with a
**Rust** backend. The webview talks to macOS through the typed command bridge in
`src/lib/api.ts` (`invoke`); file listings, metadata, operations, search, the
storage analyzer and network mounts are all real Rust services.

The UI hierarchy is:

```
App
├── TitleBar
├── CommandBar (New / file operations / Sort / View / workspace / Settings)
├── single-pane NavigationBar + PaneTabs
├── main-area
│   ├── Sidebar (Favorites, Locations, Tags)
│   ├── PreviewWorkspace
│   │   ├── workspace-panes
│   │   │   ├── DualPaneWorkspace → PaneShell → NavigationBar, PaneTabs, FileArea
│   │   │   └── single workspace → FileArea + DetailsPane
│   │   ├── PaneDivider (shared splitter, vertical or horizontal)
│   │   └── PreviewPane → PreviewEngine renderers
│   └── SearchWorkspace / StorageWorkspace
├── StatusBar
└── dialogs, menus, overlays, toasts, transfer panel
```

Dual-pane state is in the Zustand store (`src/state/explorerStore.ts`): each
pane owns tabs, current tab, view mode, sorting, grouping, hidden/extension
preferences, collapsed state and tag filter; the store owns `activePane`,
`splitRatio`, and the selected paths in each tab. Selection is emitted through
`setSelection`, `toggleAt`, `selectRangeTo`, `selectAll` and the file view
keyboard/pointer handlers. The preview subscribes to
`selectedEntries(activePane)`, so switching panes, tabs, search results, Recents,
tags, Trash and network folders all update it without a second navigation model.

Commands live in `CommandBar`, `useKeyboardShortcuts` and `MenuPanel`. The theme
engine applies CSS variables from `tokens.css`, `finder.css` and community
designs; icons are registered in `AppIcon.tsx` and the typed file registry in
`src/lib/icons/fileIconRegistry.ts`. File access is not sandboxed in the current
build; paths are absolute and the app uses the asset protocol. Persistence is a
versioned localStorage snapshot parsed tolerantly in `src/lib/persistence.ts`.

## Preview layout

`PreviewWorkspace` is the single layout engine. It supports:

- **Sidebar | panes | preview** (default, right)
- **Sidebar | preview | panes** (left)
- **Sidebar | panes over preview** (bottom)
- **Focus + Preview** in dual-pane mode: the preview takes the inactive pane's
  space while the inactive pane keeps all of its tabs, history and selection in
  the store; hiding the preview restores both panes.
- Independent show/hide for sidebar and preview.
- The existing `PaneDivider` component for all splits (pointer, keyboard,
  double-click reset, accessible separator semantics).
- Narrow-window behaviour: below 720 px of workspace width the preview stops
  reserving layout width and offers a floating **Preview** restore chip; below
  the same threshold the inactive pane is folded away too. The browsing area
  keeps a usable minimum width.
- Persisted position, width, height, visibility, focus mode, autoplay, text
  limit and enabled renderers. The legacy `previewPane` boolean is still written
  so older builds can read new snapshots.

## Native preview engine

`src/lib/preview/engine.ts` centralises `detectFileType`, `resolveRenderer`,
`load`, `update`, `cancel`, `unload`, `refresh`, `capabilities` and `metadata`.
Type detection prefers `UniformTypeIdentifiers` conformance from Spotlight
(`mdls -json`) and falls back to the existing extension registry.

Renderer order:

1. Specialised: image, PDF, media, text/code, archive, folder.
2. Quick Look thumbnails (`qlmanage -t`, the system Quick Look service) for documents,
   packages and unknown formats, including third-party generators.
3. File-information card for formats with no thumbnail.
4. The card is also the permanent fallback, so the pane is never blank.

`src-tauri/src/preview.rs` provides the native services:

- `preview_metadata` — UTI, kind, size, dates, dimensions, duration, codecs,
  page count, Spotlight tags, iCloud placeholder and network-volume flags.
- `preview_thumbnail` — Quick Look thumbnails in a bounded in-memory cache.
- `preview_quicklook_open` / `preview_quicklook_close` — the native Quick Look
  panel for Space and multi-selection.
- `preview_read_text` — ranged text, binary detection and decoded binary plists.
- `preview_archive` / `preview_extract_archive` — ZIP central-directory listing
  without extraction, and `ditto` extraction through the existing file-operation
  refresh path.
- `preview_folder_summary` / `cancel_preview_task` — bounded, cancellable folder
  counts and sizes.
- `preview_watch` / `preview_unwatch` — best-effort file change notifications.
- `preview_download_icloud` — explicit `brctl download` for placeholders.

PDFs are displayed by WKWebView's native PDFKit document view; video and audio
use WebKit's native media element and AVPlayer. Neither is reimplemented in
JavaScript. Images use the asset protocol with fit/actual-size, zoom, view-only
rotation, fullscreen and a Quick Look fallback for formats the webview cannot
decode.

## Integration

- **Space** opens the native Quick Look panel for the current selection; Escape
  closes it. `Cmd+Option+P` (and the previous `Option+P`) toggles the preview.
- The toolbar, View menu, workspace dropdown and status bar all expose the
  preview toggle; the workspace dropdown also exposes position, Focus + Preview
  and Restore default layout.
- Settings → Preview controls default visibility, position, Focus + Preview,
  media autoplay, text limit and enabled renderers.
- Selection debounce is 120 ms; in-flight loads are aborted and stale results
  discarded. Folder scans are cancellable. Quick Look thumbnails have a 15-second
  hard timeout.
- Only one media item plays at a time. Playback pauses when the preview is
  hidden, the selection changes, or the window is hidden. Unmounting removes the
  media source and releases the native player.
- The preview is a drag source through the existing pointer-drag service. It
  does not accept drops.
- MAXplorer tags are shown read-only in the header and information card.

## Phased implementation delivered

1. Layout engine, toolbar/status/View-menu toggles, empty, multi-selection,
   unsupported and error states.
2. `PreviewEngine` and the native Quick Look thumbnail/panel services.
3. Image, PDF, media and folder renderers.
4. Text/code (line numbers, find, wrap, syntax tokens, load more), archive and
   file-information renderers.
5. Settings, persistence, watcher refresh, iCloud download, drag source,
   accessibility, narrow-window behaviour and documentation.

## Test checklist

- [ ] Dual pane: select in the left pane, click the right pane, then use arrow
      keys. The preview follows the accent-bordered active pane.
- [ ] Tabs: switch tabs in either pane and confirm the preview updates.
- [ ] Search results preview through the search workspace's existing preview;
      Shared, Trash, tag-filtered listings and mounted network folders preview
      their selections. Trash items remain read-only. Recents/Home/Network are
      navigation views that open on click and then preview from the real folder.
- [ ] Narrow window: shrink below 720 px; preview auto-collapses first, then the
      inactive pane; the floating Preview chip restores the preview.
- [ ] Light, dark, Windows, Finder and an imported community theme: header,
      cards, code tokens and native PDF/media backgrounds use theme tokens.
- [ ] Large text file: initial chunk, Load more, wrap, find, copy, line numbers.
- [ ] Rapid arrow-key navigation: no stale preview flashes, no media left
      playing, folder scans stop.
- [ ] PDF: pages, zoom, find, text selection, print, fullscreen.
- [ ] Video/audio: play, scrub, fullscreen, close preview, switch selection,
      hide window; the player is released and only one item plays.
- [ ] ZIP: listing, compressed/uncompressed totals, Extract Here, Extract To.
- [ ] Folder selection: count, size, mini listing; cancel a large scan.
- [ ] Network, iCloud placeholder and permission-denied files show an actionable
      message and never hang the UI.
- [ ] Space opens Quick Look; Escape/Space closes it; `Cmd+Option+P` toggles.
- [ ] Layout persistence across restart: position, size, visibility, focus mode,
      renderers and text limit.
- [ ] VoiceOver: preview header buttons, splitter, renderer toolbars and the
      status toggle are labelled and keyboard operable.
- [ ] Reduced motion: no preview transitions or decorative animation.

## Assumptions

- The existing sidebar stays on its current side. "Preview position: Left" means
  sidebar | preview | panes; a separate sidebar-side setting was not added
  because the sidebar has never had one.
- Native Quick Look uses `qlmanage`, which is the same system Quick Look engine
  and picks up installed generators. It opens a native panel rather than an
  embedded `QLPreviewView`, because embedding an AppKit view inside the Tauri
  webview would require a second native window/view layer.
- The current build is not sandboxed, so security-scoped bookmarks are not part
  of this change. Preview reads use the same absolute-path rules as the file
  browser and never write to the source.
- ZIP is the archive format with a full contents listing; other archive formats
  still open and show a metadata card.
- Office documents rely on Quick Look, as specified.
- Recents, Home and Network are navigation views rather than file listings, so
  they keep their existing open-on-click behaviour. Files opened from them are
  previewed in their real folder (including mounted network volumes). Shared,
  Trash and tag-filtered listings use the normal file-selection model and
  therefore preview directly.
- Preview state is persisted in the existing single-window localStorage snapshot;
  per-window persistence would require a window-id key when multiple windows are
  added.

## Existing files modified

- `src/App.tsx` — main area now uses `PreviewWorkspace`; clears the Quick Look
  flag when focus returns.
- `src/components/CommandBar.tsx` — toolbar Preview toggle, View/workspace menu
  entries, position/focus/reset commands.
- `src/components/Dialogs.tsx` — Settings → Preview section and shortcut help.
- `src/components/DualPaneWorkspace.tsx` — optional active-pane-only rendering
  for Focus + Preview and narrow windows.
- `src/components/PaneDivider.tsx`, `src/lib/divider.ts` — horizontal splitter
  support while preserving the existing vertical semantics.
- `src/components/PreviewPane.tsx` — full preview shell and renderer dispatch.
- `src/components/StatusBar.tsx` — preview toggle and previewed item summary.
- `src/components/icons/AppIcon.tsx` — zoom, rotate, wrap, play/pause, cloud
  download, chevron-up and bottom-panel icons.
- `src/hooks/useKeyboardShortcuts.ts` — Space Quick Look and preview toggle.
- `src/lib/api.ts`, `src/lib/types.ts`, `src/lib/persistence.ts` — typed bridge,
  preview preferences and tolerant parsing.
- `src/state/explorerStore.ts` — preview preferences/actions, Quick Look state.
- `src/styles/tokens.css`, `src/main.tsx` — preview design tokens and stylesheet.
- `src-tauri/src/preview.rs` (new), `src-tauri/src/commands.rs`,
  `src-tauri/src/lib.rs`, `src-tauri/src/types.rs` — native preview services.
