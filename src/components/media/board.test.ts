import { describe, expect, it } from "vitest";
import {
  allMetas,
  continueWatching,
  formatRuntime,
  formatTimeLeft,
  heroBackdrop,
  heroMetaLine,
  inContinueWindow,
  initialOf,
  isNew,
  progressRatio,
  seasonLabel,
} from "./board";
import type { MediaCatalogMeta, WatchProgress } from "./types";

const NOW = Date.parse("2026-11-21T00:00:00.000Z");

describe("formatRuntime", () => {
  it("normalises Cinemeta's minutes to the reference format", () => {
    expect(formatRuntime("173 min")).toBe("2h53min");
    expect(formatRuntime("140 min")).toBe("2h20min");
    expect(formatRuntime("45 min")).toBe("45min");
  });

  it("accepts hour forms and drops junk", () => {
    expect(formatRuntime("2h")).toBe("2h");
    expect(formatRuntime("1h 30m")).toBe("1h30min");
    expect(formatRuntime(null)).toBeNull();
    expect(formatRuntime("1080p")).toBeNull();
  });
});

describe("isNew", () => {
  it("flags releases inside the 30-day window only", () => {
    expect(isNew("2026-11-01T00:00:00.000Z", NOW)).toBe(true);
    expect(isNew("2026-09-01T00:00:00.000Z", NOW)).toBe(false);
    expect(isNew(null, NOW)).toBe(false);
  });
});

describe("heroMetaLine", () => {
  it("builds release · runtime · rating with the IMDb badge and genres", () => {
    const line = heroMetaLine({
      id: "tt1",
      releaseInfo: "2026",
      runtime: "140 min",
      imdbRating: "6.1",
      genres: ["Action", "Crime", "Thriller"],
    });
    expect(line.parts).toEqual(["2026", "2h20min", "6.1"]);
    expect(line.imdb).toBe(true);
    expect(line.genres).toBe("Action, Crime, Thriller");
  });

  it("omits what the addon did not supply", () => {
    const line = heroMetaLine({ id: "tt2" });
    expect(line.parts).toEqual([]);
    expect(line.imdb).toBe(false);
    expect(line.genres).toBe("");
  });
});

describe("progress helpers", () => {
  const entry = (position: number, duration: number, updatedAt = 1): WatchProgress => ({
    position,
    duration,
    updatedAt,
  });

  it("computes a clamped ratio and rejects unusable entries", () => {
    expect(progressRatio(entry(30, 60))).toBe(0.5);
    expect(progressRatio(entry(0, 60))).toBeNull();
    expect(progressRatio(entry(10, 0))).toBeNull();
    expect(progressRatio(undefined)).toBeNull();
  });

  it("uses the spec's 2 %–95 % continue window", () => {
    expect(inContinueWindow(entry(1, 60))).toBe(false);
    expect(inContinueWindow(entry(30, 60))).toBe(true);
    expect(inContinueWindow(entry(59, 60))).toBe(false);
  });

  it("labels the season chip only when the store knows one", () => {
    expect(seasonLabel({ position: 1, duration: 2, updatedAt: 1, season: 3 })).toBe("S3");
    expect(seasonLabel({ position: 1, duration: 2, updatedAt: 1 })).toBeNull();
  });
});

describe("continueWatching", () => {
  const metas: MediaCatalogMeta[] = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" },
  ];

  it("returns watched titles most-recent first and skips the ones out of window", () => {
    const items = continueWatching(metas, {
      a: { position: 30, duration: 100, updatedAt: 100 },
      b: { position: 50, duration: 100, updatedAt: 500 },
      c: { position: 99, duration: 100, updatedAt: 900 },
    });
    expect(items.map((meta) => meta.id)).toEqual(["b", "a"]);
  });

  it("skips progress for titles that are not in a loaded catalog", () => {
    const items = continueWatching(metas, {
      zzz: { position: 30, duration: 100, updatedAt: 100 },
    });
    expect(items).toEqual([]);
  });

  // Phase 1: library.json stores type/name/poster, so a resumed title the board
  // did not load this session still gets a card.
  it("renders a stored title that is not in any loaded catalog", () => {
    const items = continueWatching(metas, {
      tt1160419: {
        position: 812,
        duration: 9330,
        updatedAt: 100,
        type: "movie",
        name: "Dune",
        poster: "https://images.metahub.space/poster/large/tt1160419/img",
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "tt1160419",
      name: "Dune",
      type: "movie",
      poster: "https://images.metahub.space/poster/large/tt1160419/img",
    });
  });

  it("prefers the catalog meta when the title is loaded", () => {
    const items = continueWatching(metas, {
      a: { position: 30, duration: 100, updatedAt: 100, name: "Stale name", poster: "stale.jpg" },
    });
    expect(items[0].name).toBe("Alpha");
  });
});

describe("formatTimeLeft", () => {
  it("reports the remaining runtime for the Resume label", () => {
    expect(formatTimeLeft(812, 9330)).toBe("2 h 22 min left");
    expect(formatTimeLeft(900, 1500)).toBe("10 min left");
    expect(formatTimeLeft(3600, 7200)).toBe("1 h left");
  });

  it("returns null for an unknown or finished duration", () => {
    expect(formatTimeLeft(10, 0)).toBeNull();
    expect(formatTimeLeft(1000, 1000)).toBeNull();
    expect(formatTimeLeft(1200, 1000)).toBeNull();
  });
});

describe("allMetas", () => {
  it("flattens rows and dedupes ids, preserving order", () => {
    const out = allMetas([
      { metas: [{ id: "a" }, { id: "b" }] },
      { metas: [{ id: "b" }, { id: "c" }] },
    ]);
    expect(out.map((meta) => meta.id)).toEqual(["a", "b", "c"]);
  });
});

describe("heroBackdrop", () => {
  it("upgrades Cinemeta's medium metahub art to the large variant", () => {
    expect(
      heroBackdrop({ id: "tt1", background: "https://images.metahub.space/background/medium/tt1/img" }),
    ).toBe("https://images.metahub.space/background/large/tt1/img");
  });

  it("leaves third-party art untouched and falls back to the poster", () => {
    expect(heroBackdrop({ id: "tt2", background: "https://cdn.example/bg.jpg" })).toBe(
      "https://cdn.example/bg.jpg",
    );
    expect(heroBackdrop({ id: "tt3", poster: "https://cdn.example/p.jpg" })).toBe(
      "https://cdn.example/p.jpg",
    );
    expect(heroBackdrop({ id: "tt4" })).toBeNull();
  });
});

describe("initialOf", () => {
  it("falls back to ? for a blank title", () => {
    expect(initialOf("Hibla 2")).toBe("H");
    expect(initialOf("   ")).toBe("?");
  });
});
