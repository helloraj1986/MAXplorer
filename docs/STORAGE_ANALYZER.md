# Storage Space Analyzer

MAXplorer's Storage Analyzer is a first-class analysis workspace for understanding and
safely reclaiming disk space on macOS. It is not a static dashboard: every number comes from
the real filesystem, every drill-down is backed by the current scan index, and every
destructive action is revalidated and explicitly confirmed.

Open it from:

- **Sidebar → Tools → Storage Analyzer**
- The **drive icon** in the command bar
- **Settings menu → Storage Analyzer**

The workspace is independent of the single/dual-pane browser. Opening it does not replace a
pane's location, tabs, selection, or navigation history. Closing it returns to exactly the
same browser state.

## Capabilities

### Volume overview

- Enumerates `/` and every mounted volume under `/Volumes` (plus `/Network` where present).
  On Windows it uses `Win32_LogicalDisk` through PowerShell.
- Reports real capacity from `statvfs`, including total, free, available, used, and usage
  percentage.
- Enriches macOS volumes with `diskutil info -plist`: volume name, filesystem, internal /
  external / removable / virtual classification, APFS container reference, and device node.
- Distinguishes internal, external, removable, network, and disk-image mounts.
- Explains that APFS volumes in a shared container do not own independent physical free
  space. The UI never pretends that one volume's capacity is isolated from its siblings.

### Storage usage

- A category bar and legend with real bytes, allocated bytes, file counts, and percentages.
- Categories: Applications, Documents, Photos, Videos, Audio, Downloads, Archives & disk
  images, Developer files, Virtual machines, Mail & messages, System, Caches & temporary
  files, Trash, and Other.
- Every inspected file is assigned to exactly one category (see rules below). Media inside
  an application bundle is counted as Applications, not twice.
- Keeps three figures separate:
  1. Usage reported by the filesystem.
  2. Bytes attributable to inspected files.
  3. Uninspected/system-managed space (snapshots, purgeable data, protected locations,
     nested mounts, unreadable entries, or other volumes sharing the container).
- Clicking a category opens a file view filtered to that category.

### Deep analysis

- **Folder tree**: breadcrumbs, up navigation, aggregate logical/allocated size, file and
  subfolder counts, largest contained file, modified date, and share of inspectable volume
  content.
  Folders expand on demand and can be opened as the current root.
- **Largest files**: configurable thresholds (100 MB, 500 MB, 1 GB, 5 GB), name/category/
  type/hidden filters, sorting, pagination, reveal/open/properties actions.
- **Largest folders**: ranked descendant totals, minimum-size and age filters, explicit
  explanation that a folder total includes its descendants.
- **File types**: content-oriented groups with size, file count, share, and extensions.
- **Recently changed large files** and **old large files** are derived from real
  modification timestamps; the interface states that age is not proof of uselessness.
- **Treemap**: a squarified canvas layout where area is proportional to size. It supports
  hover details, click-to-drill, breadcrumbs, keyboard region traversal, and an equivalent
  accessible region list. Only one canvas is rendered, not one DOM node per file.

### Duplicate verification

- Candidates are first grouped by file size.
- Same-size candidates are narrowed with a cheap first/last-64 KiB fingerprint.
- Only fingerprint matches are streamed through SHA-256 in 128 KiB chunks.
- A file whose size or modification time changes during hashing is excluded and counted.
- Results show every path, volume, size, modification date, whether all copies are on the
  same volume, and the recoverable estimate.
- The UI prevents selecting every copy of a group; at least one verified copy must remain.
- Hidden files are excluded by default. Cloud/synchronized, application-managed, backup,
  and version-control locations are called out in warnings.

### Cleanup recommendations

Recommendations are evidence-based and carry an explicit risk level:

- **Low risk**: regenerable development caches such as Xcode DerivedData, package-manager
  caches, and build artifacts. They are still never removed automatically.
- **Review recommended**: large downloads, old installers, large archives, old logs,
  application caches, and old large files whose usefulness is unknown.
