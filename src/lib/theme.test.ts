import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_INTERFACE_THEME,
  ICON_SCALE,
  INTERFACE_THEMES,
  INTERFACE_THEME_DEFINITIONS,
  TEXT_SCALE,
  THEME_METRICS,
  applyDisplayAttributes,
  applyThemeAttributes,
  iconScale,
  isInterfaceTheme,
  normalizeDensity,
  normalizeDisplayPreferences,
  normalizeIconSize,
  normalizeInterfaceTheme,
  normalizeTextSize,
  normalizeThemeMode,
  resolveAppearance,
  themeAttributes,
  themeMetrics,
  themeName,
} from "./theme";

describe("interface theme definitions", () => {
  it("exposes exactly the two supported interface themes", () => {
    expect(INTERFACE_THEMES).toEqual(["windows", "finder"]);
    expect(INTERFACE_THEME_DEFINITIONS.windows.name).toBe("Windows 11 Explorer");
    expect(INTERFACE_THEME_DEFINITIONS.finder.name).toBe("macOS Finder");
    expect(themeName("finder")).toBe("macOS Finder");
  });

  it("defaults to the Windows theme", () => {
    expect(DEFAULT_INTERFACE_THEME).toBe("windows");
    expect(normalizeInterfaceTheme(undefined)).toBe("windows");
    expect(normalizeInterfaceTheme(null)).toBe("windows");
    expect(normalizeInterfaceTheme("linux")).toBe("windows");
    expect(normalizeInterfaceTheme(42)).toBe("windows");
  });

  it("accepts only the known theme ids", () => {
    expect(isInterfaceTheme("windows")).toBe(true);
    expect(isInterfaceTheme("finder")).toBe(true);
    expect(isInterfaceTheme("macos")).toBe(false);
    expect(normalizeInterfaceTheme("finder")).toBe("finder");
  });
});

describe("appearance resolution", () => {
  it("keeps light/dark independent from the system preference", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });

  it("follows the system preference only in system mode", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });

  it("normalizes invalid appearance modes to system", () => {
    expect(normalizeThemeMode("sepia")).toBe("system");
    expect(normalizeThemeMode(undefined)).toBe("system");
    expect(normalizeThemeMode("dark")).toBe("dark");
  });
});

describe("theme attributes", () => {
  it("combines a normalized interface theme with the resolved appearance", () => {
    expect(themeAttributes("finder", "light", true)).toEqual({
      interfaceTheme: "finder",
      appearance: "light",
    });
    expect(themeAttributes("unknown", "system", true)).toEqual({
      interfaceTheme: "windows",
      appearance: "dark",
    });
    expect(themeAttributes("finder", "system", false)).toEqual({
      interfaceTheme: "finder",
      appearance: "light",
    });
  });

  it("is a no-op without a document (unit-test environment)", () => {
    expect(() =>
      applyThemeAttributes({ interfaceTheme: "finder", appearance: "dark" }),
    ).not.toThrow();
  });
});

describe("theme metrics", () => {
  it("provides row heights for both themes", () => {
    expect(THEME_METRICS.windows).toEqual({ detailsRow: 31, listRow: 22, groupRow: 30 });
    expect(THEME_METRICS.finder).toEqual({ detailsRow: 28, listRow: 24, groupRow: 28 });
    expect(themeMetrics("finder")).toBe(THEME_METRICS.finder);
    expect(themeMetrics("windows")).toBe(THEME_METRICS.windows);
  });

  it("reduces virtual rows with compact density so the canvas stays aligned", () => {
    expect(themeMetrics("windows", "compact")).toEqual({
      detailsRow: 27,
      listRow: 19,
      groupRow: 26,
    });
    expect(themeMetrics("finder", "compact")).toEqual({
      detailsRow: 25,
      listRow: 21,
      groupRow: 25,
    });
  });
});

describe("display preferences", () => {
  it("defaults to comfortable, default text and default icons", () => {
    expect(DEFAULT_DISPLAY_PREFERENCES).toEqual({
      density: "comfortable",
      textSize: "default",
      iconSize: "default",
    });
    expect(normalizeDisplayPreferences(undefined)).toEqual(DEFAULT_DISPLAY_PREFERENCES);
  });

  it("normalizes invalid or partial display values", () => {
    expect(normalizeDensity("compact")).toBe("compact");
    expect(normalizeDensity("tiny")).toBe("comfortable");
    expect(normalizeTextSize("large")).toBe("large");
    expect(normalizeTextSize(3)).toBe("default");
    expect(normalizeIconSize("small")).toBe("small");
    expect(normalizeIconSize(null)).toBe("default");
    expect(normalizeDisplayPreferences({ density: "compact", textSize: "huge" })).toEqual({
      density: "compact",
      textSize: "default",
      iconSize: "default",
    });
  });

  it("exposes deterministic text and icon scales", () => {
    expect(TEXT_SCALE.default).toBe(1);
    expect(TEXT_SCALE.small).toBeLessThan(1);
    expect(TEXT_SCALE.large).toBeGreaterThan(1);
    expect(iconScale("small")).toBe(ICON_SCALE.small);
    expect(iconScale("large")).toBe(ICON_SCALE.large);
  });

  it("is a no-op without a document (unit-test environment)", () => {
    expect(() => applyDisplayAttributes(DEFAULT_DISPLAY_PREFERENCES)).not.toThrow();
  });
});
