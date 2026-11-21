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

/**
 * Watch progress for the board: hydrated from `library.json` on workspace open
 * (Phase 1) and written back through `media_library_record`. `type`/`name`/
 * `poster` are stored so a Continue-watching card renders even when the title is
 * not in a loaded catalog.
 */
export interface WatchProgress {
  position: number;
  duration: number;
  /** Epoch millis of the last update — Continue watching sorts on it. */
  updatedAt: number;
  season?: number;
  episode?: number;
  type?: string;
  name?: string;
  poster?: string;
}

/** One `library.json` entry, as the backend stores it. */
export interface LibraryEntry {
  type?: string | null;
  name?: string | null;
  poster?: string | null;
  positionSec: number;
  durationSec: number;
  season?: number | null;
  episode?: number | null;
  /** RFC-3339 UTC, e.g. `2026-11-21T13:40:00Z`. */
  updatedAt: string;
  audioId?: number | null;
  subsId?: number | string | null;
}

/** `media_library_get` */
export interface LibrarySnapshot {
  version: number;
  /** Keyed `tt<id>` for a movie, `tt<id>:<season>:<episode>` for an episode. */
  entries: Record<string, LibraryEntry>;
}

/** `media_library_record` payload. */
export interface LibraryRecordPatch {
  metaId: string;
  positionSec: number;
  durationSec: number;
  type?: string | null;
  name?: string | null;
  poster?: string | null;
  season?: number | null;
  episode?: number | null;
  audioId?: number | null;
  subsId?: number | string | null;
}

/** `media_library_record` result — `entry` is null outside the 2 %–95 % window. */
export interface LibraryRecordOutcome {
  key: string;
  entry: LibraryEntry | null;
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

/** One audio or subtitle track from mpv's `track-list` (Phase 2). */
export interface PlayerTrack {
  id: number;
  kind: "audio" | "sub";
  lang: string | null;
  title: string | null;
  codec: string | null;
  /** `5.1` / `stereo` for audio, null for subtitles. */
  channels: string | null;
  selected: boolean;
  default: boolean;
  forced: boolean;
  external: boolean;
}

/** `media_player_tracks` / `media_player_set_track` result. */
export interface TrackState {
  tracks: PlayerTrack[];
  audioId: number | null;
  subsId: number | null;
  secondarySubsId: number | null;
}

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
  /** mpv is stalled waiting for the network (a torrent stream can do this a lot). */
  pausedForCache: boolean;
  /** mpv's cache fill, 0-100. */
  cachePercent: number;
  /** Seconds of media buffered ahead. */
  cacheSeconds: number;
  /** Bytes/second arriving from the source. */
  cacheSpeed: number;
  fileLoaded: boolean;
  error: string | null;
  /** Audio + subtitle tracks (Phase 2). Empty until the file is loaded. */
  tracks?: PlayerTrack[];
  /** Selected audio track id; null = `aid=no`. */
  audioId?: number | null;
  /** Selected subtitle track id; null = subtitles off. */
  subsId?: number | null;
}

/**
 * Coalesced frame-rate metrics (`media-player://tick`, 4/s). Everything discrete
 * still arrives as a full {@link NativePlayerStatus}.
 */
export interface NativePlayerTick {
  position: number;
  duration: number;
  cachePercent: number;
  cacheSeconds: number;
  cacheSpeed: number;
  pausedForCache: boolean;
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
