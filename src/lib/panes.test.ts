import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  acceleratorToDisplay,
  clampSplitRatio,
  createPane,
  deriveSyncAnchors,
  detectConflicts,
  isRecursiveTransfer,
  mapSynchronizedPath,
  matchesShortcut,
  normalizeAccelerator,
  otherPane,
  panesFromPersisted,
  panesShowingSources,
} from "./panes";
import type { PersistedState } from "./types";

function event(key: string, overrides: Partial<Parameters<typeof matchesShortcut>[0]> = {}) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("pane helpers", () => {
  it("creates independent pane defaults and switches between panes", () => {
    const pane = createPane("/Users/test");
    expect(pane.tabs).toHaveLength(1);
    expect(pane.activeTabId).toBe(pane.tabs[0].id);
    expect(pane.viewMode).toBe("details");
    expect(otherPane("left")).toBe("right");
    expect(otherPane("right")).toBe("left");
  });

  it("clamps the divider ratio and rejects non-finite values", () => {
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(0.01)).toBe(0.18);
    expect(clampSplitRatio(4)).toBe(0.82);
    expect(clampSplitRatio(Number.NaN)).toBe(0.5);
  });

  it("maps a target inside an anchor to the corresponding folder in the other pane", () => {
    expect(mapSynchronizedPath("/a/projects", "/b/archive", "/a/projects/src")).toBe(
      "/b/archive/src",
    );
    expect(mapSynchronizedPath("/a/projects", "/b/archive", "/a/projects")).toBe("/b/archive");
    expect(mapSynchronizedPath("/a/projects", "/b/archive", "/a/other")).toBeNull();
    expect(mapSynchronizedPath("/a/projects", "/a/projects", "/a/projects/src")).toBeNull();
  });

  it("derives relative anchors for sibling trees and rejects home or identical folders", () => {
    expect(deriveSyncAnchors("/work/old", "/archive/old")).toEqual({
      left: "/work",
      right: "/archive",
    });
    expect(deriveSyncAnchors("/one", "/two")).toEqual({ left: "/one", right: "/two" });
    expect(deriveSyncAnchors("/same", "/same")).toBeNull();
    expect(deriveSyncAnchors("win11://home", "/Users/test")).toBeNull();
  });

  it("detects conflicts case-insensitively without mutating the source list", () => {
    const result = detectConflicts(
      ["/source/Report.txt", "/source/photo.png", "/source/new.txt"],
      [
        { name: "report.TXT", path: "/dest/report.TXT" },
        { name: "photo.png", path: "/dest/photo.png" },
      ],
    );
    expect(result.names).toEqual(["Report.txt", "photo.png"]);
    expect(result.existing).toEqual(["/dest/report.TXT", "/dest/photo.png"]);
  });

  it("rejects transfers into the source itself or a descendant", () => {
    expect(isRecursiveTransfer(["/a"], "/a/sub")).toBe(true);
    expect(isRecursiveTransfer(["/a"], "/a")).toBe(true);
    expect(isRecursiveTransfer(["/a"], "/b")).toBe(false);
    expect(isRecursiveTransfer(["/a/file.txt"], "/a/sub")).toBe(false);
  });

  it("persists and restores panes, including legacy tab-only snapshots", () => {
    const legacy = {
      version: 1,
      tabs: [
        { id: "legacy", location: "/legacy", history: ["/legacy"], historyIndex: 0 },
      ],
      activeTabId: "legacy",
      viewMode: "list",
      sortKey: "date",
      sortDirection: "desc",
      groupBy: "type",
      showHidden: true,
      showExtensions: false,
    } as unknown as PersistedState;

    const panes = panesFromPersisted(legacy, "/fallback");
    expect(panes.left.tabs[0].location).toBe("/legacy");
    expect(panes.left.viewMode).toBe("list");
    expect(panes.left.sortKey).toBe("date");
    expect(panes.right.tabs[0].location).toBe("/fallback");
    expect(panes.right.showHidden).toBe(false);
  });

  it("never restores both panes collapsed at once", () => {
    const persisted = {
      version: 1,
      dualPane: true,
      panes: {
        left: {
          tabs: [{ id: "l", location: "/left", history: ["/left"], historyIndex: 0 }],
          activeTabId: "l",
          viewMode: "details",
          sortKey: "name",
          sortDirection: "asc",
          groupBy: "none",
          showHidden: false,
          showExtensions: true,
          collapsed: true,
        },
        right: {
          tabs: [{ id: "r", location: "/right", history: ["/right"], historyIndex: 0 }],
          activeTabId: "r",
          viewMode: "details",
          sortKey: "name",
          sortDirection: "asc",
          groupBy: "none",
          showHidden: false,
          showExtensions: true,
          collapsed: true,
        },
      },
    } as unknown as PersistedState;

    const panes = panesFromPersisted(persisted, "/fallback");
    expect(panes.left.collapsed).toBe(true);
    expect(panes.right.collapsed).toBe(false);
  });
});

