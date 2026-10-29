import type { FileCategory } from "../format";
import type { FileEntry } from "../types";

/**
 * A typed, presentation-only file type registry.
 *
 * File names are never executed or opened to classify them. Resolution uses the
 * metadata the listing already carries (directory flag, extension) plus the
 * name for compound extensions and well-known dotfiles. Unknown and ambiguous
 * inputs always resolve to a deterministic neutral visual.
 */
export type FileVisualKind =
  | "folder"
  | "app"
  | "pdf"
  | "word"
  | "rtf"
  | "slides"
  | "text"
  | "csv"
  | "sheet"
  | "markdown"
  | "ebook"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "diskImage"
  | "virtualDisk"
  | "javascript"
  | "typescript"
  | "html"
  | "css"
  | "json"
  | "yaml"
  | "xml"
  | "python"
  | "java"
  | "rust"
  | "go"
  | "c"
  | "cpp"
  | "shell"
  | "sql"
  | "ruby"
  | "php"
  | "swift"
  | "kotlin"
  | "csharp"
  | "objectivec"
  | "perl"
  | "lua"
  | "r"
  | "dart"
  | "scala"
  | "vue"
  | "svelte"
  | "graphql"
  | "executable"
  | "font"
  | "certificate"
  | "database"
  | "config"
  | "unknown";

/** Glyph names are intentionally local to the registry; the component maps
 * them to Lucide components. This keeps classification independent of a
 * particular icon vendor. */
export type FileGlyph =
  | "file"
  | "folder"
  | "fileText"
  | "fileSpreadsheet"
  | "presentation"
  | "fileCode"
  | "fileJson"
  | "fileArchive"
  | "fileImage"
  | "fileVideo"
  | "fileAudio"
  | "fileKey"
  | "fileCog"
  | "database"
  | "font"
  | "exe"
  | "app"
  | "disk"
  | "text"
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "sheet"
  | "slides"
  | "doc"
  | "unknown";

export interface FileTypeDefinition {
  kind: FileVisualKind;
  category: FileCategory;
  label: string;
  glyph: FileGlyph;
  /** Suffix for `--file-accent-*` in tokens.css. */
  accent: string;
  /** Optional fixed badge. When omitted the extension is used. */
  badge?: string;
  /** Whether a raster/asset thumbnail may replace the artwork. */
  thumbnail?: boolean;
}

export interface FileVisual extends FileTypeDefinition {
  /** Uppercase badge text, or an empty string for no badge. */
  badgeText: string;
  /** The extension or special name that matched, for diagnostics and tests. */
  matchedExtension: string | null;
}

