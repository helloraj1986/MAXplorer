// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MediaWorkspace } from "./MediaWorkspace";
import { rankStreams, parseSizeBytes } from "./streams";
import { useMediaStore } from "../../state/mediaStore";
import type { MediaStream } from "./types";

describe("rankStreams", () => {
  it("ranks quality first, direct over torrent second, then size", () => {
    const ranked = rankStreams([
      { name: "Torrentio", title: "Movie 720p 4.1 GB", quality: "720p" },
      { name: "Debrid", url: "https://example.com/d/x", title: "Movie 1080p 9.4 GB", quality: "1080p" },
      { name: "Debrid 4K", url: "https://example.com/d/y", title: "Movie 2160p HDR 58.2 GB", quality: "2160p" },
    ]);
    expect(ranked[0].stream.title).toContain("2160p");
    expect(ranked[1].stream.title).toContain("1080p");
    expect(ranked[2].stream.title).toContain("720p");
    // The 1080p debrid link is flagged DIRECT; the torrent one P2P.
    const direct = ranked.filter((item) => item.direct);
    expect(direct).toHaveLength(2);
    expect(direct.every((item) => item.flags.some((flag) => flag.text === "DIRECT"))).toBe(true);
    expect(ranked[2].flags.some((flag) => flag.text === "P2P")).toBe(true);
  });

  it("flags HDR releases and parses sizes from titles", () => {
    const [ranked] = rankStreams([
      { name: "X", url: "https://example.com/s", title: "Movie 2160p Dolby Vision 58.2 GB" },
    ]);
    expect(ranked.qualityRank).toBe(6);
    expect(ranked.flags.map((flag) => flag.text)).toContain("HDR");
    expect(parseSizeBytes("58.2 GB")).toBeGreaterThan(50 * 1024 ** 3);
    expect(parseSizeBytes("700 MB")).toBeGreaterThan(0);
    expect(parseSizeBytes("no size here")).toBe(0);
    expect(parseSizeBytes(null)).toBe(0);
  });
});

describe("MediaWorkspace streams sheet", () => {
  afterEach(cleanup);

  const streams: MediaStream[] = [
    { url: "https://example.com/d/x", title: "Movie 1080p 9.4 GB", quality: "1080p", name: "Debrid" },
  ];

  function select() {
    useMediaStore.setState({
      selected: {
        id: "tt123",
        name: "Test Movie",
        type: "movie",
        releaseInfo: "2024",
        imdbRating: "7.5",
      },
      streams: rankStreams(streams),
      streamsLoading: false,
      streamsError: null,
    });
  }

  it("shows the ranked stream rows for the selected title", () => {
    select();
    render(<MediaWorkspace />);
    expect(screen.getByRole("region", { name: "Test Movie streams" })).toBeTruthy();
    expect(screen.getByText(/Movie 1080p 9.4 GB/)).toBeTruthy();
    expect(screen.getByText("DIRECT")).toBeTruthy();
  });

  it("shows loading, error and empty states", () => {
    useMediaStore.setState({ selected: { id: "tt123", name: "Test Movie" }, streamsLoading: true });
    const { unmount } = render(<MediaWorkspace />);
    expect(screen.getByText(/Resolving streams/)).toBeTruthy();
    unmount();

    useMediaStore.setState({ streamsLoading: false, streamsError: "HTTP 429" });
    render(<MediaWorkspace />);
    expect(screen.getByText(/Couldn't resolve streams: HTTP 429/)).toBeTruthy();
  });

  it("shows a Play button for direct streams and an engine note for torrents", () => {
    useMediaStore.setState({
      selected: { id: "tt123", name: "Test Movie", type: "movie" },
      streams: rankStreams([
        { url: "https://example.com/d/x", title: "Movie 1080p 9.4 GB", quality: "1080p", name: "Debrid" },
        { infoHash: "abc123", title: "Movie 720p 4.1 GB", quality: "720p", name: "Torrentio" },
      ]),
      streamsLoading: false,
      streamsError: null,
    });
    render(<MediaWorkspace />);
    expect(screen.getByRole("button", { name: /Play .* in external player/ })).toBeTruthy();
    expect(screen.getByLabelText(/playback requires the Phase 4 engine/)).toBeTruthy();
  });
});
