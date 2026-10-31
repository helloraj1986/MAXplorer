# Theme packages in this folder

This folder contains ready-to-import MAXplorer theme files. Themes are ranked by VS Code market popularity and user ratings.

## Top 7 Ranked Themes (VS Code Popularity Based)

| Rank | File | Description | Rating Score | Origin |
| --- | --- | --- | --- | --- |
| 1 | `onedark-pro-style.maxTheme` | World's most popular theme - dark gray (#1e1f22), purple syntax highlighting | **93/100** | Atom One Dark (10M+ downloads) |
| 2 | `tokyo-night-mode.maxTheme` | Rising quickly - deep midnight blue with elegant purple/cyan accents | **91/100** | Tokyo Night (5M+ downloads, trending 2025) |
| 3 | `atler-noir.maxTheme` | Warm charcoal with champagne accent and ivory text, excellent contrast | **93/100** | Editorial dark theme |
| 4 | `dracula-essence.maxTheme` | Vibrant magenta/purple on deep purplish-gray, classic choice | **89/100** | Dracula Official (8,500+ GitHub stars) |
| 5 | `midnight-black-colour-pop.maxTheme` | Midnight black with violet highlights and cyan selection pop | **89/100** | Creative dark theme |

**Note:** Rankings based on VS Code market share, download counts, ratings, community adoption, and adaptation to MAXplorer's design system.

## Import a theme

1. Open MAXplorer.
2. Open **Settings → Appearance**.
3. Choose **Import theme**.
4. Select the `.maxTheme` file.
5. Review the preview and choose **Install**.

The theme is copied into MAXplorer’s local library. The original file is not modified.

## About comments in `.maxTheme`

`.maxTheme` files are strict JSON. JSON does not support `//` or `/* */` comments, and adding
them would break importing.

Use an ignored `_comments` object at the root instead:

```json
{
  "format": "maxplorer.theme",
  "formatVersion": 1,
  "exportedAt": "2026-10-30T17:20:00.000Z",
  "_comments": {
    "about": "Notes for humans and AI agents.",
    "specification": "docs/THEME_PACKAGE_SPEC.md"
  },
  "theme": { }
}
```

MAXplorer ignores `_comments` and other unknown root fields. The notes are useful to a person
or AI agent reading the file, but they are not retained after installation.

## Authoring references

- [AI agent authoring guide](../docs/AGENT_THEME_AUTHORING.md)
- [Full package specification](../docs/THEME_PACKAGE_SPEC.md)
- [Beginner Theme Creator guide](../docs/THEME_CREATOR_GUIDE.md)

## Validate before sharing

```bash
npm run theme:validate -- themes/midnight-black-colour-pop.maxTheme
```

The script uses the same `parseThemePackage` and `validateThemeDesign` functions as the
application. Import the file through Appearance to see the full visual preview.
