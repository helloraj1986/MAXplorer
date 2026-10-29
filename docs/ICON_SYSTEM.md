# Icon system

MAXplorer uses one centralized icon pipeline for both interface themes. The
system is presentation-only: it never changes paths, navigation, selection,
sorting, file operations, sync state, or keyboard behavior.

## Functional chrome — Lucide

`src/components/icons/AppIcon.tsx` is the single entry point for chrome icons.
It maps semantic names (`back`, `delete`, `sync`, `folder`) to named
`lucide-react` imports so unused glyphs are tree-shaken. `Icon.tsx` is kept as a
thin compatibility facade for existing callers.

- Default sizes: 12/14/16/18/20/24 px tokens in `src/styles/tokens.css`.
- Default optical stroke: 1.75 px, applied with Lucide's `absoluteStrokeWidth`
  so a 16 px and a 24 px icon keep the same perceived weight.
- Icons are decorative (`aria-hidden`) unless a title is supplied. Interactive
  controls keep their own `aria-label`/`title`.
- Tones (`muted`, `subtle`, `accent`, `danger`, `success`, `warning`) map to
  theme tokens rather than hard-coded colors.

## File artwork — typed registry

`src/lib/icons/fileIconRegistry.ts` resolves a typed `FileVisual` from:

1. the directory flag (`.app` bundles become applications);
2. well-known dotfile and project names (`Dockerfile`, `.gitignore`,
   `package.json`, `Cargo.toml`, …);
3. compound extensions (`tar.gz`, `d.ts`, `min.js`);
4. the extension (case-insensitive), using the listing's `extension` field
   when present;
5. MIME type, when a caller has one;
6. a deterministic neutral fallback.

It covers documents, images, video/audio, archives, disk images, applications,
executables, fonts, certificates, databases, configuration files and the
documented development languages. Unknown extensions still render a clean page
with a short extension badge. Files without extensions never produce a random
or emoji icon. File names and extensions are treated as untrusted display data
and are never executed or opened to classify them.

`FileTypeIcon` renders the registry visual and adds the symlink badge. At small
sizes (below 24 px) it switches to a simplified, higher-contrast composition so
16 px list rows stay legible.

## Folder, storage and status artwork

- `FolderIcon` supports standard, open, selected, shared, favourite, downloads,
  network, synced and special variants. Colors come from theme tokens:
  Windows uses the gold folder, Finder uses the macOS blue source-list folder.
- `StorageIcon` separates volume identity (internal, external, removable,
  network, mounted, disconnected) from a separate connection-status dot.
- `SyncStatusIcon` is wired only to real transfer state in the status bar. The
  app has no background sync engine, so no fake sync state is shown.

## Native artwork and thumbnails

- macOS `.app` bundles continue to use the Rust `read_app_icon` command through
  `src/lib/icons/nativeIconService.ts`. Lookups are deduplicated and LRU-cached
  (256 entries), and a failed lookup falls back to built-in application artwork.
- Image thumbnails use the existing Tauri asset protocol. They are lazy
  (`loading="lazy"`), decoded asynchronously, virtualized by the existing list
  virtualization, and fall back to registry artwork on error. Failed paths and
  asset URLs are bounded in `src/lib/icons/thumbnailService.ts`.
- No synchronous filesystem work happens while a directory is enumerated, and
  native icon requests are cancelled/ignored when a row unmounts.

## Verification

```bash
npm run typecheck
npm test
npm run test:cargo
npm run build
```

Current results: **161 frontend tests across 20 files**, **28 Rust tests**, and a
clean production build. The icon tests cover extension mapping, case-insensitivity,
compound extensions, dotfiles, unknown/extensionless files, MIME fallback, native
icon failure, thumbnail failure, theme switching, list/grid/details rendering and
accessibility labels. The work was merged to `main` on 2026-10-29.
