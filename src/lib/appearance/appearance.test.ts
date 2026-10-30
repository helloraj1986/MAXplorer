import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  ensureContrast,
  generateMatchingPalette,
  mix,
  normalizeHex,
  parseColor,
  readableOn,
  repairPalette,
} from "./color";
import {
  ALLOWED_OVERRIDE_TOKEN_SET,
  buildIconPackPackage,
  buildThemePackage,
  createThemeIdentity,
  normalizeIconPack,
  normalizeThemeDesign,
  packageFileName,
  parseIconPackPackage,
  parseThemePackage,
  repairThemeContrast,
  sanitizeTokenValue,
  validateThemeDesign,
  visualValidation,
  type ThemeDesign,
} from "./model";
import {
  READY_PALETTES,
  THEME_PRESETS,
  createBlankTheme,
  designFromBuiltin,
  designFromPreset,
  duplicateThemeDesign,
  presetById,
} from "./presets";
import { designRowMetrics, iconPackCssVariables, themeCssVariables } from "./tokens";
import { BUILTIN_ICON_PACKS, DEFAULT_ICON_PACK_ID, iconPackForId, mergeIconPacks } from "./iconPacks";
import { localThemeProvider, generateThemeFromDescription } from "./ai";
import { parseAppearanceLibrary, parseDraft } from "./storage";

describe("colour helpers", () => {
  it("normalises hex, shorthand and rgb colours", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("rgb(255, 0, 10)")).toBe("#ff000a");
    expect(parseColor("not-a-colour")).toBeNull();
  });

  it("computes WCAG contrast and repairs unreadable text", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    const readable = ensureContrast("#777777", "#ffffff", 4.5);
    expect(contrastRatio(readable, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(readableOn("#111111")).toBe("#ffffff");
  });

  it("mixes colours and generates a matching readable palette", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    for (const appearance of ["light", "dark"] as const) {
      const palette = generateMatchingPalette("#14b8a6", appearance);
      expect(contrastRatio(palette.text, palette.surface)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(palette.accent).toBe("#14b8a6");
    }
    const repaired = repairPalette({
      ...generateMatchingPalette("#14b8a6", "dark"),
      text: "#303030",
    });
    expect(contrastRatio(repaired.text, repaired.surface)).toBeGreaterThanOrEqual(7);
  });
});

describe("theme presets, templates and identities", () => {
  it("ships at least eight coordinated templates", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(8);
    for (const preset of THEME_PRESETS) {
      expect(preset.palette.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(preset.palette.text, preset.palette.surface)).toBeGreaterThanOrEqual(4.5);
      expect(preset.style.corners).toBeTruthy();
      expect(preset.iconPackId).toBeTruthy();
    }
  });

  it("provides ready-made palettes for every appearance", () => {
    expect(READY_PALETTES.length).toBeGreaterThanOrEqual(8);
    expect(READY_PALETTES.some((palette) => palette.appearance === "dark")).toBe(true);
    expect(READY_PALETTES.some((palette) => palette.appearance === "light")).toBe(true);
  });

  it("creates a separate identity for every copy", () => {
    const first = createThemeIdentity("My Theme", 123456, "aaaa");
    const second = createThemeIdentity("My Theme", 654321, "bbbb");
    expect(first.id).not.toBe(second.id);
    expect(first.packageId.startsWith("com.maxplorer.theme.")).toBe(true);

    const source = designFromPreset(presetById("midnight-dark") ?? THEME_PRESETS[0]);
    const copy = duplicateThemeDesign(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy.packageId).not.toBe(source.packageId);
    expect(copy.name).toBe("Midnight Dark Copy");
    expect(copy.palette).not.toBe(source.palette);
  });

  it("builds built-in copies without touching the built-in package", () => {
    const design = designFromBuiltin("finder", "light");
    expect(design.base).toBe("finder");
    expect(design.appearance).toBe("light");
    expect(design.packageId.startsWith("com.maxplorer.theme.")).toBe(true);
    expect(createBlankTheme().name).toBe("My Theme");
  });
});

