import { describe, expect, it } from "vitest";
import {
  buildSearchRequest,
  chipsFor,
  interpretQuery,
  parseSize,
  removeChip,
  scopeRoots,
  startOfDay,
} from "./interpreter";
import { DEFAULT_SEARCH_FILTERS, type SearchLocation } from "./types";

const now = new Date(2026, 9, 29, 15, 30, 0); // 29 October 2026, local time
const locations: SearchLocation[] = [
  { id: "home", name: "Home", path: "/Users/test" },
  { id: "projects", name: "Projects", path: "/Users/test/Projects" },
  { id: "docs", name: "Documents", path: "/Users/test/Documents" },
];

function interpret(query: string) {
  return interpretQuery(query, {
    now,
    home: "/Users/test",
    currentFolder: "/Users/test/Downloads",
    locations,
    largeFileBytes: 100 * 1024 * 1024,
  });
}

describe("natural-language query interpreter", () => {
  it("understands a kind plus a recent modified date", () => {
    const result = interpret("PDF modified last week");
    expect(result.filters.kinds).toEqual(["pdf"]);
    expect(result.filters.modified?.label).toBe("Last 7 days");
    expect(result.filters.modified?.after).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(result.terms).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it("understands large videos over a size threshold", () => {
    const result = interpret("large videos over 2GB");
    expect(result.filters.kinds).toEqual(["video"]);
    expect(result.filters.minSize).toBe(2 * 1024 ** 3);
    expect(result.residualQuery).toBe("");
  });

  it("maps TypeScript files and resolves a real location", () => {
    const result = interpret("typescript files in projects");
    expect(result.filters.extensions).toEqual(["ts", "tsx"]);
    expect(result.filters.locations).toEqual(["/Users/test/Projects"]);
    expect(result.terms).toEqual([]);
  });

  it("does not invent a location that is not configured", () => {
    const result = interpret("typescript files in imaginary");
    expect(result.filters.locations).toEqual([]);
    expect(result.terms).toContain("imaginary");
    expect(result.notes.some((note) => note.includes("does not match a configured location"))).toBe(true);
  });

  it("interprets a month name as a modified-date range", () => {
    const result = interpret("invoice from March");
    expect(result.terms).toContain("invoice");
    expect(result.filters.modified?.label).toBe("March 2026");
    expect(result.filters.modified?.after).toBe(new Date(2026, 2, 1).getTime());
  });

  it("routes containing queries to content search", () => {
    const result = interpret("files containing API_KEY");
    expect(result.contentTerms).toEqual(["API_KEY"]);
    expect(result.mode).toBe("content");
    expect(result.terms).toEqual([]);
    expect(result.chips.some((chip) => chip.label.includes("API_KEY"))).toBe(true);
  });

  it("interprets visual queries without pretending visual search ran", () => {
    const result = interpret("images of mountains");
    expect(result.filters.kinds).toEqual(["image"]);
    expect(result.terms).toEqual(["mountains"]);
    expect(result.visualHint).toBe(true);
    expect(result.notes.some((note) => note.includes("Visual image recognition is not enabled"))).toBe(true);
  });

  it("supports quoted phrases and exclusions", () => {
    const result = interpret('"quarterly report" -draft');
    expect(result.terms).toEqual(["quarterly report"]);
    expect(result.excludeTerms).toEqual(["draft"]);
    expect(result.exactPhrase).toBe(true);
    expect(result.matchMode).toBe("phrase");
  });

  it("understands duplicate candidates and hidden files", () => {
    const result = interpret("duplicate files hidden files");
    expect(result.wantsDuplicates).toBe(true);
    expect(result.filters.duplicatesOnly).toBe(true);
    expect(result.filters.includeHidden).toBe(true);
  });

  it("uses a transparent default for large and supports small", () => {
    const large = interpret("large documents");
    expect(large.filters.minSize).toBe(100 * 1024 * 1024);
    expect(large.notes.some((note) => note.includes("Large"))).toBe(true);
    const small = interpret("small images");
    expect(small.filters.maxSize).toBe(1024 * 1024);
  });

  it("resolves today and yesterday to local calendar days", () => {
    const today = interpret("today");
    expect(today.filters.modified?.after).toBe(startOfDay(now));
    const yesterday = interpret("yesterday");
    expect(yesterday.filters.modified?.after).toBe(startOfDay(now) - 24 * 60 * 60 * 1000);
  });

  it("is deterministic for the same input and context", () => {
    const first = interpret("pdf in projects modified this month");
    const second = interpret("pdf in projects modified this month");
    expect(first).toEqual(second);
  });
});

describe("size parsing", () => {
  it("parses binary units and rejects nonsense", () => {
    expect(parseSize("2GB")).toBe(2 * 1024 ** 3);
    expect(parseSize("500 mb")).toBe(500 * 1024 ** 2);
    expect(parseSize("12kb")).toBe(12 * 1024);
    expect(parseSize("many")).toBeNull();
  });
});

describe("structured request building", () => {
  it("carries every constraint into the backend payload", () => {
    const interpretation = interpret("pdf modified yesterday in projects");
    const request = buildSearchRequest({
      queryId: 9,
      interpretation,
      filters: interpretation.filters,
      roots: ["/Users/test/Projects"],
      includeHidden: false,
      includeLive: true,
      includeSpotlight: true,
      sort: "relevance",
      sortDirection: "desc",
      limit: 500,
    });
    expect(request.queryId).toBe(9);
    expect(request.kinds).toEqual(["pdf"]);
    expect(request.roots).toEqual(["/Users/test/Projects"]);
    expect(request.modifiedAfter).toBe(startOfDay(now) - 24 * 60 * 60 * 1000);
    expect(request.includeLive).toBe(true);
    expect(request.includeSpotlight).toBe(true);
  });
});

describe("chips", () => {
  it("are generated from actual constraints and can be removed", () => {
    const filters = {
      ...DEFAULT_SEARCH_FILTERS,
      kinds: ["pdf" as const],
      minSize: 100 * 1024 ** 2,
      maxSize: null,
    };
    const chips = chipsFor(filters, [], [], []);
    expect(chips.map((chip) => chip.label)).toContain("PDFs");
    expect(chips.map((chip) => chip.label)).toContain("Size: > 100 MiB");
    const removed = removeChip(filters, chips.find((chip) => chip.group === "kind")!);
    expect(removed.kinds).toEqual([]);
  });
});

describe("scope roots", () => {
  it("resolves every scope from real locations", () => {
    const common = {
      currentFolder: "/Users/test/Downloads",
      home: "/Users/test",
      indexedLocations: locations,
      externalLocations: [{ id: "usb", name: "USB", path: "/Volumes/USB" }],
      selectedFolders: ["/Users/test/Projects"],
      customRoots: ["/Users/test/Custom"],
    };
    expect(scopeRoots({ ...common, scope: "current" })).toEqual(["/Users/test/Downloads"]);
    expect(scopeRoots({ ...common, scope: "home" })).toEqual(["/Users/test"]);
    expect(scopeRoots({ ...common, scope: "selected" })).toEqual(["/Users/test/Projects"]);
    expect(scopeRoots({ ...common, scope: "external" })).toEqual(["/Volumes/USB"]);
    expect(scopeRoots({ ...common, scope: "custom" })).toEqual(["/Users/test/Custom"]);
    expect(scopeRoots({ ...common, scope: "indexed" })).toEqual(locations.map((location) => location.path));
  });
});
