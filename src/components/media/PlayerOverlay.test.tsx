// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PlayerOverlay,
  bufferedSpanPercent,
  cacheSummary,
  clampVolume,
  formatSpeed,
  formatTime,
  seekSecondsFromPointer,
  spanPercent,
} from "./PlayerOverlay";
import { useMediaStore } from "../../state/mediaStore";
import type { NativePlayerStatus } from "./types";

/**
 * The buffering indicator can't live over the video stage (the native libmpv
 * surface covers it), so the state is rendered in the player chrome. These are
 * the formatting rules behind that pill.
 */
describe("formatSpeed", () => {
  it("scales bytes/second into human units", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(800)).toBe("800 B/s");
    expect(formatSpeed(1536)).toBe("1.5 KB/s");
    expect(formatSpeed(2.5 * 1024 * 1024)).toBe("2.5 MB/s");
    expect(formatSpeed(12 * 1024 * 1024)).toBe("12 MB/s");
  });

  it("treats missing or negative values as zero", () => {
    expect(formatSpeed(Number.NaN)).toBe("0 B/s");
    expect(formatSpeed(-4)).toBe("0 B/s");
  });
});

describe("cacheSummary", () => {
  it("combines cache fill and arrival rate", () => {
    expect(cacheSummary(42.4, 1.5 * 1024 * 1024)).toBe("42% · 1.5 MB/s");
  });

  it("clamps the percentage into 0-100", () => {
    expect(cacheSummary(-5, 0)).toBe("0% · 0 B/s");
    expect(cacheSummary(180, 0)).toBe("100% · 0 B/s");
  });
});

describe("player time + span math (WP4a)", () => {
  it("formats elapsed times the way the bar shows them", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(28)).toBe("0:28");
    expect(formatTime(754)).toBe("12:34");
    expect(formatTime(6299)).toBe("1:44:59");
    expect(formatTime(Number.NaN)).toBe("0:00");
  });

  it("turns a pointer position into absolute seconds", () => {
    const rect = { left: 100, width: 200 };
    expect(seekSecondsFromPointer(150, rect, 300)).toBe(75);
    expect(seekSecondsFromPointer(100, rect, 300)).toBe(0);
    expect(seekSecondsFromPointer(300, rect, 300)).toBe(300);
    // Outside the track clamps instead of seeking past the ends.
    expect(seekSecondsFromPointer(-40, rect, 300)).toBe(0);
    expect(seekSecondsFromPointer(900, rect, 300)).toBe(300);
    // No duration yet: never a seek.
    expect(seekSecondsFromPointer(150, rect, 0)).toBe(0);
    expect(seekSecondsFromPointer(150, { left: 0, width: 0 }, 300)).toBe(0);
  });

  it("computes the played and buffered spans as percentages", () => {
    expect(spanPercent(60, 300)).toBeCloseTo(20, 5);
    expect(spanPercent(600, 300)).toBe(100);
    expect(spanPercent(60, 0)).toBe(0);
    // Buffered span is anchored at the playhead and clamped to the end.
    expect(bufferedSpanPercent(60, 30, 300)).toBeCloseTo(30, 5);
    expect(bufferedSpanPercent(290, 60, 300)).toBe(100);
    expect(bufferedSpanPercent(60, Number.NaN, 300)).toBeCloseTo(20, 5);
  });

  it("clamps volume to whole percentages", () => {
    expect(clampVolume(45.4)).toBe(45);
    expect(clampVolume(-10)).toBe(0);
    expect(clampVolume(180)).toBe(100);
    expect(clampVolume(Number.NaN)).toBe(0);
  });
});

// ── component behaviour ──────────────────────────────────────────────────────

