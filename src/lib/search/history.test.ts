import { describe, expect, it } from "vitest";
import {
  addHistory,
  addSavedSearch,
  deleteSavedSearch,
  parseHistory,
  parseSavedSearches,
  parseSearchFilters,
  parseSearchSettings,
  pruneHistory,
  renameSavedSearch,
  toggleSavedSearchPin,
} from "./history";
import { DEFAULT_SEARCH_FILTERS, DEFAULT_SEARCH_SETTINGS, type SavedSearch } from "./types";

const now = 10_000_000_000;

function entry(query: string, at: number, id = query) {
  return { id, query, scope: "indexed" as const, at };
}

describe("search history", () => {
  it("deduplicates recent queries and keeps newest first", () => {
    const settings = { ...DEFAULT_SEARCH_SETTINGS, historyEnabled: true, maxHistory: 5 };
    let history = addHistory([], entry("invoice", now - 1000), settings, now);
    history = addHistory(history, entry("photos", now - 500), settings, now);
    history = addHistory(history, entry("invoice", now), settings, now);
    expect(history.map((item) => item.query)).toEqual(["invoice", "photos"]);
    expect(history[0].at).toBe(now);
  });

  it("does not record when history is disabled", () => {
    const settings = { ...DEFAULT_SEARCH_SETTINGS, historyEnabled: false };
    expect(addHistory([entry("a", now)], entry("b", now), settings, now)).toEqual([]);
  });

  it("prunes by retention period", () => {
    const settings = { ...DEFAULT_SEARCH_SETTINGS, retentionDays: 7, maxHistory: 20 };
    const history = [
      entry("old", now - 8 * 24 * 60 * 60 * 1000),
      entry("new", now - 1 * 24 * 60 * 60 * 1000),
    ];
    expect(pruneHistory(history, settings, now).map((item) => item.query)).toEqual(["new"]);
  });

  it("parses malformed history safely", () => {
    expect(parseHistory("not json")).toEqual([]);
    expect(parseHistory(JSON.stringify([{ id: "1", query: "x", at: 1, scope: "indexed" }]))).toHaveLength(1);
    expect(parseHistory(JSON.stringify([{ nope: true }]))).toEqual([]);
  });
});

function saved(name: string, id = name): SavedSearch {
  return {
    id,
    name,
    query: "pdf",
    filters: { ...DEFAULT_SEARCH_FILTERS, kinds: ["pdf"] },
    scope: "indexed",
    customRoots: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

describe("saved searches", () => {
  it("adds, renames, pins, and deletes saved searches", () => {
    let searches = addSavedSearch([], saved("Invoices"));
    expect(searches).toHaveLength(1);
    searches = renameSavedSearch(searches, "Invoices", "March invoices", now + 1);
    expect(searches[0].name).toBe("March invoices");
    searches = toggleSavedSearchPin(searches, "Invoices", now + 2);
    expect(searches[0].pinned).toBe(true);
    searches = deleteSavedSearch(searches, "Invoices");
    expect(searches).toEqual([]);
  });

  it("restores structured filters and rejects invalid saved data", () => {
    const parsed = parseSavedSearches(
      JSON.stringify([{ ...saved("PDFs"), filters: { kinds: ["pdf", "not-a-kind"], minSize: 10 } }]),
    );
    expect(parsed[0].filters.kinds).toEqual(["pdf"]);
    expect(parsed[0].filters.minSize).toBe(10);
    expect(parseSavedSearches("{bad")).toEqual([]);
  });

  it("does not store frozen file results", () => {
    const search = saved("Invoices");
    expect(Object.keys(search)).not.toContain("results");
    expect(Object.keys(search)).not.toContain("hits");
  });
});

describe("search settings and filters", () => {
  it("parses tolerant settings and clamps retention", () => {
    const settings = parseSearchSettings(
      JSON.stringify({ historyEnabled: false, retentionDays: 99999, maxHistory: -3, semanticSearch: true }),
    );
    expect(settings.historyEnabled).toBe(false);
    expect(settings.retentionDays).toBe(3650);
    expect(settings.maxHistory).toBe(DEFAULT_SEARCH_SETTINGS.maxHistory);
    expect(settings.semanticSearch).toBe(true);
  });

  it("restores filter fields without trusting unknown shapes", () => {
    const filters = parseSearchFilters({
      kinds: ["pdf", "bogus"],
      minSize: 5,
      modified: { after: 1, before: 2, label: "Range" },
      contentMode: "content",
      includeHidden: "yes",
    });
    expect(filters.kinds).toEqual(["pdf"]);
    expect(filters.minSize).toBe(5);
    expect(filters.modified?.label).toBe("Range");
    expect(filters.contentMode).toBe("content");
    expect(filters.includeHidden).toBe(false);
  });
});