- **High risk**: application support data, Mail data, iOS device backups, virtual-machine
  disks, databases, Docker VM storage, and similar state.

Every recommendation shows its title, reason, exact path, size, risk, reversibility, and a
note such as "prefer the owning application's cleanup command." The total is deduplicated:
if a folder and a file inside it are both selected, only the folder contributes bytes.

Recommendations are generated from real scan results plus well-known user locations:

- `~/.Trash`
- `~/Library/Caches`, `~/Library/Logs`
- `~/Library/Developer/Xcode/DerivedData`, device support, simulator data, archives
- npm, Cargo, Gradle, and Maven caches
- Android SDK, Docker VM data, iOS device backups
- `~/Library/Application Support` and `~/Library/Mail`
- `node_modules`, `target`, `.build`, and `DerivedData` folders found in the scan
- large Downloads, installers, archives, log files, databases, VM disks, and old large files

### Safe cleanup workflow

1. Select files/folders from any analysis view, or select recommendations/duplicate copies.
2. The selection bar shows item count, logical size, and risk counts. Overlapping descendants
   are collapsed before the estimate.
3. **Review cleanup** opens a confirmation dialog with every exact path, size, risk warning,
   reversibility, and permission note.
4. Actions:
   - **Move to Trash** (default).
   - **Delete permanently**, which additionally requires an explicit acknowledgement
     checkbox.
   - **Exclude from future recommendations** for a specific path. Exclusions are stored
     locally and can be restored from the Cleanup view.
   - Cancel.
5. The backend revalidates each path immediately before acting:
   - It must be part of the current scan.
   - It must still exist and have the expected file type/size/modification date.
   - Canonical resolution must remain inside the scanned volume and outside protected system
     locations.
   - Volume roots, the home folder, and unsafe roots are refused.
6. Results report completed, failed, changed, and overlapping items, plus logical reclaimed
   bytes and free-space before/after when available.
7. A successful cleanup automatically rescans the same root so statistics are refreshed. The
   report remains visible; cancellation never claims that completed removals were restored.

## Architecture

```
Sidebar / command bar ─┐
                       ├── StorageWorkspace (React)
Storage store ─────────┘
        │  typed invoke
        ▼
src-tauri/src/storage.rs
        ├── volume discovery (statvfs + mount table + diskutil)
        ├── cancellable WalkDir scan (no symlink following)
        ├── category/file-type aggregation
        ├── in-memory ScanIndex (directories + files)
        ├── cleanup recommendations
        ├── streaming SHA-256 duplicate verification
        └── revalidated delete via operations::delete_paths
```

Frontend modules:

- `src/lib/storage/types.ts` — serialized contracts, category metadata, file/directory to
  `FileEntry` adapters.
- `src/lib/storage/selection.ts` — overlap-aware cleanup accounting and duplicate-copy
  safeguards.
- `src/lib/storage/treemap.ts` — deterministic squarified layout and hit testing.
- `src/state/storageStore.ts` — volumes, scan lifecycle, progress, queries, children cache,
  selection, duplicates, cleanup, and navigation into MAXplorer.
- `src/components/storage/` — workspace, overview, tree, files, folders, types, treemap,
  duplicates, cleanup, details, and selection/review.
- `src/styles/storage.css` — token-driven light/dark and Windows/Finder presentation.

Backend contracts are all camelCase and registered in `src-tauri/src/lib.rs`.

## Scanning implementation

- Uses `walkdir` with `follow_links(false)` and a maximum depth of 96.
- `symlink_metadata` is used for every entry, so a symlink keeps its link identity and is
  never traversed.
- Nested mount points under the scan root are skipped. On `/`, this includes
  `/System/Volumes/Data` and `/Volumes/*`, preventing the same files from being counted under
  two volumes.
- Reserved filesystem metadata folders (Spotlight, fseventsd, temporary item stores, etc.)
  are skipped and counted in the scan report.
