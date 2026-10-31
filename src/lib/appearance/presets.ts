import type { InterfaceTheme } from "../types";
import { generateMatchingPalette, type GeneratedPalette } from "./color";
import {
  DEFAULT_PANE_DIVIDER,
  DEFAULT_THEME_STYLE,
  createThemeIdentity,
  type ThemeAppearance,
  type ThemeDesign,
  type ThemePalette,
  type ThemeStyle,
} from "./model";

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  base: InterfaceTheme;
  appearance: ThemeAppearance;
  palette: ThemePalette;
  style: ThemeStyle;
  iconPackId: string | null;
}

function palette(
  accent: string,
  background: string,
  surface: string,
  sidebar: string,
  selection: string,
  text: string,
  menu: string,
): ThemePalette {
  return { accent, background, surface, sidebar, selection, text, menu };
}

function style(overrides: Partial<ThemeStyle> = {}): ThemeStyle {
  return { ...DEFAULT_THEME_STYLE, ...overrides };
}

/**
 * Twelve ready-made looks. They double as the template gallery: built-in
 * templates live here in code, while user copies are stored separately in the
 * theme library. Duplicating a template never edits the original.
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "modern-minimal",
    name: "Modern Minimal",
    description: "Crisp white panels, a confident blue accent, and quiet borders.",
    base: "windows",
    appearance: "light",
    palette: palette("#2563eb", "#f5f7fa", "#ffffff", "#eef2f7", "#2563eb", "#0f172a", "#ffffff"),
    style: style({ corners: "soft", borders: "minimal", elevation: "elevated", sidebar: "plain", toolbar: "flat" }),
    iconPackId: "soft-rounded",
  },
  {
    id: "windows-inspired",
    name: "Windows Inspired",
    description: "Fluent greys, sky-blue highlights, and the familiar Explorer rhythm.",
    base: "windows",
    appearance: "dark",
    palette: palette("#60cdff", "#1b2228", "#191919", "#1b2228", "#60cdff", "#ffffff", "#2c2c2c"),
    style: style({ corners: "soft", borders: "subtle", elevation: "elevated", sidebar: "plain", toolbar: "subtle" }),
    iconPackId: "classic",
  },
  {
    id: "macos-inspired",
    name: "macOS Inspired",
    description: "Source-list calm, rounded controls, and the macOS system blue.",
    base: "finder",
    appearance: "light",
    palette: palette("#007aff", "#ececee", "#ffffff", "#f0f0f2", "#007aff", "#1d1d1f", "#f6f6f8"),
    style: style({ corners: "rounded", borders: "minimal", elevation: "elevated", sidebar: "tinted", toolbar: "subtle" }),
    iconPackId: "soft-rounded",
  },
  {
    id: "midnight-dark",
    name: "Midnight Dark",
    description: "Deep indigo panels with a soft periwinkle glow.",
    base: "windows",
    appearance: "dark",
    palette: palette("#8da2ff", "#080b14", "#0e1320", "#0a0e19", "#8da2ff", "#e8edff", "#151b2b"),
    style: style({ corners: "rounded", borders: "subtle", elevation: "elevated", sidebar: "tinted", toolbar: "subtle" }),
    iconPackId: "mono-ink",
  },
  {
    id: "pure-black-oled",
    name: "Pure Black OLED",
    description: "True-black surfaces and a warm gold highlight for OLED displays.",
    base: "windows",
    appearance: "dark",
    palette: palette("#ffd60a", "#000000", "#000000", "#050505", "#ffd60a", "#f5f5f5", "#111111"),
    style: style({ corners: "square", borders: "minimal", elevation: "flat", sidebar: "plain", toolbar: "flat", density: "compact" }),
    iconPackId: "bold-contrast",
  },
  {
    id: "ocean-blue",
    name: "Ocean Blue",
    description: "Navy depths lifted by a bright teal highlight.",
    base: "windows",
    appearance: "dark",
    palette: palette("#2dd4bf", "#061826", "#0a2233", "#071c2b", "#2dd4bf", "#e6f7ff", "#103349"),
    style: style({ corners: "rounded", borders: "subtle", elevation: "elevated", sidebar: "tinted", toolbar: "subtle" }),
    iconPackId: "soft-rounded",
  },
  {
    id: "forest-green",
    name: "Forest Green",
    description: "Mossy darks, leafy highlights, and a grounded, natural feel.",
    base: "windows",
    appearance: "dark",
    palette: palette("#86efac", "#07160f", "#0c2117", "#091b12", "#86efac", "#e6fff0", "#123021"),
    style: style({ corners: "soft", borders: "subtle", elevation: "flat", sidebar: "plain", toolbar: "flat" }),
    iconPackId: "classic",
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Burnt orange and dusk plum for a warm evening workspace.",
    base: "windows",
    appearance: "dark",
    palette: palette("#fb923c", "#1a0f0d", "#261613", "#1f120f", "#fb923c", "#fff1e8", "#33201a"),
    style: style({ corners: "rounded", borders: "subtle", elevation: "elevated", sidebar: "tinted", toolbar: "subtle" }),
    iconPackId: "sunset-folders",
  },
  {
    id: "pastel",
    name: "Pastel",
    description: "Lavender surfaces, soft violet highlights, and gentle contrast.",
    base: "windows",
    appearance: "light",
    palette: palette("#8b5cf6", "#faf7ff", "#ffffff", "#f3edff", "#8b5cf6", "#2e243d", "#ffffff"),
    style: style({ corners: "rounded", borders: "minimal", elevation: "elevated", sidebar: "tinted", toolbar: "subtle" }),
    iconPackId: "soft-rounded",
  },
  {
    id: "glass",
    name: "Glass",
    description: "Cool translucent layers, cyan highlights, and Finder-style chrome.",
    base: "finder",
    appearance: "dark",
    palette: palette("#67e8f9", "#0b1220", "#111c2e", "#0e1728", "#67e8f9", "#f0fdff", "#16243a"),
    style: style({ corners: "rounded", borders: "subtle", elevation: "elevated", sidebar: "contrast", toolbar: "subtle" }),
    iconPackId: "soft-rounded",
  },
  {
    id: "high-contrast",
    name: "High Contrast",
    description: "Black, white, and signal yellow with strong, visible edges.",
    base: "windows",
    appearance: "dark",
    palette: palette("#ffff00", "#000000", "#000000", "#000000", "#ffff00", "#ffffff", "#000000"),
    style: style({ corners: "square", borders: "prominent", elevation: "flat", sidebar: "plain", toolbar: "flat", density: "spacious" }),
    iconPackId: "bold-contrast",
  },
  {
    id: "colourful",
    name: "Colourful",
    description: "A bright rose accent with playful pink-tinted panels.",
    base: "windows",
    appearance: "light",
    palette: palette("#db2777", "#fff7fb", "#ffffff", "#ffe9f4", "#db2777", "#2a1220", "#ffffff"),
    style: style({ corners: "rounded", borders: "subtle", elevation: "elevated", sidebar: "tinted", toolbar: "subtle" }),
    iconPackId: "sunset-folders",
  },
];

export function presetById(id: string | null | undefined): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

interface DesignOptions {
  name?: string;
  description?: string;
  author?: string;
  keepIdentity?: boolean;
}

export function designFromPreset(preset: ThemePreset, options: DesignOptions = {}): ThemeDesign {
  const name = options.name?.trim() || preset.name;
  const identity = createThemeIdentity(name, Date.now(), preset.id.slice(0, 4));
  const now = new Date().toISOString();
  return {
    id: identity.id,
    packageId: identity.packageId,
    name,
    description: options.description ?? preset.description,
    author: options.author ?? "",
    version: "1.0.0",
    base: preset.base,
    appearance: preset.appearance,
    palette: { ...preset.palette },
    style: { ...preset.style },
    iconPackId: preset.iconPackId,
    overrides: {},
    components: { paneDivider: { ...DEFAULT_PANE_DIVIDER } },
    presetId: preset.id,
    createdAt: now,
    updatedAt: now,
  };
}

/** Starting design when the user chooses "Start with a blank design". */
export function createBlankTheme(name = "My Theme"): ThemeDesign {
  const base = presetById("modern-minimal") ?? THEME_PRESETS[0];
  return designFromPreset(base, {
    name,
    description: "",
    author: "",
  });
}