const DEFINITIONS: Record<FileVisualKind, FileTypeDefinition> = {
  folder: { kind: "folder", category: "folder", label: "File folder", glyph: "folder", accent: "unknown" },
  app: { kind: "app", category: "executable", label: "Application", glyph: "app", accent: "app", badge: "APP" },
  pdf: { kind: "pdf", category: "pdf", label: "PDF Document", glyph: "pdf", accent: "pdf", badge: "PDF" },
  word: { kind: "word", category: "document", label: "Word Document", glyph: "doc", accent: "word" },
  rtf: { kind: "rtf", category: "document", label: "Rich Text Document", glyph: "text", accent: "text", badge: "RTF" },
  slides: { kind: "slides", category: "slides", label: "Presentation", glyph: "slides", accent: "slides" },
  text: { kind: "text", category: "text", label: "Text Document", glyph: "text", accent: "text" },
  csv: { kind: "csv", category: "sheet", label: "CSV File", glyph: "fileSpreadsheet", accent: "csv", badge: "CSV" },
  sheet: { kind: "sheet", category: "sheet", label: "Spreadsheet", glyph: "sheet", accent: "sheet" },
  markdown: { kind: "markdown", category: "text", label: "Markdown Document", glyph: "text", accent: "markdown", badge: "MD" },
  ebook: { kind: "ebook", category: "document", label: "EPUB eBook", glyph: "fileText", accent: "ebook", badge: "EPUB" },
  image: { kind: "image", category: "image", label: "Image", glyph: "image", accent: "image", thumbnail: true },
  video: { kind: "video", category: "video", label: "Video", glyph: "video", accent: "video" },
  audio: { kind: "audio", category: "audio", label: "Audio", glyph: "audio", accent: "audio" },
  archive: { kind: "archive", category: "archive", label: "Compressed Archive", glyph: "archive", accent: "archive" },
  diskImage: { kind: "diskImage", category: "archive", label: "Disk Image", glyph: "disk", accent: "disk", badge: "DMG" },
  virtualDisk: { kind: "virtualDisk", category: "archive", label: "Virtual Disk", glyph: "disk", accent: "disk" },
  javascript: { kind: "javascript", category: "code", label: "JavaScript File", glyph: "fileCode", accent: "js" },
  typescript: { kind: "typescript", category: "code", label: "TypeScript File", glyph: "fileCode", accent: "ts" },
  html: { kind: "html", category: "code", label: "HTML Document", glyph: "fileCode", accent: "html" },
  css: { kind: "css", category: "code", label: "Stylesheet", glyph: "fileCode", accent: "css" },
  json: { kind: "json", category: "code", label: "JSON File", glyph: "fileJson", accent: "json" },
  yaml: { kind: "yaml", category: "code", label: "YAML File", glyph: "fileCode", accent: "yaml" },
  xml: { kind: "xml", category: "code", label: "XML Document", glyph: "fileCode", accent: "xml" },
  python: { kind: "python", category: "code", label: "Python Source File", glyph: "fileCode", accent: "python" },
  java: { kind: "java", category: "code", label: "Java Source File", glyph: "fileCode", accent: "java" },
  rust: { kind: "rust", category: "code", label: "Rust Source File", glyph: "fileCode", accent: "rust" },
  go: { kind: "go", category: "code", label: "Go Source File", glyph: "fileCode", accent: "go" },
  c: { kind: "c", category: "code", label: "C Source File", glyph: "fileCode", accent: "c" },
  cpp: { kind: "cpp", category: "code", label: "C++ Source File", glyph: "fileCode", accent: "cpp" },
  shell: { kind: "shell", category: "code", label: "Shell Script", glyph: "code", accent: "shell" },
  sql: { kind: "sql", category: "code", label: "SQL File", glyph: "database", accent: "sql" },
  ruby: { kind: "ruby", category: "code", label: "Ruby Source File", glyph: "fileCode", accent: "java" },
  php: { kind: "php", category: "code", label: "PHP Source File", glyph: "fileCode", accent: "python" },
  swift: { kind: "swift", category: "code", label: "Swift Source File", glyph: "fileCode", accent: "slides" },
  kotlin: { kind: "kotlin", category: "code", label: "Kotlin Source File", glyph: "fileCode", accent: "yaml" },
  csharp: { kind: "csharp", category: "code", label: "C# Source File", glyph: "fileCode", accent: "yaml" },
  objectivec: { kind: "objectivec", category: "code", label: "Objective-C Source File", glyph: "fileCode", accent: "cpp" },
  perl: { kind: "perl", category: "code", label: "Perl Script", glyph: "fileCode", accent: "go" },
  lua: { kind: "lua", category: "code", label: "Lua Script", glyph: "fileCode", accent: "java" },
  r: { kind: "r", category: "code", label: "R Script", glyph: "fileCode", accent: "ts" },
  dart: { kind: "dart", category: "code", label: "Dart Source File", glyph: "fileCode", accent: "go" },
  scala: { kind: "scala", category: "code", label: "Scala Source File", glyph: "fileCode", accent: "rust" },
  vue: { kind: "vue", category: "code", label: "Vue Component", glyph: "fileCode", accent: "sheet" },
  svelte: { kind: "svelte", category: "code", label: "Svelte Component", glyph: "fileCode", accent: "html" },
  graphql: { kind: "graphql", category: "code", label: "GraphQL File", glyph: "fileCode", accent: "audio" },
  executable: { kind: "executable", category: "executable", label: "Executable", glyph: "exe", accent: "exe" },
  font: { kind: "font", category: "font", label: "Font File", glyph: "font", accent: "font" },
  certificate: { kind: "certificate", category: "file", label: "Certificate", glyph: "fileKey", accent: "cert" },
  database: { kind: "database", category: "file", label: "Database File", glyph: "database", accent: "db", badge: "DB" },
  config: { kind: "config", category: "text", label: "Configuration File", glyph: "fileCog", accent: "config" },
  unknown: { kind: "unknown", category: "file", label: "File", glyph: "unknown", accent: "unknown" },
};

