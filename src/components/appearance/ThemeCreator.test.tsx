// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeCreator } from "./ThemeCreator";
import { ThemePreview } from "./ThemePreview";
import { useAppearanceStore } from "../../state/appearanceStore";
import { useExplorerStore } from "../../state/explorerStore";
import { BUILTIN_ICON_PACKS, DEFAULT_ICON_PACK_ID, mergeIconPacks } from "../../lib/appearance/iconPacks";
import { designFromPreset, THEME_PRESETS } from "../../lib/appearance/presets";
import { applyThemeDesign, clearThemeDesign } from "../../lib/appearance/tokens";

beforeEach(() => {
  window.localStorage.clear();
  useAppearanceStore.setState({
    themes: [],
    activeThemeId: null,
    iconPacks: mergeIconPacks([]),
    activeIconPackId: DEFAULT_ICON_PACK_ID,
    draft: null,
  });
  useExplorerStore.setState({
    theme: "dark",
    interfaceTheme: "windows",
  });
});

afterEach(() => {
  cleanup();
});

describe("ThemeCreator", () => {
  it("opens a preset on the name step and moves through the wizard", () => {
    render(
      <ThemeCreator
        start={{ kind: "preset", presetId: "midnight-dark" }}
        close={() => undefined}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Theme Creator" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Give your theme a name" })).toBeTruthy();
    const name = screen.getByRole("textbox", { name: "Theme name" }) as HTMLInputElement;
    expect(name.value).toBe("Midnight Dark");

    fireEvent.change(name, { target: { value: "My Evening Theme" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Choose your look" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Colours/ }));
    expect(screen.getByRole("heading", { name: "Choose your colours" })).toBeTruthy();
    expect(screen.getByText("Auto Generate Matching Colours")).toBeTruthy();
  });

  it("shows a start screen with visual starting options when opened fresh", () => {
    render(<ThemeCreator close={() => undefined} />);
    expect(screen.getByText("Create a theme that feels like yours")).toBeTruthy();
    expect(screen.getByText("Start blank")).toBeTruthy();
    expect(screen.getByText("Copy current look")).toBeTruthy();
    expect(screen.getAllByText("Ocean").length).toBeGreaterThan(0);
  });

  it("saves a theme as a complete package and offers export and share", () => {
    render(
      <ThemeCreator
        start={{ kind: "preset", presetId: "modern-minimal" }}
        initialStep={6}
        close={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Theme" }));
    expect(screen.getByRole("heading", { name: "Your theme is saved" })).toBeTruthy();
    expect(useAppearanceStore.getState().themes).toHaveLength(1);
    expect(useAppearanceStore.getState().themes[0].packageId).toMatch(/^com\.maxplorer\.theme\./);
    expect(screen.getByRole("button", { name: "Export .maxTheme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });
});

describe("ThemePreview", () => {
  it("renders a truthful miniature with files, selected state and menus", () => {
    const design = designFromPreset(THEME_PRESETS[0]);
    render(
      <ThemePreview
        design={design}
        iconPack={BUILTIN_ICON_PACKS[0]}
        showContextMenu
      />,
    );
    const preview = screen.getByRole("img", { name: /Preview of/ });
    expect(preview).toBeTruthy();
    expect(screen.getByText("Design System.fig")).toBeTruthy();
    expect(screen.getByText("Move to Trash")).toBeTruthy();
    expect(preview.getAttribute("data-theme")).toBe(design.appearance);
  });

  it("applies and clears a custom theme on the real document root", () => {
    const design = designFromPreset(THEME_PRESETS[3]);
    const pack = BUILTIN_ICON_PACKS[1];
    applyThemeDesign(design, pack);
    const root = document.documentElement;
    expect(root.dataset.customTheme).toBe("true");
    expect(root.dataset.uiTheme).toBe(design.base);
    expect(root.dataset.theme).toBe(design.appearance);
    expect(root.dataset.iconPack).toBe(pack.id);
    expect(root.style.getPropertyValue("--accent")).toBe(design.palette.accent);
    clearThemeDesign();
    expect(root.dataset.customTheme).toBeUndefined();
    expect(root.style.getPropertyValue("--accent")).toBe("");
  });
});
