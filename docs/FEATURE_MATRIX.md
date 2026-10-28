# Feature matrix

Status vocabulary:

- **Verified/implemented** — reference behavior observed and the replica implements it;
  exercised in the running app and/or covered by tests.
- **Implemented** — implemented from observed geometry/structure or an explicit informed
  approximation; code and unit tests pass, but not every state was captured.
- **Informed approximation** — reference not directly available (e.g. 21H2 has no tabs).
- **Partial** — an honest subset is implemented.
- **Unsupported** — intentionally not implemented, not shown as a fake control.
- **Blocked** — code exists but runtime verification requires macOS access unavailable here.

| Area | Feature | Reference evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| Shell | Custom title bar and caption buttons | Screenshot | Verified/implemented | Windows-style controls on the right |
| Shell | Tabs with independent location/history | 22H2 design; 21H2 host has none | Informed approximation | Create, close, switch, duplicate, drag-reorder, restore |
| Shell | Tab overflow flyout | 22H2 design | Unsupported | Tabs scroll horizontally instead |
| Shell | Window resizing/min size | UIA + screenshots | Implemented | Min 760×520; CSS responsive breakpoints |
| Shell | Minimize/maximize/restore/close | Screenshot + interaction | Verified/implemented | Maximize to work area + restore glyph + close verified on Windows release; minimize same Tauri path |
| Command bar | New, cut, copy, paste, rename, share, delete | UIA | Verified/implemented | All disabled/enabled states wired |
| Command bar | Sort and View wide buttons | UIA | Verified/implemented | Menus mirror captured items |
| Command bar | More menu | Screenshot | Implemented | Adds real options/shortcuts/about |
| Navigation | Back / forward / up / refresh | UIA + interaction | Verified/implemented | Per-tab history; refresh re-reads disk |
| Navigation | Breadcrumbs | UIA + screenshots | Verified/implemented | Clickable root + segments |
| Navigation | Editable address bar | Interaction | Verified/implemented | Absolute paths, `~`, invalid-path inline error |
| Navigation | Address dropdown | Interaction | Implemented | Copy address / edit / copy as text |
| Search | Recursive name search | Search box observed | Implemented | Bounded 500 results/8 s/200k entries |
| Search | Content/index search | Not observed | Unsupported | Name-based only; documented |
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
| File ops | Copy / cut / paste | Standard Explorer | Verified/implemented | Copied a file into a test folder |
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
| Themes | Dark / light / system | Captured both | Verified/implemented | Top bars force repaint on switch |
| Theming | Selected/hover/pressed/focus states | Captured core states | Implemented | CSS tokens |
| Persistence | Tabs/history/view/sort/columns/sidebar/theme | Standard Explorer | Verified/implemented | localStorage; window bounds persisted |
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
4. **Native window captions are Windows-style**, even on macOS, because the target is the
   Windows 11 Explorer appearance. macOS traffic lights are intentionally hidden.
5. **Share and Open With** are the two areas where macOS integration is intentionally
   partial or unverified rather than faked.