describe("panes showing moved sources", () => {
  it("finds the pane whose folder is the parent of a source", () => {
    const folders = { left: "/Users/me/DATA", right: "/Applications" };
    expect(panesShowingSources(folders, ["/Users/me/DATA/report.pdf"])).toEqual(["left"]);
    expect(panesShowingSources(folders, ["/Applications/Safari.app"])).toEqual(["right"]);
  });

  it("returns both panes only when both are showing a source folder", () => {
    const folders = { left: "/tmp/a", right: "/tmp/b" };
    expect(panesShowingSources(folders, ["/tmp/a/one.txt", "/tmp/b/two.txt"])).toEqual([
      "left",
      "right",
    ]);
    expect(panesShowingSources(folders, ["/tmp/a/one.txt"])).toEqual(["left"]);
  });

  it("ignores sources whose folder no pane is showing", () => {
    const folders = { left: "/Users/me/DATA", right: "/Applications" };
    expect(panesShowingSources(folders, ["/Users/me/Downloads/x.zip"])).toEqual([]);
    expect(panesShowingSources(folders, [])).toEqual([]);
  });
});

describe("shortcut matching", () => {  it("matches Mod against the platform modifier", () => {
    const combo = event("m", { metaKey: true, shiftKey: true });
    expect(matchesShortcut(combo, DEFAULT_SHORTCUTS.toggleDualPane, "cmd")).toBe(true);
    expect(matchesShortcut(combo, DEFAULT_SHORTCUTS.toggleDualPane, "ctrl")).toBe(false);

    const ctrlCombo = event("m", { ctrlKey: true, shiftKey: true });
    expect(matchesShortcut(ctrlCombo, DEFAULT_SHORTCUTS.toggleDualPane, "ctrl")).toBe(true);
  });

  it("matches function keys and special keys exactly", () => {
    expect(matchesShortcut(event("F5"), "F5", "cmd")).toBe(true);
    expect(matchesShortcut(event("F5", { metaKey: true }), "F5", "cmd")).toBe(false);
    expect(matchesShortcut(event("Tab"), "Tab", "cmd")).toBe(true);
    expect(matchesShortcut(event("ArrowDown"), "Tab", "cmd")).toBe(false);
  });

  it("renders accelerators for macOS and Windows", () => {
    expect(acceleratorToDisplay("Mod+Shift+M", "macos")).toBe("⌘⇧M");
    expect(acceleratorToDisplay("Mod+Shift+M", "windows")).toBe("Ctrl+Shift+M");
    expect(acceleratorToDisplay("F5", "macos")).toBe("F5");
  });

  it("falls back when a user-entered accelerator has no key", () => {
    expect(normalizeAccelerator("Mod+Shift", "F5")).toBe("F5");
    expect(normalizeAccelerator("Mod+K", "F5")).toBe("Mod+K");
    expect(normalizeAccelerator("", "F5")).toBe("F5");
  });
});
