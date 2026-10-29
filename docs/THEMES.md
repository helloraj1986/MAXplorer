# Interface themes

The application ships two interchangeable visual identities:

1. **Windows 11 Explorer** (default) — the original Fluent shell.
2. **macOS Finder** — a macOS-inspired toolbar, traffic lights, source-list sidebar,
   selection, menus, spacing, and typography.

The theme is **presentation only**. Both themes render the same React components, read the
same Zustand store, and call the same Tauri commands and Rust filesystem services. There
is no second file browser, no duplicated operation logic, and no mock data.

## How to switch

Open the **Appearance** dialog from any of these entry points:

- **Appearance** at the bottom of the sidebar (visible in both themes).
- **More (…) → Appearance and themes** in the command bar.
- **More (…) → Options → Interface theme**.

The dialog has two preview cards:

- **Windows 11 Explorer**
- **macOS Finder**

Each card is a single keyboard-focusable button with a CSS/SVG miniature, a description,
an Apply control, and an **Active** badge for the selected theme. Selecting a card applies
the theme immediately. Tab moves between the cards and Space/Enter activates the focused
card; the focus ring is visible in both appearances. The dialog also contains an
independent **Use system setting / Light / Dark** segmented control. Both themes support
both appearances.

Switching themes preserves:

- the current directory and each tab's location;
- back/forward history;
- selection (paths stay selected);
- search query and results;
- sorting, grouping, view mode, and column widths;
- pinned folders, recents, and in-flight file operations.

No filesystem reload or component remount is triggered. Row heights are recomputed from
`THEME_METRICS`, so virtualized lists stay aligned.

## Where the preference is stored

The theme pair is part of the existing versioned snapshot in `localStorage`:

```json
{
  "version": 1,
  "interfaceTheme": "finder",
  "theme": "dark"
}
```

| Key | Contents |
| --- | --- |
| `win11-explorer-state-v1` | Full UI snapshot, including `interfaceTheme` and `theme` |
| `win11-explorer-window-v1` | Window bounds (separate) |

- `interfaceTheme`: `"windows"` or `"finder"`.
- `theme`: `"system"`, `"light"`, or `"dark"`.

Unknown or missing values fall back to `windows` and `system`. The snapshot is validated by
`parsePersisted` in `src/lib/persistence.ts`; the theme pair is read by
`parseThemePreferences`.

### No wrong-theme flash

