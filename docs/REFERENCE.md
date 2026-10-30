# Reference research: Windows 11 File Explorer

This document records the evidence used to build MAXplorer's Windows Explorer theme. It
distinguishes **observed** facts from **inferred approximations**. The host was a real
Windows 11 machine, not a video or a memory of Explorer.

## 1. Reference environment

| Fact | Value |
| --- | --- |
| Host OS | Windows 11 Pro, `10.0.22000` (Windows 11 21H2) |
| Display | 1512 × 921 primary, working area 1512 × 873 |
| App theme during primary capture | Dark (`AppsUseLightTheme = 0`) |
| Explorer build | 21H2 — **no tabs** |
| Default window | 1510 × 871 at 100% scale |
| Capture methods | Win32 `PrintWindow` with `PW_RENDERFULLCONTENT`, full-screen capture, Windows UI Automation |
| Reference fixture | `D:\RKM_SYNC\fileExplorer\reference\fixture` (disposable) |

`explorer.exe shell:Home` opened the **Documents** folder on this 21H2 build, which
confirms that the Windows 11 22H2 Home surface was not present. MAXplorer therefore
uses a Home/Quick access surface modeled on the 22H2 design, with the 21H2 quick-access
navigation pane preserved.

## 2. REA (reverse engineer anything) usage

Repository: `D:\RKM_SYNC\fileExplorer\rea` (REA `6.8.0`).

### Setup attempt and constraints

- REA requires Node `^22.23.4 || ^24.22.1 || >=26.12.1`. The host has Node `22.18.0`,
  so `npm ci` fails the engine check.
- `npm ci --force` installed 729 packages, but `npm run build:cached` then failed because
  this source checkout is missing the packaged Windows native artifact:
  `native/windows/build/manifest.json` and `native/windows/build/rea-windows-x64.node`.
- To use REA's actual CLI capabilities, a **portable Node 24.22.1** was downloaded to
  `C:\Users\rajee\AppData\Local\Temp\opencode\node24` and REA was run with
  `npm exec --yes --package=rea-agents@latest -- rea ...`.
- REA's `capture-native-ui-scenario` is documented for macOS ScreenCaptureKit/AX (macOS
  14+). It was not used for the Windows Explorer target; Windows UI Automation and Win32
  capture were used instead.

### Evidence produced by REA

```text
rea inspect-pe-resources C:\Windows\explorer.exe --format json
  -> complete resource inventory
     1,151 examined entries
     572 resources
     28 icon groups
     payload ranges and icon-group relationships retained
     limitations: static PE resource inventory; icon decoding and shell/window loading
                 are not observed
  -> reference/rea-explorer-pe-resources.json (525,167 bytes)

rea inspect-pe-imports C:\Windows\explorer.exe --format json
  -> reference/rea-explorer-pe-imports.json (196,369 bytes)
```

REA's evidence is shipped-artifact evidence about the Explorer binary resources/imports.
It does **not** establish layout, colors, or interaction behavior. Those came from the
live UI evidence below. REA was not used to fabricate any UI conclusion.

## 3. Captured evidence

### Screenshots

All reference screenshots are in `reference/screenshots/`.

| File | Content |
| --- | --- |
| `explorer-dark-details.png` | Folder in Details view, dark theme, 1510 × 871 |
| `explorer-dark-large-icons.png` | Large icons view with details pane, dark |
| `explorer-dark-list.png` | List view, dark |
| `explorer-dark-home.png` | `shell:Home` fallback opened Documents on 21H2 |
| `explorer-dark-details-pane.png` | Details pane with a selected Word document |
| `explorer-light-details.png` | Light theme, list view, details pane |
| `explorer-dark-view-menu.png` | View menu open |
| `explorer-dark-sort-menu.png` | Sort menu open |
| `explorer-dark-new-menu.png` | New menu open |
| `explorer-dark-context-menu.png` | File context menu |
| `explorer-dark-blank-menu.png` | Blank-area context menu |

UI Automation dumps:

- `reference/uia-explorer.txt` — details view, navigation pane, toolbars, rows, status bar.
- `reference/uia-large-icons.txt` — 105 × 116/131 item cells, 97 × 96 image containers.
- `reference/uia-view-menu.txt` — menu item rectangles.
- `reference/uia-sort-menu.txt` — sort menu rectangles.
- `reference/uia-new-menu.txt` — New menu rectangles.
- `reference/uia-blank-menu.txt` — blank menu rectangles.

### Measured geometry (UIA, screen coordinates)

Window: `0,0 1510 × 871`.

| Element | Rectangle | Notes |
| --- | --- | --- |
| Command bar | `11,34 624×47` | Title bar ends near y=31; command bar icons y=50..66 |
| New | `17,34 86×47` | icon 16×16 at `29,50` |
| Cut / Copy / Paste | `114/162/210,34 40×47` | 8 px gaps, 16 px icons |
| Rename / Share / Delete | `258/306/354,34 40×47` | disabled unless selection |
| Sort | `405,34 84×47` | wide button |
| View | `492,34 89×47` | wide button |
| More | `587,34 48×47` | 16 px icon |
| Navigation buttons | `12,96 96×32` | back / forward / chevron |
| Up band | `108,96 36×36` | |
| Address root | `144,85 727×52` | breadcrumb pill `146,95 649×34` |
| Search | `881,94 610×36` | starts after separator at x=875 |
| Nav pane | `10,140 193×700` | tree rows 30 px, 16 px icons |
| File list | `207,140 1295×700` | |
| Column header | `207,140 1295×25` | |
| Name column | `207,140 272×25` | |
| Date modified | `479,140 144×25` | |
| Type | `623,140 120×25` | |
| Size | `743,140 80×25` | |
| First row | `221,171 598×27` | row step 31 px |
| Status bar | `8,840 1494×23` | view buttons at `1454,840 44×23` |
| Details pane content | `1251,140 226×...` | divider near x=1233 |

