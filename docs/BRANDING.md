# MAXplorer branding

This document is the reference for MAXplorer's product identity, application icon,
metadata, and theme-independent branding rules.

## Product identity

| Field | Value |
| --- | --- |
| Product name | **MAXplorer** |
| Tagline | **More than just a file manager.** |
| Brand statement | **Your files. Your way.** |
| Product category | Advanced desktop file manager |
| Description | A powerful, customisable desktop file manager |
| Personality | Modern, powerful, premium, precise, and customisable |

The name is always spelled **MAXplorer**: uppercase `MAX`, lowercase `plorer`.

### Colours

| Role | Colour |
| --- | --- |
| Electric blue | `#2563EB` |
| Cyan | `#22D3EE` |
| Violet | `#8B5CF6` |
| Deep navy | `#0B1226` |
| Graphite | `#16244B` |
| White | `#FFFFFF` |

The application continues to use its existing system-native typography and theme design
tokens. MAXplorer's primary palette lives in the application icon; it does not replace the
Windows Explorer or macOS Finder surface palettes.

## Application icon

The icon is an original folder symbol with an integrated geometric **M**. The folder
communicates file organisation and navigation, while the M provides the brand signature.
It uses a blue-to-cyan-to-violet gradient on a deep-navy macOS-style rounded tile, with
controlled highlights and no text.

### Source and generated assets

| Asset | Path |
| --- | --- |
| Canonical vector master | `branding/maxplorer-icon.svg` |
| High-resolution raster master | `branding/maxplorer-icon-2048.png` |
| Tauri icon-generator source | `src-tauri/icons/icon.svg` |
| macOS icon | `src-tauri/icons/icon.icns` |
| Windows icon | `src-tauri/icons/icon.ico` |
| PNG icons | `src-tauri/icons/icon.png`, `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png` |
| Windows Store/Square assets | `src-tauri/icons/Square*.png`, `StoreLogo.png` |

Regenerate the platform assets after editing the SVG:

```bash
cp branding/maxplorer-icon.svg src-tauri/icons/icon.svg
npx tauri icon src-tauri/icons/icon.svg -o src-tauri/icons
rsvg-convert -w 2048 -h 2048 branding/maxplorer-icon.svg \
  -o branding/maxplorer-icon-2048.png
```

One icon is used in both interface themes. No separate light-background or monochrome
variant is required by the current application. See [ICON_SYSTEM.md](ICON_SYSTEM.md) for
the unrelated in-app functional/file icon system.

## Centralised branding values

User-facing identity values live in `src/lib/branding.ts`:

- product name;
- tagline;
- brand statement;
- product description;
- application icon URL;
- application version, read from `package.json` so it is not duplicated in the About
  screen.

The About screen displays the application icon, **MAXplorer**, the tagline, the current
version from project metadata, the product description, and the brand statement. It uses
the active theme's design tokens.

## Metadata and native integration

| Surface | Configuration |
| --- | --- |
| Tauri product name | `src-tauri/tauri.conf.json` → `productName: "MAXplorer"` |
| Tauri window title | `src-tauri/tauri.conf.json` → `app.windows[0].title` |
| Bundle display name | Generated from the Tauri product name |
| Bundle executable | `maxplorer` |
| macOS icon resource | `src-tauri/icons/icon.icns` |
| macOS permission strings | `src-tauri/Info.plist` |
| Rust package metadata | `src-tauri/Cargo.toml` |
| npm package metadata | `package.json` |
| In-app window title | `src/App.tsx`, always `<location> - MAXplorer` |
| Native About menu | Opens the application's themed About dialog |
| Packaging descriptions | `src-tauri/tauri.conf.json` bundle fields |

The macOS application menu and About item use the MAXplorer name. The native About menu
item is routed to the same in-app About screen used by the command bar.

## Both themes keep one identity

MAXplorer supports two presentation themes:

1. Windows Explorer theme.
2. macOS Finder theme.

The product name, application icon, window identity, About screen, metadata, and menus are
identical in both themes. Themes change presentation only; they do not create separate
application implementations or separate brand identities. See [THEMES.md](THEMES.md).

## Compatibility and the bundle identifier

The bundle identifier intentionally remains:

```text
com.replica.win11explorer
```

Changing it would move the macOS WebKit application container and could lose existing
tabs, preferences, pinned folders, recents, and privacy grants. A replacement such as
`com.<owner>.maxplorer` requires owner approval and a migration plan before adoption.

These implementation identifiers also remain unchanged:

- `win11-explorer-state-v1` and `win11-explorer-window-v1` localStorage keys;
- the `win11://home` internal location;
- the `WIN11_EXPLORER_START_PATH` environment variable;
- the `application/x-win11-explorer-paths` drag payload type.

These are compatibility identifiers, not product branding.

## Validation record

The rebrand was verified with:

- `npm run typecheck`;
- `npm test` — 129 tests across 16 files at the time of the rebrand;
- `npm run test:cargo` — 28 tests;
- `npm run build`;
- `npm run tauri build -- --bundles app,dmg`;
- `hdiutil verify` on the produced DMG.

Runtime checks confirmed:

- the macOS menu bar shows **MAXplorer**;
- **About MAXplorer** opens the themed About dialog;
- the built bundle reports `CFBundleDisplayName` and `CFBundleName` as `MAXplorer`;
- `Contents/MacOS/maxplorer` is the executable and `icon.icns` contains the new artwork;
- switching to the macOS Finder theme and back preserves the brand identity and does not
  disturb persisted state.

The generated native DMG at the time of the rebrand was
`src-tauri/target/release/bundle/dmg/MAXplorer_0.1.0_aarch64.dmg` with SHA-256
`bb995d9b7ca6ba1198489220be2df26dd9a062b0680c614c401ea3d9895ca4b8`. It was ad-hoc signed
and not notarized.
