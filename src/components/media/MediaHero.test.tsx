// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaHero } from "./MediaHero";
import type { MediaCatalogMeta } from "./types";

const movie: MediaCatalogMeta = {
  id: "tt1",
  name: "Never Surrender",
  type: "movie",
  logo: "https://images.metahub.space/logo/medium/tt1/img",
  background: "https://images.metahub.space/background/medium/tt1/img",
  description: "A deadly gang descends on his remote home.",
  releaseInfo: "2026",
  runtime: "140 min",
  imdbRating: "6.1",
  genres: ["Action", "Crime", "Thriller"],
};

describe("MediaHero", () => {
  afterEach(cleanup);

  it("renders logo art with the meta line, IMDb badge and genres", () => {
    render(<MediaHero meta={movie} onWatch={() => undefined} />);
    const logo = screen.getByAltText("Never Surrender") as HTMLImageElement;
    expect(logo.src).toContain("metahub");
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getByText("2h20min")).toBeTruthy();
    expect(screen.getByText("6.1")).toBeTruthy();
    expect(screen.getByText("IMDb")).toBeTruthy();
    expect(screen.getByText("Action, Crime, Thriller")).toBeTruthy();
    expect(screen.getByText(/deadly gang/)).toBeTruthy();
    const backdrop = document.querySelector(".media-hero-backdrop") as HTMLElement;
    expect(backdrop.style.backgroundImage).toContain("/background/large/");
  });

  it("falls back to a text title when there is no logo art", () => {
    render(<MediaHero meta={{ ...movie, logo: null }} onWatch={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Never Surrender" })).toBeTruthy();
    expect(screen.queryByAltText("Never Surrender")).toBeNull();
  });

  it("falls back to text when the logo image fails to load", () => {
    render(<MediaHero meta={movie} onWatch={() => undefined} />);
    fireEvent.error(screen.getByAltText("Never Surrender"));
    expect(screen.getByRole("heading", { name: "Never Surrender" })).toBeTruthy();
  });

  it("fires the Watch pill and keeps the library circle honest", () => {
    const onWatch = vi.fn();
    render(<MediaHero meta={movie} onWatch={onWatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(onWatch).toHaveBeenCalledTimes(1);
    // No library store yet: the circle must say so rather than pretend.
    const library = screen.getByRole("button", { name: "Add to library" });
    expect(library.getAttribute("title")).toContain("roadmap");
    expect(library.getAttribute("aria-disabled")).toBe("true");
  });

  it("hides the episodes circle for movies and shows it for series", () => {
    const { unmount } = render(<MediaHero meta={movie} onWatch={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Episodes" })).toBeNull();
    unmount();

    const onEpisodes = vi.fn();
    render(
      <MediaHero meta={{ ...movie, type: "series" }} onWatch={() => undefined} onEpisodes={onEpisodes} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Episodes" }));
    expect(onEpisodes).toHaveBeenCalledTimes(1);
  });
});
