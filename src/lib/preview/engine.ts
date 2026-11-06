import { api, isTauri } from "../api";
import { extensionOf } from "../format";
import type {
  FileEntry,
  PreviewMetadata,
  PreviewPreferences,
  PreviewRendererId,
} from "../types";
import type {
  PreviewCapabilities,
  PreviewCategory,
  PreviewContext,
  PreviewEngineContract,
  PreviewEngineOptions,
  PreviewPayload,
  PreviewRenderer,
  PreviewResult,
  PreviewTypeInfo,
} from "./types";
import { NO_CAPABILITIES } from "./types";

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "tif", "tiff", "heic", "heif", "avif", "ico",
]);
const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "flv", "mpg", "mpeg", "3g2", "3gp", "m2ts",
]);
const AUDIO_EXTENSIONS = new Set([
  "mp3", "m4a", "aac", "wav", "flac", "ogg", "wma", "aiff", "mid", "midi",
]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "dmg", "iso"]);
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "mdx", "csv", "tsv", "log", "ini", "cfg", "conf", "yaml", "yml",
  "json", "jsonc", "xml", "plist", "html", "htm", "css", "scss", "less", "js", "jsx", "ts", "tsx",
  "mjs", "cjs", "rs", "py", "rb", "go", "java", "c", "h", "cpp", "hpp", "cc", "swift", "kt", "kts",
  "sh", "zsh", "bash", "fish", "toml", "lock", "gitignore", "env", "sql", "graphql", "vue", "svelte",
]);
const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "rs", "py", "rb", "go", "java", "c", "h", "cpp", "hpp",
  "cc", "swift", "kt", "kts", "sh", "zsh", "bash", "fish", "sql", "graphql", "vue", "svelte",
  "html", "htm", "css", "scss", "less", "json", "jsonc", "xml", "yaml", "yml", "toml", "plist",
]);
const DOCUMENT_EXTENSIONS = new Set([
  "doc", "docx", "rtf", "pages", "odt", "xls", "xlsx", "numbers", "ods", "ppt", "pptx", "key",
  "odp", "epub", "mobi", "azw", "azw3",
]);

export class PreviewUnavailableError extends Error {
  constructor(message = "No preview is available for this item.") {
    super(message);
    this.name = "PreviewUnavailableError";
  }
}

export function languageForExtension(extension: string | null): string {
  switch ((extension ?? "").toLowerCase()) {
    case "json":
    case "jsonc":
      return "json";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return "html";
    case "xml":
    case "plist":
      return "xml";
    case "yaml":
    case "yml":
      return "yaml";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "sh":
    case "zsh":
    case "bash":
    case "fish":
      return "shell";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "toml":
      return "toml";
    case "csv":
    case "tsv":
      return "csv";
    default:
      return "text";
  }
}

export function classifyPreview(metadata: PreviewMetadata): PreviewTypeInfo {
  if (metadata.isDir) {
    if (metadata.isPackage) {
      return { category: "other", rendererId: "quicklook", language: "text" };
    }
    return { category: "folder", rendererId: "folder", language: "text" };
  }
  const extension = (metadata.extension ?? "").toLowerCase();
  const tree = new Set(metadata.contentTypeTree.map((value) => value.toLowerCase()));
  const contentType = metadata.contentType.toLowerCase();
  const language = languageForExtension(extension);
  if (
    tree.has("public.image") ||
    contentType.startsWith("public.image") ||
    IMAGE_EXTENSIONS.has(extension)
  ) {
    return { category: "image", rendererId: "image", language };
  }
  if (contentType === "com.adobe.pdf" || extension === "pdf") {
    return { category: "pdf", rendererId: "pdf", language };
  }
  if (
    tree.has("public.movie") ||
    tree.has("public.video") ||
    contentType.startsWith("public.movie") ||
    VIDEO_EXTENSIONS.has(extension)
  ) {
    return { category: "video", rendererId: "media", language };
  }
  if (
    tree.has("public.audio") ||
    contentType.startsWith("public.audio") ||
    AUDIO_EXTENSIONS.has(extension)
  ) {
    return { category: "audio", rendererId: "media", language };
  }
  if (
    tree.has("public.archive") ||
    tree.has("public.zip-archive") ||
    ARCHIVE_EXTENSIONS.has(extension)
  ) {
    return { category: "archive", rendererId: "archive", language };
  }
  if (TEXT_EXTENSIONS.has(extension) || tree.has("public.text") || tree.has("public.source-code")) {
    return {
      category: CODE_EXTENSIONS.has(extension) ? "code" : "text",
      rendererId: "text",
      language,
    };
  }
  if (DOCUMENT_EXTENSIONS.has(extension) || tree.has("public.composite-content")) {
    return { category: "document", rendererId: "quicklook", language };
  }
  return { category: "other", rendererId: "quicklook", language };
}

