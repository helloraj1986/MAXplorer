import type { FileEntry } from "./types";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "svg",
  "tif",
  "tiff",
  "heic",
  "heif",
  "avif",
  "ico",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "avi", "mkv", "wmv", "webm", "flv", "mpg", "mpeg"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "wma", "aiff", "mid"]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "log",
  "ini",
  "cfg",
  "conf",
  "yaml",
  "yml",
  "json",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "js",
  "jsx",
  "ts",
  "tsx",
  "rs",
  "py",
  "rb",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "swift",
  "kt",
  "sh",
  "zsh",
  "bash",
  "fish",
  "toml",
  "lock",
  "gitignore",
]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "dmg", "iso"]);
const EXECUTABLE_EXTENSIONS = new Set(["exe", "msi", "app", "bat", "cmd", "com"]);
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "rtf", "pages", "odt"]);
const SHEET_EXTENSIONS = new Set(["xls", "xlsx", "numbers", "ods"]);
const SLIDES_EXTENSIONS = new Set(["ppt", "pptx", "key", "odp"]);
const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);

export type FileCategory =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "archive"
  | "executable"
  | "text"
  | "document"
  | "sheet"
  | "slides"
  | "code"
  | "font"
  | "disk"
  | "file";

export function extensionOf(name: string): string {
  const clean = name.replace(/\.+$/, "");
  const index = clean.lastIndexOf(".");
  if (index <= 0) return "";
  return clean.slice(index + 1).toLowerCase();
}

export function isImageEntry(entry: FileEntry): boolean {
  return !entry.isDir && IMAGE_EXTENSIONS.has(extensionOf(entry.name));
}

export function isVideoEntry(entry: FileEntry): boolean {
  return !entry.isDir && VIDEO_EXTENSIONS.has(extensionOf(entry.name));
}

export function isAudioEntry(entry: FileEntry): boolean {
  return !entry.isDir && AUDIO_EXTENSIONS.has(extensionOf(entry.name));
}

export function isPdfEntry(entry: FileEntry): boolean {
  return !entry.isDir && extensionOf(entry.name) === "pdf";
}

export function isTextEntry(entry: FileEntry): boolean {
  return !entry.isDir && TEXT_EXTENSIONS.has(extensionOf(entry.name));
}