const EXTENSION_GROUPS: Record<FileVisualKind, readonly string[]> = {
  folder: [],
  app: ["app"],
  pdf: ["pdf"],
  word: ["doc", "docx", "docm", "dot", "dotx", "odt", "pages"],
  rtf: ["rtf"],
  text: ["txt", "log", "text", "nfo", "asc", "license"],
  slides: ["ppt", "pptx", "pptm", "odp", "key"],
  sheet: ["xls", "xlsx", "xlsm", "xlsb", "ods", "numbers"],
  csv: ["csv", "tsv"],
  markdown: ["md", "markdown", "mdx", "mdown", "mkd"],
  ebook: ["epub", "mobi", "azw", "azw3", "fb2"],
  image: [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "svg",
    "webp",
    "heic",
    "heif",
    "tif",
    "tiff",
    "bmp",
    "ico",
    "avif",
    "raw",
    "cr2",
    "cr3",
    "nef",
    "arw",
    "dng",
    "orf",
    "rw2",
    "raf",
    "pef",
    "srw",
    "psd",
    "ai",
  ],
  video: ["mp4", "mov", "m4v", "mkv", "avi", "webm", "wmv", "flv", "mpg", "mpeg", "3gp", "ogv", "mts", "m2ts"],
  audio: ["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma", "aiff", "aif", "mid", "midi", "alac"],
  archive: [
    "zip",
    "rar",
    "7z",
    "tar",
    "gz",
    "gzip",
    "bz2",
    "xz",
    "tgz",
    "tbz2",
    "txz",
    "zst",
    "lz",
    "lzma",
    "cab",
    "jar",
    "war",
  ],
  diskImage: ["dmg"],
  virtualDisk: ["iso", "img", "vmdk", "qcow2", "vdi", "sparseimage"],
  javascript: ["js", "mjs", "cjs", "jsx"],
  typescript: ["ts", "mts", "cts", "tsx"],
  html: ["html", "htm", "xhtml", "shtml"],
  css: ["css", "scss", "sass", "less", "styl"],
  json: ["json", "jsonc", "json5", "geojson", "webmanifest"],
  yaml: ["yaml", "yml"],
  xml: ["xml", "xsd", "xsl", "xslt", "plist"],
  python: ["py", "pyw", "pyi", "ipynb"],
  java: ["java", "class"],
  rust: ["rs"],
  go: ["go"],
  c: ["c", "h"],
  cpp: ["cpp", "cc", "cxx", "hpp", "hxx", "hh"],
  shell: ["sh", "zsh", "bash", "fish", "ksh", "ps1", "bat", "cmd"],
  sql: ["sql", "psql", "mysql"],
  ruby: ["rb", "rake", "gemspec"],
  php: ["php", "phtml", "php3", "php4", "php5"],
  swift: ["swift"],
  kotlin: ["kt", "kts"],
  csharp: ["cs", "csx"],
  objectivec: ["m", "mm"],
  perl: ["pl", "pm", "t"],
  lua: ["lua"],
  r: ["r", "rmd"],
  dart: ["dart"],
  scala: ["scala", "sc"],
  vue: ["vue"],
  svelte: ["svelte"],
  graphql: ["graphql", "gql"],
  executable: ["exe", "msi", "com", "bin", "run", "appimage", "deb", "rpm", "pkg"],
  font: ["ttf", "otf", "woff", "woff2", "eot", "ttc"],
  certificate: ["pem", "crt", "cer", "der", "p12", "pfx", "key", "pub", "asc", "gpg", "pgp"],
  database: ["db", "sqlite", "sqlite3", "mdb", "accdb", "dbf"],
  config: ["ini", "cfg", "conf", "toml", "env", "properties", "editorconfig", "gitconfig", "lock"],
  unknown: [],
};

const COMPOUND_EXTENSIONS = [
  "tar.gz",
  "tar.bz2",
  "tar.xz",
  "tar.zst",
  "d.ts",
  "min.js",
  "min.css",
  "spec.js",
  "spec.ts",
  "spec.tsx",
  "test.js",
  "test.ts",
  "test.tsx",
  "blade.php",
] as const;