- Permission and read errors are counted and the scan continues.
- Bounded by a configurable entry cap (default 500,000; the Deep scan control raises it to
  5,000,000; hard ceiling 5,000,000) and can be cancelled by request ID. Partial results are
  reported honestly. Separate controls cover quick overview, deep scan, deep scan of the Home
  folder, rescan this folder, duplicate detection, and cancel.
- Progress events (`storage-scan-progress`) contain entries/files/folders/bytes/elapsed and
  the current path; no completion percentage is invented.
- Directory aggregates are computed bottom-up once after traversal. A directory contributes
  to exactly one parent, so nested totals are not double-counted.
- Hard links are detected with `(device, inode)` on Unix. Additional links are listed but
  their bytes are not added twice.
- Allocated size uses `st_blocks * 512` on Unix; logical size uses file length.

### Index strategy

The full file/directory index is kept **in memory for the current scan**, keyed by scan ID.
This keeps drill-down, filters, categories, and cleanup verification consistent without
writing a second large database. The search index remains the only persistent SQLite index.
Opening the analyzer shows volume capacity immediately and does not force a full scan. The
last completed result is available while the application process is running. **Clear analysis
results** in the analyzer rail discards the in-memory index. A future persistent storage index
can reuse the same contracts.

Large result lists are never sent over IPC wholesale. The backend exposes:

- `get_storage_children(scanId, path)` — one directory's direct children.
- `query_storage_files(query)` — filtered, sorted, paginated file queries.
- Top files/folders/categories/type groups in the scan result.

## Volume and filesystem calculations

| Figure | Source | Meaning |
| --- | --- | --- |
| Total capacity | `statvfs` blocks × fragment size | Filesystem-reported capacity |
| Free / available | `statvfs` free / available blocks | Available can be lower than free because of reserved space |
| Used | total − free | Filesystem-reported usage |
| Logical size | file length | What the file logically contains |
| Allocated size | `st_blocks × 512` on Unix | Disk blocks reserved for the file |
| Inspected bytes | descendant aggregate of unique files | Attributable to readable files |
| Uninspected | filesystem used − inspected allocated | When the scan is truncated, most of this is **not yet scanned**; otherwise it is snapshots, purgeable space, protected data, other APFS volumes, or unreadable paths |
| Cleanup estimate | deduplicated recommendation/selection sizes | Conservative logical estimate, not a free-space promise |

Actual free-space change is measured with `statvfs` before and after cleanup when possible.
APFS snapshots, clones, compression, sparse files, and hard links mean the delta can differ
from the logical estimate.

## Categorization rules

Location evidence takes precedence over extension evidence:

1. `.Trash` / `.Trashes` → Trash.
2. `Library/Caches`, `Library/Logs`, `/var/folders`, `/tmp`, `/private/tmp` → Caches.
3. Xcode/package-manager/build directories → Developer.
4. VM extensions and VM directories → Virtual machines.
5. Application bundles/frameworks and `/Applications` → Applications.
6. Mail/Messages containers and `Library/Mail` → Mail.
7. `/System`, `/usr`, `/bin`, `/sbin`, system databases, `/Library` → System.
8. Downloads folders → Downloads.
9. Extensions → Photos, Videos, Audio, Archives, Documents, or Other.

File-type groups are separate from location categories and use extension/path metadata:

Videos, Images, Audio, PDF, Documents, Archives, Disk images, Applications, Developer,
Virtual machines, Databases, Fonts, Other.

No file is opened or executed for classification. The only byte reads are explicit
duplicate verification.

## Permissions and privacy

- Analysis is entirely local. No filenames, paths, hashes, or storage reports are uploaded.
- The application is not sandboxed in this build. macOS TCC still applies to Desktop,
  Documents, Downloads, removable volumes, and network volumes.
- Missing access is reported as a permission error with a clear suggestion to grant Full
  Disk Access only if the user chooses. The analyzer never requests administrator rights and
  never escalates privileges.
- System-protected locations are refused for deletion even if selected from a table.
- Filenames are treated as untrusted display data. The UI uses text nodes and `title`
  attributes, never HTML injection.
