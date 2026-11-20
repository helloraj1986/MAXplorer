// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { StreamsPanel } from "./StreamsPanel";
import { rankStreams } from "./streams";
import { useMediaStore } from "../../state/mediaStore";
import type { MediaCatalogMeta, StreamFilter } from "./types";

const meta: MediaCatalogMeta = { id: "tt1", name: "Heartland", type: "movie" };

function buildStreams(count: number) {
  return rankStreams(
    Array.from({ length: count }, (_, index) => ({
      url: index % 2 === 0 ? `https://example.com/1080/${index}` : undefined,
      infoHash: index % 2 === 0 ? undefined : `hash${index}`,
      name: "Torrentio",
      title: `${index % 2 === 0 ? "1080p" : "2160p"} release ${index} ${index + 1} GB`,
    })),
  );
}

function renderPanel(overrides: Partial<Parameters<typeof StreamsPanel>[0]> = {}) {
  const props = {
    meta,
    streams: buildStreams(3),
    loading: false,
    error: null,
    filter: "all" as StreamFilter,
    onFilterChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const result = render(<StreamsPanel {...props} />);
  return { ...props, ...result };
}

describe("StreamsPanel", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useMediaStore.setState({ engine: null });
  });

  it("renders the filter control and the Selection group heading", () => {
    renderPanel();
    expect(screen.getByRole("combobox", { name: "Filter sources" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Selection" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Streams for Heartland" })).toBeTruthy();
  });

  it("offers the five filter options", () => {
    renderPanel();
    const select = screen.getByRole("combobox", { name: "Filter sources" }) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "all",
      "cached",
      "4k",
      "1080p",
      "torrent",
    ]);
  });

  it("reports the chosen filter to its host without refetching", () => {
    const props = renderPanel();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter sources" }), {
      target: { value: "torrent" },
    });
    expect(props.onFilterChange).toHaveBeenCalledWith("torrent");
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(3);
  });

  it("filters the rows client-side", () => {
    renderPanel({ streams: buildStreams(3), filter: "cached" });
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(2);
  });

  it("offers a way back when the filter matches nothing", () => {
    const props = renderPanel({ filter: "4k", streams: [] });
    expect(screen.getByText(/No sources found/)).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("caps the list at 60 rows behind a Show all button", () => {
    renderPanel({ streams: buildStreams(75) });
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(60);
    fireEvent.click(screen.getByRole("button", { name: "Show all (75)" }));
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(75);
  });

  it("shows skeletons while resolving and an error panel with retry", () => {
    const { unmount } = renderPanel({ loading: true, streams: [] });
    expect(screen.getByLabelText("Loading streams")).toBeTruthy();
    unmount();

    const onRetry = vi.fn();
    renderPanel({ error: "HTTP 429", streams: [], onRetry });
    expect(screen.getByText(/Couldn't resolve streams for Heartland/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
});