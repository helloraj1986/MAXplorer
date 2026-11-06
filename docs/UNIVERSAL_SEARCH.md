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
and FTS5 tables kept in sync by triggers. The schema is versioned in `meta`; opening an
existing database preserves its records.

Indexed metadata: canonical path, name, lower-case name/path, parent, extension, kind,
size, created/modified/accessed timestamps, hidden/symlink flags, content state, content
error, optional content hash, and a scan generation for reconciliation.

Three structures support queries:

- `files` — the metadata table, with indexes on name, path, parent, root, size, kind,
  extension, modified and created.
- `files_fts` — FTS5 (`unicode61`) over name and extracted content, used for content and
  whole-token matching.
- `files_name_fts` — FTS5 (`trigram`) over name and path. This is what makes
  `%resume%`-style substring search cheap: a leading-wildcard `LIKE` cannot use a B-tree
  index and degrades to a full table scan, while the trigram index answers the same
  query in milliseconds. Terms shorter than three characters and case-sensitive queries
  fall back to `LIKE`/`instr`.

Counters (`counts.files`, `counts.content`, …) and per-location totals
(`location_counts`) are materialised by the indexer. `get_search_index_status` reads
those rows instead of running `COUNT(*)` aggregates, so status and search initiation no
longer scale with the size of the index.

### Index scope and exclusion policy

`search/live.rs` owns one policy used by the indexer walker, the live fallback, the
FSEvents filter and the prune path:

- every dot-directory (`~/.local`, `~/.lmstudio`, `~/.nvm`, `~/.gradle`, `~/.nuget`,
  `~/.vscode`, `~/.hermes`, `~/.cache`, …);
- package and build output (`node_modules`, `target`, `dist`, `build`, `out`, `.next`,
  `Pods`, `__pycache__`, `.venv`, `venv`);
- OS metadata (`Library`, `Caches`, `DerivedData`, `.Trash`);
- bundles (`.app`, `.framework`, `.bundle`, `.photoslibrary`, `.xcarchive`, `.dSYM`).

An explicitly configured index location is always allowed, because the root itself is
never subject to the policy. A single pass is capped at 400 000 entries so one
pathological tree cannot own the index.

### Indexing

- Initial scan on first launch; incremental filesystem events via `notify` (FSEvents on
  macOS); periodic reconciliation every 6 hours.
- Deletions are detected by generation-based reconciliation and remove-event handling.
- Symlinked directories are listed but never traversed; heavy/system directories and app
  bundles are skipped by default.
- Content extraction runs on a separate worker, bounded to six documents per cycle. It
  supports plain text, Markdown, JSON, XML, HTML, CSV, source code, configuration files,
  PDF (embedded text only), DOCX, XLSX, and PPTX.
- Pause/resume, rebuild, clear, retry failed extraction, maximum file size, error
  diagnostics, **clean excluded folders** and **compact database** are exposed in the
  indexing dashboard.

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

1. Indexed filename/path/metadata candidates (trigram index for substrings of three or
   more characters, `LIKE`/`instr` otherwise).
2. Indexed content candidates via FTS5 (LIKE fallback if FTS5 is unavailable).
3. Bounded live filesystem scan when the scope is a folder/external/custom location or
   the index is not ready.
4. macOS Spotlight provider (`mdfind`) with post-filtering and permission-safe stat.
5. Results are deduplicated by normalized path, ranked deterministically, and streamed to
   the UI through `search-progress` events using a query id.

Cost control is part of the contract, not an optimisation:

- **One query in flight.** A new query cancels every older one before it starts, so
  keystrokes cannot queue minutes of work behind each other.
- **Statement-level cancellation.** Each search connection installs a SQLite progress
  handler that aborts the scan when the query is superseded. Previously the cancel flag
  was only read between providers, which did nothing during a long scan.
- **A 5 s query budget.** Providers that have not started when the budget is exhausted are
  skipped and the response says so; partial results are always returned.
- **A bounded Spotlight call.** `mdfind` runs per root with `-onlyin` and a 1.5 s
  deadline; a timeout kills the child and reports a note instead of blocking the search.
- **Bounded candidate set.** At most 12 000 rows are materialised for ranking.

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
- Backend: FTS/search/ranking, trigram substring and mid-word matching, path-only matches
  through the FTS join, content extraction, filters, Unicode, case sensitivity, empty
  folders, cancellation, duplicates, persistence/migration, initial and incremental
  indexing, deletion reconciliation, content-job extraction, exclusion-aware pruning and
  materialised counters.
- `src-tauri/examples/search_maintenance.rs` runs the real engine against a real index and
  prints timings, so the numbers below can be reproduced instead of taken on trust.

## Measured performance

Development machine, macOS, Apple silicon, index on the internal SSD. The "before" column
is the same database with the exclusion policy absent and the trigram index not yet built.

| Metric | Before | After |
| --- | --- | --- |
| Index rows | 6,350,597 | 156,732 |
| Index size | 20.1 GB | see note below |
| `status()` (per query) | 47.3 s per aggregate × 5 | 4.8 ms |
| Search `resume` (name + content) | 35.6 s | 380 ms warm, 861 ms cold |
| Search `esum` (mid-word substring) | 50 s | 26 ms |
| Matches for `resume` | 2,795 (mostly cache paths) | 1,733 (real documents) |
| Prune of 6.19 M rows | — | ~4 min |
| Trigram index build (156 k rows) | — | 6.8 s |
| Reopen existing index | 5.2 s (schema migration) | 1.2 ms |
| Cancellation | ignored during SQL | aborts inside SQLite |

Reproduce with:

```bash
cargo run --release --manifest-path src-tauri/Cargo.toml \
  --example search_maintenance -- \
  "$HOME/Library/Application Support/com.replica.win11explorer/search/index.sqlite3" resume
```

Add `optimize` as a fourth argument to rebuild both FTS tables and vacuum afterwards.
The file size only drops after a vacuum: the prune frees pages inside the existing file,
and live reads never touch those pages, so query latency improves immediately.