- Symbolic links are not followed during scanning or duplicate traversal.
- Paths are canonicalized during deletion revalidation to prevent traversal outside the
  scanned root.

## Known limitations

- APFS snapshots, System Data, purgeable space, and some application-managed storage cannot
  be attributed to individual files. They are shown as uninspected rather than invented.
- The macOS root and Data volumes share an APFS container. Filesystem usage reported for `/`
  can include container-wide usage even though `/System/Volumes/Data` is deliberately skipped
  as a nested mount. This is why the overview can show a large “not scanned / system-managed”
  remainder.
- A full-volume scan of `/` can be slow, hit the entry cap, and report permission errors for
  protected areas. A truncated scan labels the remainder as **not scanned**, not as hidden
  files or recoverable space. Run Deep scan, Deep scan Home folder, or scan a narrower folder
  for deeper coverage.
- The in-memory index is not persisted across application restarts.
- The analyzer recognizes common developer/application locations but does not execute each
  tool's native cleanup command. Where known, recommendations say to use the owning tool.
- Cloud placeholders are identified conservatively (for example `*.icloud`) and are never
  downloaded. A placeholder's logical size may not equal local disk usage.
- Directory modification dates describe the directory entry, not descendants. File cleanup
  revalidates type, size, and modification date; directory cleanup revalidates identity,
  existence, and directory date, but does not re-walk every descendant immediately before
  deletion. The review always operates on the exact folder selected.
- Duplicate detection reads candidate contents and can be I/O-heavy; it is optional and
  bounded by candidate limits.
- Network volume latency and server-side restrictions can make scans much slower.
- The treemap shows a directory's direct children; drill in for deeper levels.

## Testing

Rust tests (`cargo test --manifest-path src-tauri/Cargo.toml`):

- Nested aggregation and category uniqueness.
- Large synthetic tree (1,200 files / 40 folders).
- Cancellation before and during a scan.
- Symlinks are listed, not followed.
- Unreadable directories are reported without aborting.
- Duplicate detection confirms content and rejects same-size different content.
- Cleanup recommendations are risk-labelled; the deduplicated total is computed separately.
- Changed files are rejected immediately before deletion.
- Overlapping selections are collapsed.
- Protected system paths and symlinks resolving outside the scan root are refused.
- Real volume capacity is internally consistent.
- All destructive tests use `tempfile` directories and permanent deletion only inside them.

Frontend tests:

- Overlap-aware selection accounting, duplicate-copy safeguards, recommendation dedup.
- Treemap bounds, proportions, zero-size handling, hit testing, and many-item stability.
- Workspace rendering, cleanup navigation, no-scan state, and explicit permanent-delete
  acknowledgement.
- Full suite: `npm test` (266 tests), `npm run typecheck`, `npm run build`.

Manual validation checklist:

1. Open the analyzer from all three entry points; confirm the browser's panes/tabs remain.
2. Switch volumes; verify capacity matches Finder/System Settings.
3. Run a scan on a disposable folder; confirm progress, cancel, and partial labelling.
4. Expand folders, open largest files/folders, filter by category/type/size.
5. Hover/click/keyboard-navigate the treemap; verify breadcrumbs and accessible list.
6. Run duplicate detection on a folder with known identical and same-size/different files.
7. Select overlapping recommendations; verify the deduplicated total.
8. Review cleanup, cancel once, then move a disposable file to Trash.
9. Confirm the report, automatic rescan, and refreshed totals.
10. Switch light/dark and Windows/Finder themes; resize to the minimum window width.

## Future enhancements

- Persist a versioned storage index in SQLite with incremental directory rescans and
  filesystem change notifications.
- Add APFS snapshot inventory and supported snapshot-management actions.
- Add native application uninstall attribution (bundle + support/cache/log footprint).
- Offer tool-specific cleanup for Xcode, Docker, Simulator, and package managers.
- Add per-category virtualized treemap caches for very large directories.
- Add an optional, disabled-by-default assistant that explains recommendations; any such
  feature must remain local and explicit about data handling.
