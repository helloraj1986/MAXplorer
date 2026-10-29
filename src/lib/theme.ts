import type { InterfaceTheme, ThemeMode } from "./types";

/**
 * The interface design is a separate axis from light/dark appearance.
 *
 * - `windows` reproduces Windows 11 File Explorer.
 * - `finder` reproduces macOS Finder.
 *
 * Both designs share the same application state, Tauri commands, and filesystem
 * services. Only presentation (tokens + CSS variants) changes.
 */
export const INTERFACE_THEMES: readonly InterfaceTheme[] = ["windows", "finder"];

export const DEFAULT_INTERFACE_THEME: InterfaceTheme = "windows";

export interface InterfaceThemeDefinition {
  id: InterfaceTheme;
  name: string;
  description: string;
  /** Short label used in compact surfaces such as the Options dialog. */
  shortName: string;
}

export const INTERFACE_THEME_DEFINITIONS: Record<InterfaceTheme, InterfaceThemeDefinition> = {
  windows: {
    id: "windows",
    name: "Windows 11 Explorer",
    shortName: "Windows 11",
    description:
      "Fluent surfaces, a tab strip, command bar, and breadcrumb address bar modeled on Windows 11 File Explorer.",
  },
  finder: {
    id: "finder",
    name: "macOS Finder",
    shortName: "Finder",
    description:
      "A macOS toolbar with traffic lights, a source-list sidebar, Finder-style rows, menus, and selection.",
  },
};

/** Row heights consumed by the virtualized file views. CSS mirrors these values. */
export interface ThemeMetrics {
  detailsRow: number;
  listRow: number;
  groupRow: number;
}

export const THEME_METRICS: Record<InterfaceTheme, ThemeMetrics> = {
  windows: { detailsRow: 31, listRow: 22, groupRow: 30 },
  finder: { detailsRow: 28, listRow: 24, groupRow: 28 },
};

export type Appearance = "light" | "dark";

export interface ThemeAttributes {
  interfaceTheme: InterfaceTheme;
  appearance: Appearance;
}

export function isInterfaceTheme(value: unknown): value is InterfaceTheme {
  return value === "windows" || value === "finder";
}

/** Never throws: unknown, missing, or legacy values fall back to the default. */
export function normalizeInterfaceTheme(value: unknown): InterfaceTheme {
  return isInterfaceTheme(value) ? value : DEFAULT_INTERFACE_THEME;
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

/** Resolves the user preference (system/light/dark) against the OS preference. */
export function resolveAppearance(mode: ThemeMode, prefersDark: boolean): Appearance {
  if (mode === "light" || mode === "dark") return mode;
  return prefersDark ? "dark" : "light";
}

export function themeAttributes(
  interfaceTheme: unknown,
  mode: unknown,
  prefersDark: boolean,
): ThemeAttributes {
  return {
    interfaceTheme: normalizeInterfaceTheme(interfaceTheme),
    appearance: resolveAppearance(normalizeThemeMode(mode), prefersDark),
  };
}

/**
 * Applies the resolved theme to the document root. Called before the first React
 * render (no flash of the wrong theme) and again whenever the preference changes.
 */
export function applyThemeAttributes(attributes: ThemeAttributes): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.uiTheme = attributes.interfaceTheme;
  root.dataset.theme = attributes.appearance;
  root.style.colorScheme = attributes.appearance;
}

export function themeName(theme: InterfaceTheme): string {
  return INTERFACE_THEME_DEFINITIONS[theme].name;
}

export function themeMetrics(theme: InterfaceTheme): ThemeMetrics {
  return THEME_METRICS[theme];
}
