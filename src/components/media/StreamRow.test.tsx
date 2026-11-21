// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StreamRow } from "./StreamRow";
import { rankStreams } from "./streams";
import { useMediaStore } from "../../state/mediaStore";
import { useExplorerStore } from "../../state/explorerStore";
import type { MediaStream } from "./types";

const comeTorzStream: MediaStream = {
  url: "https://example.com/d/heartland",
  name: "ComeTorz\n4K",
  title:
    "Heartland (2026)\nWEB-DL ⚙ HEVC 🕐 1h:53m:58s\nAtmos | DD+ 🔊 5.1\n💾 18.3 GB 📶 21.4 Mbps\n⚡ Ready (RD) 🧩 ComeTorz",
};

const torrentStream: MediaStream = {
  infoHash: "1175658c5b4656dcfb592f1d3b25806002faf713",
  name: "Torrentio\n4k DV | HDR10+",
  title: "Sinners 2025 2160p HDR10Plus DV BluRay x265 HEVC-PSA\n👤 132 💾 5.45 GB ⚙️ ThePirateBay\n🇬🇧 / 🇮🇹",
};

function ranked(stream: MediaStream) {
  return rankStreams([stream])[0];
}

describe("StreamRow", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useMediaStore.setState({ engine: null, playerSource: null });
  });

  it("renders the anatomy from parsed facts (subtitle line omitted when unknown)", () => {
    const { container } = render(<StreamRow ranked={ranked(comeTorzStream)} metaId="tt1" />);
    const lines = container.querySelectorAll(".media-stream-line");
    expect(lines.length).toBe(6);

    const text = container.textContent ?? "";
    expect(text).toContain("4K");
    expect(text).toContain("Heartland (2026)");
    expect(text).toContain("WEB-DL");
    expect(text).toContain("HEVC");
    expect(text).toContain("1h:53m:58s");
    expect(text).toContain("Atmos | DD+");
    expect(text).toContain("5.1");
    expect(text).toContain("18.3 GB");
    expect(text).toContain("21.4 Mbps");
    expect(text).toContain("ComeTorz");
  });

  it("omits the subtitle line when the addon says nothing about languages", () => {
    const { container } = render(<StreamRow ranked={ranked(comeTorzStream)} metaId="tt1" />);
    expect(container.querySelectorAll(".media-langflag")).toHaveLength(0);
  });

  it("renders language tiles for a row that carries flags", () => {
    const { container } = render(<StreamRow ranked={ranked(torrentStream)} metaId="tt1" />);
    const flags = Array.from(container.querySelectorAll(".media-langflag")).map(
      (node) => node.textContent,
    );
    expect(flags).toEqual(["GB", "IT"]);
    expect(container.textContent).toContain("132 peers");
  });

  it("renders all seven lines when audio and subtitle information are both known", () => {
    const full = rankStreams([
      {
        infoHash: "abc",
        name: "Torrentio",
        title:
          "Movie 2160p WEB-DL DDP5.1 x265\n👤 10 💾 8 GB ⚙️ YTS\n🇬🇧 / 🇫🇷",
      },
    ])[0];
    const { container } = render(<StreamRow ranked={full} metaId="tt1" />);
    const lines = container.querySelectorAll(".media-stream-line");
    expect(lines).toHaveLength(7);
    expect(lines[3].textContent).toContain("DD+");
    expect(lines[3].textContent).toContain("5.1");
    expect(lines[4].textContent).toContain("GB");
  });

  it("shows the rank on line 1 as a tooltip-backed label", () => {
    const { container } = render(<StreamRow ranked={ranked(comeTorzStream)} metaId="tt1" />);
    const top = container.querySelector(".media-stream-line-top");
    expect(top?.getAttribute("title")).toContain("Rank 1");
    // The rank is screen-reader/tooltip only — the visible row stays uncluttered.
    const rank = container.querySelector(".media-stream-rank");
    expect(rank?.textContent).toBe("#1");
  });

  it("plays a direct stream in the app when the row is clicked", () => {
    render(<StreamRow ranked={ranked(comeTorzStream)} metaId="tt1" />);
    fireEvent.click(screen.getByRole("button", { name: /Play Heartland/ }));
    expect(useMediaStore.getState().playerSource?.url).toBe("https://example.com/d/heartland");
  });

  it("offers an external player for direct streams only", () => {
    const { unmount } = render(<StreamRow ranked={ranked(comeTorzStream)} metaId="tt1" />);
    expect(screen.getByRole("button", { name: /external player/ })).toBeTruthy();
    unmount();
    render(<StreamRow ranked={ranked(torrentStream)} metaId="tt1" />);
    expect(screen.queryByRole("button", { name: /external player/ })).toBeNull();
  });

  it("shows live engine progress in line 7 while resolving", () => {
    const row = ranked(torrentStream);
    useMediaStore.setState({
      engine: {
        infoHash: torrentStream.infoHash as string,
        baseUrl: "http://127.0.0.1:18081",
        phase: "resolving",
        progress: 0.37,
        speed: 2.4,
        peers: 12,
      },
    });
    const { container } = render(<StreamRow ranked={row} metaId="tt1" />);
    const avail = container.querySelector(".media-stream-line-avail");
    expect(avail?.textContent).toContain("Starting engine");
    expect(avail?.textContent).toContain("37 %");
    expect(avail?.textContent).toContain("2.4 MB/s");
    expect(avail?.textContent).toContain("12 peers");
    // The row cannot be re-clicked while the engine is starting.
    expect(screen.getByRole("button", { name: /Play Sinners/ }).hasAttribute("disabled")).toBe(true);
  });

  it("turns line 7 red and toasts once when the engine fails", () => {
    const toast = vi.fn();
    useExplorerStore.setState({ toast });
    useMediaStore.setState({
      engine: {
        infoHash: torrentStream.infoHash as string,
        baseUrl: "",
        phase: "error",
        error: "No peers responded in time.",
      },
    });
    const { container, rerender } = render(<StreamRow ranked={ranked(torrentStream)} metaId="tt1" />);
    const avail = container.querySelector(".media-stream-line-avail");
    expect(avail?.className).toContain("error");
    expect(avail?.textContent).toContain("No peers responded in time.");
    rerender(<StreamRow ranked={ranked(torrentStream)} metaId="tt1" />);
    expect(toast).toHaveBeenCalledTimes(1);
  });
});