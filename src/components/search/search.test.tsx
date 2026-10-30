// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchOverlay } from "./SearchOverlay";
import { SearchWorkspace } from "./SearchWorkspace";
import { IndexingDashboard } from "./IndexingDashboard";
import { ContextMenu } from "../ContextMenu";
import { useSearchStore } from "../../state/searchStore";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useExplorerStore } from "../../state/explorerStore";
import { createPane } from "../../lib/panes";
import { interpretQuery } from "../../lib/search/interpreter";
import { DEFAULT_SEARCH_FILTERS, DEFAULT_SEARCH_SETTINGS } from "../../lib/search/types";
import type { FileEntry } from "../../lib/types";
import type { SearchHit } from "../../lib/search/types";

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) => clearTimeout(handle)) as typeof cancelAnimationFrame;
}

function entry(name: string, isDir = false): FileEntry {
  return {
    name,
    path: `/Users/test/Projects/${name}`,
    isDir,
    isSymlink: false,
    size: isDir ? null : 1200,
    modified: Date.now(),
    created: Date.now(),
    accessed: Date.now(),
    extension: isDir ? null : name.split(".").pop() ?? null,
    isHidden: false,
    isReadOnly: false,
    target: null,
  };
}

function hit(name: string, score = 100, matchKind = "name"): SearchHit {
  return {
    entry: entry(name),
    score,
    matchKind,
    snippet: null,
    source: "index",
    indexed: true,
    explanation: "Name match",
  };
}

const hits = [hit("invoice-march.pdf", 900), hit("invoice-notes.txt", 500, "content")];

function setupExplorer() {
  const pane = createPane("/Users/test/Projects");
  useExplorerStore.setState({
    platform: {
      platform: "macos",
      home: "/Users/test",
      pathSeparator: "/",
      modifier: "cmd",
      computerLabel: "This Mac",
    },
    panes: { left: pane, right: createPane("/Users/test/Documents") },
    activePane: "left",
    locations: [
      { id: "home", name: "Home", path: "/Users/test", kind: "home", icon: "home", isVolume: false },
      { id: "projects", name: "Projects", path: "/Users/test/Projects", kind: "folder", icon: "folder", isVolume: false },
    ],
    dialog: null,
    initialized: true,
  });
}

function setupSearch(overrides: Partial<ReturnType<typeof useSearchStore.getState>> = {}) {
  const query = "invoice";
  const interpretation = interpretQuery(query, {
    home: "/Users/test",
    currentFolder: "/Users/test/Projects",
    locations: [{ id: "projects", name: "Projects", path: "/Users/test/Projects" }],
  });
  useSearchStore.setState({
    open: true,
    workspaceOpen: false,
    query,
    interpretation,
    filters: interpretation.filters,
    scope: "current",
    results: hits,
    loading: false,
    phase: "complete",
    error: null,
    selectedPath: null,
    selectedPaths: [],
    history: [],
    savedSearches: [],
    settings: { ...DEFAULT_SEARCH_SETTINGS },
    indexStatus: null,
    indexLoading: false,
    duplicates: null,
    duplicatesLoading: false,
    ...overrides,
  });
}

beforeEach(() => {
  setupExplorer();
  setupSearch();
});

afterEach(() => {
  cleanup();
  useSearchStore.setState({ open: false, workspaceOpen: false });
  useExplorerStore.getState().hideContextMenu();
});

function ShortcutHarness() {
  useKeyboardShortcuts();
  return null;
}

describe("Universal Search shortcut", () => {
  it("opens the command overlay with Command+Shift+F without disturbing Command+F", () => {
    useSearchStore.setState({ open: false, workspaceOpen: false });
    render(<ShortcutHarness />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F", metaKey: true, shiftKey: true, bubbles: true }),
      );
    });
    expect(useSearchStore.getState().open).toBe(true);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", metaKey: false, shiftKey: false, bubbles: true }),
      );
    });
    expect(useSearchStore.getState().open).toBe(false);
  });
});

