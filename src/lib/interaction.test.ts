import { describe, expect, it } from "vitest";
import {
  hasAdditiveSelectionModifier,
  hasSelectAllModifier,
  isSelectionContextMenuGesture,
  selectionIntent,
  selectionModifierFor,
} from "./interaction";

const base = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false };

describe("selection interaction mode", () => {
  it("uses Ctrl for Windows mode and Command for Finder mode", () => {
    expect(selectionModifierFor("windows")).toBe("ctrl");
    expect(selectionModifierFor("finder")).toBe("meta");
  });

  it("treats Ctrl+primary-click as additive selection in Windows mode", () => {
    expect(hasAdditiveSelectionModifier({ ...base, ctrlKey: true }, "windows")).toBe(true);
    expect(selectionIntent({ ...base, ctrlKey: true }, "windows")).toBe("toggle");
  });

  it("does not treat Ctrl+click as additive selection in Finder mode", () => {
    expect(hasAdditiveSelectionModifier({ ...base, ctrlKey: true }, "finder")).toBe(false);
    expect(hasAdditiveSelectionModifier({ ...base, metaKey: true }, "finder")).toBe(true);
  });

  it("gives Shift priority for range selection", () => {
    expect(selectionIntent({ ...base, shiftKey: true }, "windows")).toBe("range");
    expect(selectionIntent({ ...base, shiftKey: true, ctrlKey: true }, "windows")).toBe("range");
    expect(selectionIntent({ ...base, shiftKey: true, metaKey: true }, "finder")).toBe("range");
  });

  it("recognises the macOS synthetic context menu produced by Ctrl+click", () => {
    const ctrlClickMenu = { button: 0, ctrlKey: true };
    expect(isSelectionContextMenuGesture(ctrlClickMenu, "windows")).toBe(true);
    expect(isSelectionContextMenuGesture(ctrlClickMenu, "finder")).toBe(false);
    // A genuine secondary click must still open a menu.
    expect(isSelectionContextMenuGesture({ button: 2, ctrlKey: true }, "windows")).toBe(false);
  });

  it("selects all with Ctrl+A in Windows mode and Command+A in Finder mode", () => {
    expect(hasSelectAllModifier({ ctrlKey: true, metaKey: false }, "windows")).toBe(true);
    expect(hasSelectAllModifier({ ctrlKey: false, metaKey: true }, "windows")).toBe(true);
    expect(hasSelectAllModifier({ ctrlKey: false, metaKey: true }, "finder")).toBe(true);
    expect(hasSelectAllModifier({ ctrlKey: true, metaKey: false }, "finder")).toBe(false);
  });
});
