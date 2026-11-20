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
}

/** A stream ffmpeg has prepared for the `<video>` element. */
export interface PreparedStream {
  streamUrl: string;
  title: string;
  videoMode: string;
  videoCodec: string;
  audioNote: string;
}

/** Whether in-app playback can run on this machine. */
export interface NativePlayerDiagnostics {
  ffmpeg: string | null;
  ffprobe: string | null;
  serverPort: number;
  detail: string;
}

export const DEFAULT_MEDIA_CATALOGS: { type: string; id: string; name: string }[] = [
  { type: "movie", id: "top", name: "Trending movies" },
  { type: "series", id: "top", name: "Popular series" },
];
