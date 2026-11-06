// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The store is the only place that can guarantee the interface stops waiting.
 * These tests pin that behaviour: a backend that never answers must not leave
 * the search spinner running, and a superseded query must not be allowed to
 * overwrite newer results.
 */

const universalSearch = vi.fn((request: unknown) => Promise.resolve(request));
const cancelSearch = vi.fn((requestId: number) => Promise.resolve(requestId));

vi.mock("../lib/api", () => ({
  isTauri: true,
  normalizeError: (error: unknown) => ({
    code: "error",
    message: typeof error === "string" ? error : "Search failed",
    path: null,
  }),
  api: {
    universalSearch: (request: unknown) => universalSearch(request),
    cancelSearch: (requestId: number) => cancelSearch(requestId),
    onSearchProgress: () => Promise.resolve(() => undefined),
  },
}));

import { useSearchStore } from "./searchStore";
import { useExplorerStore } from "./explorerStore";
import { createPane } from "../lib/panes";
import { interpretQuery } from "../lib/search/interpreter";
import { DEFAULT_SEARCH_FILTERS, DEFAULT_SEARCH_SETTINGS } from "../lib/search/types";

function setup() {
  useExplorerStore.setState({
    platform: {
      platform: "macos",
      home: "/Users/test",
      pathSeparator: "/",
      modifier: "cmd",
      computerLabel: "This Mac",
    },
    panes: { left: createPane("/Users/test/Projects"), right: createPane("/Users/test/Documents") },
    activePane: "left",
    locations: [
      { id: "home", name: "Home", path: "/Users/test", kind: "home", icon: "home", isVolume: false },
    ],
    dialog: null,
    initialized: true,
  });
  const query = "resume";
  const interpretation = interpretQuery(query, {
    home: "/Users/test",
    currentFolder: "/Users/test/Projects",
    locations: [{ id: "home", name: "Home", path: "/Users/test" }],
  });
  useSearchStore.setState({
    open: true,
    workspaceOpen: true,
    query,
    interpretation,
    filters: { ...DEFAULT_SEARCH_FILTERS, ...interpretation.filters },
    scope: "current",
    customRoots: [],
    results: [],
    stats: null,
    loading: false,
    phase: "idle",
    error: null,
    queryId: 0,
    selectedPath: null,
    selectedPaths: [],
    anchorPath: null,
    history: [],
    savedSearches: [],
    settings: { ...DEFAULT_SEARCH_SETTINGS },
    indexStatus: null,
    indexLoading: false,
    duplicates: null,
    duplicatesLoading: false,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  universalSearch.mockReset();
  cancelSearch.mockClear();
  setup();
});

describe("search watchdog", () => {
  it("stops the spinner and reports partial results when the backend never answers", async () => {
    universalSearch.mockImplementation(() => new Promise(() => undefined));
    void useSearchStore.getState().runSearchNow();
    expect(useSearchStore.getState().loading).toBe(true);

    await vi.advanceTimersByTimeAsync(12_000);

    const state = useSearchStore.getState();
    expect(state.loading).toBe(false);
    expect(state.phase).toBe("partial");
  });

  it("clears the spinner when the backend answers", async () => {
    universalSearch.mockImplementation(() =>
      Promise.resolve({
        queryId: 1,
        hits: [],
        stats: { elapsedMs: 12, total: 0, notes: [] },
      }),
    );
    void useSearchStore.getState().runSearchNow();
    await vi.advanceTimersByTimeAsync(0);

    const state = useSearchStore.getState();
    expect(state.loading).toBe(false);
    expect(state.phase).toBe("complete");
  });

  it("cancels the previous request when a new query starts", async () => {
    universalSearch.mockImplementation(() => new Promise(() => undefined));
    void useSearchStore.getState().runSearchNow();
    const first = useSearchStore.getState().queryId;

    useSearchStore.getState().setQuery("resume builder");
    await vi.advanceTimersByTimeAsync(200);

    expect(cancelSearch).toHaveBeenCalledWith(first);
    expect(useSearchStore.getState().queryId).toBeGreaterThan(first);
  });

  it("ignores a late response from a superseded query", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    universalSearch.mockImplementation(
      () => new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    void useSearchStore.getState().runSearchNow();
    const first = useSearchStore.getState().queryId;

    universalSearch.mockImplementation(() =>
      Promise.resolve({ queryId: first + 1, hits: [], stats: { elapsedMs: 5, total: 0, notes: [] } }),
    );
    useSearchStore.getState().setQuery("resume builder");
    await vi.advanceTimersByTimeAsync(200);
    const current = useSearchStore.getState().queryId;
    expect(current).not.toBe(first);

    resolveFirst({
      queryId: first,
      hits: [
        {
          entry: {
            name: "stale.pdf",
            path: "/Users/test/Projects/stale.pdf",
            isDir: false,
            isSymlink: false,
            size: 1,
            modified: 1,
            created: 1,
            accessed: 1,
            extension: "pdf",
            isHidden: false,
            isReadOnly: false,
            target: null,
          },
          score: 1,
          matchKind: "name",
          snippet: null,
          source: "index",
          indexed: true,
          explanation: null,
        },
      ],
      stats: { elapsedMs: 1, total: 1, notes: [] },
    });
    await vi.advanceTimersByTimeAsync(0);

    const state = useSearchStore.getState();
    expect(state.queryId).toBe(current);
    expect(state.results.some((hit) => hit.entry.name === "stale.pdf")).toBe(false);
  });
});
