# MAXplorer Search — Audit, Root Cause and Repair Plan

Status: Phase 1 complete (measured on the development machine, 2026-11-06).
Scope: `src/components/search/`, `src/state/searchStore.ts`, `src/lib/search/`,
`src-tauri/src/search/`, `src-tauri/src/commands.rs`.

## 1. What exists today

Search is not missing; it is over-built in one dimension and unguarded in another.

| Layer | Implementation |
| --- | --- |
| UI | `SearchOverlay` (Quick Search), `SearchWorkspace`, `SearchFilters`, `SearchResults`, `SearchPreview`, `IndexingDashboard`, `DuplicateResults` |
| Orchestration | `src/state/searchStore.ts` — debounce, scope resolution, progressive merge, history, saved searches |
| Query language | `src/lib/search/interpreter.ts` — deterministic parser for kinds, extensions, sizes, dates, locations, exclusions |
| Backend | `src-tauri/src/search/` — SQLite index (`engine.rs`), extractor (`extract.rs`), indexer + FSEvents watcher (`indexer.rs`), live walk + `mdfind` (`live.rs`), Tauri commands (`mod.rs`, `commands.rs`) |
| Providers | Tier 1 SQLite index (name/path/metadata/FTS5 content), Tier 2 bounded filesystem walk, Tier 3 macOS Spotlight via `mdfind` |

The architecture already matches the target described in the brief. The defect is in
execution cost and index hygiene, not in missing features.

## 2. Root cause of the permanent spinner

Measured against the live index on this machine
(`~/Library/Application Support/com.replica.win11explorer/search/index.sqlite3`):

```
rows total .......... 6,350,597
rows (files) ........ 6,309,160
rows (content) ......   180,936
database size ....... 20 GB  (page_count 5,153,957 × 4096)
locations ........... 1  (/Users/<user>, status "partial")
```

```
SELECT COUNT(*) FROM files WHERE is_dir = 0;                           47.27 s
SELECT ... WHERE name_lower LIKE '%resume%' OR path_lower LIKE '%resume%' LIMIT 50000;
                                                                       49.89 s
SELECT substr(path,1,40), COUNT(*) FROM files GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
                                                                       29.31 s
```

94.5 % of the index — 6,003,687 rows — is a single directory:
`~/.local/share/opencode` (a tool-generated data/cache tree). The remainder is
`~/.lmstudio`, `~/.vscode`, `~/.gradle`, `~/.nvm`, `~/.nuget`, `~/.hermes/cache`,
`node_modules`, and similar machine-generated trees.

### The failure chain

1. `live::should_skip_directory()` only rejects a short hard-coded list
   (`node_modules`, `Library`, `.cache`, `.cargo`, …). It does **not** reject other
   dot-directories, so the indexer walked `~/.local`, `~/.lmstudio`, `~/.gradle`,
   `~/.nvm`, `~/.nuget`, `~/.vscode`, `~/.hermes`, `~/.codex` and indexed 6.3 M files.
2. `SearchService::execute_search()` calls `self.status()` on **every** query.
   `status()` runs five unindexed `COUNT(*)` aggregates plus a per-location
   `COUNT(*)` pair. On this database that is **≈47 s per aggregate, per keystroke**.
3. `query_name_candidates()` builds `name_lower LIKE '%term%' OR path_lower LIKE '%term%'`.
   A leading wildcard cannot use `idx_files_name_lower`, so it is a full scan of
   6.3 M rows: **≈50 s**.
4. The frontend debounces at 140 ms and fires `universal_search` per pause. Each new
   query starts a fresh `spawn_blocking` task with its own read connection while the
   previous 50-second scan is still running. Queries pile up, each pinning a WAL read
   snapshot, so the WAL cannot checkpoint and the page cache thrashes.
5. `cancel` is only checked *between* providers and *between* candidate rows. A
   `rusqlite` statement already executing cannot be interrupted, so cancellation does
   nothing for the 50 seconds that matter.
6. `runSearchNow()` sets `loading: true` and clears it only on `progress.done` or on
   the awaited response. Nothing in the UI has a timeout. The spinner therefore spins
   for as long as the backend takes — which is effectively forever.
7. Because `scan_entries()` aborts whenever the window is focused, the location is
   permanently marked `"partial"`. That keeps `includeLive` true for every query, so
   each search *also* walks the filesystem, on top of the 97 seconds of SQL.

