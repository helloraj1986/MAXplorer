import type { InterfaceTheme } from "../types";
import {
  contrastRatio,
  generateMatchingPalette,
  isColor,
  normalizeHex,
} from "./color";

export type ThemeAppearance = "light" | "dark";
export type ThemeDensity = "compact" | "comfortable" | "spacious";
export type ThemeCornerStyle = "square" | "soft" | "rounded";
export type ThemeBorderStyle = "minimal" | "subtle" | "prominent";
export type ThemeElevation = "flat" | "elevated";
export type ThemeTextSize = "small" | "default" | "large";
export type ThemeIconSize = "small" | "default" | "large";
export type ThemeSidebarStyle = "plain" | "tinted" | "contrast";
export type ThemeToolbarStyle = "flat" | "subtle" | "elevated";
export type ThemeCreatorMode = "simple" | "advanced";

export interface ThemePalette {
  /** The main brand colour used for buttons, focus and highlights. */
  accent: string;
  /** Window backdrop behind panels. */
  background: string;
  /** Main file area and panel colour. */
  surface: string;
  /** Navigation pane colour. */
  sidebar: string;
  /** Selected row / highlighted item colour. */
  selection: string;
  /** Primary readable text colour. */
  text: string;
  /** Menus and small floating surfaces. */
  menu: string;
}

export interface ThemeStyle {
  corners: ThemeCornerStyle;
  density: ThemeDensity;
  borders: ThemeBorderStyle;
  elevation: ThemeElevation;
  iconSize: ThemeIconSize;
  textSize: ThemeTextSize;
  sidebar: ThemeSidebarStyle;
  toolbar: ThemeToolbarStyle;
}

/**
 * A complete, self-contained theme. This is the only shape stored in the
 * library, saved to disk, or accepted from an imported `.maxTheme` package.
 *
 * `overrides` is the Advanced Mode escape hatch. It is limited to the known
 * design-token list below; arbitrary CSS cannot be imported or generated.
 */
