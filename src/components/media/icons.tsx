import type { CSSProperties, ReactElement } from "react";
import {
  AudioLines,
  Boxes,
  CalendarDays,
  Cast,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Compass,
  Cpu,
  Disc3,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  Film,
  Gauge,
  HardDrive,
  Heart,
  Home,
  Languages,
  Maximize,
  Music,
  Package,
  Pause,
  PictureInPicture2,
  Play,
  Puzzle,
  Search,
  Settings,
  Share2,
  Signal,
  SkipBack,
  SkipForward,
  Subtitles,
  ThumbsUp,
  Users,
  Volume1,
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
  | "episodes"
  // player + stream rows
  | "play"
  | "pause"
  | "prev"
  | "next"
  | "volume"
  | "volume-low"
  | "muted"
  | "subtitles"
  | "audio"
  | "waveform"
  | "speed"
  | "pip"
  | "more"
  | "external"
  | "peers"
  | "ready"
  // detail action row + stream-row line glyphs (WP3)
  | "quality"
  | "source"
  | "codec"
  | "clock"
  | "music"
  | "channels"
  | "size"
  | "bitrate"
  | "peer-count"
  | "trailer"
  | "watched"
  | "like"
  | "heart"
  | "share";

interface GlyphProps {
  size?: number;
  strokeWidth?: number;
  /** Solid fill for the glyphs the player draws filled (play / pause). */
  fill?: string;
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
  episodes: (p) => <Film {...p} />,
  play: (p) => <Play {...p} />,
  pause: (p) => <Pause {...p} />,
  prev: (p) => <SkipBack {...p} />,
  next: (p) => <SkipForward {...p} />,
  volume: (p) => <Volume2 {...p} />,
  "volume-low": (p) => <Volume1 {...p} />,
  muted: (p) => <VolumeX {...p} />,
  subtitles: (p) => <Subtitles {...p} />,
  audio: (p) => <Languages {...p} />,
  waveform: (p) => <AudioLines {...p} />,
  speed: (p) => <Gauge {...p} />,
  pip: (p) => <PictureInPicture2 {...p} />,
  more: (p) => <Ellipsis {...p} />,
  external: (p) => <ExternalLink {...p} />,
  peers: (p) => <Package {...p} />,
  ready: (p) => <Zap {...p} />,
  quality: (p) => <Clapperboard {...p} />,
  source: (p) => <Disc3 {...p} />,
  codec: (p) => <Cpu {...p} />,
  clock: (p) => <Clock {...p} />,
  music: (p) => <Music {...p} />,
  channels: (p) => <AudioLines {...p} />,
  size: (p) => <HardDrive {...p} />,
  bitrate: (p) => <Signal {...p} />,
  "peer-count": (p) => <Users {...p} />,
  trailer: (p) => <Film {...p} />,
  watched: (p) => <Eye {...p} />,
  like: (p) => <ThumbsUp {...p} />,
  heart: (p) => <Heart {...p} />,
  share: (p) => <Share2 {...p} />,
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
  fill,
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
      fill={fill}
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