export function designFromBuiltin(
  interfaceTheme: InterfaceTheme,
  appearance: ThemeAppearance,
  name?: string,
): ThemeDesign {
  const source = presetById(interfaceTheme === "finder" ? "macos-inspired" : "windows-inspired") ?? THEME_PRESETS[0];
  const modeAccent =
    interfaceTheme === "finder"
      ? appearance === "light"
        ? "#007aff"
        : "#0a84ff"
      : appearance === "light"
        ? "#0067c0"
        : "#60cdff";
  const matched: GeneratedPalette = generateMatchingPalette(modeAccent, appearance);
  const preset: ThemePreset = {
    ...source,
    appearance,
    palette: {
      ...matched,
      accent: modeAccent,
      selection: modeAccent,
      // Keep the built-in look recognisable while still giving the user a copy.
      menu: appearance === "light" ? "#f9f9f9" : "#2c2c2c",
    },
  };
  return designFromPreset(preset, {
    name: name ?? `${interfaceTheme === "finder" ? "Finder" : "Windows"} Look`,
    description: "A customisable copy of the built-in MAXplorer look.",
    author: "",
  });
}

export function duplicateThemeDesign(source: ThemeDesign, name?: string): ThemeDesign {
  const nextName = name ?? `${source.name} Copy`;
  const identity = createThemeIdentity(nextName, Date.now(), "copy");
  const now = new Date().toISOString();
  return {
    ...source,
    id: identity.id,
    packageId: identity.packageId,
    name: nextName,
    palette: { ...source.palette },
    style: { ...source.style },
    overrides: { ...source.overrides },
    components: { paneDivider: { ...source.components.paneDivider } },
    createdAt: now,
    updatedAt: now,
  };
}