Large icons: item `105 × 116` (or 131 for two-line labels), step 111 horizontally and
132 vertically, image container `97 × 96`, name labels `16 px` per line.

### Menus observed

- **View menu**: 189 × 332 at `442,86`; items 28 px high, 32 px step; icons 16 px at
  x=486, text at x=514; check dot at x≈459. Items: Extra large icons, Large icons,
  Medium icons, Small icons, List, Details, Tiles, Content, Compact view, Show.
- **Sort menu**: 154 × 236 at `370,86`; items 28 px high: Name, Date modified, Type,
  More, Ascending, Descending, Group by.
- **New menu**: 234 × 166 at `17,86`; items 36 px high: Folder, Shortcut, Bitmap image,
  Compressed (zipped) Folder. The host's file associations suppress Text Document.
- **File context menu** (Project Brief.docx): ~290 px wide; groups:
  Open, Edit with Notepad++, Send with Tailscale, 7-Zip submenu, Bulk Rename Here,
  Scan with Microsoft Defender; Sign and encrypt, More GpgEX options; Open with,
  Share with Resilio Sync, Copy as path, Share, Restore previous versions, Send to;
  Cut, Copy, Create shortcut, Delete, Rename, Properties.
- **Blank context menu**: 262 × 292 at `1158,375`; View, Sort by, Group by, Undo Delete
  (disabled), New, Properties, Open in Terminal, Show more options.

MAXplorer intentionally omits third-party shell extensions from the reference host
(Notepad++, 7-Zip, Tailscale, Resilio, GpgEX, Defender) because they are not part of
Windows Explorer. It keeps the Explorer-owned actions and maps them to real macOS
operations.

### Colors sampled

| Region | Dark | Light |
| --- | --- | --- |
| Title / command bar | `#1B2228` (Mica-tinted) | `#F3F3F3` |
| Content / nav / list | `#191919` | `#FFFFFF` |
| Address field | `#1A1A1A` | `#FFFFFF` |
| Status bar | `#1C1C1C` | `#F3F3F3` |
| Borders | `#2D2D2D` / `#3A3A3A` | `#E5E5E5` / `#D0D0D0` |
| Selected row | `#2D2D2D` | `#E5E5E5` |
| Menu surface | `#2C2C2C` | `#F9F9F9` |

### Typography

Win32 UIA and screenshot inspection show Segoe UI Variable-era 12 px UI text, 11–13 px
menu/label text, and 15–26 px headings. MAXplorer uses `Segoe UI Variable` when
available and falls back to `-apple-system`/SF Pro on macOS.

## 4. Verified behavior

Directly observed on the reference:

- Details, List, Large icons, Small icons views and their item geometry.
- Back/forward/up/refresh controls and breadcrumb navigation.
- Address breadcrumbs; editable address entry and path acceptance.
- Search box placement/placeholder and recursive scope presentation.
- Command bar enable/disable states when selection changes.
- File context menu, blank context menu, View/Sort/New menus.
- Details pane metadata for a selected file and folder summary.
- Light/dark system theme updates.
- Sorting and view switching via View/Sort menus.
- Details columns and row selection highlight.
- Status bar item count and selection size.

## 5. Inferred or approximate behavior

- **Tabs**: not present in the 21H2 reference. Tab strip, drag reorder, close buttons,
  plus button, and per-tab histories follow the Windows 11 22H2/23H2 design and are
  marked as informed approximations.
- **Home surface**: 21H2 had Quick access, not 22H2 Home. MAXplorer uses a Quick access
  + Recent home surface mapped to macOS home directories.
- **Hover, pressed, focus, animation timings**: sampled/observed states are reproduced
  where captured; other timings are informed approximations.
- **Drag/drop and marquee selection**: interaction design inferred from Explorer behavior;
  not recorded frame-by-frame from the reference.
- **Native macOS equivalents**: This PC → This Mac; drives → `/Volumes`; Windows
  Quick access pins → macOS pinned paths; Gallery (no macOS equivalent) omitted.
- **Sharing**: no native macOS share sheet integration in this build; see limitations.

## 6. Unknowns / not observed

- 22H2 tab overflow flyout and tab context menu.
- Windows permission-denied dialogs and network-drive states.
- Gallery semantics on 22H2+.
- Exact native macOS TCC prompts and behavior under a sandboxed distribution.
- Share sheet, Quick Look, and PDF preview behavior.
- Full keyboard shortcut matrix under every focus state.
- Byte-level copy progress dialog behavior.

These are not claimed as reverse-engineered. The feature matrix states the status of each.
