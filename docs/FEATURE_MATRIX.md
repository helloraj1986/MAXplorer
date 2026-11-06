# Feature matrix

Status vocabulary:

- **Verified/implemented** — reference behavior observed and MAXplorer implements it;
  exercised in the running app and/or covered by tests.
- **Implemented** — implemented from observed geometry/structure or an explicit informed
  approximation; code and unit tests pass, but not every state was captured.
- **Informed approximation** — reference not directly available (e.g. 21H2 has no tabs).
- **Partial** — an honest subset is implemented.
- **Unsupported** — intentionally not implemented, not shown as a fake control.
- **Blocked** — code exists but runtime verification requires macOS access unavailable here.

| Area | Feature | Reference evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| Branding | Product identity | Explicit request | Implemented | MAXplorer name, tagline, brand statement and description centralised in `src/lib/branding.ts` |
| Branding | Application icon | Design request | Verified/implemented | Original folder + M artwork; ICNS/ICO/PNG generated; bundle icon inspected |
| Branding | About screen and native menu | Explicit request | Verified/implemented | Icon, name, tagline, metadata version, description; native About opens the themed dialog |
| Branding | Theme-independent identity | Explicit request | Verified/implemented | Same name, icon, About screen and metadata in both Windows and Finder themes |
| Shell | Custom title bar and caption buttons | Screenshot | Verified/implemented | Windows-style controls on the right |
| Shell | Tabs with independent location/history | 22H2 design; 21H2 host has none | Informed approximation | Create, close, switch, duplicate, drag-reorder, restore |
| Shell | Tab overflow flyout | 22H2 design | Unsupported | Tabs scroll horizontally instead |
| Shell | Window resizing/min size | UIA + screenshots | Implemented | Min 760×520; CSS responsive breakpoints |
| Shell | Minimize/maximize/restore/close | Screenshot + interaction | Verified/implemented | Maximize to work area + restore glyph + close verified on Windows release; minimize same Tauri path |
| Command bar | New, cut, copy, paste, rename, share, delete | UIA | Verified/implemented | All disabled/enabled states wired; unified command bar tests cover selection states |
| Command bar | Sort and View wide buttons | UIA | Verified/implemented | Menus mirror captured items |
| Command bar | One global command center | Explicit request | Implemented | File ops, organization, workspace, and Settings in one bar; component tests |
| Command bar | Column configuration | Explicit request | Implemented | Show/hide Date/Type/Size and reset widths; persisted |
| Command bar | Responsive labels and overflow | Explicit request | Implemented | Measured regular/compact/narrow tiers; low-priority commands move into Settings |
| Command bar | Dual-pane toggle in command bar | Explicit request | Implemented | Split control + workspace menu; removed from window corner |
| Command bar | Settings menu | Screenshot | Implemented | One Settings entry plus Universal Search, Terminal, selection commands, About; no duplicate section links |
| Navigation | Back / forward / up / refresh | UIA + interaction | Verified/implemented | Per-tab history; refresh re-reads disk |
| Navigation | Breadcrumbs | UIA + screenshots | Verified/implemented | Clickable root + segments |
| Navigation | Editable address bar | Interaction | Verified/implemented | Absolute paths, `~`, invalid-path inline error |
| Navigation | Address dropdown | Interaction | Implemented | Copy address / edit / copy as text |
| Navigation | Dedicated navigation/search layer | Explicit request | Implemented | Back/forward/up/refresh, breadcrumbs, editable address, search kept in one row |
| Tabs | Dedicated Layer 3 tab row | Explicit request | Implemented | Single global row; per-pane rows in dual-pane mode |
| Tabs | All-tabs overflow menu | Explicit request | Implemented | Lists every tab and exposes new/duplicate/close/close-others |
| Tabs | Narrow-window tab handling | Explicit request | Implemented | Tabs scroll horizontally; all tabs remain reachable from the menu |
| Tabs | Active pane and tab indication | Explicit request | Implemented | Pane badge, active-tab state, thin top accent in dual-pane mode |
| Settings | Consolidated Settings dialog | Explicit request | Implemented | Appearance, Display, Layout, Behavior, Keyboard, Advanced; one dialog state |
| Settings | Display scaling and density | Explicit request | Implemented | Text size, icon size, compact rows, defaults persisted; compact metrics unit-tested |
| Settings | Layout and behavior preferences | Explicit request | Implemented | Sidebar visibility, command-bar labels, folder-open behavior, Trash confirmation |
| Settings | Settings entry points | Explicit request | Implemented | Command-bar Settings menu and `Mod+,`; sidebar Appearance removed |
| Sidebar | Navigation-only scope | Explicit request | Implemented | Appearance/theme footer removed; Home/pins/locations retained |
| Sidebar | Collapse/restore | Explicit request | Implemented | Command-bar toggle and `Mod+B`; visibility persisted |
| Search | Recursive name search | Search box observed | Implemented | Contextual folder search: bounded 500 results/8 s/200k entries |
| Search | Universal indexed search | Explicit request | Implemented | SQLite index + FTS5 content + trigram name index; three providers with a 5 s query budget |
| Search | Content/index search | Not observed | Implemented | Extracted text for text/Markdown/JSON/HTML/CSV/code/PDF/DOCX/XLSX/PPTX; OCR not supported |
| Search | Search index hygiene | Explicit request | Implemented | Dot-directories, package caches, bundles and build output excluded; prune + compact actions |
| Search | Progressive results and cancellation | Explicit request | Implemented | Per-provider progress events; statement-level cancellation; UI watchdog prevents an endless spinner |
| Search | Natural-language query interpreter | Explicit request | Implemented | Kinds, extensions, sizes, dates, locations, exclusions, content phrases as editable chips |
| Sidebar | Home / Quick access | 21H2 nav pane | Implemented | Default real folders shown on Home |
| Sidebar | Pinned folders | Screenshot | Implemented | Pin/unpin; persisted |
| Sidebar | Desktop, Downloads, Documents, Pictures, Music, Videos | Screenshot | Verified/implemented | Real `dirs` locations |
| Sidebar | This PC / drives | Screenshot + UIA | Implemented | This Mac + `/Volumes` on macOS; dev host shows drives |
| Sidebar | Resize | Screenshot divider | Implemented | Drag handle; persisted |
| Sidebar | Gallery | 22H2+ | Unsupported | No equivalent macOS library mapping |
| Listing | Details view + columns | UIA + screenshot | Verified/implemented | 25 px header, 31 px rows, 272/144/120/80 columns |
| Listing | List view | Screenshot | Verified/implemented | 22 px rows |
| Listing | Large icons | Screenshot + UIA | Verified/implemented | 96 px image container, 105 × 116/131 cells |
| Listing | Medium icons | View menu | Implemented | 40 px icons |
| Listing | Small icons | View switch | Verified/implemented | 16 px icons |
| Listing | Extra large icons | View menu | Implemented | 160 px icons |
| Listing | Tiles | View menu | Implemented | 48 px icon + name/type/size |
| Listing | Content | View menu | Implemented | 32 px icon + name/type/date/size |
| Listing | Column resize | Screenshot | Implemented | Drag dividers; persisted |
| Listing | `.app` bundle icons | Fixture + screenshot | Implemented | Real ICNS/PNG icon via `read_app_icon`; generic fallback |
| Icons | Functional chrome icons | Design system request | Implemented | Lucide named imports; shared 12–24 px sizes, 1.75 px optical stroke, tone tokens |
| Icons | File-type registry | Design system request | Implemented | Documents, images, media, archives, disk images, dev files, apps, fonts, certificates, databases, config, unknown fallback |
| Icons | Folder artwork | Design system request | Implemented | Windows gold and Finder blue folders; standard/open/selected/shared/favourite/downloads/network/special variants |
| Icons | Storage artwork | Design system request | Implemented | Internal/external/removable/network/mounted/disconnected variants; connection dot separate |
| Icons | Image thumbnails | Design system request | Implemented | Lazy asset-protocol images, bounded URL/failure caches, category fallback |
| Icons | Transfer status indicator | Design system request | Implemented | Wired to real transfer state only; no fake sync engine |
| Listing | Sort by name/date/type/size | Sort menu | Verified/implemented | Asc/desc; folders first |
| Listing | Group by type/date/size | Sort > Group by | Implemented | Group headers in details/list/grid |
| Listing | Column filter dropdowns | Hover arrows visible | Unsupported | Sorting/resizing only |
| Listing | Hidden files | View > Show | Implemented | macOS dot/UF_HIDDEN; Windows attribute |
| Listing | File name extensions toggle | View > Show | Implemented | Persisted |
| Listing | Virtualization | Not visible in static ref | Implemented | Detail/list/grid virtual rows |
| Listing | Large-directory truncation | Not observed | Implemented | 50,000-entry backend cap + banner |
| Selection | Single, Ctrl/Cmd-click, Shift-range | Standard Explorer | Verified/implemented | Click selected a row in the app |
| Selection | Select all, keyboard nav | Standard Explorer | Implemented | Arrow/Home/End/PageUp/Down/type-ahead |
| Selection | Drag marquee | Standard Explorer | Implemented | Rectangle intersects visible rows |
| Selection | Selection preserves across sort/refresh | Standard Explorer | Implemented | Path-based; pruned after refresh |
| File ops | Create folder | Standard Explorer | Verified/implemented | Created/renamed a test folder |
| File ops | Create text file | New menu | Implemented | Immediate + rename prompt |
| File ops | Create shortcut | Context menu | Implemented | Real symlink/alias on macOS |
| File ops | Copy / cut / paste | Standard Explorer | Verified/implemented | Copy exercised in a test folder; cut+paste confirmed as a real move from macOS `transferHistory`; cut entries are dimmed and source panes reload after a move |
| File ops | Rename | Context menu / F2 | Verified/implemented | Prompt validation + conflict error |
| File ops | Move | Standard Explorer | Implemented | Same-volume rename or copy+delete fallback |
| File ops | Duplicate | Context menu | Implemented | "` - Copy`" naming |
| File ops | Delete to Trash | Standard Explorer | Verified/implemented | Confirmed and moved to Trash |
| File ops | Permanent delete | Shift+Delete | Implemented | Strong confirmation; backend tested |
| File ops | Name conflicts | Standard Explorer | Implemented | Replace / Keep both / Skip / Cancel |
| File ops | Send to Desktop/Documents/Downloads | Context menu | Implemented | Real move destinations |
| File ops | Drag to folder / sidebar | Standard Explorer | Implemented | Move by default, Option copies |
| File ops | OS file drop into app | Standard Explorer | Implemented | Copies into current folder |
| File ops | Byte-level progress | Standard Explorer | Partial | Indeterminate overlay only |
| File ops | Undo delete | Blank menu shows Undo Delete | Unsupported | No undo stack; confirmation only |
| File ops | Compressed folder creation | New menu | Unsupported | No compression control |
| Context menus | File context menu | Screenshot | Verified/implemented | Open/open-with/new tab/pin/copy path/share/cut/copy/shortcut/duplicate/send/delete/rename/properties |
| Context menus | Blank context menu | Screenshot | Verified/implemented | Paste/View/Sort/Group/Refresh/New/Properties/Terminal |
| Context menus | Submenus | View/Sort/New/context | Implemented | Hover-open, edge-flip |
| Context menus | Third-party shell extensions | Screenshot (Notepad++, 7-Zip, etc.) | Unsupported | Not part of Explorer; omitted |
| Details pane | File metadata / icon | Screenshot | Verified/implemented | Date modified/created, size, type, location |
| Details pane | Folder summary | Screenshot | Verified/implemented | Item count, location, total direct-file size |
| Details pane | Multi-selection | Standard Explorer | Implemented | Count, size, list |
| Preview pane | Image preview | Standard Explorer | Verified/implemented | Real thumbnail/preview via asset protocol |
| Preview pane | Text preview | Standard Explorer | Verified/implemented | Bounded 128 KB preview |
| Preview pane | PDF/Quick Look | Standard Explorer | Unsupported | No PDF renderer |
| Properties | General tab | Windows properties | Verified/implemented | Permissions/owner on macOS; folder size scan |
| Properties | Security/Details tabs | Windows properties | Unsupported | General only |
| Open With | App chooser | Windows Open With | Blocked | macOS `.app` list implemented; needs macOS run |
| Share | Native share sheet | Windows Share | Partial | Copies path + Reveal in Finder action |
| Themes | Interface themes: Windows 11 / macOS Finder | Windows reference + macOS HIG | Verified/implemented | Settings → Appearance and command-bar quick switch; live switch without remount or filesystem reload |
| Themes | Dark / light / system appearance | Captured both | Verified/implemented | Independent from the interface theme; applies to both |
| Appearance Platform | Create Your Theme entry point | Explicit request | Implemented | Prominent action in Settings → Appearance; opens the guided creator |
| Appearance Platform | Guided six-step creator | Explicit request | Implemented | Name, Look, Colours, Style, Icons, Preview & Save; optional steps and early save |
| Appearance Platform | Starting options | Explicit request | Implemented | Blank, copy current, Windows/Finder, 10 palettes, 12 visual templates |
| Appearance Platform | Colour customisation | Explicit request | Implemented | Visual pickers for accent, selection, background, panel, sidebar, text; automatic matching |
| Appearance Platform | Contrast validation | Explicit request | Implemented | WCAG ratio display, warning, and one-click automatic repair |
| Appearance Platform | Style controls | Explicit request | Implemented | Corners, density, borders, elevation, text/icon size, sidebar and toolbar treatment |
| Appearance Platform | Independent icon packs | Explicit request | Implemented | 5 built-in packs; per-theme or app-wide selection; `.maxIcons` import/export |
| Appearance Platform | Live full-interface preview | Explicit request | Implemented | Toolbar, tabs, sidebar, address bar, list, grid, context menu, selection, dual pane |
| Appearance Platform | Save / edit / duplicate / rename / delete | Explicit request | Implemented | Library actions; duplicate isolation; delete confirmation |
| Appearance Platform | Export / share / import packages | Explicit request | Implemented | `.maxTheme` export to Downloads, clipboard share, validated preview then install |
| Appearance Platform | Drafts, undo, and resets | Explicit request | Implemented | Automatic draft save/recovery, undo/redo, section reset, confirmed full reset |
| Appearance Platform | Simple and Advanced modes | Explicit request | Implemented | Visual default; curated token editor, package id, and validation details |
| Appearance Platform | Description-based generation | Explicit request | Implemented | Optional offline style matcher; normalized schema; no account, key, or network |
| Appearance Platform | AI-agent theme authoring | Explicit request | Implemented | Strict JSON `.maxTheme`; agent guide; ignored `_comments`; validator script |
| Persistence | Custom theme library, icon packs, drafts | Explicit request | Implemented | `maxplorer-appearance-v1` and `maxplorer-theme-draft-v1`; tolerant readers |
| Theming | Selected/hover/pressed/focus/disabled states | Captured core states | Implemented | CSS tokens; shared focus-visible rules |
| Theming | Finder traffic lights / toolbar / source list | macOS HIG | Implemented | Real Tauri window APIs; CSS/SVG recreation, not AppKit |
| Theming | Finder column view / Quick Look / tags | macOS HIG | Unsupported | Not shown as fake controls |
| Persistence | Tabs/history/view/sort/columns/sidebar/themes | Standard Explorer | Verified/implemented | localStorage; window bounds persisted |
| Persistence | Display/layout/behavior preferences | Explicit request | Implemented | Text/icon scale, density, column visibility, labels, sidebar visibility, folder-open, confirmations; legacy fallback tested |
| Persistence | Theme restored without a wrong-theme flash | Requirement | Implemented | Inline pre-paint bootstrap + store seeding |
| Persistence | Window size/position | Standard Explorer | Implemented | Restored and clamped to screen |
| macOS | TCC usage descriptions | N/A | Implemented | Desktop/Documents/Downloads/volumes Info.plist keys |
| macOS | Real filesystem browsing | Required | Verified on Windows + macOS smoke | Same Rust code; macOS CI Home showed real `/Users/runner` paths |
| macOS | Full interactive workflow on macOS | Required | Manually verified, not automated | Owner ran the app successfully on a Mac (2026-10-28); clicking/menus/ops exercised on Windows; no macOS UI automation yet |
| macOS | `.app` bundles open as applications | Finder package semantics | Implemented | Double-click launches via `open`; not treated as a folder |
| macOS | Finder reveal / Terminal / volumes | N/A | Implemented | `open -R`, `open -a Terminal`, `/Volumes` |
| macOS | Native mac app launch/package | Required | Verified build + launch | Universal DMG built; app launched and screenshotted on macOS 14 CI; full interaction not automated |
| macOS | DMG artifact | Required | Verified build | `v0.1.0` universal DMG, ad-hoc signed, checksum matches, smoke-launched |
| macOS | Runtime Home/real filesystem smoke | Required | Verified on macOS 14 CI | App process alive; `/Users/runner` quick-access paths shown |

