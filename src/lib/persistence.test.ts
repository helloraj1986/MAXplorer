import { describe, expect, it } from "vitest";
import {
  defaultPersisted,
  parsePersisted,
  parseThemePreferences,
} from "./persistence";
import { DEFAULT_SHORTCUTS } from "./panes";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    tabs: [{ id: "tab-1", location: "/Users/test", history: ["/Users/test"], historyIndex: 0 }],
    activeTabId: "tab-1",
    viewMode: "details",
    sortKey: "name",
    sortDirection: "asc",
    groupBy: "none",
    showHidden: false,
    showExtensions: true,
    detailsPane: false,
    previewPane: false,
    theme: "dark",
    interfaceTheme: "finder",
    columnWidths: { name: 272, date: 144, type: 120, size: 80, location: 260 },
    sidebarWidth: 204,
    pinned: [],
    recents: [],
    ...overrides,
  };
}

describe("persisted theme preference", () => {
  it("defaults new snapshots to the Windows theme", () => {
    const value = defaultPersisted({
      id: "tab-1",
      location: "/Users/test",
      history: ["/Users/test"],
      historyIndex: 0,
    });
    expect(value.interfaceTheme).toBe("windows");
    expect(value.theme).toBe("system");
    expect(value.display).toEqual({
      density: "comfortable",
      textSize: "default",
      iconSize: "default",
    });
    expect(value.sidebarVisible).toBe(true);
    expect(value.commandBarLabels).toBe(true);
    expect(value.folderOpenMode).toBe("sameTab");
    expect(value.confirmTrashDelete).toBe(true);
  });

  it("restores a valid Finder theme alongside the light/dark preference", () => {
    const parsed = parsePersisted(JSON.stringify(snapshot()));
    expect(parsed?.interfaceTheme).toBe("finder");
    expect(parsed?.theme).toBe("dark");
    expect(parsed?.tabs[0].location).toBe("/Users/test");
  });

  it("falls back safely for missing or invalid theme values", () => {
    const missing = parsePersisted(JSON.stringify(snapshot({ interfaceTheme: undefined })));
    expect(missing?.interfaceTheme).toBe("windows");
    expect(missing?.theme).toBe("dark");

    const invalid = parsePersisted(
      JSON.stringify(snapshot({ interfaceTheme: "linux", theme: "sepia" })),
    );
    expect(invalid?.interfaceTheme).toBe("windows");
    expect(invalid?.theme).toBe("system");

    const wrongTypes = parsePersisted(
      JSON.stringify(snapshot({ interfaceTheme: 7, theme: { mode: "dark" } })),
    );
    expect(wrongTypes?.interfaceTheme).toBe("windows");
    expect(wrongTypes?.theme).toBe("system");
  });

  it("rejects missing, malformed, and incompatible snapshots", () => {
    expect(parsePersisted(null)).toBeNull();
    expect(parsePersisted("")).toBeNull();
    expect(parsePersisted("{not json")).toBeNull();
    expect(parsePersisted(JSON.stringify(snapshot({ version: 2 })))).toBeNull();
    expect(parsePersisted(JSON.stringify(snapshot({ tabs: [] })))).toBeNull();
  });

  it("restores display, layout, behavior, and column preferences", () => {
    const parsed = parsePersisted(
      JSON.stringify(
        snapshot({
          display: { density: "compact", textSize: "large", iconSize: "small" },
          columnVisibility: { date: false, type: true, size: false },
          commandBarLabels: false,
          sidebarVisible: false,
          folderOpenMode: "newTab",
          confirmTrashDelete: false,
        }),
      ),
    );
    expect(parsed?.display).toEqual({ density: "compact", textSize: "large", iconSize: "small" });
    expect(parsed?.columnVisibility).toEqual({ date: false, type: true, size: false });
    expect(parsed?.commandBarLabels).toBe(false);
    expect(parsed?.sidebarVisible).toBe(false);
    expect(parsed?.folderOpenMode).toBe("newTab");
    expect(parsed?.confirmTrashDelete).toBe(false);
  });

  it("falls back safely for legacy snapshots without the new preferences", () => {
    const parsed = parsePersisted(JSON.stringify(snapshot()));
    expect(parsed?.display).toEqual({
      density: "comfortable",
      textSize: "default",
      iconSize: "default",
    });
    expect(parsed?.columnVisibility).toEqual({ date: true, type: true, size: true });
    expect(parsed?.commandBarLabels).toBe(true);
    expect(parsed?.sidebarVisible).toBe(true);
    expect(parsed?.folderOpenMode).toBe("sameTab");
    expect(parsed?.confirmTrashDelete).toBe(true);

    const invalid = parsePersisted(
      JSON.stringify(
        snapshot({
          display: { density: "huge", textSize: 3, iconSize: null },
          columnVisibility: "all",
          folderOpenMode: "window",
        }),
      ),
    );
    expect(invalid?.display).toEqual({
      density: "comfortable",
      textSize: "default",
      iconSize: "default",
    });
    expect(invalid?.columnVisibility).toEqual({ date: true, type: true, size: true });
    expect(invalid?.folderOpenMode).toBe("sameTab");
  });

  it("keeps tabs and history intact while normalizing invalid entries", () => {
    const parsed = parsePersisted(
      JSON.stringify(
        snapshot({
          tabs: [
            { id: "a", location: "", history: [], historyIndex: 9 },
            { id: 5, location: "/bad" },
            { id: "b", location: "/tmp", history: ["/tmp"], historyIndex: 0 },
          ],
          activeTabId: "missing",
        }),
      ),
    );
    expect(parsed?.tabs).toHaveLength(2);
    expect(parsed?.tabs[0]).toMatchObject({
      id: "a",
      location: "win11://home",
      history: ["win11://home"],
      historyIndex: 0,
    });
    expect(parsed?.activeTabId).toBe("a");
  });
});

