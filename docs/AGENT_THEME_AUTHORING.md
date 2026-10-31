# AI agent authoring guide: `.maxTheme`

**Audience:** AI coding agents and automation that need to create a MAXplorer theme.

**Authoritative specification:** [THEME_PACKAGE_SPEC.md](THEME_PACKAGE_SPEC.md).

This page is the short, copyable checklist. The specification remains the source of truth if
the two ever differ.

---

## What an agent must produce

One strict JSON file with the `.maxTheme` extension:

```json
{
  "format": "maxplorer.theme",
  "formatVersion": 1,
  "exportedAt": "2026-10-30T17:20:00.000Z",
  "theme": {
    "id": "evening-ink-8f21ac",
    "packageId": "com.maxplorer.theme.evening-ink-8f21ac",
    "name": "Evening Ink",
    "description": "A quiet dark theme for late-night work.",
    "author": "MAXplorer",
    "version": "1.0.0",
    "base": "windows",
    "appearance": "dark",
    "palette": {
      "accent": "#8b5cf6",
      "background": "#050506",
      "surface": "#0a0a0d",
      "sidebar": "#070709",
      "selection": "#22d3ee",
      "text": "#f5f5f7",
      "menu": "#121218"
    },
    "style": {
      "corners": "rounded",
      "density": "comfortable",
      "borders": "subtle",
      "elevation": "elevated",
      "iconSize": "default",
      "textSize": "default",
      "sidebar": "tinted",
      "toolbar": "subtle"
    },
    "iconPackId": "sunset-folders",
    "overrides": {},
    "presetId": null,
    "createdAt": "2026-10-30T17:20:00.000Z",
    "updatedAt": "2026-10-30T17:20:00.000Z"
  }
}
```

No installation, compiler, build step, or MAXplorer process is required to author the file.

---

## Required rules

| Field | Rule |
| --- | --- |
| `format` | Exactly `"maxplorer.theme"` |
| `formatVersion` | Exactly `1` |
| `theme.id` | Lowercase letters, digits, and hyphens; 2–80 characters |
| `theme.packageId` | Must start with `com.maxplorer.theme.` |
| `theme.name` | 1–60 characters |
| `theme.version` | Exactly `"1.0.0"` |
| `theme.base` | `"windows"` or `"finder"` |
| `theme.appearance` | `"light"` or `"dark"` |
| `theme.palette` | All seven colours; use hex such as `#8b5cf6` |
| `theme.style` | All eight keys with an allowed value |
| `theme.iconPackId` | `null` or a valid pack id |
| `theme.overrides` | Only allowed token names and safe values |

### Allowed style values

```text
corners:    square | soft | rounded
density:    compact | comfortable | spacious
borders:    minimal | subtle | prominent
elevation:  flat | elevated
iconSize:   small | default | large
textSize:   small | default | large
sidebar:    plain | tinted | contrast
toolbar:    flat | subtle | elevated
```

### Built-in icon pack ids

```text
classic
soft-rounded
bold-contrast
mono-ink
sunset-folders
```

`null` means “follow the application-wide icon pack”.

### Optional pane divider configuration

Add this inside `theme` to customise the dual-pane divider without CSS. Omit it entirely
for the safe default; legacy themes without it still install.

```json
{
  "components": {
    "paneDivider": {
      "width": 2,
      "hitAreaWidth": 14,
      "color": null,
      "hoverColor": null,
      "activeColor": null,
      "gripColor": null,
      "showGrip": true,
      "gripVisibility": "hover",
      "activeIndicator": "accent-border",
      "cornerRadius": 1,
      "headerBackground": null,
      "headerBorderColor": null
    }
  }
}
```

Allowed values:

```text
width:          1–8 (visible line, logical px)
hitAreaWidth:   12–28 (pointer target; always larger than width)
color/hoverColor/activeColor/gripColor/headerBackground/headerBorderColor:
                "#rrggbb", "rgb(...)", or null to derive from theme tokens
showGrip:       true | false
gripVisibility: hover | always | never
activeIndicator: accent-border | top-line | header | none
cornerRadius:   0–8
```

Invalid values are clamped and reported as import warnings; they do not reject the theme.

---

## Comments and notes

Standard JSON does not allow comments. Do not add `//` or `/* */` — the file will fail to
parse.

Use an ignored `_comments` object at the package root:

```json
{
  "format": "maxplorer.theme",
  "formatVersion": 1,
  "exportedAt": "2026-10-30T17:20:00.000Z",
  "_comments": {
    "about": "Notes for humans. MAXplorer ignores this object.",
    "specification": "docs/THEME_PACKAGE_SPEC.md"
  },
  "theme": { }
}
```

`MAXplorer` ignores unknown root fields, so `_comments` imports safely. It is not retained
after import.

---

## Safety and validation

Never generate or include:

- CSS, JavaScript, HTML, shell commands, or executable content;
- `url(...)`, `@import`, `expression(...)`, `javascript:`, or backslashes in values;
- semicolons, braces, angle brackets, or arbitrary CSS declarations;
- token names outside the allowlist in `src/lib/appearance/model.ts`;
- data URLs or remote assets.

Advanced overrides are limited to the tokens in
[THEME_PACKAGE_SPEC.md](THEME_PACKAGE_SPEC.md#4-how-a-friendly-design-becomes-application-tokens).
Unknown tokens and unsafe values are dropped during normalization.

Validation entry point:

```ts
import { parseThemePackage, validateThemeDesign } from "./src/lib/appearance/model";

const result = parseThemePackage(fileText);
if (!result.ok) throw new Error(result.error);
const report = validateThemeDesign(result.value.theme);
```

`report.ok === true` means the schema is valid. Contrast warnings are advisory; keep
primary text at 4.5:1 or better against `surface` and `background`.

---

## Quality checklist

- [ ] All seven palette colours are valid hex values.
- [ ] Text contrast against `surface` and `background` is at least 4.5:1.
- [ ] `id` and `packageId` are unique and lowercase.
- [ ] `createdAt` and `updatedAt` are ISO timestamps.
- [ ] `iconPackId` is `null` or a known / installed pack id.
- [ ] `overrides` is present (use `{}` when unused).
- [ ] No arbitrary CSS or executable content.
- [ ] File uses strict JSON and ends in `.maxTheme`.
- [ ] The generated theme imports through Appearance → Import theme → Install.

---

## Example files in this repository

| File | Purpose |
| --- | --- |
| `themes/midnight-black-colour-pop.maxTheme` | Annotated dark theme with `_comments` |
| `docs/THEME_PACKAGE_SPEC.md` | Full schema and security model |
| `docs/THEME_CREATOR_GUIDE.md` | Beginner workflow for ordinary users |

---

## Importing the result

1. Open MAXplorer.
2. Choose **Settings → Appearance**.
3. Choose **Import theme**.
4. Select the `.maxTheme` file.
5. Review the preview and choose **Install**.

No manual unzip, asset folder, manifest, or code editing is required.