## Deliberate deviations

1. **Third-party shell extensions are not recreated.** The reference host had Notepad++,
   7-Zip, Tailscale, Resilio, GpgEX, and Defender entries. Those are not Explorer features
   and cannot be ported faithfully to macOS.
2. **This PC is labeled This Mac on macOS**, and drives map to `/Volumes`.
3. **Quick access is a Home surface** because the 21H2 reference had no 22H2 Home. It uses
   real macOS home folders and app-maintained recents.
4. **Native window captions are Windows-style in the Windows theme and macOS-style traffic
   lights in the Finder theme.** Both are CSS controls backed by the same Tauri window APIs;
   they are not AppKit buttons.
5. **Share and Open With** are the two areas where macOS integration is intentionally
   partial or unverified rather than faked.
6. **Finder theme scope**: list/icon views, toolbar, sidebar, menus, selection, and
   typography are recreated. Finder-specific column view, Quick Look, tags, and native
   materials are not implemented and are not shown.

## Theme parity checklist

The themes are presentation-only: both render the same components, store, and Rust
commands. "Shared code" means the Finder theme uses the same path but that workflow was
not separately re-exercised in this pass; "Exercised" means it was run in the running app
in that theme.

| Feature | Windows theme | Finder theme | Evidence |
| --- | --- | --- | --- |
| Directory navigation | Exercised | Exercised | Same store/`navigate`; fixture and temp directory opened in both |
| Back / forward / up / refresh | Shared code | Shared code | Same `NavigationBar` controls; history covered by unit tests |
| Breadcrumbs / editable address | Exercised | Exercised | Same component, restyled; address navigation used in both |
| Search and filtering | Exercised | Exercised | Same search box/store action; query + 17 results preserved across a switch |
| Selection / multi-selection | Exercised | Exercised | Same row handlers; path-based selection preserved |
| Sorting / grouping | Shared code | Shared code | Same command and context menus |
| View switching (8 modes) | Exercised | Exercised | Same view buttons/menus; details/list/icons captured in both |
| Create folder / text file / shortcut | Shared code | Shared code | Same store actions |
| Copy / cut / paste / move | Shared code | Shared code | Same Rust operations |
| Rename / duplicate / delete | Exercised (rename) | Exercised (rename) | Rename via F2 in Windows, result and selection checked in Finder |
| Tabs (new/close/switch/reorder) | Shared code | Shared code | Same tab state, restyled; one restored tab exercised in both |
| Drag-and-drop (internal + OS) | Shared code | Shared code | Same handlers and payloads |
| Context menus | Exercised | Exercised | Same `MenuPanel` items, Finder styling |
| Keyboard shortcuts | Shared code | Shared code | Single global shortcut map; theme cards keyboard-exercised |
| File metadata / properties | Shared code | Shared code | Same panes/dialogs |
| Error handling / permissions | Shared code | Shared code | Same API error normalization |
| Theme persistence | Exercised | Exercised | Finder + dark + list view restored after restart |

