/** Media mode types: Stremio addon protocol shapes used by the UI. */

export interface MediaManifestCatalog {
  type: string;
  id: string;
  name: string;
}

export interface MediaManifest {
  id: string;
  name: string;
  types: string[];
  catalogs: MediaManifestCatalog[];
  version?: string | null;
  description?: string | null;
}

export interface MediaCatalogMeta {
  id: string;
  name?: string | null;
  type?: string | null;
  poster?: string | null;
  background?: string | null;
  logo?: string | null;
  description?: string | null;
  releaseInfo?: string | null;
  imdbRating?: string | null;
  /** Cinemeta ships these in catalog responses too (spec §7). */
  genres?: string[] | null;
  cast?: string[] | null;
  director?: string[] | null;
  /** e.g. `173 min` — the board renders `2h53min`. */
  runtime?: string | null;
  /** ISO date; drives the card's `NEW` badge. */
  released?: string | null;
}

/** In-memory watch progress (WP2 stub store; WP5 persists it to library.json). */
export interface WatchProgress {
  position: number;
  duration: number;
  /** Epoch millis of the last update — Continue watching sorts on it. */
  updatedAt: number;
  season?: number;
  episode?: number;
}

export interface MediaCatalogResponse {
  metas: MediaCatalogMeta[];
}

export const CINEMETA_ADDON_URL = "https://v3-cinemeta.strem.io";
export const DEFAULT_STREAM_ADDON_URL = "https://torrentio.strem.fun";

export interface MediaStream {
  url?: string | null;
  title?: string | null;
  name?: string | null;
  quality?: string | null;
  size?: string | null;
  infoHash?: string | null;
  source?: string | null;
}

export interface StreamsResponse {
  streams: MediaStream[];
}

export interface RankedStream {
  stream: MediaStream;
  /** Stable sort key components, precomputed for the ranked sheet. */
  qualityRank: number;
  direct: boolean;
  sizeBytes: number;
  label: string;
  source: string;
  qualityBadge: string | null;
  flags: { text: string; tone: "good" | "warn" | "plain" }[];
  /** Parsed release facts rendered by the 7-line stream row (spec §4.3). */
  facts: StreamFacts;
  /** 1-based position after ranking — shown as `Rank 1 · 4K direct`. */
  rank: number;
  /** True when the row streams over the built-in torrent engine. */
  isTorrent: boolean;
}

/** Language flag tile data (`GB` → English) parsed from the addon's flag emoji. */
export interface StreamLanguageFlag {
  code: string;
  label: string;
}

/** Everything the 7-line stream row shows, parsed from the release name. */
export interface StreamFacts {
  /** First line of `title` — the release name. */
  release: string | null;
  /** `WEB-DL` / `BluRay` / `REMUX` / `WEBRip` … */
  source: string | null;
  /** `HEVC` / `H.264` / `AV1`. */
  codec: string | null;
  /** `1h:53m:58s`, only when the addon supplies it. */
  runtime: string | null;
  /** `Atmos`, `DD+`, `TrueHD` … strongest first. */
  audio: string[];
  /** `5.1` / `7.1` / `8CH`. */
  channels: string | null;
  audioLangs: StreamLanguageFlag[];
  subLangs: StreamLanguageFlag[];
  /** Parsed `21.4 Mbps`; null when the addon supplies none (never invented). */
  bitrateMbps: number | null;
  hdr: string[];
  /** Release group (`-PSA`), not the addon name. */
  group: string | null;
  /** The addon/provider named in the row (`⚙️ ThePirateBay`). */
  provider: string | null;
  /** `👤 132` — peers the addon already sees. */
  peers: number | null;
}

/** Streams-panel filter (docs/MEDIA_UI_SPEC.md §4.3). */
export type StreamFilter = "all" | "cached" | "4k" | "1080p" | "torrent";

/** Native (libmpv) player state pushed from the backend. */
export interface NativePlayerStatus {
  loaded: boolean;
  paused: boolean;
  eof: boolean;
  idle: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  title: string | null;
  videoFormat: string | null;
  /** mpv is stalled waiting for the network (a torrent stream does this a lot). */
  pausedForCache: boolean;
  /** mpv's cache fill, 0-100. */
  cachePercent: number;
  /** Seconds of media buffered ahead. */
  cacheSeconds: number;
  /** Bytes/second arriving from the source. */
  cacheSpeed: number;
  fileLoaded: boolean;
  error: string | null;
}

/** Whether the in-app player can run, and whether it can embed video. */
export interface NativePlayerDiagnostics {
  available: boolean;
  libraryPath: string | null;
  apiVersion: string | null;
  embeddingSupported: boolean;
  detail: string;
}

export const DEFAULT_MEDIA_CATALOGS: { type: string; id: string; name: string }[] = [
  { type: "movie", id: "top", name: "Trending movies" },
  { type: "series", id: "top", name: "Popular series" },
];