export interface ThemeDesign {
  id: string;
  packageId: string;
  name: string;
  description: string;
  author: string;
  version: "1.0.0";
  base: InterfaceTheme;
  appearance: ThemeAppearance;
  palette: ThemePalette;
  style: ThemeStyle;
  /** Selected icon pack, or null to use the application-wide icon pack. */
  iconPackId: string | null;
  /** Advanced-mode token overrides. Simple Mode never needs these. */
  overrides: Record<string, string>;
  /** Which ready-made look this theme started from, when applicable. */
  presetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IconPackFolderColors {
  backTop: string;
  backBottom: string;
  frontTop: string;
  frontBottom: string;
  stroke: string;
  shine: string;
}

export interface IconPack {
  id: string;
  name: string;
  description: string;
  author: string;
  builtIn: boolean;
  /** Visual weight of Lucide chrome icons. */
  strokeWidth: number;
  corner: "rounded" | "square";
  monochrome: boolean;
  folder: IconPackFolderColors;
  accent: string | null;
}

export interface ThemePackage {
  format: "maxplorer.theme";
  formatVersion: 1;
  exportedAt: string;
  theme: ThemeDesign;
}

export interface IconPackPackage {
  format: "maxplorer.icons";
  formatVersion: 1;
  exportedAt: string;
  iconPack: IconPack;
}

export interface ThemeValidationIssue {
  level: "error" | "warning" | "info";
  message: string;
  field?: "name" | "text" | "accent" | "surface" | "background" | "package";
  /** A palette field that can be repaired automatically, when applicable. */
  repair?: "text";
}

export interface ThemeValidationResult {
  ok: boolean;
  issues: ThemeValidationIssue[];
}

export const DEFAULT_THEME_STYLE: ThemeStyle = {
  corners: "soft",
  density: "comfortable",
  borders: "subtle",
  elevation: "elevated",
  iconSize: "default",
  textSize: "default",
  sidebar: "plain",
  toolbar: "subtle",
};

export const DEFAULT_THEME_PALETTE: ThemePalette = {
  accent: "#2563eb",
  background: "#f5f7fa",
  surface: "#ffffff",
  sidebar: "#eef2f7",
  selection: "#2563eb",
  text: "#0f172a",
  menu: "#ffffff",
};

/**
 * The complete set of tokens Advanced Mode may override and imported packages
 * may carry. Anything outside this list is ignored by normalization.
 */
export const ALLOWED_OVERRIDE_TOKENS: readonly string[] = [
  "--accent",
  "--accent-fill",
  "--accent-text",
  "--accent-border",
  "--accent-soft",
  "--accent-tint",
  "--mica",
  "--mica-2",
  "--surface",
  "--surface-raised",
  "--surface-2",
  "--surface-3",
  "--field",
  "--text",
  "--text-2",
  "--text-3",
  "--text-disabled",
  "--border",
  "--border-strong",
  "--hover",
  "--pressed",
  "--selected",
  "--selected-inactive",
  "--selection-border",
  "--menu",
  "--menu-border",
  "--menu-hover",
  "--statusbar",
  "--scrollbar",
  "--scrollbar-hover",
  "--focus-ring",
  "--danger",
  "--danger-text",
  "--warning",
  "--success",
  "--theme-background",
  "--theme-sidebar",
  "--theme-toolbar",
  "--theme-radius",
  "--radius",
  "--radius-menu",
  "--shadow-1",
  "--shadow-2",
  "--overlay",
  "--font-ui",
  "--font-display",
  "--icon-stroke",
  "--folder-back-top",
  "--folder-back-bottom",
  "--folder-front-top",
  "--folder-front-bottom",
  "--folder-stroke",
  "--folder-shine",
  "--storage-led",
  "--app-tile-accent",
] as const;

export const ALLOWED_OVERRIDE_TOKEN_SET = new Set(ALLOWED_OVERRIDE_TOKENS);

export const THEME_BASES: readonly InterfaceTheme[] = ["windows", "finder"];
export const THEME_APPEARANCES: readonly ThemeAppearance[] = ["light", "dark"];

const CORNER_STYLES = new Set<ThemeCornerStyle>(["square", "soft", "rounded"]);
const DENSITIES = new Set<ThemeDensity>(["compact", "comfortable", "spacious"]);
const BORDER_STYLES = new Set<ThemeBorderStyle>(["minimal", "subtle", "prominent"]);
const ELEVATIONS = new Set<ThemeElevation>(["flat", "elevated"]);
const TEXT_SIZES = new Set<ThemeTextSize>(["small", "default", "large"]);
const ICON_SIZES = new Set<ThemeIconSize>(["small", "default", "large"]);
const SIDEBAR_STYLES = new Set<ThemeSidebarStyle>(["plain", "tinted", "contrast"]);
const TOOLBAR_STYLES = new Set<ThemeToolbarStyle>(["flat", "subtle", "elevated"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const PACKAGE_PREFIX = "com.maxplorer.theme.";

export function slugify(value: string, fallback = "theme"): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

/**
 * Generates a stable-looking, human-readable theme id and package identifier.
 * Users never see or edit the package identifier in Simple Mode.
 */
export function createThemeIdentity(
  name: string,
  seed: string | number = Date.now(),
  salt = Math.random().toString(36).slice(2, 6),
): { id: string; packageId: string } {
  const slug = slugify(name);
  const suffix = `${String(seed).slice(-6)}${salt}`.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-8);
  const id = `${slug}-${suffix}`.slice(0, 80);
  return { id, packageId: `${PACKAGE_PREFIX}${id}` };
}

export function isThemeId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : fallback;
}

function validTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

export function normalizePalette(value: unknown, fallback: ThemePalette = DEFAULT_THEME_PALETTE): ThemePalette {
  const raw = value && typeof value === "object" ? (value as Partial<ThemePalette>) : {};
  return {
    accent: normalizeHex(raw.accent, fallback.accent),
    background: normalizeHex(raw.background, fallback.background),
    surface: normalizeHex(raw.surface, fallback.surface),
    sidebar: normalizeHex(raw.sidebar, fallback.sidebar),
    selection: normalizeHex(raw.selection, fallback.selection),
    text: normalizeHex(raw.text, fallback.text),
    menu: normalizeHex(raw.menu, fallback.menu),
  };
}

export function normalizeStyle(value: unknown): ThemeStyle {
  const raw = value && typeof value === "object" ? (value as Partial<ThemeStyle>) : {};
  return {
    corners: enumValue(raw.corners, CORNER_STYLES, DEFAULT_THEME_STYLE.corners),
    density: enumValue(raw.density, DENSITIES, DEFAULT_THEME_STYLE.density),
    borders: enumValue(raw.borders, BORDER_STYLES, DEFAULT_THEME_STYLE.borders),
    elevation: enumValue(raw.elevation, ELEVATIONS, DEFAULT_THEME_STYLE.elevation),
    iconSize: enumValue(raw.iconSize, ICON_SIZES, DEFAULT_THEME_STYLE.iconSize),
    textSize: enumValue(raw.textSize, TEXT_SIZES, DEFAULT_THEME_STYLE.textSize),
    sidebar: enumValue(raw.sidebar, SIDEBAR_STYLES, DEFAULT_THEME_STYLE.sidebar),
    toolbar: enumValue(raw.toolbar, TOOLBAR_STYLES, DEFAULT_THEME_STYLE.toolbar),
  };
}

/**
 * Advanced values are intentionally conservative: colours, lengths, shadows
 * and font stacks are allowed; braces, semicolons, url(), @ rules and
 * expression() are rejected so an imported file cannot inject CSS.
 */
export function sanitizeTokenValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return null;
  if (/[;{}<>@]|url\s*\(|expression\s*\(|javascript:|\\/i.test(trimmed)) return null;
  if (!/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--[a-z0-9-]+\)|[a-z0-9 .,%+\-/#()"']+)$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function normalizeOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_OVERRIDE_TOKEN_SET.has(key)) continue;
    const sanitized = sanitizeTokenValue(raw);
    if (sanitized) result[key] = sanitized;
  }
  return result;
}

export function normalizeThemeDesign(value: unknown): ThemeDesign | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ThemeDesign>;
  const name = cleanText(raw.name, 60);
  if (!name) return null;
  const now = new Date().toISOString();
  const identity = createThemeIdentity(name, Date.now(), "restore");
  const id = isThemeId(raw.id) ? raw.id : identity.id;
  const palette = normalizePalette(raw.palette);
  return {
    id,
    packageId:
      typeof raw.packageId === "string" && raw.packageId.startsWith(PACKAGE_PREFIX)
        ? raw.packageId.replace(/[^a-z0-9.-]/gi, "").slice(0, 120)
        : `${PACKAGE_PREFIX}${id}`,
    name,
    description: cleanText(raw.description, 200),
    author: cleanText(raw.author, 60),
    version: "1.0.0",
    base: raw.base === "finder" ? "finder" : "windows",
    appearance: raw.appearance === "light" ? "light" : "dark",
    palette,
    style: normalizeStyle(raw.style),
    iconPackId: typeof raw.iconPackId === "string" && raw.iconPackId ? raw.iconPackId.slice(0, 80) : null,
    overrides: normalizeOverrides(raw.overrides),
    presetId: typeof raw.presetId === "string" ? raw.presetId.slice(0, 80) : null,
    createdAt: validTimestamp(raw.createdAt, now),
    updatedAt: validTimestamp(raw.updatedAt, now),
  };
}

export function normalizedFolderColors(value: unknown): IconPackFolderColors {
  const raw = value && typeof value === "object" ? (value as Partial<IconPackFolderColors>) : {};
  return {
    backTop: normalizeHex(raw.backTop, "#7dbcf7"),
    backBottom: normalizeHex(raw.backBottom, "#2f8ff0"),
    frontTop: normalizeHex(raw.frontTop, "#9ed2ff"),
    frontBottom: normalizeHex(raw.frontBottom, "#3f9bf5"),
    stroke: normalizeHex(raw.stroke, "#0c3e78"),
    shine: normalizeHex(raw.shine, "#ffffff"),
  };
}

export function normalizeIconPack(value: unknown): IconPack | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IconPack>;
  const name = cleanText(raw.name, 60);
  if (!name) return null;
  const id = typeof raw.id === "string" && ID_PATTERN.test(raw.id) ? raw.id : createThemeIdentity(name, Date.now(), "icons").id;
  return {
    id,
    name,
    description: cleanText(raw.description, 180),
    author: cleanText(raw.author, 60),
    builtIn: raw.builtIn === true,
    strokeWidth:
      typeof raw.strokeWidth === "number" && Number.isFinite(raw.strokeWidth)
        ? Math.min(2.75, Math.max(1.1, Math.round(raw.strokeWidth * 100) / 100))
        : 1.75,
    corner: raw.corner === "square" ? "square" : "rounded",
    monochrome: raw.monochrome === true,
    folder: normalizedFolderColors(raw.folder),
    accent: isColor(raw.accent) ? normalizeHex(raw.accent) : null,
  };
}