Not re-tested interactively in the Finder theme on macOS: native TCC prompts, OS-level
drag-and-drop from Finder, and Open With. The Windows dev build exercises the shared code
paths; see [VALIDATION.md](VALIDATION.md) for the exact boundary.


## Dual-pane mode

| Area | Feature | Reference evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| Dual pane | Two independent panes with tabs, history, address bars, sorting, filtering, selection, and errors | Standard dual-pane file managers; explicit request | Implemented | `panes.left` / `panes.right`; single-pane renders the left pane |
| Dual pane | Dedicated per-pane navigation and tab rows | Explicit request | Implemented | Navigation above tabs in each pane; active pane marked by a token-driven inset accent border |
| Dual pane | Command-bar mode toggle and workspace controls | Explicit request | Implemented | Split toggle plus copy/move, sync navigation, comparison, sidebar visibility |
| Dual pane | High-visibility theme-aware divider with slim visual line and wide pointer target | Explicit request | Implemented | `PaneDivider`; 2 px line inside 14 px hit area by default, token-driven colours |
| Dual pane | Draggable divider, keyboard resize, double-click reset, collapse/restore | Explicit request | Implemented | Ratio clamped 0.18–0.82 plus 300 px preferred minimum; both panes cannot collapse |
| Dual pane | Divider theming and imported-theme compatibility | Explicit request | Implemented | Semantic tokens plus optional `components.paneDivider`; legacy themes inherit safe defaults |
| Dual pane | Active-pane indication | Explicit request | Implemented | Theme-driven inset accent border by default; optional top line, header tint, or none |
| Dual pane | Divider pointer/keyboard accessibility | Explicit request | Implemented | Separator ARIA semantics, arrow/Home/End/Enter, Shift large step, focus ring, pointer-cancel cleanup |
| Dual pane | Divider position persistence | Explicit request | Implemented | Existing `splitRatio`; transient window clamps do not overwrite the saved preference |
| Dual pane | Mode switching with preserved state | Explicit request | Implemented | Switching to single-pane keeps both pane snapshots |
| Dual pane | Persistence of mode, pane folders/tabs, divider, sync preference, shortcuts, transfer history | Explicit request | Implemented | Version-1 snapshot extended with optional fields; legacy snapshots remain readable |
| Dual pane | Active-pane shortcuts | Explicit request | Implemented | Tab switches panes in the file list; F5/F6 copy/move; Enter/Cmd+A/Cmd+R are pane-scoped |
| Transfers | Streaming copy/move with conflicts, progress, speed, ETA, pause/resume/cancel/retry | Explicit request | Implemented | Rust `transfer.rs`; temp files; no silent overwrite; recursive guard |
| Transfers | Copy-vs-move drag feedback and drop highlights | Explicit request | Implemented | Alt/Meta = copy; folders, blank space, Home, and pane tabs accept drops |
| Transfers | Cut/paste feedback across panes | Standard Explorer | Implemented | Cut entries dim; a completed move reloads every pane showing a source folder, so the move cannot read as a copy |
| Comparison | Read-only folder comparison, differences filter, optional content verification | Explicit request | Implemented | Rust `compare.rs`; comparison dock; no mutation commands |
| Comparison | Row indicators in both panes | Explicit request | Implemented | Left-only / right-only / size / date / content dots |
| Sync navigation | Relative folder mapping, disabled by default | Explicit request | Implemented | `deriveSyncAnchors` + `mapSynchronizedPath`; no-op on invalid mappings |
| Tests | Temp-directory coverage for transfer/compare and pure helper tests | Explicit request | Implemented | Rust and frontend suites cover the feature; counts are recorded per development phase |
| Tests | Divider geometry, pointer/keyboard, cleanup, theming, fallback and import tests | Explicit request | Implemented | `divider.test.ts`, `PaneDivider.test.tsx`, `divider-theme.test.ts` |