describe("pre-render theme bootstrap", () => {
  it("reads both axes and defaults when no snapshot exists", () => {
    expect(parseThemePreferences(null)).toEqual({ interfaceTheme: "windows", theme: "system" });
    expect(parseThemePreferences("")).toEqual({ interfaceTheme: "windows", theme: "system" });
    expect(parseThemePreferences("null")).toEqual({ interfaceTheme: "windows", theme: "system" });
    expect(parseThemePreferences("42")).toEqual({ interfaceTheme: "windows", theme: "system" });
    expect(parseThemePreferences("{oops")).toEqual({ interfaceTheme: "windows", theme: "system" });
  });

  it("restores the stored theme pair without touching other state", () => {
    expect(parseThemePreferences(JSON.stringify(snapshot()))).toEqual({
      interfaceTheme: "finder",
      theme: "dark",
    });
    expect(
      parseThemePreferences(JSON.stringify(snapshot({ interfaceTheme: "windows", theme: "light" }))),
    ).toEqual({ interfaceTheme: "windows", theme: "light" });
  });

  it("ignores invalid stored values", () => {
    expect(
      parseThemePreferences(
        JSON.stringify(snapshot({ interfaceTheme: "beos", theme: "high-contrast" })),
      ),
    ).toEqual({ interfaceTheme: "windows", theme: "system" });
  });
});

