import { THEME_METRICS, type ThemeMetrics } from "../theme";
import {
  ensureContrast,
  mix,
  normalizeHex,
  readableOn,
  tint,
  withAlpha,
} from "./color";
import {
  ALLOWED_OVERRIDE_TOKENS,
  normalizePaneDividerDesign,
  type IconPack,
  type ThemeDesign,
  type ThemeDensity,
  type ThemeStyle,
} from "./model";

const TEXT_SCALE: Record<ThemeStyle["textSize"], number> = {
  small: 0.92,
  default: 1,
  large: 1.1,
};

const ICON_SCALE: Record<ThemeStyle["iconSize"], number> = {
  small: 0.86,
  default: 1,
  large: 1.15,
};

const DENSITY_SCALE: Record<ThemeDensity, number> = {
  compact: 0.88,
  comfortable: 1,
  spacious: 1.12,
};

const CORNER_RADIUS: Record<ThemeStyle["corners"], number> = {
  square: 2,
  soft: 6,
  rounded: 10,
};

export interface AdvancedTokenGroup {
  label: string;
  tokens: ReadonlyArray<{ name: string; label: string }>;
}

/** The friendly subset surfaced in Advanced Mode's token editor. */
export const ADVANCED_TOKEN_GROUPS: readonly AdvancedTokenGroup[] = [
  {
    label: "Accent and selection",
    tokens: [
      { name: "--accent", label: "Accent" },
      { name: "--accent-fill", label: "Accent fill" },
      { name: "--accent-text", label: "Text on accent" },
      { name: "--accent-border", label: "Accent border" },
      { name: "--accent-soft", label: "Accent soft" },
      { name: "--accent-tint", label: "Accent tint" },
      { name: "--selected", label: "Selected surface" },
      { name: "--selected-inactive", label: "Inactive selection" },
      { name: "--selection-border", label: "Selection outline" },
    ],
  },
  {
    label: "Surfaces",
    tokens: [
      { name: "--surface", label: "Main surface" },
      { name: "--surface-raised", label: "Raised surface" },
      { name: "--surface-2", label: "Secondary surface" },
      { name: "--surface-3", label: "Tertiary surface" },
      { name: "--field", label: "Input field" },
    ],
  },
  {
    label: "Text",
    tokens: [
      { name: "--text", label: "Primary text" },
      { name: "--text-2", label: "Secondary text" },
      { name: "--text-3", label: "Muted text" },
      { name: "--text-disabled", label: "Disabled text" },
    ],
  },
  {
    label: "Lines and feedback",
    tokens: [
      { name: "--border", label: "Border" },
      { name: "--border-strong", label: "Strong border" },
      { name: "--hover", label: "Hover surface" },
      { name: "--pressed", label: "Pressed surface" },
      { name: "--focus-ring", label: "Focus ring" },
      { name: "--danger", label: "Danger" },
      { name: "--danger-text", label: "Danger text" },
      { name: "--warning", label: "Warning" },
      { name: "--success", label: "Success" },
      { name: "--overlay", label: "Modal overlay" },
    ],
  },
  {
    label: "Dual pane",
    tokens: [
      { name: "--pane-divider-color", label: "Divider" },
      { name: "--pane-divider-hover-color", label: "Divider hover" },
      { name: "--pane-divider-active-color", label: "Divider dragging" },
      { name: "--pane-divider-grip-color", label: "Divider grip" },
      { name: "--pane-active-indicator-color", label: "Active pane indicator" },
      { name: "--pane-header-background", label: "Pane header" },
      { name: "--pane-header-border-color", label: "Pane header border" },
      { name: "--pane-focus-ring-color", label: "Pane focus ring" },
    ],
  },
  {
    label: "Window chrome and menus",
    tokens: [
      { name: "--mica", label: "Window backdrop" },
      { name: "--mica-2", label: "Secondary backdrop" },
      { name: "--theme-background", label: "App background" },
      { name: "--theme-sidebar", label: "Sidebar background" },
      { name: "--theme-toolbar", label: "Toolbar background" },
      { name: "--statusbar", label: "Status bar" },
      { name: "--menu", label: "Menu" },
      { name: "--menu-border", label: "Menu border" },
      { name: "--menu-hover", label: "Menu highlight" },
      { name: "--scrollbar", label: "Scrollbar thumb" },
      { name: "--scrollbar-hover", label: "Scrollbar hover" },
    ],
  },
  {
    label: "Shape and type",
    tokens: [
      { name: "--theme-radius", label: "Corner radius" },
      { name: "--radius", label: "Control radius" },
      { name: "--radius-menu", label: "Menu radius" },
      { name: "--shadow-1", label: "Small shadow" },
      { name: "--shadow-2", label: "Large shadow" },
      { name: "--font-ui", label: "Interface font" },
      { name: "--font-display", label: "Heading font" },
      { name: "--icon-stroke", label: "Icon stroke" },
    ],
  },
  {
    label: "Folder and storage artwork",
    tokens: [
      { name: "--folder-back-top", label: "Folder back top" },
      { name: "--folder-back-bottom", label: "Folder back bottom" },
      { name: "--folder-front-top", label: "Folder front top" },
      { name: "--folder-front-bottom", label: "Folder front bottom" },
      { name: "--folder-stroke", label: "Folder outline" },
      { name: "--folder-shine", label: "Folder shine" },
      { name: "--storage-led", label: "Storage indicator" },
      { name: "--app-tile-accent", label: "Application accent" },
    ],
  },
];