const SPECIAL_NAMES: Record<string, FileVisualKind> = {
  ".gitignore": "config",
  ".gitattributes": "config",
  ".gitmodules": "config",
  ".npmrc": "config",
  ".nvmrc": "config",
  ".yarnrc": "config",
  ".editorconfig": "config",
  ".env": "config",
  ".env.local": "config",
  ".bashrc": "shell",
  ".zshrc": "shell",
  ".zprofile": "shell",
  ".profile": "shell",
  ".vimrc": "config",
  ".dockerignore": "config",
  ".ds_store": "unknown",
  dockerfile: "config",
  makefile: "config",
  "cmakelists.txt": "config",
  "package.json": "json",
  "package-lock.json": "json",
  "tsconfig.json": "json",
  "jsconfig.json": "json",
  "cargo.toml": "config",
  "cargo.lock": "config",
  readme: "text",
  license: "text",
  notice: "text",
  authors: "text",
  changelog: "text",
  procfile: "config",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  vagrantfile: "ruby",
  brewfile: "ruby",
  justfile: "config",
};

const MIME_INDEX: Record<string, FileVisualKind> = {
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.oasis.opendocument.text": "word",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "text/plain": "text",
  "text/csv": "csv",
  "text/tab-separated-values": "csv",
  "text/markdown": "markdown",
  "application/epub+zip": "ebook",
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/svg+xml": "image",
  "image/webp": "image",
  "image/heic": "image",
  "image/tiff": "image",
  "image/bmp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/x-matroska": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/flac": "audio",
  "audio/aac": "audio",
  "audio/mp4": "audio",
  "application/zip": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-rar-compressed": "archive",
  "application/x-apple-diskimage": "diskImage",
  "application/x-iso9660-image": "virtualDisk",
  "application/json": "json",
  "application/xml": "xml",
  "text/xml": "xml",
  "text/html": "html",
  "text/css": "css",
  "application/javascript": "javascript",
  "text/javascript": "javascript",
  "application/typescript": "typescript",
  "text/typescript": "typescript",
  "application/x-yaml": "yaml",
  "text/yaml": "yaml",
  "application/sql": "sql",
  "application/x-httpd-php": "php",
  "font/ttf": "font",
  "font/otf": "font",
  "font/woff": "font",
  "font/woff2": "font",
};

const EXTENSION_INDEX = new Map<string, FileVisualKind>();
for (const [kind, extensions] of Object.entries(EXTENSION_GROUPS) as Array<
  [FileVisualKind, readonly string[]]
>) {
  for (const extension of extensions) {
    if (!EXTENSION_INDEX.has(extension)) EXTENSION_INDEX.set(extension, kind);
  }
}

export function extensionOfName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const clean = base.replace(/\.+$/, "");
  const index = clean.lastIndexOf(".");
  if (index <= 0) return "";
  return clean.slice(index + 1).toLowerCase();
}

export function compoundExtensionOf(name: string): string | null {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  for (const compound of COMPOUND_EXTENSIONS) {
    if (base.endsWith(`.${compound}`)) return compound;
  }
  return null;
}

function normalizeMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

const COMPOUND_BADGES: Record<string, string> = {
  "tar.gz": "TGZ",
  "tar.bz2": "TBZ",
  "tar.xz": "TXZ",
  "tar.zst": "TZS",
  "d.ts": "TS",
  "min.js": "JS",
  "min.css": "CSS",
  "blade.php": "PHP",
};

const SPECIAL_BADGES: Record<string, string> = {
  ".gitignore": "GIT",
  ".gitattributes": "GIT",
  ".gitmodules": "GIT",
  ".npmrc": "NPM",
  ".nvmrc": "NODE",
  ".yarnrc": "YARN",
  ".editorconfig": "ED",
  ".env": "ENV",
  ".env.local": "ENV",
  ".bashrc": "SH",
  ".zshrc": "SH",
  ".zprofile": "SH",
  ".profile": "SH",
  ".vimrc": "VIM",
  ".dockerignore": "DOCK",
  ".ds_store": "SYS",
  dockerfile: "DOCK",
  makefile: "MAKE",
  "cmakelists.txt": "CMAKE",
  readme: "TXT",
  license: "TXT",
  notice: "TXT",
  authors: "TXT",
  changelog: "TXT",
  procfile: "PROC",
  gemfile: "RB",
  rakefile: "RB",
  podfile: "RB",
  vagrantfile: "RB",
  brewfile: "RB",
  justfile: "JUST",
};

