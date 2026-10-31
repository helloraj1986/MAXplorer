// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import {
  DEFAULT_PANE_DIVIDER,
  DEFAULT_THEME_COMPONENTS,
  buildThemePackage,
  normalizePaneDividerDesign,
  normalizeThemeDesign,
  paneDividerConfigIssues,
  parseThemePackage,
  type ThemeDesign,
} from "./model";
import { applyThemeDesign, clearThemeDesign, themeCssVariables } from "./tokens";

function design(overrides: Partial<ThemeDesign> = {}): ThemeDesign {
  const base = normalizeThemeDesign({
    name: "Divider test",
    base: "windows",
    appearance: "light",
    palette: {
      accent: "#2563eb",
      background: "#f5f7fa",
      surface: "#ffffff",
      sidebar: "#eef2f7",
      selection: "#2563eb",
      text: "#0f172a",
      menu: "#ffffff",
    },
    style: {
      corners: "soft",
      density: "comfortable",
      borders: "subtle",
      elevation: "elevated",
      iconSize: "default",
      textSize: "default",
      sidebar: "plain",
      toolbar: "subtle",
    },
    version: "1.0.0",
  });
  if (!base) throw new Error("test theme failed to normalize");
  return { ...base, ...overrides };
}

afterEach(() => clearThemeDesign());

describe("pane divider theme configuration", () => {
  it("uses sensible defaults when a legacy theme has no components block", () => {
    const legacy = normalizeThemeDesign({ name: "Legacy", palette: {}, style: {} });
    expect(legacy?.components).toEqual(DEFAULT_THEME_COMPONENTS);
    expect(normalizePaneDividerDesign(undefined)).toEqual(DEFAULT_PANE_DIVIDER);
  });

  it("accepts a theme-authored divider configuration", () => {
    const config = normalizePaneDividerDesign({
      width: 3,
      hitAreaWidth: 18,
      color: "#6b7280",
      hoverColor: "#374151",
      activeColor: "#2563eb",
      gripColor: "#6b7280",
      showGrip: true,
      gripVisibility: "always",
      activeIndicator: "top-line",
      cornerRadius: 2,
      headerBackground: "#f1f5f9",
      headerBorderColor: "#cbd5e1",
    });
    expect(config).toMatchObject({
      width: 3,
      hitAreaWidth: 18,
      color: "#6b7280",
      hoverColor: "#374151",
      activeColor: "#2563eb",
      gripColor: "#6b7280",
      gripVisibility: "always",
      activeIndicator: "top-line",
      cornerRadius: 2,
      headerBackground: "#f1f5f9",
      headerBorderColor: "#cbd5e1",
    });
  });

  it("clamps hostile dimensions and ignores invalid colours", () => {
    const config = normalizePaneDividerDesign({
      width: 400,
      hitAreaWidth: 1,
      cornerRadius: -8,
      color: "url(https://evil.example)",
      hoverColor: "red; background: black",
      activeIndicator: "explode",
      gripVisibility: "sometimes",
    });
    expect(config.width).toBe(8);
    expect(config.hitAreaWidth).toBe(12);
    expect(config.cornerRadius).toBe(0);
    expect(config.color).toBeNull();
    expect(config.hoverColor).toBeNull();
    expect(config.activeIndicator).toBe("accent-border");
    expect(config.gripVisibility).toBe("hover");
  });

  it("keeps the pointer target larger than a thick visible line", () => {
    const config = normalizePaneDividerDesign({ width: 8, hitAreaWidth: 12 });
    expect(config.hitAreaWidth).toBeGreaterThan(config.width);
    expect(config.hitAreaWidth).toBeGreaterThanOrEqual(12);
  });

  it("reports useful diagnostics for invalid imported configuration", () => {
    const issues = paneDividerConfigIssues({
      width: 40,
      color: "not-a-colour",
      activeIndicator: "rainbow",
      showGrip: "yes",
    });
    expect(issues).toHaveLength(4);
    expect(issues.every((issue) => issue.field === "divider")).toBe(true);
    expect(issues.some((issue) => issue.message.includes("width"))).toBe(true);
    expect(paneDividerConfigIssues(undefined)).toEqual([]);
    expect(paneDividerConfigIssues("nope")).toHaveLength(1);
  });
});

