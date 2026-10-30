# Theme packages in this folder

This folder contains ready-to-import MAXplorer theme files.

| File | Description |
| --- | --- |
| `midnight-black-colour-pop.maxTheme` | Midnight-black theme with violet highlights, cyan selection, coral folders, and `_comments` notes |
| `atelier-noir.maxTheme` | Warm charcoal and ivory with a muted champagne accent, brass folders, and a Finder source-list layout |

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
