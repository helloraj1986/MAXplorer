import type {
  ArchiveListing,
  FileEntry,
  FolderPreview,
  PreviewMetadata,
  PreviewPreferences,
  PreviewRendererId,
  PreviewThumbnail,
  TextRangePreview,
} from "../types";

/** Broad families used for renderer selection. */
export type PreviewCategory =
  | "folder"
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "text"
  | "code"
  | "archive"
  | "document"
  | "other";

export interface PreviewContext {
  entry: FileEntry;
  metadata: PreviewMetadata;
  preferences: PreviewPreferences;
  requestId: number;
  signal: AbortSignal;
}

export interface PreviewCapabilities {
  zoom: boolean;
  rotate: boolean;
  search: boolean;
  wrap: boolean;
  fullscreen: boolean;
  playback: boolean;
  extract: boolean;
  loadMore: boolean;
  quickLook: boolean;
}

export const NO_CAPABILITIES: PreviewCapabilities = {
  zoom: false,
  rotate: false,
  search: false,
  wrap: false,
  fullscreen: false,
  playback: false,
  extract: false,
  loadMore: false,
  quickLook: false,
};

export type PreviewPayload =
  | { kind: "image" }
  | { kind: "pdf" }
  | { kind: "media" }
  | {
      kind: "text";
      text: TextRangePreview;
      language: string;
    }
  | { kind: "archive"; archive: ArchiveListing }
  | { kind: "folder"; folder: FolderPreview }
  | { kind: "quicklook"; thumbnail: PreviewThumbnail }
  | { kind: "metadata" };

export interface PreviewRenderer {
  id: PreviewRendererId;
  label: string;
  capabilities: PreviewCapabilities;
  canHandle: (category: PreviewCategory, metadata: PreviewMetadata) => boolean;
  load: (context: PreviewContext) => Promise<PreviewPayload>;
}

export interface PreviewResult {
  rendererId: PreviewRendererId;
  category: PreviewCategory;
  metadata: PreviewMetadata;
  payload: PreviewPayload;
  error?: string | null;
}

export interface PreviewTypeInfo {
  category: PreviewCategory;
  rendererId: PreviewRendererId;
  language: string;
}

export interface PreviewEngineOptions {
  preferences: PreviewPreferences;
  /** Incremented by the caller so stale async results can be discarded. */
  requestId: number;
  signal: AbortSignal;
  onProgress?: (label: string) => void;
}

export interface PreviewEngineContract {
  detectFileType(metadata: PreviewMetadata): PreviewTypeInfo;
  resolveRenderer(category: PreviewCategory, metadata: PreviewMetadata): PreviewRendererId;
  load(entry: FileEntry): Promise<PreviewResult>;
  update(entry: FileEntry): Promise<PreviewResult>;
  cancel(): void;
  unload(): void;
  capabilities(rendererId: PreviewRendererId): PreviewCapabilities;
  metadata(entry: FileEntry): Promise<PreviewMetadata>;
  refresh(entry: FileEntry): Promise<PreviewResult>;
}