Root cause in one sentence: **the index has no exclusion policy and no size guard, so
it holds 6.3 M junk rows; every keystroke then runs unindexed full-table aggregates and
leading-wildcard scans against it, with no statement-level cancellation and no UI
timeout.**

## 3. Secondary defects found during the audit

| # | Defect | Impact |
| --- | --- | --- |
| 1 | `files.content` stored inline in the `files` table | 20 GB database; every scan reads wide pages |
| 2 | `status()` used as a per-query health probe | 47 s × 5 per query |
| 3 | `location_coverage()` runs `COUNT(*)` per location per call | scales with locations × rows |
| 4 | `mdfind` invoked via `Command::output()` with no timeout | can block a search indefinitely when `mdworker` is busy |
| 5 | `mdfind` runs unscoped when the scope has more than one root | searches the whole machine |
| 6 | `CANDIDATE_LIMIT = 50_000` materialised into a Rust `HashMap` before ranking | hundreds of MB per query |
| 7 | No statement progress handler / `sqlite3_interrupt` | cancellation is cosmetic |
| 8 | No backend query deduplication | N overlapping scans for N keystrokes |
| 9 | Indexer has no per-scan entry cap | one pathological tree can own the index |
| 10 | `finish_scan(complete=false)` never reconciles stale rows | junk rows are permanent |
| 11 | No way to prune/compact from the UI | 20 GB is unrecoverable without manual work |
| 12 | `partial` status is permanent while the app is focused | live walk on every query, forever |

## 4. Design decisions

**Keep the three-tier model.** It is correct; it needs cost control, not replacement.

1. **Index hygiene (Tier 1 correctness).** A single shared exclusion policy used by the
   indexer, the live walker, the FSEvents filter and the Spotlight post-filter:
   any dot-directory, plus `node_modules`, `target`, `dist`, `build`, `out`, `Library`,
   `Caches`, `Pods`, `__pycache__`, `.venv`, `venv`, and bundle packages
   (`.app`, `.framework`, `.bundle`, `.photoslibrary`). Plus a hard per-location entry
   cap so no single tree can own the index.
2. **O(1) status.** Counters are materialised into `meta`/`location_counts` by the
   indexer and read as point lookups. `status()` becomes a handful of primary-key reads.
3. **Substring search that can use an index.** A second FTS5 table with
   `tokenize='trigram'` over `(name, path)` gives `%term%` semantics at index speed for
   terms of three or more characters. Shorter terms and case-sensitive queries keep the
   `LIKE`/`instr` path, now bounded by an explicit candidate cap.
4. **Real cancellation.** A `rusqlite` progress handler checks the query's cancel token
   every N VM steps, so a superseded query aborts inside SQLite instead of running to
   completion.
5. **Single in-flight query per service.** A newer query cancels the previous one before
   it starts, and the backend refuses to run two scans of the same scope concurrently.
6. **Bounded total latency.** Each search has a wall-clock budget; providers stop at the
   budget and report a partial result with an explicit note rather than hanging.
7. **The UI can never spin forever.** A frontend watchdog clears the spinner and shows
   partial results or an error if the backend does not report completion.

## 5. What changes

Backend (`src-tauri/src/search/`):

- `live.rs` — unified exclusion policy, `mdfind` with a hard timeout and per-root scope.
- `engine.rs` — schema v2 (`files_name_fts` trigram, `location_counts`), cached
  counters, trigram name/path queries, progress-handler cancellation, `prune_excluded`,
  `optimize`.
- `indexer.rs` — exclusion policy applied to the walker, per-scan entry cap, counter
  refresh, stale-row reconciliation on partial scans.
- `mod.rs` — single in-flight query, per-query deadline, cheap status, partial-result
  reporting.
- `commands.rs` — `prune_search_index`, `optimize_search_index`, `search_index_health`.

Frontend:

- `src/state/searchStore.ts` — watchdog, supersede-on-new-query, partial-result state.
- `src/components/search/IndexingDashboard.tsx` — database size, junk-row prune, compact.
- `src/styles/search.css` — states for the new progress/partial affordances, theme tokens only.

## 6. Measured baseline (before)

| Metric | Value |
| --- | --- |
| Search initiation latency (`resume`, warm) | 47 s+ (status aggregates alone) |
| Time to first result | never observed (spinner) |
| Index size | 20 GB |
| Indexed rows | 6,350,597 (94.5 % junk) |
| Cancellation responsiveness | none during SQL execution |

Post-fix numbers are recorded in `docs/UNIVERSAL_SEARCH.md` after the benchmark run.