export const PREVIEW_CAPABILITIES: Record<PreviewRendererId, PreviewCapabilities> = {
  image: {
    ...NO_CAPABILITIES,
    zoom: true,
    rotate: true,
    fullscreen: true,
    quickLook: true,
  },
  pdf: {
    ...NO_CAPABILITIES,
    zoom: true,
    search: true,
    fullscreen: true,
    quickLook: true,
  },
  media: {
    ...NO_CAPABILITIES,
    zoom: false,
    fullscreen: true,
    playback: true,
    quickLook: true,
  },
  text: {
    ...NO_CAPABILITIES,
    search: true,
    wrap: true,
    fullscreen: true,
    loadMore: true,
  },
  archive: {
    ...NO_CAPABILITIES,
    extract: true,
    quickLook: true,
  },
  folder: {
    ...NO_CAPABILITIES,
  },
  quicklook: {
    ...NO_CAPABILITIES,
    fullscreen: true,
    quickLook: true,
  },
  metadata: {
    ...NO_CAPABILITIES,
    quickLook: true,
  },
};

function fallbackMetadata(entry: FileEntry): PreviewMetadata {
  const extension = extensionOf(entry.name) || null;
  return {
    path: entry.path,
    name: entry.name,
    extension,
    contentType: entry.isDir ? "public.folder" : "public.data",
    contentTypeTree: entry.isDir ? ["public.folder"] : ["public.data"],
    kind: entry.isDir ? "Folder" : extension ? `${extension.toUpperCase()} File` : "File",
    size: entry.size,
    isDir: entry.isDir,
    isSymlink: entry.isSymlink,
    isReadable: true,
    isPackage: false,
    isICloudPlaceholder: false,
    isNetworkVolume: false,
    modified: entry.modified,
    created: entry.created,
    duration: null,
    width: null,
    height: null,
    codecs: [],
    pageCount: null,
    tags: [],
    quickLookSupported: !entry.isDir,
  };
}

function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function loadText(context: PreviewContext): Promise<PreviewPayload> {
  const result = await api.previewReadText(
    context.entry.path,
    0,
    context.preferences.textLimit,
  );
  if (aborted(context.signal)) throw new DOMException("Aborted", "AbortError");
  return {
    kind: "text",
    text: result,
    language: result.decodedPlist ? "xml" : languageForExtension(context.metadata.extension),
  };
}

async function loadArchive(context: PreviewContext): Promise<PreviewPayload> {
  const archive = await api.previewArchive(context.entry.path);
  if (aborted(context.signal)) throw new DOMException("Aborted", "AbortError");
  return { kind: "archive", archive };
}

async function loadFolder(context: PreviewContext): Promise<PreviewPayload> {
  const folder = await api.previewFolderSummary(context.entry.path, context.requestId, 12);
  if (aborted(context.signal)) throw new DOMException("Aborted", "AbortError");
  return { kind: "folder", folder };
}

async function loadQuickLook(context: PreviewContext): Promise<PreviewPayload> {
  const thumbnail = await api.previewThumbnail(context.entry.path, 1600);
  if (aborted(context.signal)) throw new DOMException("Aborted", "AbortError");
  if (!thumbnail.dataUrl) throw new PreviewUnavailableError();
  return { kind: "quicklook", thumbnail };
}

function renderer(
  id: PreviewRendererId,
  label: string,
  canHandle: (category: PreviewCategory, metadata: PreviewMetadata) => boolean,
  load: (context: PreviewContext) => Promise<PreviewPayload>,
): PreviewRenderer {
  return {
    id,
    label,
    capabilities: PREVIEW_CAPABILITIES[id],
    canHandle,
    load,
  };
}

