import { useAppearanceStore } from "../state/appearanceStore";
import {
  DEFAULT_PANE_DIVIDER,
  normalizePaneDividerDesign,
  type PaneDividerDesign,
} from "../lib/appearance/model";

/**
 * Resolves the active theme's divider configuration.
 *
 * Built-in themes use the shared defaults (their colours still come from the
 * semantic CSS tokens). Imported or custom themes may override any supported
 * property through `components.paneDivider`; invalid values were already
 * clamped during import, and are clamped again here defensively.
 */
export function usePaneDividerTheme(): PaneDividerDesign {
  const activeThemeId = useAppearanceStore((state) => state.activeThemeId);
  const themes = useAppearanceStore((state) => state.themes);
  const design = themes.find((theme) => theme.id === activeThemeId);
  if (!design) return DEFAULT_PANE_DIVIDER;
  return normalizePaneDividerDesign(design.components?.paneDivider);
}