describe("dual-pane persistence", () => {
  const leftPane = {
    tabs: [
      { id: "left-1", location: "/left/one", history: ["/left/one"], historyIndex: 0 },
      { id: "left-2", location: "/left/two", history: ["/left/two"], historyIndex: 0 },
    ],
    activeTabId: "left-2",
    viewMode: "list",
    sortKey: "date",
    sortDirection: "desc",
    groupBy: "type",
    showHidden: true,
    showExtensions: false,
    collapsed: false,
  };

  const rightPane = {
    tabs: [{ id: "right-1", location: "/right/one", history: ["/right/one"], historyIndex: 0 }],
    activeTabId: "right-1",
    viewMode: "details",
    sortKey: "size",
    sortDirection: "asc",
    groupBy: "none",
    showHidden: false,
    showExtensions: true,
    collapsed: true,
  };

  it("restores mode, active pane, split ratio, sync preference, tabs, and shortcuts", () => {
    const parsed = parsePersisted(
      JSON.stringify(
        snapshot({
          dualPane: true,
          activePane: "right",
          splitRatio: 0.95,
          syncNavigation: true,
          panes: { left: leftPane, right: rightPane },
          shortcuts: {
            toggleDualPane: "Mod+Alt+D",
            copyToOtherPane: "Mod+Shift+C",
            moveToOtherPane: "Mod+Shift+X",
            switchPane: "Tab",
          },
        }),
      ),
    );

    expect(parsed?.dualPane).toBe(true);
    expect(parsed?.activePane).toBe("right");
    expect(parsed?.splitRatio).toBe(0.82);
    expect(parsed?.syncNavigation).toBe(true);
    expect(parsed?.panes.left.tabs).toHaveLength(2);
    expect(parsed?.panes.left.activeTabId).toBe("left-2");
    expect(parsed?.panes.left.viewMode).toBe("list");
    expect(parsed?.panes.right.collapsed).toBe(true);
    expect(parsed?.shortcuts.toggleDualPane).toBe("Mod+Alt+D");
    expect(parsed?.shortcuts.switchPane).toBe("Tab");
  });

  it("keeps the legacy tab mirror in sync with the left pane", () => {
    const parsed = parsePersisted(
      JSON.stringify(snapshot({ dualPane: true, panes: { left: leftPane, right: rightPane } })),
    );
    expect(parsed?.tabs).toEqual(parsed?.panes.left.tabs);
    expect(parsed?.activeTabId).toBe(parsed?.panes.left.activeTabId);
    expect(parsed?.viewMode).toBe("list");
    expect(parsed?.showHidden).toBe(true);
  });

  it("defaults missing dual-pane fields and repairs invalid values", () => {
    const parsed = parsePersisted(
      JSON.stringify(
        snapshot({
          dualPane: "yes",
          activePane: "middle",
          splitRatio: "half",
          syncNavigation: 1,
          shortcuts: { toggleDualPane: "", copyToOtherPane: 7 },
        }),
      ),
    );
    expect(parsed?.dualPane).toBe(false);
    expect(parsed?.activePane).toBe("left");
    expect(parsed?.splitRatio).toBe(0.5);
    expect(parsed?.syncNavigation).toBe(false);
    expect(parsed?.shortcuts.toggleDualPane).toBe(DEFAULT_SHORTCUTS.toggleDualPane);
    expect(parsed?.shortcuts.copyToOtherPane).toBe(DEFAULT_SHORTCUTS.copyToOtherPane);
    expect(parsed?.panes.left.tabs[0].location).toBe("/Users/test");
  });

  it("restores only valid, recent transfer history entries", () => {
    const parsed = parsePersisted(
      JSON.stringify(
        snapshot({
          transferHistory: [
            {
              id: "h1",
              mode: "move",
              status: "completed",
              sources: ["/a"],
              destination: "/b",
              completedAt: 1000,
              totalBytes: 10,
              processedBytes: 10,
              message: null,
            },
            { id: "h2", destination: "/b", sources: [], status: "unknown", completedAt: 2 },
          ],
        }),
      ),
    );
    expect(parsed?.transferHistory).toHaveLength(1);
    expect(parsed?.transferHistory[0].id).toBe("h1");
  });

  it("defaults a fresh snapshot to single-pane mode with independent panes", () => {
    const value = defaultPersisted({
      id: "tab-1",
      location: "/Users/test",
      history: ["/Users/test"],
      historyIndex: 0,
    });
    expect(value.dualPane).toBe(false);
    expect(value.activePane).toBe("left");
    expect(value.splitRatio).toBe(0.5);
    expect(value.panes.left.tabs).toHaveLength(1);
    expect(value.panes.right.tabs).toHaveLength(1);
    expect(value.panes.left.tabs[0].id).not.toBe(value.panes.right.tabs[0].id);
  });
});
