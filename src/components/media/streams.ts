import type { MediaStream, RankedStream } from "./types";

/**
 * Stream ranking for the streams sheet: quality first, then direct/debrid
 * links over P2P-only torrents, then larger releases (usually better encode).
 * Pure and side-effect free so it is trivially testable.
 */
const QUALITY_ORDER: [string, number][] = [
  ["2160p", 6],
  ["4k", 6],
  ["1440p", 5],
  ["1080p", 4],
  ["720p", 3],
  ["480p", 2],
  ["360p", 1],
];

function qualityRankOf(stream: MediaStream): number {
  const haystack = `${stream.quality ?? ""} ${stream.title ?? ""}`.toLowerCase();
  let rank = 0;
  for (const [needle, value] of QUALITY_ORDER) {
    if (haystack.includes(needle)) {
      rank = Math.max(rank, value);
    }
  }
  return rank;
}

/** Parses "58.2 GB" / "9.4 GB" / "700 MB" size hints from addon titles. */
export function parseSizeBytes(text: string | null | undefined): number {
  if (!text) return 0;
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB)/i);
  if (!match) return 0;
  const value = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return 0;
  const unit = match[2].toUpperCase();
  const factor = unit === "TB" ? 1024 ** 4 : unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return Math.round(value * factor);
}

export function rankStreams(streams: MediaStream[]): RankedStream[] {
  const ranked = streams.map((stream): RankedStream => {
    const qualityRank = qualityRankOf(stream);
    const direct = Boolean(stream.url && !stream.infoHash);
    const sizeBytes = stream.size
      ? parseSizeBytes(stream.size)
      : parseSizeBytes(stream.title);
    const label = stream.name ?? stream.title ?? "Stream";
    const source = stream.source ?? (direct ? "direct" : "torrent");
    const flags: RankedStream["flags"] = [];
    if (direct) {
      flags.push({ text: "DIRECT", tone: "good" });
    } else {
      flags.push({ text: "P2P", tone: "warn" });
    }
    if (qualityRank >= 6) flags.push({ text: "4K", tone: "plain" });
    if (/hdr|dolby ?vision|dv/i.test(stream.title ?? "")) {
      flags.push({ text: "HDR", tone: "plain" });
    }
    return { stream, qualityRank, direct, sizeBytes, label, source, flags };
  });
  ranked.sort((left, right) => {
    if (right.qualityRank !== left.qualityRank) return right.qualityRank - left.qualityRank;
    if (right.direct !== left.direct) return right.direct ? 1 : -1;
    return right.sizeBytes - left.sizeBytes;
  });
  return ranked;
}

/** One-line display string for a stream row. */
export function streamRowLabel(ranked: RankedStream): string {
  const detail = ranked.stream.title ?? ranked.stream.url ?? ranked.stream.infoHash ?? "";
  return detail ? `${ranked.label} — ${detail}` : ranked.label;
}