export function visualValidation(design: ThemeDesign): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  if (!design.name.trim()) {
    issues.push({ level: "error", message: "Give your theme a name.", field: "name" });
  }
  if (!design.packageId.startsWith(PACKAGE_PREFIX)) {
    issues.push({
      level: "error",
      message: "The theme package identifier is not valid.",
      field: "package",
    });
  }
  const primary = contrastRatio(design.palette.text, design.palette.surface);
  if (primary < 4.5) {
    issues.push({
      level: primary < 3 ? "error" : "warning",
      message:
        primary < 3
          ? "Text would be very hard to read on the main panel."
          : "Text contrast is below the recommended level on the main panel.",
      field: "text",
      repair: "text",
    });
  }
  const windowContrast = contrastRatio(design.palette.text, design.palette.background);
  if (windowContrast < 4.5) {
    issues.push({
      level: windowContrast < 3 ? "error" : "warning",
      message:
        windowContrast < 3
          ? "Text would be very hard to read on the window background."
          : "Text contrast is below the recommended level on the window background.",
      field: "text",
      repair: "text",
    });
  }
  const sidebarContrast = contrastRatio(design.palette.text, design.palette.sidebar);
  if (sidebarContrast < 3) {
    issues.push({
      level: "warning",
      message: "Text may be hard to read in the navigation pane.",
      field: "text",
      repair: "text",
    });
  }
  const accentContrast = contrastRatio(design.palette.accent, design.palette.surface);
  if (accentContrast < 2.2) {
    issues.push({
      level: "warning",
      message: "The accent colour blends into the main panel.",
      field: "accent",
    });
  }
  return issues;
}