vi.mock("../../lib/api", () => ({
  isTauri: false,
  normalizeError: (error: unknown) => ({ message: String(error) }),
  api: {
    playerOpen: vi.fn(),
    playerClose: vi.fn(() => Promise.resolve()),
    playerSetRect: vi.fn(),
    playerSetPause: vi.fn(() => Promise.resolve(undefined)),
    playerSeek: vi.fn(() => Promise.resolve(undefined)),
    playerSeekRelative: vi.fn(() => Promise.resolve(undefined)),
    playerSetVolume: vi.fn(() => Promise.resolve(undefined)),
    playerSetMuted: vi.fn(() => Promise.resolve(undefined)),
    playerSetSurfaceVisible: vi.fn(() => Promise.resolve(undefined)),
    playMediaStream: vi.fn(() => Promise.resolve({ player: "VLC" })),
  },
}));

// Imported after the mock so every call goes through the spies.
import { api } from "../../lib/api";

function status(overrides: Partial<NativePlayerStatus> = {}): NativePlayerStatus {
  return {
    loaded: true,
    paused: false,
    eof: false,
    idle: false,
    position: 754,
    duration: 6299,
    volume: 40,
    muted: false,
    title: "Sintel",
    videoFormat: "hevc",
    pausedForCache: false,
    cachePercent: 42,
    cacheSeconds: 30,
    cacheSpeed: 1.5 * 1024 * 1024,
    fileLoaded: true,
    error: null,
    ...overrides,
  };
}

function openPlayer(overrides: Partial<NativePlayerStatus> = {}) {
  useMediaStore.setState({
    playerSource: {
      url: "http://127.0.0.1:18081/torrents/x/stream/0",
      title: "Sintel",
      metaId: "tt1727587",
      poster: "https://images.metahub.space/poster/medium/tt1727587/img",
      quality: "4K",
    },
    playerStatus: status(overrides),
    engine: null,
  });
}

const root = () => document.querySelector(".media-player") as HTMLElement;
const seekBar = () => document.querySelector(".media-player-seek") as HTMLElement;