export function fileCategory(entry: FileEntry): FileCategory {
  if (entry.isDir) {
    return extensionOf(entry.name) === "app" ? "executable" : "folder";
  }
  if (entry.isSymlink) return "folder";
  const extension = extensionOf(entry.name);
  if (extension === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (EXECUTABLE_EXTENSIONS.has(extension)) return "executable";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (SHEET_EXTENSIONS.has(extension)) return "sheet";
  if (SLIDES_EXTENSIONS.has(extension)) return "slides";
  if (FONT_EXTENSIONS.has(extension)) return "font";
  if (["js", "jsx", "ts", "tsx", "rs", "py", "rb", "go", "java", "c", "h", "cpp", "hpp", "swift", "kt", "sh", "zsh", "bash", "html", "htm", "css", "scss", "json", "xml", "yaml", "yml", "toml"].includes(extension)) {
    return "code";
  }
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "file";
}

export function typeName(entry: FileEntry): string {
  if (entry.isSymlink) return "Shortcut";
  if (entry.isDir) {
    return extensionOf(entry.name) === "app" ? "Application" : "File folder";
  }
  const extension = extensionOf(entry.name);
  const explicit: Record<string, string> = {
    pdf: "PDF Document",
    png: "PNG File",
    jpg: "JPEG File",
    jpeg: "JPEG File",
    gif: "GIF File",
    svg: "SVG File",
    webp: "WebP Image",
    heic: "HEIC Image",
    txt: "Text Document",
    md: "MD File",
    markdown: "Markdown File",
    csv: "CSV File",
    tsv: "TSV File",
    doc: "Word Document",
    docx: "Word Document",
    xls: "Excel Worksheet",
    xlsx: "Excel Worksheet",
    ppt: "PowerPoint Presentation",
    pptx: "PowerPoint Presentation",
    mp4: "MP4 Video File",
    mov: "QuickTime Movie",
    mkv: "MKV Video File",
    mp3: "MP3 Audio File",
    m4a: "M4A Audio File",
    wav: "WAV Audio File",
    zip: "Compressed (zipped) Folder",
    "7z": "7Z Compressed Archive",
    rar: "RAR Compressed Archive",
    tar: "TAR Archive",
    gz: "GZip Compressed File",
    dmg: "Disk Image",
    iso: "Disc Image File",
    exe: "Application",
    msi: "Windows Installer Package",
    app: "Application",
    fig: "Figma Design File",
    html: "HTML Document",
    htm: "HTML Document",
    css: "Cascading Style Sheet",
    js: "JavaScript File",
    jsx: "React JavaScript File",
    ts: "TypeScript File",
    tsx: "React TypeScript File",
    json: "JSON File",
    xml: "XML Document",
    yaml: "YAML File",
    yml: "YAML File",
    rs: "Rust Source File",
    py: "Python Source File",
    swift: "Swift Source File",
    sh: "Shell Script",
    zsh: "Shell Script",
    log: "Text Document",
    rtf: "Rich Text Document",
    pages: "Pages Document",
    numbers: "Numbers Spreadsheet",
    key: "Keynote Presentation",
    ttf: "TrueType Font",
    otf: "OpenType Font",
    woff: "Web Open Font",
    woff2: "Web Open Font",
  };
  if (explicit[extension]) return explicit[extension];
  if (!extension) return "File";
  return `${extension.toUpperCase()} File`;
}

export function formatDate(value: number | null | undefined): string {
  if (value == null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = date.getHours();
  const displayHours = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const meridiem = hours >= 12 ? "PM" : "AM";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ${displayHours}:${minutes} ${meridiem}`;
}

export function formatDateOnly(value: number | null | undefined): string {
  if (value == null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function roundHalfEven(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  let rounded: number;
  if (Math.abs(fraction - 0.5) < 1e-9) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return rounded / factor;
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes === 0) return "0 KB";
  if (bytes < 1024) return "1 KB";
  const kb = bytes / 1024;
  if (kb < 1024 * 1024) {
    if (kb < 100) return `${trimNumber(roundHalfEven(kb, 1))} KB`;
    return `${Math.round(kb).toLocaleString("en-US")} KB`;
  }
  const gb = kb / (1024 * 1024);
  return `${trimNumber(roundHalfEven(gb, 1))} GB`;
}

export function formatSizeLong(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  return `${formatSize(bytes)} (${bytes.toLocaleString("en-US")} bytes)`;
}

export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : pluralForm ?? `${singular}s`;
}

export function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function basename(path: string): string {
  if (path === "/" || /^[A-Za-z]:[\\/]?$/.test(path)) return path;
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function parentPath(path: string): string | null {
  if (path === "/" || /^[A-Za-z]:[\\/]?$/.test(path)) return null;
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index < 0) return null;
  if (index === 0) return "/";
  let parent = normalized.slice(0, index);
  if (/^[A-Za-z]:$/.test(parent)) parent += "\\";
  return parent;
}

export function joinPath(parent: string, name: string, separator = "/"): string {
  if (!parent || parent === "/") return `${separator === "\\" ? "" : "/"}${name}`;
  const trimmed = parent.replace(/[\\/]+$/, "");
  return `${trimmed}${separator}${name}`;
}

export function isRootPath(path: string): boolean {
  return path === "/" || /^[A-Za-z]:[\\/]?$/.test(path);
}

export function isPathInside(path: string, parent: string): boolean {
  if (path === parent) return true;
  const normalizedParent = parent.replace(/[\\/]+$/, "");
  return path.startsWith(`${normalizedParent}/`) || path.startsWith(`${normalizedParent}\\`);
}

export interface Breadcrumb {
  label: string;
  path: string;
}

export function breadcrumbs(path: string, rootLabel: string, homeLocation: string): Breadcrumb[] {
  if (path === homeLocation) return [{ label: "Home", path: homeLocation }];
  if (path === "/") return [{ label: rootLabel, path: "/" }];
  const windowsRoot = /^([A-Za-z]:)[\\/]/.exec(path);
  if (windowsRoot) {
    const drive = windowsRoot[1].toUpperCase();
    const rest = path.slice(2).replace(/^[\\/]+/, "");
    const parts = rest.split(/[\\/]+/).filter(Boolean);
    const crumbs: Breadcrumb[] = [{ label: `Local Disk (${drive})`, path: `${drive}\\` }];
    let current = `${drive}\\`;
    for (const part of parts) {
      current = joinPath(current, part, "\\");
      crumbs.push({ label: part, path: current });
    }
    return crumbs;
  }
  const parts = path.split("/").filter(Boolean);
  const crumbs: Breadcrumb[] = [{ label: rootLabel, path: "/" }];
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

export function displayName(entry: FileEntry, showExtensions: boolean): string {
  if (showExtensions || entry.isDir) return entry.name;
  const extension = extensionOf(entry.name);
  if (!extension || entry.name.startsWith(".")) return entry.name;
  if (["app", "dmg", "pages", "numbers", "key", "fig"].includes(extension)) return entry.name;
  return entry.name.slice(0, entry.name.length - extension.length - 1);
}

export function totalSize(entries: FileEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.size ?? 0), 0);
}

export function fileExtensionLabel(entry: FileEntry): string {
  if (entry.isDir) return "Folder";
  const extension = extensionOf(entry.name);
  return extension ? extension.toUpperCase() : "File";
}

export function isShortcutModifier(event: { metaKey: boolean; ctrlKey: boolean }, platform: string): boolean {
  return platform === "macos" ? event.metaKey : event.ctrlKey;
}
