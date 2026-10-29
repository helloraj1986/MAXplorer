import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERFACE_THEME,
  INTERFACE_THEMES,
  INTERFACE_THEME_DEFINITIONS,
  THEME_METRICS,
  applyThemeAttributes,
  isInterfaceTheme,
  normalizeInterfaceTheme,
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
});
