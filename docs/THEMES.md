# Interface themes

MAXplorer ships two interchangeable presentation themes:

1. **Windows 11 Explorer** (default) — the original Fluent shell.
2. **macOS Finder** — a macOS-inspired toolbar, traffic lights, source-list sidebar,
   selection, menus, spacing, and typography.

The theme is **presentation only**. Both themes render the same React components, read the
same Zustand store, and call the same Tauri commands and Rust filesystem services. There
is no second file browser, no duplicated operation logic, and no mock data.

MAXplorer's product name, application icon, About screen, window identity, and menus are
identical in both themes. The themes change presentation; they do not create separate
brands. See [BRANDING.md](BRANDING.md).

## How to switch

Open the Appearance section of the consolidated **Settings** dialog from either of these
entry points:

- **Settings (gear) → Settings...** in the command bar, then choose **Appearance**.
- `Command+,` / `Ctrl+,` opens Settings.

The Settings menu itself contains a single Settings entry; it does not repeat the
individual sections or provide a second theme submenu. Appearance and theme controls are no
longer in the sidebar; the sidebar is navigation-only.

The Appearance section has two preview cards:

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

## Custom themes

Appearance is also the home of the visual Theme Creator. It is a separate layer from the
two built-in interface themes:

- Built-in themes remain immutable, code-defined packages.
- A custom theme stores a base (`windows` or `finder`), a light/dark appearance, a
  coordinated palette, shape and spacing choices, and an optional icon pack.
- Saving adds a normalized `ThemeDesign` to the local library and makes it active.
- Built-in and custom themes share all application state, Tauri commands, and filesystem
  code. A custom theme changes presentation only.

The creator is documented for ordinary users in
[THEME_CREATOR_GUIDE.md](THEME_CREATOR_GUIDE.md). The package schema, token map, validation
rules, and provider interface are in
[THEME_PACKAGE_SPEC.md](THEME_PACKAGE_SPEC.md). AI agents that need to author a theme file
directly should start with [AGENT_THEME_AUTHORING.md](AGENT_THEME_AUTHORING.md). Note that
`.maxTheme` is strict JSON: comments must be stored in an ignored root `_comments` object,
not as `//` lines.

Persistence uses two additional keys:

| Key | Contents |
| --- | --- |
| `maxplorer-appearance-v1` | User theme library, active theme, custom icon packs, active icon pack |
| `maxplorer-theme-draft-v1` | Unfinished design, step, and Simple/Advanced mode |

`main.tsx` applies the active custom design and icon pack before React renders, and
`useTheme()` keeps them in sync afterwards. `clearThemeDesign()` removes inline token
overrides when a built-in theme is selected.

## Dual-pane divider

The divider between the two file panes is a shared, theme-aware component
(`src/components/PaneDivider.tsx`). It never hard-codes a colour:

| Token | Role |
| --- | --- |
| `--pane-divider-color` | Resting visible line |
| `--pane-divider-hover-color` | Pointer hover / keyboard focus |
| `--pane-divider-active-color` | Active drag |
| `--pane-divider-grip-color` | Centre grip dots |
| `--pane-active-indicator-color` | Active-pane border/top line |
| `--pane-header-background` | Optional tinted pane header |
| `--pane-header-border-color` | Optional pane header border |
| `--pane-focus-ring-color` | Keyboard focus ring |
| `--pane-divider-width` | Visible line width (default `2px`) |
| `--pane-divider-hit-area` | Pointer target width (default `14px`) |
| `--pane-divider-radius` | Visible line radius |

Built-in Windows and Finder themes define these in `tokens.css` for both light and dark
appearances. Imported themes inherit the same semantic values; a custom theme can override
any of them through Advanced Mode or set the richer `components.paneDivider` block
documented in [THEME_PACKAGE_SPEC.md](THEME_PACKAGE_SPEC.md).