describe("pane divider token resolution", () => {
  it("exposes explicit divider tokens for the default theme", () => {
    const variables = themeCssVariables(design());
    expect(variables["--pane-divider-width"]).toBe("2px");
    expect(variables["--pane-divider-hit-area"]).toBe("14px");
    expect(variables["--pane-divider-radius"]).toBe("1px");
    expect(variables["--pane-active-indicator-color"]).toBe("#2563eb");
    expect(variables["--pane-focus-ring-color"]).toBe("#2563eb");
    expect(variables["--pane-header-background"]).toBeTruthy();
    expect(variables["--pane-header-border-color"]).toBeTruthy();
  });

  it("derives a visible divider when the theme supplies no divider colour", () => {
    for (const appearance of ["light", "dark"] as const) {
      const variables = themeCssVariables(
        design({
          appearance,
          ...(appearance === "dark"
            ? {
                palette: {
                  accent: "#60cdff",
                  background: "#111111",
                  surface: "#191919",
                  sidebar: "#151515",
                  selection: "#60cdff",
                  text: "#ffffff",
                  menu: "#222222",
                },
              }
            : {}),
        }),
      );
      expect(contrastRatio(variables["--pane-divider-color"], variables["--surface"])).toBeGreaterThanOrEqual(2);
      expect(contrastRatio(variables["--pane-divider-hover-color"], variables["--surface"])).toBeGreaterThanOrEqual(
        2.6,
      );
      expect(contrastRatio(variables["--pane-divider-active-color"], variables["--surface"])).toBeGreaterThan(1);
    }
  });

  it("honours explicit component colours instead of the derived fallback", () => {
    const variables = themeCssVariables(
      design({
        components: {
          paneDivider: {
            ...DEFAULT_PANE_DIVIDER,
            color: "#ff00aa",
            hoverColor: "#00ffaa",
            activeColor: "#123456",
            gripColor: "#654321",
          },
        },
      }),
    );
    expect(variables["--pane-divider-color"]).toBe("#ff00aa");
    expect(variables["--pane-divider-hover-color"]).toBe("#00ffaa");
    expect(variables["--pane-divider-active-color"]).toBe("#123456");
    expect(variables["--pane-divider-grip-color"]).toBe("#654321");
  });

  it("allows Advanced Mode token overrides to win over derived values", () => {
    const variables = themeCssVariables(
      design({ overrides: { "--pane-divider-color": "#abcdef" } }),
    );
    expect(variables["--pane-divider-color"]).toBe("#abcdef");
  });
});

describe("pane divider live theme switching", () => {
  it("applies tokens and indicator attributes, then restores built-in defaults", () => {
    const first = design({
      components: {
        paneDivider: {
          ...DEFAULT_PANE_DIVIDER,
          color: "#222222",
          gripVisibility: "always",
          activeIndicator: "header",
        },
      },
    });
    applyThemeDesign(first);
    const root = document.documentElement;
    expect(root.dataset.customTheme).toBe("true");
    expect(root.dataset.paneGrip).toBe("always");
    expect(root.dataset.paneIndicator).toBe("header");
    expect(root.style.getPropertyValue("--pane-divider-color")).toBe("#222222");

    const second = design({
      appearance: "dark",
      components: {
        paneDivider: {
          ...DEFAULT_PANE_DIVIDER,
          color: "#eeeeee",
          gripVisibility: "never",
          activeIndicator: "none",
        },
      },
    });
    applyThemeDesign(second);
    expect(root.dataset.paneGrip).toBe("never");
    expect(root.dataset.paneIndicator).toBe("none");
    expect(root.style.getPropertyValue("--pane-divider-color")).toBe("#eeeeee");
    expect(root.style.getPropertyValue("--pane-divider-width")).toBe("2px");

    clearThemeDesign();
    expect(root.dataset.customTheme).toBeUndefined();
    expect(root.dataset.paneGrip).toBeUndefined();
    expect(root.dataset.paneIndicator).toBeUndefined();
    expect(root.style.getPropertyValue("--pane-divider-color")).toBe("");
  });
});

describe("imported theme compatibility", () => {
  it("round-trips the divider component through export and import", () => {
    const source = design({
      components: {
        paneDivider: {
          ...DEFAULT_PANE_DIVIDER,
          width: 4,
          hitAreaWidth: 20,
          color: "#1f2937",
          activeIndicator: "top-line",
        },
      },
    });
    const parsed = parseThemePackage(JSON.stringify(buildThemePackage(source)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.theme.components.paneDivider.width).toBe(4);
      expect(parsed.value.theme.components.paneDivider.hitAreaWidth).toBe(20);
      expect(parsed.value.theme.components.paneDivider.color).toBe("#1f2937");
      expect(parsed.value.theme.components.paneDivider.activeIndicator).toBe("top-line");
    }
  });

  it("imports legacy packages without divider configuration", () => {
    const source = design();
    const legacy = { ...source };
    delete (legacy as Partial<ThemeDesign>).components;
    const parsed = parseThemePackage({
      format: "maxplorer.theme",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      theme: legacy,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.theme.components.paneDivider).toEqual(DEFAULT_PANE_DIVIDER);
      expect(parsed.warnings ?? []).toEqual([]);
    }
  });

  it("returns warnings for repaired divider configuration", () => {
    const source = design();
    const parsed = parseThemePackage({
      format: "maxplorer.theme",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      theme: {
        ...source,
        components: { paneDivider: { ...DEFAULT_PANE_DIVIDER, width: 90, color: "bad" } },
      },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.theme.components.paneDivider.width).toBe(8);
      expect(parsed.warnings?.length).toBeGreaterThanOrEqual(2);
    }
  });
});