const appliedKeys = new Set<string>();

function addVars(target: Record<string, string>, values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value) target[key] = value;
  }
}

/**
 * Converts a friendly design into the full set of CSS tokens the application
 * already consumes. This is the bridge that lets a visual choice in the creator
 * apply to every real MAXplorer surface without duplicating component styles.
 */
export function themeCssVariables(design: ThemeDesign): Record<string, string> {
  const { palette, style, appearance } = design;
  const isDark = appearance === "dark";
  const surface = normalizeHex(palette.surface);
  const background = normalizeHex(palette.background);
  const text = normalizeHex(palette.text);
  const accent = normalizeHex(palette.accent);
  const selection = normalizeHex(palette.selection);
  const menu = normalizeHex(palette.menu);

  const borderStep = style.borders === "minimal" ? 0.09 : style.borders === "prominent" ? 0.28 : 0.16;
  const strongStep = style.borders === "minimal" ? 0.15 : style.borders === "prominent" ? 0.42 : 0.24;
  const border = mix(surface, text, borderStep);
  const borderStrong = mix(surface, text, strongStep);
  const raised = isDark ? mix(surface, text, 0.06) : surface;
  const surface2 = mix(surface, text, 0.045);
  const surface3 = mix(surface, text, 0.085);
  const text2 = ensureContrast(mix(text, surface, 0.3), surface, 4.5);
  const text3 = ensureContrast(mix(text, surface, 0.48), surface, 3);
  const accentText = ensureContrast(readableOn(accent, "#ffffff", "#091018"), accent, 4.5);
  const accentSoft = withAlpha(accent, isDark ? 0.22 : 0.14);
  const accentTint = withAlpha(accent, isDark ? 0.1 : 0.07);
  const danger = isDark ? "#ff7b72" : "#b42318";
  const warning = isDark ? "#f2cc60" : "#8a5a00";
  const success = isDark ? "#7ee787" : "#18794e";

  const sidebarBase =
    style.sidebar === "tinted"
      ? tint(palette.sidebar, accent, isDark ? 0.1 : 0.06)
      : style.sidebar === "contrast"
        ? mix(palette.sidebar, text, isDark ? 0.1 : 0.06)
        : palette.sidebar;
  const sidebar = normalizeHex(sidebarBase);
  const toolbar =
    style.toolbar === "flat"
      ? background
      : style.toolbar === "elevated"
        ? raised
        : mix(background, surface, 0.55);
  const radius = CORNER_RADIUS[style.corners];
  const shadow =
    style.elevation === "flat"
      ? "none"
      : isDark
        ? "0 16px 48px rgba(0, 0, 0, 0.48), 0 2px 6px rgba(0, 0, 0, 0.32)"
        : "0 16px 48px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08)";

  const divider = normalizePaneDividerDesign(design.components?.paneDivider);
  // The divider is never allowed to resolve to the pane surface. Even a
  // minimalist theme gets a measurable step away from both adjacent panes; a
  // component-level or token-level value can still override this.
  const dividerColor = divider.color ?? ensureContrast(borderStrong, surface, 2);
  const dividerHoverColor =
    divider.hoverColor ?? ensureContrast(readableOn(surface, accent, text), surface, 2.6);
  const dividerActiveColor = divider.activeColor ?? accent;
  const dividerGripColor = divider.gripColor ?? text3;
  const activeIndicatorColor = accent;
  const paneHeaderBackground = divider.headerBackground ?? toolbar;
  const paneHeaderBorderColor = divider.headerBorderColor ?? borderStrong;

  const variables: Record<string, string> = {
    "--theme-background": background,
    "--theme-sidebar": sidebar,
    "--theme-toolbar": toolbar,
    "--theme-radius": `${radius}px`,
    "--mica": background,
    "--mica-2": mix(background, surface, 0.4),
    "--surface": surface,
    "--surface-raised": raised,
    "--surface-2": surface2,
    "--surface-3": surface3,
    "--field": isDark ? mix(surface, text, 0.075) : mix(surface, text, 0.035),
    "--text": text,
    "--text-2": text2,
    "--text-3": text3,
    "--text-disabled": mix(text, surface, 0.58),
    "--border": border,
    "--border-strong": borderStrong,
    "--pane-divider-color": dividerColor,
    "--pane-divider-hover-color": dividerHoverColor,
    "--pane-divider-active-color": dividerActiveColor,
    "--pane-divider-grip-color": dividerGripColor,
    "--pane-divider-width": `${divider.width}px`,
    "--pane-divider-hit-area": `${divider.hitAreaWidth}px`,
    "--pane-divider-radius": `${divider.cornerRadius}px`,
    "--pane-active-indicator-color": activeIndicatorColor,
    "--pane-header-background": paneHeaderBackground,
    "--pane-header-border-color": paneHeaderBorderColor,
    "--pane-focus-ring-color": accent,
    "--hover": mix(surface, text, 0.07),
    "--pressed": mix(surface, text, 0.12),
    "--selected": withAlpha(selection, isDark ? 0.34 : 0.22),
    "--selected-inactive": withAlpha(selection, isDark ? 0.12 : 0.08),
    "--selection-border": withAlpha(selection, 0.55),
    "--accent": accent,
    "--accent-fill": accent,
    "--accent-text": accentText,
    "--accent-border": mix(accent, text, 0.2),
    "--accent-soft": accentSoft,
    "--accent-tint": accentTint,
    "--danger": danger,
    "--danger-text": isDark ? "#ff9da6" : "#b42318",
    "--warning": warning,
    "--success": success,
    "--menu": menu,
    "--menu-border": borderStrong,
    "--menu-hover": tint(menu, accent, isDark ? 0.22 : 0.12),
    "--menu-shadow": shadow,
    "--scrollbar": mix(surface, text, 0.3),
    "--scrollbar-hover": mix(surface, text, 0.5),
    "--statusbar": sidebar,
    "--image-border": withAlpha(text, 0.14),
    "--focus-ring": accent,
    "--warning-soft": withAlpha(warning, 0.1),
    "--overlay": withAlpha("#000000", isDark ? 0.52 : 0.34),
    "--shadow-1":
      style.elevation === "flat"
        ? "none"
        : isDark
          ? "0 2px 8px rgba(0, 0, 0, 0.28)"
          : "0 2px 8px rgba(15, 23, 42, 0.1)",
    "--shadow-2": shadow,
    "--radius": `${radius}px`,
    "--radius-menu": `${radius + 4}px`,
    "--finder-sidebar": sidebar,
    "--finder-toolbar": toolbar,
    "--finder-separator": border,
    "--storage-led": accent,
    "--app-tile-accent": accent,
    "--ui-text-scale": String(TEXT_SCALE[style.textSize]),
    "--ui-icon-scale": String(ICON_SCALE[style.iconSize]),
  };

  addVars(variables, design.overrides);
  return variables;
}

