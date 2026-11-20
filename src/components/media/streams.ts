import type {
  MediaStream,
  RankedStream,
  StreamFacts,
  StreamFilter,
  StreamLanguageFlag,
} from "./types";

/**
 * Stream parsing, ranking and filtering (docs/MEDIA_UI_SPEC.md §4.3 / §7).
 *
 * Torrentio hands us one line of release information inside `title` plus a short
 * `name`. The fields the reference panel shows (`21.4 Mbps`, `Atmos · 5.1`,
 * subtitle flags, release group) are all recoverable from those two strings —
 * see `parseStreamFacts`. Everything here is pure and side-effect free so it is
 * trivially testable; the UI renders the parsed facts and nothing else.
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
  const haystack = `${stream.quality ?? ""} ${stream.title ?? ""} ${stream.name ?? ""}`.toLowerCase();
  let rank = 0;
  for (const [needle, value] of QUALITY_ORDER) {
    if (haystack.includes(needle)) {
      rank = Math.max(rank, value);
    }
  }
  return rank;
}

/** Derives a display label ("4K"/"1080p") from the release title. */
function qualityFromTitle(stream: MediaStream): string | null {
  const haystack = `${stream.name ?? ""} ${stream.title ?? ""}`.toLowerCase();
  for (const [needle, value] of QUALITY_ORDER) {
    if (haystack.includes(needle)) return value >= 6 ? "4K" : needle;
  }
  return null;
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

/** `📶 21.4 Mbps` → 21.4. Returns null when the addon does not supply one. */
export function parseBitrate(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = /(\d+(?:[.,]\d+)?)\s*Mbps/i.exec(text);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** `1h:53m:58s` / `1h53m` → `1h:53m:58s` / `1h:53m`. Null when absent. */
export function parseRuntime(text: string | null | undefined): string | null {
  if (!text) return null;
  const withSeconds = /(\d{1,3})\s*h[:\s]?(\d{1,2})\s*m[:\s]?(\d{1,2})\s*s/i.exec(text);
  if (withSeconds) {
    return `${withSeconds[1]}h:${withSeconds[2]}m:${withSeconds[3]}s`;
  }
  const minutes = /(\d{1,3})\s*h[:\s]?(\d{1,2})\s*m(?!\w)/i.exec(text);
  if (minutes) return `${minutes[1]}h:${minutes[2]}m`;
  return null;
}

const SOURCE_PATTERNS: [RegExp, string][] = [
  [/\bremux\b/i, "REMUX"],
  [/\bweb[-\s]?dl\b/i, "WEB-DL"],
  [/\bwebrip\b/i, "WEBRip"],
  [/\bblu[-\s]?ray\b/i, "BluRay"],
  [/\bbdremux\b/i, "BDRemux"],
  [/\bbdrip\b/i, "BDRip"],
  [/\bbrrip\b/i, "BRRip"],
  [/\bhdtv(rip)?\b/i, "HDTV"],
  [/\bdvdrip\b/i, "DVDRip"],
  [/\bhdrip\b/i, "HDRip"],
];

/** `WEB-DL` / `BluRay` / `REMUX` — the container source, normalised. */
export function parseSource(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [pattern, label] of SOURCE_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

const CODEC_PATTERNS: [RegExp, string][] = [
  [/hevc|x265|h\.?265/i, "HEVC"],
  [/\bav1\b/i, "AV1"],
  [/x264|h\.?264|\bavc\b/i, "H.264"],
  [/\bvc-?1\b/i, "VC-1"],
];

export function parseCodec(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [pattern, label] of CODEC_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/**
 * Audio formats in the order the reference lists them (lossless first, then the
 * lossy core). `DDP5.1` counts as DD+, `TrueHD` is kept apart from `Atmos`
 * because a remux carries both.
 */
const AUDIO_PATTERNS: [RegExp, string][] = [
  [/\batmos\b/i, "Atmos"],
  [/\btruehd\b/i, "TrueHD"],
  [/\bdts[-\s]?hd\b/i, "DTS-HD"],
  [/\bdts[-\s]?x\b/i, "DTS-X"],
  [/\bdts\b/i, "DTS"],
  // `DDP5.1` has no boundary between P and the channel digit.
  [/\bddp|\bdd\+|\be-?ac-?3\b/i, "DD+"],
  [/\bdd(?!p|\+|\d)\b|\bdd\d|\bac-?3\b/i, "AC3"],
  [/\baac\b/i, "AAC"],
  [/\bflac\b/i, "FLAC"],
  [/\bopus\b/i, "Opus"],
  [/\blpcm\b/i, "LPCM"],
];

export function parseAudioFormats(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const [pattern, label] of AUDIO_PATTERNS) {
    if (!pattern.test(text)) continue;
    // "Atmos" already implies the DD+ core on most encodes; keep both only when
    // the release spells DD+ out separately.
    if (label === "DD+" && /atmos/i.test(text) && !/\bddp|\bdd\+/i.test(text)) continue;
    if (!found.includes(label)) found.push(label);
  }
  return found;
}

/** `5.1` / `7.1` / `2.0` / `8CH`. */
export function parseChannels(text: string | null | undefined): string | null {
  if (!text) return null;
  // No word boundary before the digit: `DDP5.1` has none between P and 5.
  const surround = /(?:^|[^0-9])([257])\.([01])(?![0-9])/.exec(text);
  if (surround) return `${surround[1]}.${surround[2]}`;
  const channels = /\b(\d{1,2})\s*ch\b/i.exec(text);
  if (channels) return `${channels[1]}CH`;
  return null;
}

/** HDR flavours, strongest label first: `DV`, `HDR10+`, `HDR10`, `HDR`. */
export function parseHdr(text: string | null | undefined): string[] {
  if (!text) return [];
  const tags: string[] = [];
  if (/dolby[.\s]?vision|\bdv\b/i.test(text)) tags.push("DV");
  if (/hdr10\+|hdr10plus/i.test(text)) tags.push("HDR10+");
  if (/\bhdr10\b/i.test(text) && !/hdr10\+|hdr10plus/i.test(text)) tags.push("HDR10");
  if (/\bhdr\b/i.test(text) && tags.length === 0) tags.push("HDR");
  return tags;
}

/** Country/region flag emoji → the 2-letter code they encode. */
const REGIONAL_FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;

/** ISO country → language name, for the flag tooltip (UK/US both English). */
const COUNTRY_LANGUAGE: Record<string, string> = {
  GB: "English",
  US: "English",
  AU: "English",
  CA: "English",
  IE: "English",
  RU: "Russian",
  UA: "Ukrainian",
  ES: "Spanish",
  MX: "Spanish",
  AR: "Spanish",
  FR: "French",
  DE: "German",
  AT: "German",
  CH: "German",
  IT: "Italian",
  PT: "Portuguese",
  BR: "Portuguese",
  NL: "Dutch",
  BE: "Dutch",
  PL: "Polish",
  CZ: "Czech",
  SK: "Slovak",
  HU: "Hungarian",
  BG: "Bulgarian",
  RO: "Romanian",
  GR: "Greek",
  DK: "Danish",
  SE: "Swedish",
  NO: "Norwegian",
  FI: "Finnish",
  TR: "Turkish",
  SA: "Arabic",
  AE: "Arabic",
  IL: "Hebrew",
  TH: "Thai",
  CN: "Chinese",
  TW: "Chinese",
  HK: "Chinese",
  JP: "Japanese",
  KR: "Korean",
  IN: "Hindi",
  VN: "Vietnamese",
  ID: "Indonesian",
  MY: "Malay",
  PH: "Filipino",
  HR: "Croatian",
  RS: "Serbian",
  SI: "Slovenian",
  LT: "Lithuanian",
  LV: "Latvian",
  EE: "Estonian",
};

/**
 * Decodes the flag emoji Torrentio puts in `title` (🇬🇧 → `GB` → English).
 * Unknown regional codes are kept with their raw code as the label so nothing
 * silently disappears.
 */
export function parseLanguageFlags(text: string | null | undefined): StreamLanguageFlag[] {
  if (!text) return [];
  const matches = text.match(REGIONAL_FLAG) ?? [];
  const seen = new Set<string>();
  const flags: StreamLanguageFlag[] = [];
  for (const emoji of matches) {
    const code = String.fromCharCode(
      ...Array.from(emoji).map((point) => point.codePointAt(0)! - 0x1f1e6 + 65),
    );
    if (seen.has(code)) continue;
    seen.add(code);
    flags.push({ code, label: COUNTRY_LANGUAGE[code] ?? code });
  }
  return flags;
}

/** Trailing `-GROUP` of a release name (`…-PSA` → `PSA`). */
export function parseReleaseGroup(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /-([A-Za-z0-9]{2,20})\s*$/.exec(text.trim());
  if (!match) return null;
  // `…-H.265` / `…-10bit` are not groups.
  const candidate = match[1];
  if (/^\d|^h\.?26|^x26|^av1$/i.test(candidate)) return null;
  return candidate;
}

/**
 * Full fact set for one row. `title` is the multi-line Torrentio field:
 * release name, then `👤 peers 💾 size ⚙️ provider`, then optional flags.
 */
export function parseStreamFacts(stream: MediaStream): StreamFacts {
  const raw = (stream.title ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const release = raw[0] ?? stream.name ?? null;
  const metaText = raw.slice(1).join(" ");
  // Codec/source/group live in the release name; the rest can be spelled out on
  // any other line (the reference addon puts runtime/audio/bitrate there).
  const haystack = `${stream.name ?? ""} ${stream.title ?? ""}`;

  const peersMatch = /👤\s*(\d+)/.exec(metaText);
  // The provider is the token after the reference's puzzle glyph, or after a
  // gear *with* the emoji variation selector (`⚙` alone is the codec glyph in
  // `WEB-DL ⚙ HEVC`, not a provider marker).
  const providerMatch = /🧩\s*([^\s·|]+)/.exec(metaText) ?? /⚙️\s*([^\s·|]+)/.exec(metaText);

  const flags = parseLanguageFlags(metaText);
  // Torrentio's flag list mixes audio and subtitle languages. Only split it when
  // the release name says which is which — otherwise it is reported as subtitle
  // languages, which is how Stremio renders that same list. Never invented.
  const audioHint = /multi[-\s]?audio|dual[-\s]?audio|\bmvo\b|\bdub\b|\baudio\b/i.test(release ?? "");
  const subHint = /multi[-\s]?sub|\bsubs?\b|subtitles?/i.test(release ?? "");
  const audioLangs = audioHint ? flags : [];
  const subLangs = audioHint && !subHint ? [] : flags;

  return {
    release,
    source: parseSource(release) ?? parseSource(metaText),
    codec: parseCodec(release) ?? parseCodec(metaText),
    runtime: parseRuntime(haystack),
    audio: parseAudioFormats(haystack),
    channels: parseChannels(haystack),
    audioLangs,
    subLangs,
    bitrateMbps: parseBitrate(haystack),
    hdr: parseHdr(haystack),
    group: parseReleaseGroup(release),
    provider: providerMatch ? providerMatch[1].trim().replace(/^[·|]\s*/, "") : null,
    peers: peersMatch ? Number(peersMatch[1]) : null,
  };
}

export function rankStreams(streams: MediaStream[]): RankedStream[] {
  const ranked = streams.map((stream): RankedStream => {
    const qualityRank = qualityRankOf(stream);
    const direct = Boolean(stream.url && !stream.infoHash);
    const sizeBytes = stream.size
      ? parseSizeBytes(stream.size)
      : parseSizeBytes(stream.title);
    const label =
      stream.title?.split("\n")[0]?.trim() || stream.name?.split("\n")[0]?.trim() || "Stream";
    const source = stream.source ?? (direct ? "direct" : "torrent");
    const qualityBadge = stream.quality ?? qualityFromTitle(stream) ?? null;
    const flags: RankedStream["flags"] = [];
    if (direct) {
      flags.push({ text: "DIRECT", tone: "good" });
    } else {
      flags.push({ text: "P2P", tone: "warn" });
    }
    if (qualityRank >= 6) flags.push({ text: "4K", tone: "plain" });
    if (/hdr|dolby ?vision|dv\b/i.test(stream.title ?? "")) {
      flags.push({ text: "HDR", tone: "plain" });
    }
    return {
      stream,
      qualityRank,
      direct,
      sizeBytes,
      label,
      source,
      flags,
      qualityBadge,
      facts: parseStreamFacts(stream),
      rank: 0,
      isTorrent: Boolean(stream.infoHash),
    };
  });
  ranked.sort((left, right) => {
    if (right.qualityRank !== left.qualityRank) return right.qualityRank - left.qualityRank;
    if (right.direct !== left.direct) return right.direct ? 1 : -1;
    return right.sizeBytes - left.sizeBytes;
  });
  // 1-based rank, assigned after sorting: the panel shows it on line 1.
  ranked.forEach((entry, index) => {
    entry.rank = index + 1;
  });
  return ranked;
}

/** One-line display string for a stream row (kept for older call sites). */
export function streamRowLabel(ranked: RankedStream): string {
  const detail = ranked.stream.title ?? ranked.stream.url ?? ranked.stream.infoHash ?? "";
  return detail ? `${ranked.label} — ${detail}` : ranked.label;
}

/** The panel's filter control (spec §4.3). */
export const STREAM_FILTERS: { id: StreamFilter; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every source the addon returned" },
  {
    id: "cached",
    label: "Cached / Instant",
    hint: "Direct HTTP sources — playback starts immediately, no swarm wait",
  },
  { id: "4k", label: "4K", hint: "2160p and 4K releases" },
  { id: "1080p", label: "1080p", hint: "1080p releases" },
  { id: "torrent", label: "Torrents", hint: "Sources that stream over the built-in torrent engine" },
];

/**
 * Client-side filter over already-fetched streams — never a refetch, and it must
 * not reorder: the ranking from `rankStreams` is preserved.
 *
 * `cached` means "direct URL" (an HTTP source that plays instantly) because no
 * debrid cache check has been made for the row yet; the label says
 * `Cached / Instant` for that reason.
 */
export function filterStreams(streams: RankedStream[], filter: StreamFilter): RankedStream[] {
  switch (filter) {
    case "cached":
      return streams.filter((entry) => entry.direct);
    case "4k":
      return streams.filter((entry) => entry.qualityRank >= 6);
    case "1080p":
      return streams.filter((entry) => entry.qualityRank === 4);
    case "torrent":
      return streams.filter((entry) => entry.isTorrent);
    default:
      return streams;
  }
}