export function validateThemeDesign(design: ThemeDesign): ThemeValidationResult {
  const issues = visualValidation(design);
  return { ok: issues.every((issue) => issue.level !== "error"), issues };
}

export function repairThemeContrast(design: ThemeDesign): ThemeDesign {
  const palette = generateMatchingPalette(design.palette.accent, design.appearance);
  const repaired: ThemePalette = {
    ...design.palette,
    text:
      contrastRatio("#ffffff", design.palette.surface) >= contrastRatio("#111827", design.palette.surface)
        ? "#f8fafc"
        : "#111827",
  };
  // Prefer the user's chosen text when it already reads well.
  if (contrastRatio(design.palette.text, design.palette.surface) >= 4.5) {
    repaired.text = design.palette.text;
  } else if (contrastRatio(palette.text, design.palette.surface) >= 4.5) {
    repaired.text = palette.text;
  }
  return { ...design, palette: repaired, updatedAt: new Date().toISOString() };
}

export function buildThemePackage(design: ThemeDesign): ThemePackage {
  return {
    format: "maxplorer.theme",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    theme: design,
  };
}

export function buildIconPackPackage(iconPack: IconPack): IconPackPackage {
  return {
    format: "maxplorer.icons",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    iconPack,
  };
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseThemePackage(input: string | unknown): ParseResult<ThemePackage> {
  let value: unknown = input;
  if (typeof input === "string") {
    const text = input.replace(/^\uFEFF/, "");
    if (text.length > 1_000_000) {
      return { ok: false, error: "This theme package is too large." };
    }
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, error: "This file is not a valid theme package." };
    }
  }
  if (!value || typeof value !== "object") {
    return { ok: false, error: "This file is not a valid theme package." };
  }
  const raw = value as Partial<ThemePackage>;
  if (raw.format !== "maxplorer.theme") {
    return { ok: false, error: "This is not a MAXplorer theme package." };
  }
  if (raw.formatVersion !== 1) {
    return { ok: false, error: "This theme was made with a newer version of MAXplorer." };
  }
  const theme = normalizeThemeDesign(raw.theme);
  if (!theme) {
    return { ok: false, error: "The theme package is missing a valid theme." };
  }
  return {
    ok: true,
    value: {
      format: "maxplorer.theme",
      formatVersion: 1,
      exportedAt: validTimestamp(raw.exportedAt, new Date().toISOString()),
      theme,
    },
  };
}

export function parseIconPackPackage(input: string | unknown): ParseResult<IconPackPackage> {
  let value: unknown = input;
  if (typeof input === "string") {
    const text = input.replace(/^\uFEFF/, "");
    if (text.length > 1_000_000) {
      return { ok: false, error: "This icon package is too large." };
    }
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, error: "This file is not a valid icon package." };
    }
  }
  if (!value || typeof value !== "object") {
    return { ok: false, error: "This file is not a valid icon package." };
  }
  const raw = value as Partial<IconPackPackage>;
  if (raw.format !== "maxplorer.icons") {
    return { ok: false, error: "This is not a MAXplorer icon package." };
  }
  if (raw.formatVersion !== 1) {
    return { ok: false, error: "This icon pack was made with a newer version of MAXplorer." };
  }
  const iconPack = normalizeIconPack(raw.iconPack);
  if (!iconPack) {
    return { ok: false, error: "The icon package is missing valid icon information." };
  }
  return {
    ok: true,
    value: {
      format: "maxplorer.icons",
      formatVersion: 1,
      exportedAt: validTimestamp(raw.exportedAt, new Date().toISOString()),
      iconPack,
    },
  };
}

/** A portable, human-friendly file name for an export. */
export function packageFileName(design: ThemeDesign): string {
  return `${slugify(design.name)}.maxTheme`;
}

export function iconPackageFileName(pack: IconPack): string {
  return `${slugify(pack.name)}.maxIcons`;
}