describe("theme model and packages", () => {
  it("normalises designs and ignores unsupported or unsafe tokens", () => {
    const base = designFromPreset(THEME_PRESETS[0]);
    const normalized = normalizeThemeDesign({
      ...base,
      name: "  My   Theme  ",
      overrides: {
        "--accent": "#ff0000",
        "--not-a-token": "#000",
        "--text": "red; background: url(https://example.com)",
      },
      style: { ...base.style, density: "gigantic", corners: "rounded" },
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.name).toBe("My Theme");
    expect(normalized?.overrides).toEqual({ "--accent": "#ff0000" });
    expect(normalized?.style.corners).toBe("rounded");
    expect(normalized?.style.density).toBe(base.style.density);
    expect(ALLOWED_OVERRIDE_TOKEN_SET.has("--accent")).toBe(true);
    expect(ALLOWED_OVERRIDE_TOKEN_SET.has("--not-a-token")).toBe(false);
  });

  it("rejects unsafe advanced values while accepting colours and font stacks", () => {
    expect(sanitizeTokenValue("#ff0000")).toBe("#ff0000");
    expect(sanitizeTokenValue("rgba(0,0,0,.5)")).toBe("rgba(0,0,0,.5)");
    expect(sanitizeTokenValue('"Segoe UI", sans-serif')).toBe('"Segoe UI", sans-serif');
    expect(sanitizeTokenValue("red; } body { display:none")).toBeNull();
    expect(sanitizeTokenValue("url(https://evil.example)")).toBeNull();
    expect(sanitizeTokenValue("@import things")).toBeNull();
  });

  it("builds and parses portable .maxTheme packages", () => {
    const design = designFromPreset(presetById("ocean-blue") ?? THEME_PRESETS[0]);
    const packaged = buildThemePackage(design);
    const parsed = parseThemePackage(JSON.stringify(packaged));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.theme.name).toBe(design.name);
      expect(parsed.value.format).toBe("maxplorer.theme");
    }
    expect(packageFileName(design)).toMatch(/\.maxTheme$/);
  });

  it("ignores annotation comments in packages", () => {
    const design = designFromPreset(presetById("midnight-dark") ?? THEME_PRESETS[0]);
    const packaged = buildThemePackage(design);
    const parsed = parseThemePackage(
      JSON.stringify({
        ...packaged,
        _comments: {
          about: "Notes for humans and AI agents.",
          specification: "docs/THEME_PACKAGE_SPEC.md",
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.theme.name).toBe(design.name);
  });

  it("rejects malformed, future and oversized packages", () => {
    expect(parseThemePackage("nonsense").ok).toBe(false);
    expect(parseThemePackage({ format: "other", formatVersion: 1 }).ok).toBe(false);
    expect(
      parseThemePackage({
        format: "maxplorer.theme",
        formatVersion: 99,
        theme: designFromPreset(THEME_PRESETS[0]),
      }).ok,
    ).toBe(false);
    expect(parseThemePackage("x".repeat(1_100_000)).ok).toBe(false);
  });

  it("validates contrast and repairs it in one step", () => {
    const design = designFromPreset(presetById("midnight-dark") ?? THEME_PRESETS[0]);
    const broken: ThemeDesign = {
      ...design,
      palette: { ...design.palette, text: "#202020", surface: "#181818" },
    };
    const issues = visualValidation(broken);
    expect(issues.some((issue) => issue.repair === "text")).toBe(true);
    expect(validateThemeDesign(broken).ok).toBe(false);
    const repaired = repairThemeContrast(broken);
    expect(contrastRatio(repaired.palette.text, repaired.palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("normalises icon packs and packages them", () => {
    const pack = normalizeIconPack({
      ...BUILTIN_ICON_PACKS[0],
      id: "custom-pack",
      name: "Custom Pack",
      builtIn: false,
      strokeWidth: 99,
    });
    expect(pack?.strokeWidth).toBe(2.75);
    const packageValue = buildIconPackPackage(pack!);
    const parsed = parseIconPackPackage(JSON.stringify(packageValue));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.iconPack.name).toBe("Custom Pack");
  });
});

describe("token generation", () => {
  it("maps a design onto the application's real CSS variables", () => {
    const design = designFromPreset(presetById("windows-inspired") ?? THEME_PRESETS[0]);
    const variables = themeCssVariables(design);
    expect(variables["--theme-background"]).toBe(design.palette.background);
    expect(variables["--theme-sidebar"]).toBe(design.palette.sidebar);
    expect(variables["--accent"]).toBe(design.palette.accent);
    expect(variables["--radius"]).toMatch(/px$/);
    expect(variables["--ui-text-scale"]).toBe("1");
    expect(contrastRatio(variables["--text"], variables["--surface"])).toBeGreaterThanOrEqual(4.5);
  });

  it("applies advanced overrides and icon pack variables", () => {
    const design = {
      ...designFromPreset(THEME_PRESETS[0]),
      overrides: { "--accent": "#ff00aa" },
    };
    expect(themeCssVariables(design)["--accent"]).toBe("#ff00aa");
    const pack = iconPackForId(BUILTIN_ICON_PACKS, "soft-rounded");
    const packVars = iconPackCssVariables(pack);
    expect(packVars["--folder-back-top"]).toBe(pack.folder.backTop);
    expect(iconPackCssVariables(iconPackForId(BUILTIN_ICON_PACKS, DEFAULT_ICON_PACK_ID))).toEqual({});
    expect(mergeIconPacks([]).length).toBe(BUILTIN_ICON_PACKS.length);
  });

  it("derives virtual row heights from the theme's density", () => {
    const compact = {
      ...designFromPreset(THEME_PRESETS[0]),
      style: { ...THEME_PRESETS[0].style, density: "compact" as const },
    };
    const normal = designFromPreset(THEME_PRESETS[0]);
    const spacious = {
      ...normal,
      style: { ...normal.style, density: "spacious" as const },
    };
    expect(designRowMetrics(compact).detailsRow).toBeLessThan(designRowMetrics(normal).detailsRow);
    expect(designRowMetrics(spacious).detailsRow).toBeGreaterThan(designRowMetrics(normal).detailsRow);
  });
});

describe("description-based creation", () => {
  it("creates a valid dark theme from natural language without a network", async () => {
    expect(localThemeProvider.available()).toBe(true);
    const result = await generateThemeFromDescription(
      "Create a dark theme with deep blue backgrounds and subtle cyan highlights",
    );
    expect(result.design.appearance).toBe("dark");
    expect(result.design.overrides).toEqual({});
    expect(validateThemeDesign(result.design).issues.filter((issue) => issue.level === "error")).toHaveLength(0);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("honours rounded corners and monochrome icon requests", async () => {
    const result = await generateThemeFromDescription("Minimal black theme with rounded corners and monochrome icons");
    expect(result.design.appearance).toBe("dark");
    expect(result.design.style.corners).toBe("rounded");
    expect(result.design.iconPackId).toBe("mono-ink");
  });
});

describe("library persistence validation", () => {
  it("falls back to an empty library for corrupt data", () => {
    expect(parseAppearanceLibrary(null)).toEqual({
      version: 1,
      themes: [],
      activeThemeId: null,
      customIconPacks: [],
      activeIconPackId: DEFAULT_ICON_PACK_ID,
    });
    expect(parseAppearanceLibrary("{oops").themes).toEqual([]);
  });

  it("keeps valid themes, drops duplicates and rejects stale active ids", () => {
    const design = designFromPreset(THEME_PRESETS[0]);
    const parsed = parseAppearanceLibrary(
      JSON.stringify({
        version: 1,
        themes: [design, { ...design, name: "Duplicate" }],
        activeThemeId: "missing",
        customIconPacks: [],
        activeIconPackId: "missing",
      }),
    );
    expect(parsed.themes).toHaveLength(1);
    expect(parsed.activeThemeId).toBeNull();
    expect(parsed.activeIconPackId).toBe(DEFAULT_ICON_PACK_ID);
  });

  it("restores unfinished drafts only when their design is valid", () => {
    const design = designFromPreset(THEME_PRESETS[2]);
    const draft = parseDraft(
      JSON.stringify({ version: 1, design, step: 3, mode: "advanced", savedAt: 1 }),
    );
    expect(draft?.step).toBe(3);
    expect(draft?.mode).toBe("advanced");
    expect(parseDraft(JSON.stringify({ version: 1, design: null }))).toBeNull();
  });
});
