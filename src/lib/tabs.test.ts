import { describe, expect, it } from "vitest";
import { closeOtherTabs, closeTab, createTab, cycleTab, duplicateTab } from "./tabs";

describe("tabs", () => {
  it("creates independent tab state", () => {
    const tab = createTab("/a", "one");
    expect(tab.location).toBe("/a");
    expect(tab.history).toEqual(["/a"]);
    expect(tab.selection).toEqual([]);
    expect(tab.searchQuery).toBe("");
  });

  it("selects the neighbor after closing the active tab", () => {
    const tabs = [createTab("/a", "a"), createTab("/b", "b"), createTab("/c", "c")];
    const result = closeTab(tabs, "b", "b");
    expect(result.tabs.map((tab) => tab.id)).toEqual(["a", "c"]);
    expect(result.activeId).toBe("c");
  });

  it("reports when the last tab closes", () => {
    const tabs = [createTab("/a", "a")];
    const result = closeTab(tabs, "a", "a");
    expect(result.closedLast).toBe(true);
    expect(result.tabs).toHaveLength(1);
  });

  it("closes other tabs", () => {
    const tabs = [createTab("/a", "a"), createTab("/b", "b"), createTab("/c", "c")];
    const result = closeOtherTabs(tabs, "a", "b");
    expect(result.tabs.map((tab) => tab.id)).toEqual(["b"]);
    expect(result.activeId).toBe("b");
  });

  it("cycles tabs in both directions", () => {
    const tabs = [createTab("/a", "a"), createTab("/b", "b"), createTab("/c", "c")];
    expect(cycleTab(tabs, "a", 1)).toBe("b");
    expect(cycleTab(tabs, "a", -1)).toBe("c");
  });

  it("duplicates a tab without carrying selection or search", () => {
    const tab = createTab("/a", "a");
    tab.selection = ["/a/file"];
    tab.searchQuery = "file";
    tab.searchResults = [];
    const copy = duplicateTab(tab);
    expect(copy.id).not.toBe(tab.id);
    expect(copy.location).toBe("/a");
    expect(copy.selection).toEqual([]);
    expect(copy.searchQuery).toBe("");
  });
});
