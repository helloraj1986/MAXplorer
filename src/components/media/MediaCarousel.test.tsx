// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaCarousel } from "./MediaCarousel";
import type { MediaCatalogMeta } from "./types";

const items: MediaCatalogMeta[] = [
  { id: "tt1", name: "Hibla 2", poster: "https://images.metahub.space/poster/medium/tt1/img" },
  { id: "tt2", name: "Palang Tod", poster: "https://images.metahub.space/poster/medium/tt2/img" },
  { id: "tt3", name: "Service", poster: null },
];

describe("MediaCarousel", () => {
  afterEach(cleanup);

  it("renders the heading and one card per item", () => {
    render(<MediaCarousel heading="Continue watching" items={items} onSelect={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Continue watching" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Show streams for/ }).length).toBe(3);
  });

  it("keeps one tab stop per row (roving tabindex) and moves it with the arrow keys", () => {
    render(<MediaCarousel heading="Trending movies" items={items} onSelect={() => undefined} />);
    const cards = screen.getAllByRole("button", { name: /Show streams for/ });
    expect(cards[0].getAttribute("tabindex")).toBe("0");
    expect(cards[1].getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(cards[0], { key: "ArrowRight" });
    expect(cards[1].getAttribute("tabindex")).toBe("0");
    expect(cards[0].getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(cards[1], { key: "End" });
    expect(cards[2].getAttribute("tabindex")).toBe("0");
  });

  it("selects a title on click and on Enter", () => {
    const onSelect = vi.fn();
    render(<MediaCarousel heading="Trending movies" items={items} onSelect={onSelect} />);
    const cards = screen.getAllByRole("button", { name: /Show streams for/ });
    fireEvent.click(cards[0]);
    fireEvent.keyDown(cards[1], { key: "Enter" });
    expect(onSelect.mock.calls.map((call) => call[0].id)).toEqual(["tt1", "tt2"]);
  });

  it("draws the in-art progress bar from the store entry", () => {
    render(
      <MediaCarousel
        heading="Continue watching"
        items={items}
        progress={{ tt1: { position: 45, duration: 100, updatedAt: 1 } }}
        onSelect={() => undefined}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Hibla 2 progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("45");
  });

  it("shows skeletons while loading and the error line with Retry on failure", () => {
    const { unmount } = render(
      <MediaCarousel heading="Trending movies" items={[]} loading onSelect={() => undefined} />,
    );
    expect(document.querySelectorAll(".media-card-skeleton").length).toBe(6);
    unmount();

    const onRetry = vi.fn();
    render(
      <MediaCarousel
        heading="Trending movies"
        items={[]}
        error="Cinemeta did not respond."
        onRetry={onRetry}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Cinemeta did not respond.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("falls back to the addon's letter tile when a poster is missing", () => {
    render(<MediaCarousel heading="Trending movies" items={[items[2]]} onSelect={() => undefined} />);
    expect(document.querySelector(".media-card-fallback")?.textContent).toBe("S");
  });
});
