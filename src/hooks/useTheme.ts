import { useEffect, useState } from "react";
import { useExplorerStore } from "../state/explorerStore";
import {
  applyThemeAttributes,
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
 * Applies the interface theme (`data-ui-theme`) and the resolved light/dark
 * appearance (`data-theme`) to the document root. Returns the resolved appearance.
 *
 * The theme pair is applied before React renders (see `main.tsx`) so the window
 * never flashes the wrong design; this hook keeps it in sync afterwards.
 */
export function useTheme(): Appearance {
  const theme = useExplorerStore((state) => state.theme);
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const [resolved, setResolved] = useState<Appearance>(() => resolveAppearance(theme, systemPrefersDark()));

  useEffect(() => {
    const query =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const apply = () => {
      const appearance = resolveAppearance(theme, query?.matches ?? false);
      applyThemeAttributes({ interfaceTheme, appearance });
      setResolved(appearance);
    };
    apply();
    query?.addEventListener("change", apply);
    return () => query?.removeEventListener("change", apply);
  }, [theme, interfaceTheme]);

  return resolved;
}

/** Row heights for the virtualized file views, mirroring the active theme's CSS. */
export function useThemeMetrics(): ThemeMetrics {
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  return themeMetrics(interfaceTheme);
}
