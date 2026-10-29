import type { CSSProperties } from "react";
import {
  AppWindow,
  AppWindowMac,
  Archive,
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpAZ,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  ClipboardCopy,
  ClipboardPaste,
  Clock,
  Cloud,
  CloudOff,
  Columns2,
  Copy,
  Database,
  Disc3,
  Download,
  Eject,
  ExternalLink,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileKey,
  FileLock2,
  FilePenLine,
  FilePlus2,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  FileWarning,
  Film,
  Folder,
  FolderDown,
  FolderGit2,
  FolderHeart,
  FolderLock,
  FolderOpen,
  FolderSymlink,
  GitCompareArrows,
  Globe,
  HardDrive,
  House,
  Image,
  Images,
  Info,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  Lock,
  Maximize2,
  Minus,
  Monitor,
  MoreHorizontal,
  Music,
  Palette,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Presentation,
  RefreshCw,
  Rows3,
  Scissors,
  Search,
  Server,
  Settings,
  Share2,
  Shield,
  Square,
  SquareArrowOutUpRight,
  SquareTerminal,
  Star,
  Table2,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  Usb,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * Semantic names used by the chrome. Keeping the names stable lets the rest of
 * the application describe intent ("delete", "sync") rather than a vendor icon.
 * Every glyph is a named Lucide import, so unused icons are tree-shaken.
 */
export type AppIconName =
  | "back"
  | "forward"
  | "up"
  | "refresh"
  | "search"
  | "close"
  | "minimize"
  | "maximize"
  | "restore"
  | "plus"
  | "chevronDown"
  | "chevronRight"
  | "chevronLeft"
  | "more"
  | "new"
  | "cut"
  | "copy"
  | "paste"
  | "rename"
  | "renameFile"
  | "share"
  | "delete"
  | "sort"
  | "view"
  | "home"
  | "pin"
  | "unpin"
  | "computer"
  | "desktop"
  | "downloads"
  | "documents"
  | "pictures"
  | "music"
  | "movies"
  | "applications"
  | "drive"
  | "network"
  | "gallery"
  | "folder"
  | "folderOpen"
  | "file"
  | "image"
  | "pdf"
  | "archive"
  | "video"
  | "audio"
  | "exe"
  | "text"
  | "doc"
  | "sheet"
  | "slides"
  | "code"
  | "font"
  | "disk"
  | "link"
  | "open"
  | "openWith"
  | "newWindow"
  | "tab"
  | "terminal"
  | "properties"
  | "info"
  | "warning"
  | "check"
  | "lock"
  | "settings"
  | "eye"
  | "grid"
  | "list"
  | "details"
  | "sortAsc"
  | "sortDesc"
  | "arrowRight"
  | "copyPath"
  | "undo"
  | "star"
  | "clock"
  | "trash"
  | "shield"
  | "sync"
  | "sidebar"
  | "panel"
  | "columns"
  | "compare"
  | "fullscreen"
  | "palette"
  | "spinner"
  | "appWindow"
  | "fileKey"
  | "fileCog"
  | "fileJson"
  | "fileCode"
  | "fileSpreadsheet"
  | "fileArchive"
  | "fileVideo"
  | "fileAudio"
  | "fileImage"
  | "fileText"
  | "fileType"
  | "database"
  | "server"
  | "usb"
  | "eject"
  | "cloud"
  | "cloudOff"
  | "checkCircle"
  | "alertCircle"
  | "xCircle"
  | "folderHeart"
  | "folderDown"
  | "folderGit"
  | "folderLock"
  | "folderSymlink"
  | "package"
  | "wrench";

const ICONS: Record<AppIconName, LucideIcon> = {
  back: ArrowLeft,
  forward: ArrowRight,
  up: ArrowUp,
  refresh: RefreshCw,
  search: Search,
  close: X,
  minimize: Minus,
  maximize: Square,
  restore: Copy,
  plus: Plus,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  more: MoreHorizontal,
  new: FilePlus2,
  cut: Scissors,
  copy: Copy,
  paste: ClipboardPaste,
  rename: Pencil,
  renameFile: FilePenLine,
  share: Share2,
  delete: Trash2,
  sort: ArrowUpDown,
  view: Rows3,
  home: House,
  pin: Pin,
  unpin: PinOff,
  computer: Monitor,
  desktop: Monitor,
  downloads: Download,
  documents: FileText,
  pictures: Image,
  music: Music,
  movies: Film,
  applications: AppWindow,
  drive: HardDrive,
  network: Globe,
  gallery: Images,
  folder: Folder,
  folderOpen: FolderOpen,
  file: File,
  image: FileImage,
  pdf: FileText,
  archive: FileArchive,
  video: FileVideo,
  audio: FileAudio,
  exe: AppWindow,
  text: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  code: FileCode2,
  font: Type,
  disk: Disc3,
  link: Link2,
  open: ExternalLink,
  openWith: SquareArrowOutUpRight,
  newWindow: PanelsTopLeft,
  tab: Folder,
  terminal: SquareTerminal,
  properties: Info,
  info: Info,
  warning: TriangleAlert,
  check: Check,
  lock: Lock,
  settings: Settings,
  eye: Eye,
  grid: LayoutGrid,
  list: List,
  details: Table2,
  sortAsc: ArrowDownAZ,
  sortDesc: ArrowUpAZ,
  arrowRight: ArrowRight,
  copyPath: ClipboardCopy,
  undo: Undo2,
  star: Star,
  clock: Clock,
  trash: Trash2,
  shield: Shield,
  sync: RefreshCw,
  sidebar: PanelLeft,
  panel: PanelRight,
  columns: Columns2,
  compare: GitCompareArrows,
  fullscreen: Maximize2,
  palette: Palette,
  spinner: Loader2,
  appWindow: AppWindowMac,
  fileKey: FileKey,
  fileCog: FileCog,
  fileJson: FileJson,
  fileCode: FileCode2,
  fileSpreadsheet: FileSpreadsheet,
  fileArchive: FileArchive,
  fileVideo: FileVideo,
  fileAudio: FileAudio,
  fileImage: FileImage,
  fileText: FileText,
  fileType: FileType2,
  database: Database,
  server: Server,
  usb: Usb,
  eject: Eject,
  cloud: Cloud,
  cloudOff: CloudOff,
  checkCircle: CircleCheck,
  alertCircle: CircleAlert,
  xCircle: CircleX,
  folderHeart: FolderHeart,
  folderDown: FolderDown,
  folderGit: FolderGit2,
  folderLock: FolderLock,
  folderSymlink: FolderSymlink,
  package: Archive,
  wrench: Wrench,
};

export type AppIconTone = "default" | "muted" | "subtle" | "accent" | "danger" | "success" | "warning";

export interface AppIconProps {
  name: AppIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Decorative icons stay out of the accessibility tree. Defaults to true. */
  decorative?: boolean;
  tone?: AppIconTone;
  disabled?: boolean;
}

/**
 * Single entry point for functional icons. Sizing and stroke tokens are
 * centralised here so toolbars, menus and sidebars cannot drift apart.
 */
export function AppIcon({
  name,
  size = 16,
  strokeWidth = 1.75,
  className,
  style,
  title,
  decorative = !title,
  tone = "default",
  disabled = false,
}: AppIconProps) {
  const Glyph = ICONS[name];
  const classes = [
    "ui-icon",
    tone !== "default" ? `ui-icon--${tone}` : "",
    disabled ? "ui-icon--disabled" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth
      className={classes}
      style={style}
      focusable="false"
      role={title && !decorative ? "img" : undefined}
      aria-hidden={title && !decorative ? undefined : true}
      aria-label={title && !decorative ? title : undefined}
      aria-disabled={disabled || undefined}
    />
  );
}
