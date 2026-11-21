// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  TrackMenu,
  languageName,
  trackBadges,
  trackLabel,
  trackRows,
} from "./TrackMenu";
import type { PlayerTrack } from "./types";

const audio = (overrides: Partial<PlayerTrack> = {}): PlayerTrack => ({
  id: 1,
  kind: "audio",
  lang: "eng",
  title: null,
  codec: "eac3",
  channels: "5.1",
  selected: true,
  default: true,
  forced: false,
  external: false,
  ...overrides,
});

const subtitle = (overrides: Partial<PlayerTrack> = {}): PlayerTrack => ({
  id: 1,
  kind: "sub",
  lang: "eng",
  title: "English",
  codec: "subrip",
  channels: null,
  selected: false,
  default: false,
  forced: false,
  external: false,
  ...overrides,
});

describe("track helpers", () => {
  it("names ISO 639 codes and falls back to the raw code", () => {
    expect(languageName("eng")).toBe("English");
    expect(languageName("FRA")).toBe("French");
    expect(languageName("tlh")).toBe("TLH");
    expect(languageName(null)).toBeNull();
    expect(languageName(" ")).toBeNull();
  });

  it("builds the `English · EAC3 · 5.1` row label", () => {
    expect(trackLabel(audio())).toBe("English · EAC3 · 5.1");
    // A track with no language falls back to its title, then to the id.
    expect(trackLabel(audio({ lang: null, title: "Commentary", codec: null, channels: null }))).toBe(
      "Commentary",
    );
    expect(trackLabel(audio({ lang: null, title: null, codec: null, channels: null }))).toBe(
      "Track 1",
    );
  });

  it("reports Default / Forced / External badges", () => {
    expect(trackBadges(audio())).toEqual(["Default"]);
    expect(trackBadges(subtitle({ forced: true, external: true }))).toEqual(["Forced", "External"]);
  });
});

describe("trackRows", () => {
  it("puts the subtitle Off row first and marks the current selection", () => {
    const rows = trackRows("sub", [subtitle()], null);
    expect(rows.map((row) => row.label)).toEqual(["Off", "English · SUBRIP"]);
    expect(rows[0].checked).toBe(true);
    expect(rows[1].checked).toBe(false);

    const selected = trackRows("sub", [subtitle()], 1);
    expect(selected[0].checked).toBe(false);
    expect(selected[1].checked).toBe(true);
  });

  it("has no Off row for audio and keeps mpv's order", () => {
    const rows = trackRows("audio", [audio(), audio({ id: 2, lang: "fra", selected: false })], 1);
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    expect(rows.every((row) => row.label !== "Off")).toBe(true);
  });
});

describe("TrackMenu", () => {
  afterEach(cleanup);

  it("renders a radio menu with the active row checked", () => {
    render(
      <TrackMenu
        kind="sub"
        tracks={[subtitle()]}
        activeId={1}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("aria-checked")).toBe("false");
    expect(items[1].getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menu", { name: "Subtitles" })).toBeTruthy();
  });

  it("reports Off and a track id through onSelect", () => {
    const onSelect = vi.fn();
    render(
      <TrackMenu
        kind="sub"
        tracks={[subtitle()]}
        activeId={null}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Off/ }));
    expect(onSelect).toHaveBeenCalledWith(null);

    const onSelect2 = vi.fn();
    cleanup();
    render(
      <TrackMenu
        kind="sub"
        tracks={[subtitle()]}
        activeId={null}
        onSelect={onSelect2}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: /English/ }));
    expect(onSelect2).toHaveBeenCalledWith(1);
  });

  it("closes on Escape and moves focus with the arrow keys", () => {
    const onClose = vi.fn();
    render(
      <TrackMenu
        kind="audio"
        tracks={[audio(), audio({ id: 2, lang: "fra", selected: false })]}
        activeId={1}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    const items = screen.getAllByRole("menuitemradio");
    items[0].focus();
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when there are no tracks of that kind", () => {
    const { container } = render(
      <TrackMenu kind="audio" tracks={[subtitle()]} activeId={null} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector(".media-trackmenu")).toBeNull();
  });
});