describe("PlayerOverlay chrome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openPlayer();
  });

  afterEach(() => {
    cleanup();
    useMediaStore.setState({ playerSource: null, playerStatus: null, engine: null });
    vi.useRealTimers();
  });

  it("renders the top strip, transport and codec chip on --m-* tokens", () => {
    render(<PlayerOverlay />);
    expect(document.querySelector(".media-player-top")).toBeTruthy();
    expect(document.querySelector(".media-player-bottom")).toBeTruthy();
    expect(document.querySelector(".media-player-title")?.textContent).toBe("Sintel");
    // quality + codec chip, both real data (stream badge + mpv video-format).
    expect(document.querySelector(".media-player-chip")?.textContent).toBe("4K · HEVC");
    const transport = document.querySelector(".media-player-transport");
    expect(transport?.getAttribute("aria-label")).toBe("Pause");
  });

  it("hides the chrome 3 s after the last input while playing, and wakes on mouse move", () => {
    vi.useFakeTimers();
    render(<PlayerOverlay />);
    expect(root().className).not.toContain("is-idle");

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(root().className).not.toContain("is-idle");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(root().className).toContain("is-idle");

    fireEvent.mouseMove(window);
    expect(root().className).not.toContain("is-idle");

    // …and the countdown restarts from that input.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(root().className).toContain("is-idle");
  });

  it("keeps the chrome pinned while paused", () => {
    vi.useFakeTimers();
    openPlayer({ paused: true });
    render(<PlayerOverlay />);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(root().className).not.toContain("is-idle");
  });

  it("reveals the chrome on Tab", () => {
    vi.useFakeTimers();
    render(<PlayerOverlay />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(root().className).toContain("is-idle");

    fireEvent.keyDown(window, { key: "Tab" });
    expect(root().className).not.toContain("is-idle");
  });

  it("maps the §5 keyboard shortcuts onto the player commands", () => {
    render(<PlayerOverlay />);

    fireEvent.keyDown(window, { key: " " });
    expect(api.playerSetPause).toHaveBeenCalledWith(true);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(api.playerSeekRelative).toHaveBeenLastCalledWith(10);

    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });
    expect(api.playerSeekRelative).toHaveBeenLastCalledWith(-60);

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(api.playerSetVolume).toHaveBeenLastCalledWith(45);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(api.playerSetVolume).toHaveBeenLastCalledWith(35);

    fireEvent.keyDown(window, { key: "m" });
    expect(api.playerSetMuted).toHaveBeenCalledWith(true);
  });

  it("hides the chrome on Esc, then closes the player on the second press", () => {
    render(<PlayerOverlay />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(root().className).toContain("is-idle");
    expect(useMediaStore.getState().playerSource).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useMediaStore.getState().playerSource).toBeNull();
  });

  it("draws the buffered span from cacheSeconds", () => {
    render(<PlayerOverlay />);
    const buffer = document.querySelector(".media-player-seek-buffer") as HTMLElement;
    const fill = document.querySelector(".media-player-seek-fill") as HTMLElement;
    // position 754 + 30 s buffered of 6299 s
    expect(buffer.style.width).toBe(`${((754 + 30) / 6299) * 100}%`);
    expect(fill.style.width).toBe(`${(754 / 6299) * 100}%`);
  });

  it("exposes slider semantics with a readable aria-valuetext", () => {
    render(<PlayerOverlay />);
    expect(seekBar().getAttribute("role")).toBe("slider");
    expect(seekBar().getAttribute("aria-valuetext")).toBe("12:34 of 1:44:59");
    expect(seekBar().getAttribute("aria-valuemin")).toBe("0");
    expect(seekBar().getAttribute("aria-valuemax")).toBe("6299");
  });

  it("scrubs optimistically and sends exactly one seek on release", async () => {
    render(<PlayerOverlay />);
    const bar = seekBar();
    // jsdom reports a zero-size rect, so the ratio resolves to 0 s — what matters
    // here is that the gesture produces a single commit, never a seek per move.
    fireEvent.pointerDown(bar, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 120, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 240, pointerId: 1 });
    expect(api.playerSeek).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.pointerUp(bar, { clientX: 240, pointerId: 1 });
    });
    expect(api.playerSeek).toHaveBeenCalledTimes(1);
  });

  it("replaces the stage with the error card and keeps the surface hidden", () => {
    openPlayer({ error: "Failed to open https://example.test/stream" });
    render(<PlayerOverlay />);
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Playback failed");
    expect(alert?.textContent).toContain("Failed to open https://example.test/stream");
    expect(alert?.textContent).toContain("Open in external player");
    expect(alert?.textContent).toContain("Retry");
    // The spinner must not linger behind the card.
    expect(document.querySelector(".media-player-spinner")).toBeNull();
  });

  it("opens the external player from the error card", () => {
    openPlayer({ error: "boom" });
    render(<PlayerOverlay />);
    const external = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("Open in external player"),
    );
    expect(external).toBeTruthy();
    fireEvent.click(external as HTMLButtonElement);
    expect(api.playMediaStream).toHaveBeenCalledWith(
      "http://127.0.0.1:18081/torrents/x/stream/0",
    );
  });

  it("shows the connecting note before the first frame, not a blank stage", () => {
    openPlayer({ fileLoaded: false, loaded: false, videoFormat: null });
    useMediaStore.setState({
      engine: { infoHash: "abc", baseUrl: "", phase: "resolving", progress: 0.37, peers: 12 },
    });
    render(<PlayerOverlay />);
    const stage = document.querySelector(".media-player-stage");
    expect(stage?.textContent).toContain("Connecting to the swarm… 37% · 12 peers");
    // The same state is mirrored in the chrome pill, which survives the surface.
    expect(document.querySelector(".media-player-pill")?.textContent).toContain(
      "Connecting to the swarm…",
    );
  });

  it("renders the title art for an audio-only source", () => {
    openPlayer({ videoFormat: null });
    render(<PlayerOverlay />);
    const art = document.querySelector(".media-player-art");
    expect(art).toBeTruthy();
    const img = art?.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(
      "https://images.metahub.space/poster/medium/tt1727587/img",
    );
  });
});