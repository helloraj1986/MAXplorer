import { useEffect, useState } from "react";
import { useExplorerStore } from "../state/explorerStore";
import { useAppearanceStore } from "../state/appearanceStore";
import { iconPackForId } from "../lib/appearance/iconPacks";
import {
  applyIconPack,
  applyThemeDesign,
  clearThemeDesign,
  designRowMetrics,
} from "../lib/appearance/tokens";
import {
  applyDisplayAttributes,
  applyThemeAttributes,
  iconScale,
  resolveAppearance,
  themeMetrics,
  type Appearance,
  type ThemeMetrics,
} from "../lib/theme";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Applies the built-in interface theme, the resolved light/dark appearance, the
 * active custom design (if any), and the selected icon pack.
 *
 * A custom theme is a complete presentation layer. It carries its own base
 * interface (Windows or Finder), appearance, colours, shape and typography, so
 * switching to it never changes files, tabs, selection or filesystem behavior.
 */
export function useTheme(): Appearance {
  const theme = useExplorerStore((state) => state.theme);
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const display = useExplorerStore((state) => state.display);
  const activeThemeId = useAppearanceStore((state) => state.activeThemeId);
  const themes = useAppearanceStore((state) => state.themes);
  const iconPacks = useAppearanceStore((state) => state.iconPacks);
  const activeIconPackId = useAppearanceStore((state) => state.activeIconPackId);
  const activeDesign = themes.find((candidate) => candidate.id === activeThemeId) ?? null;
  const [resolved, setResolved] = useState<Appearance>(() =>
    activeDesign ? activeDesign.appearance : resolveAppearance(theme, systemPrefersDark()),
  );

  useEffect(() => {
    const query =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const apply = () => {
      const appearance = activeDesign
        ? activeDesign.appearance
        : resolveAppearance(theme, query?.matches ?? false);
      applyThemeAttributes({
        interfaceTheme: activeDesign ? activeDesign.base : interfaceTheme,
        appearance,
      });
      applyDisplayAttributes(display);
      const pack = iconPackForId(iconPacks, activeDesign?.iconPackId ?? activeIconPackId);
      if (activeDesign) {
        applyThemeDesign(activeDesign, pack);
      } else {
        clearThemeDesign();
        applyIconPack(pack);
        applyDisplayAttributes(display);
      }
      setResolved(appearance);
    };
    apply();
    query?.addEventListener("change", apply);
    return () => query?.removeEventListener("change", apply);
  }, [theme, interfaceTheme, display, activeDesign, iconPacks, activeIconPackId]);

  return resolved;
}

/** Row heights for the virtualized file views, mirroring the active theme. */
export function useThemeMetrics(): ThemeMetrics {
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const density = useExplorerStore((state) => state.display.density);
  const activeThemeId = useAppearanceStore((state) => state.activeThemeId);
  const themes = useAppearanceStore((state) => state.themes);
  const activeDesign = themes.find((theme) => theme.id === activeThemeId);
  if (activeDesign) return designRowMetrics(activeDesign);
  return themeMetrics(interfaceTheme, density);
}

/** Scales file artwork without changing row geometry outside the icon box. */
export function useIconScale(): number {
  const size = useExplorerStore((state) => state.display.iconSize);
  const activeThemeId = useAppearanceStore((state) => state.activeThemeId);
  const themes = useAppearanceStore((state) => state.themes);
  const activeDesign = themes.find((theme) => theme.id === activeThemeId);
  if (activeDesign) {
    return activeDesign.style.iconSize === "small" ? 0.86 : activeDesign.style.iconSize === "large" ? 1.15 : 1;
  }
  return iconScale(size);
}