`index.html` contains a tiny inline bootstrap that runs before the stylesheet and React
render. It reads the saved snapshot, validates the two values, and sets
`data-ui-theme` and `data-theme` on `<html>`. `main.tsx` repeats the pure call for
environments where the inline script did not run, and the store seeds its initial
`interfaceTheme`/`theme` from the same reader. The first paint therefore uses the saved
design.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/lib/theme.ts` | Theme ids, names, descriptions, normalization, appearance resolution, `data-*` application, `THEME_METRICS` |
| `src/lib/types.ts` | `InterfaceTheme` and `PersistedState.interfaceTheme` |
| `src/lib/persistence.ts` | Snapshot validation, `parseThemePreferences`, tolerant localStorage readers |
| `src/state/explorerStore.ts` | `interfaceTheme` state, `setInterfaceTheme`, persistence snapshot |
| `src/hooks/useTheme.ts` | Applies both document attributes and exposes theme row metrics |
| `src/styles/tokens.css` | Windows tokens plus Finder token overrides for dark and light |
| `src/styles/app.css` | Shared component styling, theme selector, sidebar footer |
| `src/styles/finder.css` | Structural Finder overrides, all scoped to `[data-ui-theme="finder"]` |
| `src/components/Dialogs.tsx` | Appearance dialog with preview cards and appearance control |
| `src/components/TitleBar.tsx` | Finder traffic lights (same Tauri window APIs) |
| `src/components/Sidebar.tsx` | Finder section headings and Appearance entry point |

### Two independent axes

```
data-ui-theme = "windows" | "finder"   (design system)
data-theme    = "light"   | "dark"     (appearance)
```

The Finder tokens are declared in two blocks:

```css
[data-ui-theme="finder"] { /* dark values */ }
[data-ui-theme="finder"][data-theme="light"] { /* light values */ }
```

The second selector is more specific, so Finder + light wins regardless of source order.
The Windows theme continues to use the original `:root` / `[data-theme="light"]` tokens.

### Finder layout adapter

`App.tsx` wraps `CommandBar` and `NavigationBar` in a `.chrome` element:

- Windows theme: `.chrome { display: contents; }` — layout is unchanged.
- Finder theme: `.chrome` becomes one macOS-style toolbar; its children use CSS `order`
  to render navigation, path, actions, and search in Finder order. `display: contents` on
  the two bars lets their existing controls join that row without duplicating components.

The Finder theme also adds real traffic lights. They call the same Tauri APIs as the
Windows caption buttons (`close`, `minimize`, `maximize`/`unmaximize`), so window dragging,
resizing, maximizing, and closing continue to work.

## Adding another theme

1. Extend `InterfaceTheme` in `src/lib/types.ts` (for example `"classic"`).
2. Add an entry to `INTERFACE_THEMES` and `INTERFACE_THEME_DEFINITIONS` in
   `src/lib/theme.ts`, plus `THEME_METRICS` row heights.
3. Add token overrides in `src/styles/tokens.css` under `[data-ui-theme="classic"]`
   (dark) and `[data-ui-theme="classic"][data-theme="light"]`.
4. Add structural overrides in a scoped stylesheet and import it from `src/main.tsx`.
5. Add the new preview to the Appearance dialog (`ThemesDialog` in `Dialogs.tsx`).
6. Extend `src/lib/theme.test.ts` and `src/lib/persistence.test.ts` for normalization and
   persistence.
7. Run `npm run typecheck`, `npm test`, and `npm run build`.

No store, filesystem, or Tauri changes are needed. `normalizeInterfaceTheme` already
rejects unknown stored values, so old snapshots remain compatible.

## Verification

Automated checks (Windows dev host):

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | **43 passed** across 7 files (was 26 across 5 before this change) |
| `npm run build` | Pass |

The new tests cover theme normalization, appearance resolution, attribute application,
metrics, persisted theme restoration, invalid-value fallback, and the pre-render reader.

Interactive validation of both themes, light/dark, the selector, menus, resizing, and a
rename operation is recorded in [VALIDATION.md](VALIDATION.md). Screenshots:

| Screenshot | Shows |
| --- | --- |
| `finder-light-details.png` | Finder light: traffic lights, unified toolbar, source list, 28 px rows |
| `finder-dark-details.png` | Finder dark: selection, sidebar, toolbar |
| `finder-dark-list.png` | Finder list view |
| `finder-dark-icons.png` | Finder icon view and grid selection |
| `finder-dark-context-menu.png` | Finder context menu styling |
| `finder-dark-more-menu.png` | Finder More menu including "Appearance and themes" |
| `finder-dark-narrow.png` | Finder at 1080 × 720; no toolbar/sidebar overlap |
| `windows-light-details.png` | Windows theme light, unchanged layout |
| `windows-dark-details.png` | Windows theme dark, unchanged layout |
| `themes-dialog-finder-light.png` | Appearance dialog, Finder light, active card |
| `themes-dialog-finder-dark.png` | Appearance dialog, Finder dark |
| `themes-dialog-windows-dark.png` | Appearance dialog, Windows dark, active card |

Validated behaviors beyond the screenshots: switching Finder → Windows preserved the tab,
path, and selection without a remount or filesystem reload; a file renamed in the Windows
theme was still present after switching to Finder; and Finder + dark + list view were
restored after restarting the app.

## Known limitations

- The Finder theme is a web-rendered recreation, not AppKit. Traffic lights, toolbar,
  source list, and menus are CSS/SVG approximations backed by Tauri window APIs.
- Finder list view keeps the shared name-only rows; Finder's resizable column headers and
  alternating row stripes are not recreated. Column view, Quick Look, tags, and native
  translucent materials are not implemented and are not shown as fake controls.
- macOS TCC prompts, OS drag-and-drop from Finder, and Open With were not re-run on macOS
  as part of the theme change; the shared code paths are exercised on the Windows dev
  build.
- Theme switching keeps the scroll offset in pixels. Because Finder rows are shorter,
  the exact first visible row can shift slightly.
