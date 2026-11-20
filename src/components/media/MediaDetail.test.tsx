// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaDetail } from "./MediaDetail";
import type { MediaCatalogMeta } from "./types";

const meta: MediaCatalogMeta = {
  id: "tt1",
  name: "Heartland",
  type: "movie",
  background: "https://images.metahub.space/background/medium/tt1/img",
  logo: "https://images.metahub.space/logo/medium/tt1/img",
  description: "A country music legend returns to Nashville to unravel the truth.",
  releaseInfo: "2026",
  runtime: "114 min",
  imdbRating: "5.5",
  genres: ["Thriller", "Mystery"],
  cast: ["Jessica Chastain", "Carter Faith"],
  director: ["Shawn Parr"],
};

describe("MediaDetail", () => {
  afterEach(cleanup);

  it("renders the backdrop, logo art, meta line, synopsis and chip rows", () => {
    const { container } = render(<MediaDetail meta={meta} onClose={vi.fn()} />);
    const backdrop = container.querySelector(".media-detail-backdrop") as HTMLElement;
    // `medium` metahub art is a near-black 1280×720 crop — the detail screen
    // upgrades it exactly like the hero does (spec §4.2 / §11.9).
    expect(backdrop.style.backgroundImage).toContain("/background/large/");
    expect(screen.getByAltText("Heartland")).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getByText("1h54min")).toBeTruthy();
    expect(screen.getByText("5.5")).toBeTruthy();
    expect(screen.getByText(/country music legend/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Genres" })).toBeTruthy();
    expect(screen.getByText("Thriller")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Cast" })).toBeTruthy();
    expect(screen.getByText("Jessica Chastain")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Directors" })).toBeTruthy();
    expect(screen.getByText("Shawn Parr")).toBeTruthy();
  });

  it("falls back to a text title when the logo fails or is missing", () => {
    const { unmount } = render(
      <MediaDetail meta={{ ...meta, logo: null }} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Heartland" })).toBeTruthy();
    unmount();

    render(<MediaDetail meta={meta} onClose={vi.fn()} />);
    fireEvent.error(screen.getByAltText("Heartland"));
    expect(screen.getByRole("heading", { name: "Heartland" })).toBeTruthy();
  });

  it("renders the action row and reports the action", () => {
    const onAction = vi.fn();
    render(<MediaDetail meta={meta} onClose={vi.fn()} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
    expect(onAction).toHaveBeenCalledWith("library");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onAction).toHaveBeenCalledWith("share");
  });

  it("returns to the board on Escape", () => {
    const onClose = vi.fn();
    render(<MediaDetail meta={meta} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("hides chip rows the addon did not supply", () => {
    render(
      <MediaDetail
        meta={{ id: "tt9", name: "Bare", genres: null, cast: null, director: null }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("list", { name: "Genres" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Cast" })).toBeNull();
  });
});