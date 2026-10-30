# MAXplorer Universal Search

Universal Search is MAXplorer's local discovery system. It combines a persistent SQLite
index, full-text extraction, a bounded live filesystem provider, and macOS Spotlight. The
UI exposes a command-style Quick Search overlay and a full search workspace inside the
existing MAXplorer shell.

## Entry points

- The single navigation-bar search field (Layer 2). Its globe button opens Universal Search; typing in the field keeps the existing contextual folder search.
- `Command+Shift+F` by default; configurable in **Settings → Keyboard** shortcuts.
- `Command+F` keeps the existing contextual folder search.
- **Settings (gear) → Universal Search**. Search indexing lives once under **Settings... → Advanced** (and in the search UI's own indexing action), so the command bar does not duplicate the indexing screen. The unified command bar therefore exposes Universal Search without adding a second toolbar search field.

## Architecture

```
src/components/search/   Quick Search overlay, workspace, filters, results, preview,
                         duplicates, indexing dashboard
src/state/searchStore.ts Query orchestration, progressive merging, scopes, history,
                         saved searches, index controls
src/lib/search/          Deterministic natural-language interpreter, structured types,
                         history/saved-search persistence
src-tauri/src/search/    SQLite schema and queries, FTS5, extraction, indexer, live scan,
                         Spotlight provider, duplicate detection, Tauri commands
```

The frontend never invents results. Every constraint is converted to a structured
`SearchRequest`; the backend applies the same metadata/filter gate to every provider.

### Index

SQLite is stored under the Tauri application support directory at
`search/index.sqlite3`. It uses WAL mode, short transactions, indexed metadata columns,
and an FTS5 table kept in sync by triggers. The schema is versioned in `meta`; opening an
existing database preserves its records.

Indexed metadata: canonical path, name, lower-case name/path, parent, extension, kind,
size, created/modified/accessed timestamps, hidden/symlink flags, content state, content
error, optional content hash, and a scan generation for reconciliation.

### Indexing

- Initial scan on first launch; incremental filesystem events via `notify` (FSEvents on
  macOS); periodic reconciliation every 30 minutes.
- Deletions are detected by generation-based reconciliation and remove-event handling.
- Symlinked directories are listed but never traversed; heavy/system directories and app
  bundles are skipped by default.
- Content extraction runs on a separate worker, bounded to six documents per cycle. It
  supports plain text, Markdown, JSON, XML, HTML, CSV, source code, configuration files,
  PDF (embedded text only), DOCX, XLSX, and PPTX.
- Pause/resume, rebuild, clear, retry failed extraction, maximum file size, and error
  diagnostics are exposed in the indexing dashboard.

### Revealing a result in MAXplorer

Search results can be revealed in the file browser from the context menu or the preview
pane. The default action looks for the result's parent folder in either pane, including
inactive tabs. When it finds one, that pane and tab are activated instead of navigating
away from them; otherwise the active pane navigates to the parent in place, preserving the
other pane, its tabs, history, and synchronized-navigation state. The item is selected,
scrolled into view, and the file list is focused. With dual panes open, an additional
**Reveal in left/right pane** action targets the chosen pane so the active pane's location
can be preserved. A collapsed pane is restored before revealing. Missing, moved, or
inaccessible items produce a toast instead of leaving a selection on an entry that is not
on screen.

### Query execution

1. Indexed filename/path/metadata candidates.
2. Indexed content candidates via FTS5 (LIKE fallback if FTS5 is unavailable).
3. Bounded live filesystem scan when the scope is a folder/external/custom location or
   the index is not ready.
4. macOS Spotlight provider (`mdfind`) with post-filtering and permission-safe stat.
5. Results are deduplicated by normalized path, ranked deterministically, and streamed to
   the UI through `search-progress` events using a query id.

Ranking gives exact name, prefix, name-token, path, content, and metadata matches strong
weights, with a deliberately small recency boost. Match explanations only report evidence
that actually matched.

### Natural-language interpretation

`src/lib/search/interpreter.ts` deterministically parses file kinds, extensions,
languages, sizes (binary units), relative/absolute dates, month names, locations, quoted
phrases, exclusions, content phrases, hidden files, duplicates, and case sensitivity.
Every interpreted constraint becomes an editable chip. Unresolved locations or dates are
left as search terms and explained in a note.

### Duplicate detection

Files are grouped by size, narrowed by a first/last-64-KiB fingerprint, then confirmed
with SHA-256. Only byte-identical files are labelled exact duplicates. Size alone is never
sufficient. The duplicate view reports recoverable bytes and never deletes anything
automatically.

## Privacy and macOS permissions

- Only configured indexed locations and explicit scopes are searched.
- File contents, paths, hashes, embeddings, and history stay local; nothing is uploaded.
- Indexing skips `Library`, application bundles, and common heavy directories by default.
- Permission failures are reported as partial/unavailable locations instead of falling
  back to bypassing TCC or sandbox restrictions.
- The indexing database lives outside indexed locations under application support.
- Search history stores query text, scope, and timestamp only; contents are never stored.
- History can be disabled, cleared, and pruned by retention.

## Supported and unsupported capabilities

Implemented: filename/path/metadata/content search, scoped live search, Spotlight,
progressive results, filters and chips, list/grid results, previews, natural-language
constraints, history, saved searches, duplicate verification, indexing controls and
diagnostics, light/dark and Windows/Finder themes.

Not implemented in this build: local semantic embeddings, visual image recognition, OCR
for scanned PDFs, and similar-name-based duplicate grouping. These are reported as
unavailable/disabled rather than represented by mock results.

## Tests

- Frontend: query interpreter, date/size interpretation, chips, scope roots, history/
  saved-search parsing and retention, overlay/workspace/filter/indexing UI behaviour, and
  Reveal in MAXplorer pane/tab targeting, history preservation, and stale-result handling.
- Backend: FTS/search/ranking, content extraction, filters, Unicode, case sensitivity,
  empty folders, cancellation, duplicates, persistence/migration, initial and incremental
  indexing, deletion reconciliation, and content-job extraction.
- A debug-build benchmark over 5,000 indexed files measured indexed name queries at a
  median of 5 ms and p95 of 6 ms on the development machine.
