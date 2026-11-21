// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaWorkspace } from "./MediaWorkspace";
import { rankStreams } from "./streams";
import { useMediaStore } from "../../state/mediaStore";
import type { MediaManifest } from "./types";

const manifestFixture: MediaManifest = {
  id: "org.stremio.cinemeta",
  name: "Cinemeta",
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "top", name: "Popular" },
    { type: "series", id: "top", name: "Popular" },
  ],
};

const movieMeta = {
  id: "tt10648173",
  name: "Never Surrender",
  type: "movie",
  poster: "https://images.metahub.space/poster/medium/tt10648173/background",
  background: "https://images.metahub.space/background/medium/tt10648173/img",
  logo: "https://images.metahub.space/logo/medium/tt10648173/img",
  description: "A deadly gang descends on his remote home.",
  releaseInfo: "2026",
  runtime: "140 min",
  imdbRating: "6.1",
  genres: ["Action", "Crime"],
};

function setBoard(overrides: Record<string, unknown> = {}) {
  useMediaStore.setState({
    workspaceOpen: true,
    screen: "board",
    searchQuery: "",
    watchProgress: {},
    manifest: manifestFixture,
    manifestLoading: false,
    manifestError: null,
    connected: true,
    selected: null,
    catalogs: [
      {
        type: "movie",
        id: "top",
        name: "Trending movies",
        loading: false,
        error: null,
        metas: [movieMeta],
      },
      {
        type: "series",
        id: "top",
        name: "Popular series",
        loading: false,
        error: null,
        metas: [],
      },
    ],
    ...overrides,
  });
}

describe("MediaWorkspace board", () => {
  afterEach(cleanup);
  beforeEach(() => {
    useMediaStore.setState({
      workspaceOpen: true,
      screen: "board",
      searchQuery: "",
      watchProgress: {},
      manifest: null,
      manifestLoading: false,
      manifestError: null,
      catalogs: [],
      connected: false,
      selected: null,
    });
  });

  it("replaces the board with the detail screen and the streams panel while a title is open", () => {
    setBoard({
      selected: movieMeta,
      screen: "detail",
      streams: rankStreams([
        {
          url: "https://example.com/d/x",
          name: "Debrid",
          title: "Never Surrender 2160p WEB-DL \n💾 9.4 GB 📶 21.4 Mbps ⚙️ TorBox",
        },
      ]),
      streamsLoading: false,
      streamsError: null,
      streamFilter: "all",
    });
    const { container } = render(<MediaWorkspace />);
    // Board is gone, the two-column detail screen is on screen.
    expect(screen.queryByRole("heading", { name: "Trending movies" })).toBeNull();
    expect(container.querySelector(".media-main-detail")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Streams for Never Surrender" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Play Never Surrender 2160p/ })).toBeTruthy();
    // Esc returns to the board and clears the selection.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useMediaStore.getState().selected).toBeNull();
  });

  it("shows the connecting state before the manifest resolves", () => {
    useMediaStore.setState({ manifestLoading: true });
    render(<MediaWorkspace />);
    expect(screen.getAllByText(/Connecting/).length).toBeGreaterThan(0);
  });

  it("renders the hero and one carousel per catalog row", () => {
    setBoard();
    render(<MediaWorkspace />);
    expect(screen.getByRole("heading", { name: "Trending movies" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Popular series" })).toBeTruthy();
    // Hero logo art + meta line, per spec §3.1.
    expect((screen.getByAltText("Never Surrender") as HTMLImageElement).src).toContain("metahub");
    expect(screen.getByText("2h20min")).toBeTruthy();
    expect(screen.getByText("IMDb")).toBeTruthy();
    // The title appears on the card as a caption too, by design.
    expect(screen.getAllByText("Never Surrender").length).toBeGreaterThan(0);
  });

  it("puts Continue watching first when the progress store has entries, and hides it when empty", () => {
    setBoard({
      watchProgress: { tt10648173: { position: 45, duration: 100, updatedAt: Date.now() } },
    });
    render(<MediaWorkspace />);
    const headings = document.querySelectorAll(".media-row-head h3");
    expect(headings[0].textContent).toBe("Continue watching");
    expect(
      screen
        .getAllByRole("progressbar", { name: "Never Surrender progress" })[0]
        .getAttribute("aria-valuenow"),
    ).toBe("45");
    cleanup();

    setBoard();
    render(<MediaWorkspace />);
    const first = document.querySelector(".media-row-head h3");
    expect(first?.textContent).toBe("Trending movies");
    expect(screen.queryByText("Continue watching")).toBeNull();
  });

  it("surfaces addon failures with a retry affordance", () => {
    useMediaStore.setState({ manifestError: "Addon responded with HTTP 500" });
    render(<MediaWorkspace />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach the catalog addon.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("filters the loaded catalogs from the top-bar search and hides the hero", () => {
    setBoard({ searchQuery: "never" });
    render(<MediaWorkspace />);
    expect(screen.getByRole("heading", { name: /Results for/ })).toBeTruthy();
    expect(screen.queryByText("IMDb")).toBeNull();
  });

  it("no longer renders a pinned-addons panel: the addons are quiet footer chips", () => {
    setBoard();
    render(<MediaWorkspace />);
    expect(document.querySelector(".media-addonrail")).toBeNull();
    const footer = document.querySelector(".media-board-footer");
    expect(footer?.textContent).toContain("metadata");
    expect(footer?.textContent).toContain("streams");
  });

  it("closes the workspace from the top-bar button", () => {
    const spy = vi.fn();
    setBoard({ closeWorkspace: spy });
    render(<MediaWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Close media" }));
    expect(spy).toHaveBeenCalled();
  });
});
