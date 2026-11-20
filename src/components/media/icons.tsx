import type { CSSProperties, ReactElement } from "react";
import {
  Boxes,
  CalendarDays,
  Cast,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Download,
  Gauge,
  Home,
  Languages,
  Maximize,
  Package,
  Pause,
  Play,
  Puzzle,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Subtitles,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";

/**
 * Media-workspace icon set (docs/MEDIA_UI_SPEC.md §6).
 *
 * Thin wrapper over lucide so the media area has one namespaced vocabulary and
 * a single place to swap a glyph. The rest of the app keeps using
 * `src/components/Icon` (AppIcon) — do not merge the two: the media UI needs
 * glyphs the explorer chrome has no concept of.
 */
export type MediaIconName =
  // rail
  | "brand"
  | "home"
  | "discover"
  | "library"
  | "calendar"
  | "addons"
  | "settings"
  // top bar
  | "search"
  | "downloads"
  | "fullscreen"
  | "cast"
  | "close"
  // rows / panels
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "check"
  // player + stream rows
  | "play"
  | "pause"
  | "prev"
  | "next"
  | "volume"
  | "muted"
  | "subtitles"
  | "audio"
  | "speed"
  | "peers"
  | "ready";

interface GlyphProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean;
  "aria-label"?: string;
  role?: string;
}

const GLYPHS: Record<MediaIconName, (props: GlyphProps) => ReactElement> = {
  brand: (p) => <Play {...p} />,
  home: (p) => <Home {...p} />,
  discover: (p) => <Compass {...p} />,
  library: (p) => <Boxes {...p} />,
  calendar: (p) => <CalendarDays {...p} />,
  addons: (p) => <Puzzle {...p} />,
  settings: (p) => <Settings {...p} />,
  search: (p) => <Search {...p} />,
  downloads: (p) => <Download {...p} />,
  fullscreen: (p) => <Maximize {...p} />,
  cast: (p) => <Cast {...p} />,
  close: (p) => <X {...p} />,
  "chevron-left": (p) => <ChevronLeft {...p} />,
  "chevron-right": (p) => <ChevronRight {...p} />,
  "chevron-down": (p) => <ChevronDown {...p} />,
  check: (p) => <Check {...p} />,
  play: (p) => <Play {...p} />,
  pause: (p) => <Pause {...p} />,
  prev: (p) => <SkipBack {...p} />,
  next: (p) => <SkipForward {...p} />,
  volume: (p) => <Volume2 {...p} />,
  muted: (p) => <VolumeX {...p} />,
  subtitles: (p) => <Subtitles {...p} />,
  audio: (p) => <Languages {...p} />,
  speed: (p) => <Gauge {...p} />,
  peers: (p) => <Package {...p} />,
  ready: (p) => <Zap {...p} />,
};

export interface MediaIconProps extends GlyphProps {
  name: MediaIconName;
  /** Decorative by default: pass `title` (and `decorative={false}`) when the
   *  icon is the only content of an interactive element. */
  decorative?: boolean;
  title?: string;
}

/** A single media glyph. Icons are decorative unless a title is supplied. */
export function MediaIcon({
  name,
  size = 20,
  strokeWidth = 1.8,
  className,
  style,
  decorative = true,
  title,
}: MediaIconProps) {
  const Glyph = GLYPHS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className ? `media-icon ${className}` : "media-icon"}
      style={style}
      aria-hidden={decorative ? true : undefined}
      aria-label={!decorative && title ? title : undefined}
      role={!decorative && title ? "img" : undefined}
    />
  );
}

/** The MAXplorer media brand mark: violet gradient tile with a play glyph. */
export function MediaBrandMark({ size = 34 }: { size?: number }) {
  return (
    <span className="media-brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <MediaIcon name="brand" size={size * 0.5} strokeWidth={0} className="media-brand-play" />
    </span>
  );
}
