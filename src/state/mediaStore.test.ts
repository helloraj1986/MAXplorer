// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 1: `mediaStore.watchProgress` is no longer an in-memory stub. These
 * tests pin the contract with `library.json`:
 *  - hydration aggregates episode keys onto the show id (latest episode wins);
 *  - a record writes through `media_library_record` and is optimistic locally;
 *  - the 2 %–95 % window is enforced on both sides (never create, do remove).
 */

const libraryGet = vi.fn();
const libraryRecord = vi.fn();
const libraryRemove = vi.fn();

vi.mock("../lib/api", () => ({
  isTauri: false,
  normalizeError: (error: unknown) => ({ message: String(error) }),
  api: {
    libraryGet: () => libraryGet(),
    libraryRecord: (patch: unknown) => libraryRecord(patch),
    libraryRemove: (metaId: string) => libraryRemove(metaId),
    getAddonManifest: vi.fn(),
    getMediaCatalog: vi.fn(),
    getMediaStreams: vi.fn(),
    playerDiagnostics: vi.fn(() => Promise.resolve(null)),
    debridGetConfig: vi.fn(() => Promise.resolve(null)),
    playerClose: vi.fn(() => Promise.resolve()),
    startTorrent: vi.fn(),
    torrentStatus: vi.fn(),
  },
}));

import { useMediaStore } from "./mediaStore";
import type { MediaCatalogMeta } from "../components/media/types";

const movie: MediaCatalogMeta = {
  id: "tt1160419",
  name: "Dune",
  type: "movie",
  poster: "https://images.metahub.space/poster/large/tt1160419/img",
};

beforeEach(() => {
  libraryGet.mockReset();
  libraryRecord.mockReset();
  libraryRemove.mockReset();
  libraryRecord.mockResolvedValue({ key: "tt1160419", entry: null });
  libraryRemove.mockResolvedValue(true);
  useMediaStore.setState({
    watchProgress: {},
    libraryReady: false,
    catalogs: [],
    selected: null,
    playerSource: null,
  });
});

describe("loadLibrary", () => {
  it("hydrates progress from library.json", async () => {
    libraryGet.mockResolvedValue({
      version: 1,
      entries: {
        tt1160419: {
          type: "movie",
          name: "Dune",
          poster: "https://images.metahub.space/poster/large/tt1160419/img",
          positionSec: 812.4,
          durationSec: 9330,
          updatedAt: "2026-11-21T13:40:00Z",
        },
      },
    });

    await useMediaStore.getState().loadLibrary();

    const progress = useMediaStore.getState().watchProgress;
    expect(progress.tt1160419.position).toBe(812.4);
    expect(progress.tt1160419.duration).toBe(9330);
    expect(progress.tt1160419.name).toBe("Dune");
    expect(progress.tt1160419.updatedAt).toBe(Date.parse("2026-11-21T13:40:00Z"));
    expect(useMediaStore.getState().libraryReady).toBe(true);
  });

  it("aggregates per-episode entries onto the show id, latest episode wins", async () => {
    libraryGet.mockResolvedValue({
      version: 1,
      entries: {
        "tt0903747:1:1": {
          type: "series",
          name: "Breaking Bad",
          positionSec: 900,
          durationSec: 3000,
          season: 1,
          episode: 1,
          updatedAt: "2026-11-20T10:00:00Z",
        },
        "tt0903747:1:2": {
          type: "series",
          name: "Breaking Bad",
          positionSec: 300,
          durationSec: 3000,
          season: 1,
          episode: 2,
          updatedAt: "2026-11-21T10:00:00Z",
        },
      },
    });

    await useMediaStore.getState().loadLibrary();

    const progress = useMediaStore.getState().watchProgress;
    expect(Object.keys(progress)).toEqual(["tt0903747"]);
    expect(progress.tt0903747).toMatchObject({ position: 300, season: 1, episode: 2 });
  });

  it("stays usable when the backend cannot be reached", async () => {
    libraryGet.mockRejectedValue(new Error("nope"));
    await useMediaStore.getState().loadLibrary();
    expect(useMediaStore.getState().libraryReady).toBe(true);
    expect(useMediaStore.getState().watchProgress).toEqual({});
  });
});

describe("recordProgress", () => {
  it("updates optimistically and writes through the library command", () => {
    useMediaStore.setState({ selected: movie });

    useMediaStore.getState().recordProgress("tt1160419", 812.4, 9330);

    expect(useMediaStore.getState().watchProgress.tt1160419.position).toBe(812.4);
    expect(libraryRecord).toHaveBeenCalledWith({
      metaId: "tt1160419",
      positionSec: 812.4,
      durationSec: 9330,
      type: "movie",
      name: "Dune",
      poster: "https://images.metahub.space/poster/large/tt1160419/img",
      season: null,
      episode: null,
    });
  });

  it("never creates an entry below 2 %", () => {
    useMediaStore.getState().recordProgress("tt1160419", 10, 1000);
    expect(useMediaStore.getState().watchProgress).toEqual({});
    expect(libraryRecord).not.toHaveBeenCalled();
  });

  it("removes a finished title past 95 %", () => {
    useMediaStore.setState({
      watchProgress: {
        tt1160419: { position: 500, duration: 1000, updatedAt: Date.now(), name: "Dune" },
      },
    });

    useMediaStore.getState().recordProgress("tt1160419", 960, 1000);

    expect(useMediaStore.getState().watchProgress).toEqual({});
    expect(libraryRemove).toHaveBeenCalledWith("tt1160419");
  });

  it("ignores a zero-length position", () => {
    useMediaStore.getState().recordProgress("tt1160419", 0, 9330);
    expect(libraryRecord).not.toHaveBeenCalled();
  });
});