/** Folder artwork colours for a built-in base, used by live previews. */
export function baseFolderCssVariables(base: "windows" | "finder"): Record<string, string> {
  if (base === "finder") {
    return {
      "--folder-back-top": "#8cc7fa",
      "--folder-back-bottom": "#3b95f2",
      "--folder-front-top": "#a9d8ff",
      "--folder-front-bottom": "#4aa2f7",
      "--folder-stroke": "rgba(12, 62, 120, 0.22)",
      "--folder-shine": "rgba(255, 255, 255, 0.5)",
    };
  }
  return {
    "--folder-back-top": "#f8cd54",
    "--folder-back-bottom": "#e5a921",
    "--folder-front-top": "#ffe187",
    "--folder-front-bottom": "#f7bf4a",
    "--folder-stroke": "rgba(116, 74, 0, 0.22)",
    "--folder-shine": "rgba(255, 255, 255, 0.4)",
  };
}

export function iconPackCssVariables(pack: IconPack): Record<string, string> {
  if (!pack || pack.id === "classic") return {};
  const monochrome = pack.monochrome;
  return {
    "--icon-stroke": String(pack.strokeWidth),
    "--folder-back-top": pack.folder.backTop,
    "--folder-back-bottom": pack.folder.backBottom,
    "--folder-front-top": pack.folder.frontTop,
    "--folder-front-bottom": pack.folder.frontBottom,
    "--folder-stroke": withAlpha(pack.folder.stroke, 0.3),
    "--folder-shine": withAlpha(pack.folder.shine, 0.46),
    ...(monochrome
      ? {
          "--file-accent-pdf": "#64748b",
          "--file-accent-word": "#64748b",
          "--file-accent-sheet": "#64748b",
          "--file-accent-slides": "#64748b",
          "--file-accent-image": "#64748b",
          "--file-accent-video": "#64748b",
          "--file-accent-audio": "#64748b",
          "--file-accent-archive": "#64748b",
          "--file-accent-code": "#64748b",
          "--storage-led": "#64748b",
          "--app-tile-accent": "#64748b",
        }
      : {}),
    ...(pack.accent
      ? {
          "--storage-led": pack.accent,
          "--app-tile-accent": pack.accent,
        }
      : {}),
  };
}

