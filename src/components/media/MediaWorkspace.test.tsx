// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MediaWorkspace } from "./MediaWorkspace";
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

describe("MediaWorkspace", () => {
  afterEach(cleanup);
  beforeEach(() => {
    useMediaStore.setState({
      workspaceOpen: true,
      manifest: null,
      manifestLoading: false,
      manifestError: null,
      catalogs: [],
      connected: false,
    });
  });

  it("shows the connecting state before the manifest resolves", () => {
    useMediaStore.setState({ manifestLoading: true });
    render(<MediaWorkspace />);
    expect(screen.getByText(/Connecting/)).toBeTruthy();
  });

  it("renders real catalog rows with poster art once loaded", () => {
    useMediaStore.setState({
      manifest: manifestFixture,
      connected: true,
      catalogs: [
        {
          type: "movie",
          id: "top",
          name: "Trending movies",
          loading: false,
          error: null,
          metas: [
            {
              id: "tt10648173",
              name: "Thor: Love and Thunder",
              poster: "https://images.metahub.space/poster/medium/tt10648173/background",
              releaseInfo: "2022",
              imdbRating: "6.2",
            },
          ],
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
    });
    render(<MediaWorkspace />);
    expect(screen.getByRole("heading", { name: "Trending movies" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Popular series" })).toBeTruthy();
    // The title appears in both the hero and its poster card, by design.
    expect(screen.getAllByText("Thor: Love and Thunder").length).toBeGreaterThan(0);
    expect((screen.getByAltText("") as HTMLImageElement).src).toContain("metahub");
    expect(screen.getByText("2022 · ★ 6.2")).toBeTruthy();
  });

  it("surfaces addon failures with a retry affordance", () => {
    useMediaStore.setState({ manifestError: "Addon responded with HTTP 500" });
    render(<MediaWorkspace />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach the catalog addon.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("closes the workspace from the header button", async () => {
    const spy = vi.fn();
    useMediaStore.setState({ closeWorkspace: spy });
    render(<MediaWorkspace />);
    screen.getByRole("button", { name: "Close media" }).click();
    expect(spy).toHaveBeenCalled();
  });
});