function badgeFor(definition: FileTypeDefinition, matchedExtension: string | null): string {
  if (definition.badge) return definition.badge;
  if (!matchedExtension) return "";
  const key = matchedExtension.toLowerCase();
  return (
    COMPOUND_BADGES[key] ??
    SPECIAL_BADGES[key] ??
    key.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase()
  );
}

function visualFor(kind: FileVisualKind, matchedExtension: string | null): FileVisual {
  const definition = DEFINITIONS[kind];
  return {
    ...definition,
    badgeText: badgeFor(definition, matchedExtension),
    matchedExtension,
  };
}

export interface FileVisualInput {
  name: string;
  extension?: string | null;
  mimeType?: string | null;
  isDir?: boolean;
  isSymlink?: boolean;
}

/**
 * Resolves a visual for a name and optional metadata. The order is deliberate:
 * the directory flag wins, then well-known dotfile names, then compound
 * extensions, then the extension, then MIME as a last structured hint.
 */
export function resolveFileVisual(input: FileVisualInput): FileVisual {
  const name = input.name ?? "";
  const lower = name.toLowerCase();
  const base = (lower.split(/[\\/]/).pop() ?? lower).replace(/\.+$/, "");

  if (input.isDir) {
    return visualFor(base.endsWith(".app") ? "app" : "folder", "app");
  }

  const special = SPECIAL_NAMES[base] ?? SPECIAL_NAMES[lower];
  if (special) {
    return visualFor(special, extensionOfName(base) || base);
  }

  const compound = compoundExtensionOf(name);
  if (compound) {
    const kind = EXTENSION_INDEX.get(compound) ?? EXTENSION_INDEX.get(extensionOfName(compound));
    if (kind) return visualFor(kind, compound);
  }

  const extension = (input.extension ?? "").trim().toLowerCase() || extensionOfName(name);
  if (extension) {
    const kind = EXTENSION_INDEX.get(extension);
    if (kind) return visualFor(kind, extension);
    return visualFor("unknown", extension);
  }

  const mime = normalizeMime(input.mimeType);
  if (mime) {
    const kind = MIME_INDEX[mime];
    if (kind) return visualFor(kind, null);
    if (mime.startsWith("image/")) return visualFor("image", null);
    if (mime.startsWith("video/")) return visualFor("video", null);
    if (mime.startsWith("audio/")) return visualFor("audio", null);
    if (mime.startsWith("font/")) return visualFor("font", null);
    if (mime.startsWith("text/")) return visualFor("text", null);
  }

  return visualFor("unknown", null);
}

export function fileVisualForEntry(entry: FileEntry): FileVisual {
  return resolveFileVisual({
    name: entry.name,
    extension: entry.extension,
    isDir: entry.isDir,
    isSymlink: entry.isSymlink,
  });
}

export function fileVisualForCategory(category: FileCategory): FileVisual {
  if (category === "folder") return visualFor("folder", null);
  if (category === "pdf") return visualFor("pdf", "pdf");
  if (category === "image") return visualFor("image", "png");
  if (category === "video") return visualFor("video", "mp4");
  if (category === "audio") return visualFor("audio", "mp3");
  if (category === "archive") return visualFor("archive", "zip");
  if (category === "executable") return visualFor("executable", "exe");
  if (category === "text") return visualFor("text", "txt");
  if (category === "document") return visualFor("word", "docx");
  if (category === "sheet") return visualFor("sheet", "xlsx");
  if (category === "slides") return visualFor("slides", "pptx");
  if (category === "code") return visualFor("javascript", "js");
  if (category === "font") return visualFor("font", "ttf");
  if (category === "disk") return visualFor("diskImage", "dmg");
  return visualFor("unknown", null);
}

export function accentVariable(accent: string): string {
  return `var(--file-accent-${accent})`;
}

export function isThumbnailCandidate(visual: FileVisual): boolean {
  return visual.thumbnail === true;
}

export function registryKindCount(): number {
  return Object.keys(DEFINITIONS).length;
}

export function registeredExtensions(): string[] {
  return [...EXTENSION_INDEX.keys()];
}
