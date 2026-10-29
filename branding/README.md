# MAXplorer brand assets

**Product:** MAXplorer  
**Tagline:** More than just a file manager.  
**Brand statement:** Your files. Your way.

## Icon concept

A stylised folder with an integrated geometric **M**. The folder communicates file
organisation and navigation; the M is the brand signature. The mark uses an original
blue-to-cyan-to-violet gradient on a deep-navy macOS-style rounded tile, with a restrained
top-light sheen and soft internal depth. There is no text in the icon.

The artwork is original and was drawn for this project. It does not copy the Apple Finder
or Windows Explorer marks.

## Colours

| Role | Colour |
| --- | --- |
| Electric blue | `#2563EB` |
| Cyan | `#22D3EE` |
| Violet | `#8B5CF6` |
| Deep navy | `#0B1226` |
| Graphite | `#16244B` |
| White | `#FFFFFF` |

## Source and generated assets

- `branding/maxplorer-icon.svg` - canonical vector master (1024 x 1024 canvas).
- `branding/maxplorer-icon-2048.png` - high-resolution raster master.
- `src-tauri/icons/icon.svg` - copy consumed by the Tauri icon generator.
- `src-tauri/icons/icon.icns`, `icon.ico`, `icon.png`, `32x32.png`, `64x64.png`,
  `128x128.png`, `128x128@2x.png` - generated platform assets.

Regenerate every platform asset after editing the SVG:

```bash
cp branding/maxplorer-icon.svg src-tauri/icons/icon.svg
npx tauri icon src-tauri/icons/icon.svg -o src-tauri/icons
rsvg-convert -w 2048 -h 2048 branding/maxplorer-icon.svg \
  -o branding/maxplorer-icon-2048.png
```

One icon is used in both the Windows Explorer and macOS Finder themes. A separate
light-background or monochrome variant is not needed by the current application, so none
is shipped.

## Identity and persistent data

The bundle identifier intentionally remains `com.replica.win11explorer`. Changing it would
move the WebKit application container, potentially losing the user's persisted tabs,
preferences, pinned folders, recents, and macOS privacy grants. A future owner-controlled
reverse-DNS identifier (for example `com.<owner>.maxplorer`) requires owner approval and a
migration plan before it can be adopted.

The following implementation identifiers also remain unchanged so existing data and
automation keep working:

- `win11-explorer-state-v1` and `win11-explorer-window-v1` localStorage keys.
- `win11://home` internal location.
- `WIN11_EXPLORER_START_PATH` environment variable.
- `application/x-win11-explorer-paths` drag payload type.

