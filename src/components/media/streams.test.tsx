import { describe, expect, it } from "vitest";
import {
  filterStreams,
  parseBitrate,
  parseChannels,
  parseHdr,
  parseLanguageFlags,
  parseRuntime,
  parseSizeBytes,
  parseStreamFacts,
  parseSource,
  parseCodec,
  rankStreams,
  STREAM_FILTERS,
} from "./streams";
import type { MediaStream } from "./types";

/** A real Torrentio row (trimmed trackers), captured from the live addon. */
const torrentioStream: MediaStream = {
  name: "Torrentio\n4k DV | HDR10+",
  title:
    "Sinners 2025 2160p HDR10Plus DV BluRay 8CH x265 HEVC-PSA\n👤 132 💾 5.45 GB ⚙️ ThePirateBay\n🇬🇧 / 🇮🇹 / 🇪🇸",
  infoHash: "1175658c5b4656dcfb592f1d3b25806002faf713",
};

/** The reference addon's shape: facts spelled out on their own lines. */
const comeTorzStream: MediaStream = {
  url: "https://example.com/d/heartland",
  name: "ComeTorz\n4K",
  title:
    "Heartland (2026)\nWEB-DL ⚙ HEVC 🕐 1h:53m:58s\nAtmos | DD+ 🔊 5.1\n💾 18.3 GB 📶 21.4 Mbps\n⚡ Ready (RD) 🧩 ComeTorz",
};

describe("parseSizeBytes", () => {
  it("parses the addon's size hints and ignores noise", () => {
    expect(parseSizeBytes("58.2 GB")).toBeGreaterThan(50 * 1024 ** 3);
    expect(parseSizeBytes("700 MB")).toBeGreaterThan(0);
    expect(parseSizeBytes("no size here")).toBe(0);
    expect(parseSizeBytes(null)).toBe(0);
  });
});

describe("stream fact parsing", () => {
  it("recovers bitrate, runtime, audio, channels, HDR and group from a release", () => {
    expect(parseBitrate("📶 21.4 Mbps")).toBeCloseTo(21.4);
    expect(parseBitrate("nothing here")).toBeNull();

    expect(parseRuntime("1h:53m:58s")).toBe("1h:53m:58s");
    expect(parseRuntime("2h07m")).toBe("2h:07m");
    expect(parseRuntime("Heartland (2026)")).toBeNull();

    expect(parseChannels("DDP5.1 Atmos")).toBe("5.1");
    expect(parseChannels("TrueHD 7.1")).toBe("7.1");
    expect(parseChannels("8CH x265")).toBe("8CH");
    expect(parseChannels("no channels")).toBeNull();

    expect(parseSource("…2160p WEB-DL DDP5.1…")).toBe("WEB-DL");
    expect(parseSource("…UHD BluRay REMUX…")).toBe("REMUX");
    expect(parseSource("…WEBDL…")).toBe("WEB-DL");
    expect(parseSource("Untitled")).toBeNull();

    expect(parseCodec("x265 HEVC")).toBe("HEVC");
    expect(parseCodec("AV1")).toBe("AV1");
    expect(parseCodec("x264")).toBe("H.264");

    expect(parseHdr("2160p DV HDR10Plus")).toEqual(["DV", "HDR10+"]);
    expect(parseHdr("1080p HDR")).toEqual(["HDR"]);
    expect(parseHdr("1080p")).toEqual([]);
  });

  it("decodes the addon's flag emoji into language codes with names", () => {
    const flags = parseLanguageFlags("🇬🇧 / 🇷🇺 / 🇪🇸 / 🇬🇧");
    expect(flags.map((flag) => flag.code)).toEqual(["GB", "RU", "ES"]);
    expect(flags[0].label).toBe("English");
    expect(flags[1].label).toBe("Russian");
    expect(parseLanguageFlags("no flags")).toEqual([]);
  });

  it("parses a full Torrentio row", () => {
    const facts = parseStreamFacts(torrentioStream);
    expect(facts.release).toBe("Sinners 2025 2160p HDR10Plus DV BluRay 8CH x265 HEVC-PSA");
    expect(facts.source).toBe("BluRay");
    expect(facts.codec).toBe("HEVC");
    expect(facts.group).toBe("PSA");
    expect(facts.provider).toBe("ThePirateBay");
    expect(facts.peers).toBe(132);
    expect(facts.channels).toBe("8CH");
    expect(facts.hdr).toEqual(["DV", "HDR10+"]);
    // Torrentio does not supply a bitrate: it must stay absent, never invented.
    expect(facts.bitrateMbps).toBeNull();
    expect(facts.subLangs.map((flag) => flag.code)).toEqual(["GB", "IT", "ES"]);
  });

  it("parses a row whose facts are spelled out on their own lines", () => {
    const facts = parseStreamFacts(comeTorzStream);
    expect(facts.release).toBe("Heartland (2026)");
    expect(facts.source).toBe("WEB-DL");
    expect(facts.codec).toBe("HEVC");
    expect(facts.runtime).toBe("1h:53m:58s");
    expect(facts.audio).toEqual(["Atmos", "DD+"]);
    expect(facts.channels).toBe("5.1");
    expect(facts.bitrateMbps).toBeCloseTo(21.4);
    expect(facts.provider).toBe("ComeTorz");
  });
});

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
    expect(ranked.filter((item) => item.direct)).toHaveLength(2);
    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it("flags HDR releases and marks torrent rows", () => {
    const [ranked] = rankStreams([
      { name: "X", url: "https://example.com/s", title: "Movie 2160p Dolby Vision 58.2 GB" },
    ]);
    expect(ranked.qualityRank).toBe(6);
    expect(ranked.flags.map((flag) => flag.text)).toContain("HDR");
    expect(ranked.isTorrent).toBe(false);
    expect(rankStreams([torrentioStream])[0].isTorrent).toBe(true);
  });
});

describe("filterStreams", () => {
  const ranked = rankStreams([
    comeTorzStream,
    torrentioStream,
    {
      infoHash: "def",
      name: "Torrentio\n1080p",
      title: "Movie 1080p WEB-DL x264 1.4 GB\n⚙️ YTS",
    },
  ]);

  it("keeps the ranking order under every filter", () => {
    for (const filter of STREAM_FILTERS) {
      const result = filterStreams(ranked, filter.id);
      const expected = ranked.filter((entry) => result.includes(entry));
      expect(result).toEqual(expected);
    }
  });

  it("filters cached (direct), 4K, 1080p and torrent rows", () => {
    expect(filterStreams(ranked, "all")).toHaveLength(3);
    expect(filterStreams(ranked, "cached").map((entry) => entry.direct)).toEqual([true]);
    expect(filterStreams(ranked, "4k")).toHaveLength(2);
    expect(filterStreams(ranked, "1080p")).toHaveLength(1);
    expect(filterStreams(ranked, "torrent")).toHaveLength(2);
  });
});