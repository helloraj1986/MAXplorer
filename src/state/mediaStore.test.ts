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
const librarySetTracks = vi.fn();
const playerSetTrack = vi.fn();

vi.mock("../lib/api", () => ({
  isTauri: false,
  normalizeError: (error: unknown) => ({ message: String(error) }),
  api: {
    libraryGet: () => libraryGet(),
    libraryRecord: (patch: unknown) => libraryRecord(patch),
    libraryRemove: (metaId: string) => libraryRemove(metaId),
    librarySetTracks: (choice: unknown) => librarySetTracks(choice),
    playerSetTrack: (kind: string, id: number) => playerSetTrack(kind, id),
    playerOpen: vi.fn(() => Promise.resolve(null)),
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
  librarySetTracks.mockReset();
  playerSetTrack.mockReset();
  librarySetTracks.mockResolvedValue({});
  playerSetTrack.mockResolvedValue({
    tracks: [],
    audioId: 2,
    subsId: null,
    secondarySubsId: null,
  });
  libraryRecord.mockResolvedValue({ key: "tt1160419", entry: null });
  libraryRemove.mockResolvedValue(true);
  useMediaStore.setState({
    watchProgress: {},
    libraryReady: false,
    trackChoices: {},
    catalogs: [],
    selected: null,
    playerSource: null,
    playerStatus: null,
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

  it("hydrates the per-title track choice (Phase 2)", async () => {
    libraryGet.mockResolvedValue({
      version: 1,
      entries: {
        tt1: {
          positionSec: 500,
          durationSec: 1000,
          updatedAt: "2026-11-21T13:40:00Z",
          audioId: 2,
          subsId: "off",
        },
        tt2: {
          positionSec: 500,
          durationSec: 1000,
          updatedAt: "2026-11-21T13:40:00Z",
          subsId: 3,
        },
      },
    });

    await useMediaStore.getState().loadLibrary();

    const choices = useMediaStore.getState().trackChoices;
    expect(choices.tt1).toEqual({ audioId: 2, subsId: null });
    expect(choices.tt2).toEqual({ audioId: null, subsId: 3 });
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

describe("setTrack (Phase 2)", () => {
  it("selects through the command, refreshes the list and persists the choice", async () => {
    useMediaStore.setState({
      playerSource: { url: "https://example/stream.mkv", title: "Dune", metaId: "tt1160419" },
      playerStatus: {
        loaded: true,
        paused: false,
        eof: false,
        idle: false,
        position: 0,
        duration: 100,
        volume: 100,
        muted: false,
        title: null,
        videoFormat: "h264",
        pausedForCache: false,
        cachePercent: 0,
        cacheSeconds: 0,
        cacheSpeed: 0,
        fileLoaded: true,
        error: null,
        tracks: [],
        audioId: 1,
        subsId: null,
      },
    });

    await useMediaStore.getState().setTrack("audio", 2);

    expect(playerSetTrack).toHaveBeenCalledWith("audio", 2);
    expect(useMediaStore.getState().playerStatus?.audioId).toBe(2);
    expect(useMediaStore.getState().trackChoices.tt1160419).toEqual({
      audioId: 2,
      subsId: null,
    });
    expect(librarySetTracks).toHaveBeenCalledWith({
      metaId: "tt1160419",
      audioId: 2,
      subsId: null,
    });
  });

  it("sends id 0 for the Off row (mpv `sid=no`)", async () => {
    playerSetTrack.mockResolvedValue({
      tracks: [],
      audioId: 1,
      subsId: null,
      secondarySubsId: null,
    });
    useMediaStore.setState({
      playerSource: { url: "u", title: "t", metaId: "tt1" },
      playerStatus: null,
    });

    await useMediaStore.getState().setTrack("sub", null);

    expect(playerSetTrack).toHaveBeenCalledWith("sub", 0);
  });

  it("carries the stored choice into the player source", () => {
    useMediaStore.setState({
      selected: null,
      trackChoices: { tt9: { audioId: 2, subsId: 3 } },
    });
    useMediaStore.getState().openPlayer("https://example/x", "Title", "tt9", null, 120);
    expect(useMediaStore.getState().playerSource).toMatchObject({
      metaId: "tt9",
      startSeconds: 120,
      audioId: 2,
      subsId: 3,
    });
  });
});