export function designRowMetrics(design: ThemeDesign): ThemeMetrics {
  const base = THEME_METRICS[design.base];
  const scale = DENSITY_SCALE[design.style.density] ?? 1;
  return {
    detailsRow: Math.max(20, Math.round(base.detailsRow * scale)),
    listRow: Math.max(18, Math.round(base.listRow * scale)),
    groupRow: Math.max(20, Math.round(base.groupRow * scale)),
  };
}

function applyVariables(values: Record<string, string>, target: HTMLElement): void {
  for (const [key, value] of Object.entries(values)) {
    target.style.setProperty(key, value);
    appliedKeys.add(key);
  }
}

/** Applies a custom theme to the running application. */
export function applyThemeDesign(design: ThemeDesign, iconPack?: IconPack | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const divider = normalizePaneDividerDesign(design.components?.paneDivider);
  applyIconPack(iconPack ?? null);
  applyVariables(themeCssVariables(design), root);
  root.dataset.customTheme = "true";
  root.dataset.uiTheme = design.base;
  root.dataset.theme = design.appearance;
  root.dataset.density = design.style.density;
  root.dataset.textSize = design.style.textSize;
  root.dataset.iconSize = design.style.iconSize;
  root.dataset.themeCorners = design.style.corners;
  root.dataset.themeBorders = design.style.borders;
  root.dataset.paneGrip = divider.showGrip ? divider.gripVisibility : "never";
  root.dataset.paneIndicator = divider.activeIndicator;
  root.style.colorScheme = design.appearance;
}

/** Applies an icon pack to the built-in themes as well as custom themes. */
export function applyIconPack(pack: IconPack | null | undefined): void {
  if (typeof document === "undefined") return;
  clearIconPack();
  const root = document.documentElement;
  if (!pack) return;
  const values = iconPackCssVariables(pack);
  applyVariables(values, root);
  root.dataset.iconPack = pack.id;
}

export function clearIconPack(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of [
    "--icon-stroke",
    "--folder-back-top",
    "--folder-back-bottom",
    "--folder-front-top",
    "--folder-front-bottom",
    "--folder-stroke",
    "--folder-shine",
    "--file-accent-pdf",
    "--file-accent-word",
    "--file-accent-sheet",
    "--file-accent-slides",
    "--file-accent-image",
    "--file-accent-video",
    "--file-accent-audio",
    "--file-accent-archive",
    "--file-accent-code",
    "--storage-led",
    "--app-tile-accent",
  ]) {
    root.style.removeProperty(key);
    appliedKeys.delete(key);
  }
  delete root.dataset.iconPack;
}

/** Removes custom tokens so the selected built-in theme takes over again. */
export function clearThemeDesign(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of appliedKeys) {
    root.style.removeProperty(key);
  }
  appliedKeys.clear();
  delete root.dataset.customTheme;
  delete root.dataset.themeCorners;
  delete root.dataset.themeBorders;
  delete root.dataset.paneGrip;
  delete root.dataset.paneIndicator;
  delete root.dataset.iconPack;
}

export function customThemeVariableAllowList(): readonly string[] {
  return ALLOWED_OVERRIDE_TOKENS;
}
