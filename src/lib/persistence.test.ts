import { describe, expect, it } from "vitest";
import {
  defaultPersisted,
  parsePersisted,
  parseThemePreferences,
} from "./persistence";

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