Colour fallbacks are derived from the active theme’s strong border, accent, text and
surface tokens. The normal divider is contrast-checked against the pane surface, so a
third-party theme that omits divider configuration still gets a visible line instead of a
gap or a same-colour border. Invalid colours, dimensions, or enum values are clamped and
reported as import warnings; the theme still installs.

Theme switching updates the divider, hover/dragging states, grip, active-pane indicator,
and pane-header treatment immediately. It does not reset the split ratio or either pane’s
navigation state.


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
| `src/styles/app.css` | Shared component styling, three-layer chrome, Settings dialog, display scaling |
| `src/styles/finder.css` | Structural Finder overrides, all scoped to `[data-ui-theme="finder"]` |
| `src/components/icons/` | Lucide chrome icons plus theme-aware file, folder, storage and status artwork |
| `src/lib/icons/` | File-type registry, native `.app` icon service, thumbnail policy |
| `src/components/Dialogs.tsx` | Consolidated Settings dialog; Appearance section with preview cards |
| `src/components/TitleBar.tsx` | Window chrome only; Finder traffic lights (same Tauri window APIs) |
| `src/components/CommandBar.tsx` | Layer 1 command center, theme quick switch, Settings menu |
| `src/components/Sidebar.tsx` | Navigation-only Finder section headings and locations |
| `src/lib/appearance/` | Theme model, colour maths, templates, packages, token mapping, offline matcher |
| `src/state/appearanceStore.ts` | Theme library, active theme, icon packs, automatic drafts |
| `src/components/appearance/` | Theme Creator, Appearance library, token-driven live preview |
| `src/styles/appearance.css` | Creator, preview, library, and custom-theme application styles |

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

### Theme-aware icon artwork

Functional chrome icons come from `components/icons/AppIcon.tsx` and use the same
size/stroke/color tokens in both themes. File artwork is resolved by
`lib/icons/fileIconRegistry.ts`; category accents and page colors are tokens. Folder
artwork switches between the Windows gold folder and the Finder blue folder through
`--folder-*` tokens, and storage artwork uses `--storage-*` tokens. No component forks
behavior per theme: switching themes only changes tokens and the scoped Finder layout.
See [ICON_SYSTEM.md](ICON_SYSTEM.md).

### Finder layout adapter

`App.tsx` wraps the command bar in a `.chrome` element, then renders the navigation and tab
layers separately:

- Windows theme: `.chrome { display: contents; }` — the three layers keep their own rows.
- Finder theme: `.chrome` becomes a compact macOS-style command toolbar; `display:
  contents` on its command bar lets those controls join the row. The navigation row and tab
  row below use Finder toolbar tokens, separators, and 28 px controls. In dual-pane mode the
  same navigation and tab treatment repeats inside each pane.

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
5. Add the new preview to the Appearance section (`AppearanceSettings` in `Dialogs.tsx`).
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
| `npm test` | **246 passed** across 26 files |
| `npm run test:cargo` | **48 passed** |
| `npm run build` | Pass |

The tests cover theme normalization, appearance resolution, attribute application,
metrics, persisted theme restoration, invalid-value fallback, the pre-render reader, and
the icon registry/component suite (theme switching, list/grid rendering, thumbnails,
native-icon fallback and accessibility).

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
| `appearance-settings.png` | Current Appearance page with Create Your Theme, built-ins, templates |
| `theme-creator-start.png` | Theme Creator start screen with visual starting options |
| `theme-creator-colours.png` | Colour step with palettes, pickers, and live preview |
| `theme-creator-style.png` | Style step with visual corner, spacing, and border choices |
| `appearance-icon-packs.png` | Independent icon pack gallery below the template gallery |

The screenshots above record the earlier two-row chrome and the standalone Appearance
dialog. The theme tokens, previews, and switching behavior are unchanged; the current
layout places commands, navigation, and tabs in three separate rows and moves Appearance
into the consolidated Settings dialog. New screenshots should be captured on the next
interactive Tauri pass.

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
- Native artwork is currently limited to macOS `.app` bundles. Arbitrary file/folder
  native icons and QuickLook video thumbnails would require a new Rust/AppKit bridge.