const RENDERERS: Record<PreviewRendererId, PreviewRenderer> = {
  image: renderer("image", "Image", (category) => category === "image", async () => ({ kind: "image" })),
  pdf: renderer("pdf", "PDF", (category) => category === "pdf", async () => ({ kind: "pdf" })),
  media: renderer(
    "media",
    "Media",
    (category) => category === "video" || category === "audio",
    async () => ({ kind: "media" }),
  ),
  text: renderer(
    "text",
    "Text",
    (category) => category === "text" || category === "code",
    loadText,
  ),
  archive: renderer("archive", "Archive", (category) => category === "archive", loadArchive),
  folder: renderer("folder", "Folder", (category) => category === "folder", loadFolder),
  quicklook: renderer(
    "quicklook",
    "Quick Look",
    (_category, metadata) => metadata.quickLookSupported,
    loadQuickLook,
  ),
  metadata: renderer("metadata", "File information", () => true, async () => ({ kind: "metadata" })),
};

function fallbackChain(
  preferred: PreviewRendererId,
  enabled: PreviewRendererId[],
  metadata: PreviewMetadata,
): PreviewRendererId[] {
  const ordered = [preferred, "quicklook", "metadata"] as PreviewRendererId[];
  const chain: PreviewRendererId[] = [];
  for (const id of ordered) {
    if (chain.includes(id)) continue;
    if (id === "metadata") {
      chain.push(id);
      continue;
    }
    if (!enabled.includes(id)) continue;
    if (!RENDERERS[id].canHandle(classifyPreview(metadata).category, metadata)) continue;
    chain.push(id);
  }
  return chain;
}

export class PreviewEngine implements PreviewEngineContract {
  private controller: AbortController;
  private requestId: number;
  private preferences: PreviewPreferences;
  private onProgress?: (label: string) => void;

  constructor(options: PreviewEngineOptions) {
    this.controller = new AbortController();
    options.signal.addEventListener("abort", () => this.controller.abort(), { once: true });
    this.requestId = options.requestId;
    this.preferences = options.preferences;
    this.onProgress = options.onProgress;
  }

  detectFileType(metadata: PreviewMetadata): PreviewTypeInfo {
    return classifyPreview(metadata);
  }

  resolveRenderer(category: PreviewCategory, metadata: PreviewMetadata): PreviewRendererId {
    const preferred: PreviewRendererId =
      category === "image"
        ? "image"
        : category === "pdf"
          ? "pdf"
          : category === "video" || category === "audio"
            ? "media"
            : category === "text" || category === "code"
              ? "text"
              : category === "archive"
                ? "archive"
                : category === "folder"
                  ? "folder"
                  : "quicklook";
    const chain = fallbackChain(preferred, this.preferences.renderers, metadata);
    return chain[0] ?? "metadata";
  }

  capabilities(rendererId: PreviewRendererId): PreviewCapabilities {
    return PREVIEW_CAPABILITIES[rendererId];
  }

  async metadata(entry: FileEntry): Promise<PreviewMetadata> {
    if (!isTauri) return fallbackMetadata(entry);
    try {
      return await api.previewMetadata(entry.path);
    } catch {
      return fallbackMetadata(entry);
    }
  }

  async load(entry: FileEntry): Promise<PreviewResult> {
    this.onProgress?.("Reading file information");
    const metadata = await this.metadata(entry);
    if (aborted(this.controller.signal)) throw new DOMException("Aborted", "AbortError");
    const info = this.detectFileType(metadata);
    const chain = fallbackChain(info.rendererId, this.preferences.renderers, metadata);
    let lastError: unknown = null;
    for (let index = 0; index < chain.length; index += 1) {
      const id = chain[index];
      const selected = RENDERERS[id];
      try {
        if (id !== "metadata") this.onProgress?.(`Preparing ${selected.label.toLowerCase()} preview`);
        const payload = await selected.load({
          entry,
          metadata,
          preferences: this.preferences,
          requestId: this.requestId,
          signal: this.controller.signal,
        });
        if (aborted(this.controller.signal)) throw new DOMException("Aborted", "AbortError");
        return {
          rendererId: id,
          category: info.category,
          metadata,
          payload,
          error: null,
        };
      } catch (error) {
        if (aborted(this.controller.signal)) throw new DOMException("Aborted", "AbortError");
        lastError = error;
      }
    }
    return {
      rendererId: "metadata",
      category: info.category,
      metadata,
      payload: { kind: "metadata" },
      error: lastError instanceof Error ? lastError.message : null,
    };
  }

  async update(entry: FileEntry): Promise<PreviewResult> {
    return this.load(entry);
  }

  async refresh(entry: FileEntry): Promise<PreviewResult> {
    return this.load(entry);
  }

  cancel(): void {
    this.controller.abort();
    void api.cancelPreviewTask(this.requestId).catch(() => undefined);
  }

  unload(): void {
    this.cancel();
  }
}