export interface ReadyPalette {
  id: string;
  name: string;
  appearance: ThemeAppearance;
  palette: ThemePalette;
}

const READY_PALETTE_ACCENTS: ReadonlyArray<{
  id: string;
  name: string;
  appearance: ThemeAppearance;
  accent: string;
}> = [
  { id: "ocean", name: "Ocean", appearance: "dark", accent: "#2dd4bf" },
  { id: "midnight", name: "Midnight", appearance: "dark", accent: "#8da2ff" },
  { id: "graphite", name: "Graphite", appearance: "dark", accent: "#cbd5e1" },
  { id: "sand", name: "Warm Sand", appearance: "light", accent: "#b45309" },
  { id: "rose", name: "Rose Quartz", appearance: "light", accent: "#db2777" },
  { id: "forest", name: "Forest", appearance: "dark", accent: "#86efac" },
  { id: "lavender", name: "Lavender", appearance: "light", accent: "#8b5cf6" },
  { id: "citrus", name: "Citrus", appearance: "light", accent: "#ca8a04" },
  { id: "slate", name: "Slate", appearance: "dark", accent: "#38bdf8" },
  { id: "paper", name: "Paper", appearance: "light", accent: "#2563eb" },
];

/** Ready-made palettes used by the colour step and start screen. */
export const READY_PALETTES: readonly ReadyPalette[] = READY_PALETTE_ACCENTS.map((entry) => ({
  ...entry,
  palette: {
    ...generateMatchingPalette(entry.accent, entry.appearance),
    selection: entry.accent,
  },
}));

export function readyPaletteById(id: string | null | undefined): ReadyPalette | undefined {
  return READY_PALETTES.find((entry) => entry.id === id);
}

export function applyPalette(design: ThemeDesign, next: ThemePalette, appearance?: ThemeAppearance): ThemeDesign {
  return {
    ...design,
    appearance: appearance ?? design.appearance,
    palette: { ...next },
    updatedAt: new Date().toISOString(),
  };
}