## Diagnostics

| Area | Feature | Reference evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| Diagnostics | Rotating local log | Explicit request | Implemented | App-data `logs/maxplorer.log`; 8 MB rotation; `npm run logs` |
| Diagnostics | Rust panic capture | Explicit request | Implemented | Panic hook records thread, location, message, forced backtrace; release unwinds |
| Diagnostics | Background task containment | Explicit request | Implemented | Storage tasks and content extraction convert panics into errors instead of process aborts |
| Diagnostics | Frontend error capture | Explicit request | Implemented | Global error/rejection handlers + React error boundary with log path |
| Diagnostics | User access to logs | Explicit request | Implemented | Settings → Reveal diagnostic log; error screen Reveal log action |
| Diagnostics | PDF UTF-8 crash fix | Found by diagnostics | Implemented | `extract_pdf` truncates at a character boundary; regression test added |

## Storage Space Analyzer

| Area | Feature | Reference evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| Entry | Dedicated analyzer workspace | Explicit request | Implemented | Sidebar Tools row, command-bar drive button, Settings menu; independent of pane/tab state |
| Volumes | Real capacity and free space | Explicit request | Implemented | `statvfs` total/free/available/used; never inferred from scanned files |
| Volumes | Volume classification | Explicit request | Implemented | `diskutil info -plist` internal/external/removable/virtual/APFS container on macOS; Windows logical disks |
| Overview | Category usage bar and legend | Explicit request | Implemented | Real bytes/files; click-through to filtered file view; uninspected space kept separate |
| Overview | At-a-glance statistics | Explicit request | Implemented | Largest file/folder, cleanup estimate, duplicate status, recent/stale files, scan status |
| Scan | Cancellable background scan | Explicit request | Implemented | Progress event; no invented percentage; partial/cancelled state labelled |
| Scan | Direct arbitrary-folder scan | Explicit request | Implemented | Header **Scan folder...** prompt avoids whole-volume entry caps for nested folders |
| Scan | Video extension coverage | Explicit request | Implemented | MP4/MOV/AVI/3GP/VOB/RM/MTS/M2TS/OGV/MOD and related camera formats |
| Scan | Symlink and loop safety | Explicit request | Implemented | `follow_links(false)`; symlinks listed but never traversed |
| Scan | Permission/error resilience | Explicit request | Implemented | Errors counted; scan continues; notes suggest Full Disk Access only as an option |
| Scan | Mount-boundary handling | Explicit request | Implemented | Nested mounts and reserved metadata directories skipped to prevent double counting |
| Scan | Hard-link accounting | Explicit request | Implemented | `(device, inode)` deduplication; additional links listed but not double-counted |
| Analysis | Folder tree with drill-down | Explicit request | Implemented | Breadcrumbs, lazy expansion, aggregate/logical/allocated size, file/folder counts, largest file, share |
| Analysis | Largest files | Explicit request | Implemented | Thresholds, filters, sorting, pagination, reveal/open/properties/select |
| Analysis | Largest folders | Explicit request | Implemented | Descendant totals, age/size filters, explicit overlap explanation |
| Analysis | File-type analysis | Explicit request | Implemented | Content-oriented groups, extensions, totals, filtered file view |
| Analysis | Recently changed and stale large files | Explicit request | Implemented | File metadata based; age is never treated as proof of uselessness |
| Visualization | Interactive treemap | Explicit request | Implemented | Canvas squarified layout, drill-down, breadcrumbs, keyboard regions, accessible list |
| Duplicates | Content-verified duplicate detection | Explicit request | Implemented | Size → 64 KiB fingerprint → streaming SHA-256; changed files excluded |
| Duplicates | Copy-preservation safeguards | Explicit request | Implemented | At least one verified copy must remain; cloud/backup warnings |
| Cleanup | Risk-labelled recommendations | Explicit request | Implemented | Low/review/high; reasoning, exact path, size, reversibility, notes |
| Cleanup | Deduplicated estimates | Explicit request | Implemented | Ancestor selection subsumes descendants; recommendations and selection deduplicated |
| Cleanup | Review before destruction | Explicit request | Implemented | Exact path list, risk warnings, Trash default, permanent deletion with acknowledgement |
| Cleanup | Revalidated execution | Explicit request | Implemented | Scan membership, type/size/date, canonical containment, protected system roots, volume/home guards |
| Cleanup | Result reporting and refresh | Explicit request | Implemented | Completed/failed/changed/overlap, logical and free-space measurements, automatic rescan |
| Cleanup | Per-path exclusions | Explicit request | Implemented | Recommendation paths can be excluded/restored; stored locally |
| Cleanup | Multi-file progress and cancellation | Explicit request | Implemented | Per-item progress event and safe cancellation after the current item |
| Privacy | Local-only analysis | Explicit request | Implemented | No uploads, no remote AI, no file execution; hashes stay local |
| Limitations | System-managed storage | Explicit request | Partial | Snapshots/System Data/purgeable space shown as uninspected, not fabricated |
| Indexing | Persistent full analyzer index | Explicit request | Implemented | Versioned SQLite cache in app-data; restores summary, children, and file queries after restart/reinstall |
| Indexing | Cached scan safety | Explicit request | Implemented | Cached results are read-only for cleanup until a fresh rescan; clear action removes cache |
| Indexing | Cache history | Explicit request | Implemented | Rolling eight scans; same-root replacement; stale write protection |
| Developer storage | Tool-native cleanup execution | Explicit request | Partial | Locations recognized and recommendations explain the owning tool; commands are not executed |
| Tests | Rust/frontend coverage | Explicit request | Implemented | Temp-directory scan/duplicate/delete tests; selection/treemap/workspace tests |