describe("SearchOverlay", () => {
  it("renders real result rows with accessible labels", () => {
    render(<SearchOverlay />);
    expect(screen.getByRole("dialog", { name: "Universal Search" })).toBeTruthy();
    expect(screen.getByLabelText("Search files, contents, and everywhere")).toBeTruthy();
    expect(document.body.textContent).toContain("invoice-march.pdf");
    expect(document.body.textContent).toContain("invoice-notes.txt");
  });

  it("closes on Escape and on the backdrop", () => {
    render(<SearchOverlay />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(useSearchStore.getState().open).toBe(false);
    cleanup();
    useSearchStore.setState({ open: true });
    const second = render(<SearchOverlay />);
    fireEvent.mouseDown(second.container.querySelector(".search-overlay-backdrop")!);
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("navigates results with the keyboard and opens the active result", () => {
    render(<SearchOverlay />);
    const input = screen.getByLabelText("Search files, contents, and everywhere");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("shows recent searches when the query is empty", () => {
    setupSearch({
      query: "",
      interpretation: null,
      results: [],
      history: [{ id: "1", query: "budget", scope: "indexed", at: Date.now() }],
    });
    render(<SearchOverlay />);
    expect(screen.getByText("Recent searches")).toBeTruthy();
    expect(screen.getByText("budget")).toBeTruthy();
  });

  it("removes an interpreted filter chip", () => {
    const interpretation = interpretQuery("PDF modified last week", {
      home: "/Users/test",
      currentFolder: "/Users/test/Projects",
      locations: [],
    });
    setupSearch({ query: interpretation.original, interpretation, filters: interpretation.filters });
    render(<SearchOverlay />);
    const chip = screen.getByLabelText("Remove PDFs");
    act(() => {
      fireEvent.click(chip);
    });
    expect(useSearchStore.getState().filters.kinds).toEqual([]);
  });
});

describe("Reveal in MAXplorer", () => {
  it("offers the action beside Reveal in Finder in the result context menu", () => {
    const path = "/Users/test/Projects/invoice-march.pdf";
    useExplorerStore.getState().showContextMenu({
      kind: "search",
      x: 24,
      y: 24,
      path,
      isDir: false,
      paths: [path],
    });
    render(<ContextMenu />);
    expect(screen.getByText("Reveal in MAXplorer")).toBeTruthy();
    expect(screen.getByText("Reveal in Finder")).toBeTruthy();
  });

  it("closes the search workspace and selects the result in a file pane", async () => {
    const pane = createPane("/Users/test/Projects");
    const tab = pane.tabs[0];
    useExplorerStore.setState({
      dualPane: false,
      activePane: "left",
      panes: {
        left: {
          ...pane,
          tabs: [{ ...tab, entries: [entry("invoice-march.pdf")], listingFor: "/Users/test/Projects", loading: false }],
        },
        right: createPane("/Users/test/Documents"),
      },
    });
    setupSearch({ workspaceOpen: true, open: false });
    await act(async () => {
      await useSearchStore.getState().revealInMaxplorer("/Users/test/Projects/invoice-march.pdf");
    });
    expect(useSearchStore.getState().workspaceOpen).toBe(false);
    expect(useExplorerStore.getState().activePane).toBe("left");
    expect(useExplorerStore.getState().activeTab("left").selection).toEqual([
      "/Users/test/Projects/invoice-march.pdf",
    ]);
  });
});

describe("SearchWorkspace", () => {
  it("shows the query header, filters, chips, and result columns", () => {
    setupSearch({ workspaceOpen: true, open: false });
    render(<SearchWorkspace />);
    expect(screen.getByLabelText("Search query")).toBeTruthy();
    expect(screen.getByLabelText("Search filters")).toBeTruthy();
    expect(document.body.textContent).toContain("invoice-march.pdf");
    expect(screen.getAllByText("Filters").length).toBeGreaterThan(0);
  });

  it("switches between list and grid views", () => {
    setupSearch({ workspaceOpen: true, open: false });
    render(<SearchWorkspace />);
    fireEvent.click(screen.getByTitle("Grid view"));
    expect(useSearchStore.getState().view).toBe("grid");
    fireEvent.click(screen.getByTitle("List view"));
    expect(useSearchStore.getState().view).toBe("list");
  });

  it("shows duplicate mode when the duplicate filter is active", () => {
    setupSearch({ workspaceOpen: true, filters: { ...DEFAULT_SEARCH_FILTERS, duplicatesOnly: true } });
    render(<SearchWorkspace />);
    expect(screen.getAllByText("Duplicate candidates").length).toBeGreaterThan(0);
  });
});

describe("IndexingDashboard", () => {
  it("explains coverage and never offers automatic deletion of files", () => {
    useSearchStore.setState({
      indexStatus: {
        paused: false,
        activity: "watching",
        currentPath: null,
        ftsAvailable: true,
        contentEnabled: true,
        maxContentBytes: 1_500_000,
        dbPath: "/tmp/index.sqlite3",
        indexSizeBytes: 1024,
        indexedFiles: 120,
        indexedFolders: 10,
        searchableContent: 40,
        pendingContent: 2,
        failedContent: 0,
        skippedContent: 1,
        lastReconciliation: Date.now(),
        locations: [
          {
            path: "/Users/test",
            name: "test",
            status: "up_to_date",
            indexedFiles: 120,
            searchableFiles: 40,
            lastIndexed: Date.now(),
            error: null,
          },
        ],
        errors: [],
      },
    });
    render(<IndexingDashboard />);
    expect(screen.getByText("Indexed locations")).toBeTruthy();
    expect(screen.getByText("Files indexed")).toBeTruthy();
    expect(screen.getByText(/All indexing and query processing happens locally/)).toBeTruthy();
  });
});
