import type { CSSProperties, ReactNode } from "react";

export type IconName =
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
  | "renameFile"
  | "palette"
  | "spinner";

const FILLED = new Set<IconName>(["more"]);

const ICONS: Record<IconName, ReactNode> = {
  back: (
    <>
      <path d="M11.5 4.5 6 10l5.5 5.5" />
      <path d="M6.3 10H16" />
    </>
  ),
  forward: (
    <>
      <path d="M8.5 4.5 14 10l-5.5 5.5" />
      <path d="M13.7 10H4" />
    </>
  ),
  up: (
    <>
      <path d="M10 16V4.5" />
      <path d="M5.5 9 10 4.5 14.5 9" />
    </>
  ),
  refresh: (
    <>
      <path d="M16 8.2A6.2 6.2 0 1 0 16 12" />
      <path d="M16 4.5V8.2h-3.7" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="5.2" />
      <path d="m13 13 3.2 3.2" />
    </>
  ),
  close: <path d="m5 5 10 10M15 5 5 15" />,
  minimize: <path d="M5.5 10.5h9" />,
  maximize: <rect x="5" y="5" width="10" height="10" rx="1" />,
  restore: (
    <>
      <path d="M7.5 6.5v-1a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" />
      <rect x="4.5" y="7.5" width="8" height="8" rx="1" />
    </>
  ),
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  chevronDown: <path d="m6 8 4 4 4-4" />,
  chevronRight: <path d="m8 6 4 4-4 4" />,
  chevronLeft: <path d="m12 6-4 4 4 4" />,
  more: (
    <>
      <circle cx="4.5" cy="10" r="1.25" />
      <circle cx="10" cy="10" r="1.25" />
      <circle cx="15.5" cy="10" r="1.25" />
    </>
  ),
  new: (
    <>
      <circle cx="10" cy="10" r="6.2" />
      <path d="M10 6.8v6.4M6.8 10h6.4" />
    </>
  ),
  cut: (
    <>
      <circle cx="6" cy="14" r="2.1" />
      <circle cx="14" cy="14" r="2.1" />
      <path d="m7.4 12.3 4.1-7.8M12.6 12.3 8.5 4.5" />
    </>
  ),
  copy: (
    <>
      <rect x="7" y="7" width="8" height="8" rx="1" />
      <path d="M13 5H6a1 1 0 0 0-1 1v7" />
    </>
  ),
  paste: (
    <>
      <rect x="5" y="5.5" width="10" height="10.5" rx="1.2" />
      <path d="M8 5.5V4.4c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v1.1" />
      <path d="M7.5 9h5M7.5 12h4" />
    </>
  ),
  rename: (
    <>
      <path d="m4.5 15.5 1-4.2 7.9-7.9 3.2 3.2-7.9 7.9-4.2 1z" />
      <path d="m11.5 4.5 3.2 3.2" />
    </>
  ),
  renameFile: (
    <>
      <path d="M11 3.5H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7.5" />
      <path d="M11 3.5v4h4M12.5 12.5l1-3 2 2-3 1z" />
    </>
  ),
  share: (
    <>
      <path d="M8 8H5.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H12" />
      <path d="M10 12V3.5M7.5 6 10 3.5 12.5 6" />
    </>
  ),
  delete: (
    <>
      <path d="M5 6h10M8 6V4.5h4V6M6.2 6l.6 9.5h6.4l.6-9.5" />
      <path d="M8.5 9v3.5M11.5 9v3.5" />
    </>
  ),
  sort: (
    <>
      <path d="M6 4.5v11M3.5 13 6 15.5 8.5 13" />
      <path d="M14 15.5v-11M11.5 7 14 4.5 16.5 7" />
    </>
  ),
  view: (
    <>
      <path d="M4.5 5.5h2M9 5.5h6.5M4.5 10h2M9 10h6.5M4.5 14.5h2M9 14.5h6.5" />
    </>
  ),
  home: (
    <>
      <path d="m3.5 9.5 6.5-6 6.5 6" />
      <path d="M5.5 8.2V16h9V8.2" />
      <path d="M8.5 16v-4h3v4" />
    </>
  ),
  pin: (
    <>
      <path d="m7 4 6 6M12.5 3.5l4 4-2.6 1.1-3.3 3.3-1 2.6-4-4 2.6-1 3.3-3.3 1-2.7z" />
      <path d="m7.5 12.5-3.3 3.3" />
    </>
  ),
  unpin: (
    <>
      <path d="m7 4 6 6M12.5 3.5l4 4-2.6 1.1-3.3 3.3-1 2.6-4-4 2.6-1 3.3-3.3 1-2.7z" />
      <path d="m7.5 12.5-3.3 3.3M3.5 3.5l13 13" />
    </>
  ),
  computer: (
    <>
      <rect x="3" y="4.5" width="14" height="9" rx="1" />
      <path d="M7 16.5h6M10 13.5v3" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="4.5" width="14" height="9" rx="1" />
      <path d="M7 16.5h6M10 13.5v3" />
    </>
  ),
  downloads: (
    <>
      <path d="M10 3.5v9M6.5 9.5 10 13l3.5-3.5" />
      <path d="M4.5 15.5h11" />
    </>
  ),
  documents: (
    <>
      <path d="M6 3.5h5l3.5 3.5v9.5H6z" />
      <path d="M11 3.5V7h3.5M8 10h4M8 12.5h4" />
    </>
  ),
  pictures: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
      <circle cx="7.5" cy="8" r="1.3" />
      <path d="m4.5 14 4-4 2.5 2.5 2-2 3.5 3.5" />
    </>
  ),
  music: (
    <>
      <path d="M8 14.5V5.5l7-2v9" />
      <circle cx="5.8" cy="14.8" r="2.2" />
      <circle cx="12.8" cy="12.8" r="2.2" />
    </>
  ),
  movies: (
    <>
      <rect x="3.5" y="5" width="13" height="10" rx="1" />
      <path d="M7 5v10M13 5v10M3.5 8h3.5M13 8h3.5M3.5 12h3.5M13 12h3.5" />
    </>
  ),
  applications: (
    <>
      <rect x="3.5" y="3.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="3.5" width="5" height="5" rx="1" />
      <rect x="3.5" y="11.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="11.5" width="5" height="5" rx="1" />
    </>
  ),
  drive: (
    <>
      <ellipse cx="10" cy="5.5" rx="6" ry="2.5" />
      <path d="M4 5.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9" />
      <path d="M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
    </>
  ),
  network: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M3.5 10h13M10 3.5c2 2 2 11 0 13M10 3.5c-2 2-2 11 0 13" />
    </>
  ),
  gallery: (
    <>
      <rect x="3" y="4.5" width="14" height="11" rx="1" />
      <circle cx="7" cy="8" r="1.2" />
      <path d="m4 14 4-4 3 3 2-2 3 3" />
    </>
  ),
  folder: (
    <>
      <path d="M3 6.5c0-.8.7-1.5 1.5-1.5h3l2 2h6c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-8z" />
    </>
  ),
  file: (
    <>
      <path d="M6 3.5h5l3.5 3.5v9.5H6z" />
      <path d="M11 3.5V7h3.5" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
      <circle cx="7.5" cy="8" r="1.2" />
      <path d="m4.5 14 4-4 2.5 2.5 2-2 3.5 3.5" />
    </>
  ),
  pdf: (
    <>
      <path d="M6 3.5h5l3.5 3.5v9.5H6z" />
      <path d="M11 3.5V7h3.5M7.5 11h5M7.5 13.5h3.5" />
    </>
  ),
  archive: (
    <>
      <path d="M6 3.5h8v13H6z" />
      <path d="M9 4v2M11 6v2M9 8v2M11 10v2M9 12v2" />
      <rect x="8.5" y="13" width="2" height="2" rx=".4" />
    </>
  ),
  video: (
    <>
      <rect x="3.5" y="5" width="13" height="10" rx="1" />
      <path d="m8.5 7.8 4 2.2-4 2.2z" />
    </>
  ),
  audio: (
    <>
      <path d="M8 14.5V5.5l7-2v9" />
      <circle cx="5.8" cy="14.8" r="2.2" />
      <circle cx="12.8" cy="12.8" r="2.2" />
    </>
  ),
  exe: (
    <>
      <rect x="3.5" y="4" width="13" height="11" rx="1" />
      <path d="M3.5 7.5h13M5.5 5.6h.8M7.5 5.6h.8" />
      <path d="m8 10 2 1.5-2 1.5" />
    </>
  ),
  text: (
    <>
      <path d="M6 3.5h5l3.5 3.5v9.5H6z" />
      <path d="M11 3.5V7h3.5M8 10h4M8 12.5h4" />
    </>
  ),
  doc: (
    <>
      <path d="M6 3.5h5l3.5 3.5v9.5H6z" />
      <path d="M11 3.5V7h3.5M8 10h4M8 12.5h4M8 15h2" />
    </>
  ),
  sheet: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="1" />
      <path d="M4 8h12M4 12h12M8 4v12M12 4v12" />
    </>
  ),
  slides: (
    <>
      <rect x="4" y="4" width="12" height="8" rx="1" />
      <path d="M10 12v4M7 16h6" />
    </>
  ),
  code: <path d="m7.5 6-4 4 4 4M12.5 6l4 4-4 4" />,
  font: <path d="M4.5 15.5 10 4.5l5.5 11M6.3 12h7.4" />,
  disk: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
      <circle cx="10" cy="10" r="3" />
      <path d="M10 7v1.5" />
    </>
  ),
  link: (
    <>
      <path d="M8.5 11.5 11.5 8.5" />
      <path d="M7.5 13.5 6 15a2.8 2.8 0 0 1-4-4l1.5-1.5M12.5 6.5 14 5a2.8 2.8 0 0 1 4 4l-1.5 1.5" />
    </>
  ),
  open: (
    <>
      <path d="M8 4.5H5.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V12" />
      <path d="M11.5 4.5H16v4.5M16 4.5l-6 6" />
    </>
  ),
  openWith: (
    <>
      <rect x="3.5" y="4.5" width="8" height="8" rx="1" />
      <path d="M12 8h4.5v7.5H9V12M13.5 5.5h4v4M17.5 5.5 12 11" />
    </>
  ),
  newWindow: (
    <>
      <rect x="3.5" y="5.5" width="10" height="10" rx="1" />
      <path d="M6.5 5.5V4a1 1 0 0 1 1-1H16a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-1.5M6.5 9h4M8.5 7v4" />
    </>
  ),
  tab: (
    <>
      <path d="M3.5 7.5V5.5h6l1.5 2h5.5v8H3.5z" />
      <path d="M3.5 9.5h13" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
      <path d="m6 8 2 2-2 2M10 12h4" />
    </>
  ),
  properties: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 9v4M10 6.5v.5" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 9v4M10 6.5v.5" />
    </>
  ),
  warning: (
    <>
      <path d="M10 3.5 17 16H3z" />
      <path d="M10 8v3.5M10 13.5v.5" />
    </>
  ),
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  lock: (
    <>
      <rect x="5" y="8.5" width="10" height="7.5" rx="1" />
      <path d="M7 8.5V6.5a3 3 0 0 1 6 0v2" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 3.5v1.2M10 15.3v1.2M3.5 10h1.2M15.3 10h1.2M5.4 5.4l.8.8M13.8 13.8l.8.8M14.6 5.4l-.8.8M6.2 13.8l-.8.8" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 10s2.7-4.5 7.2-4.5 7.2 4.5 7.2 4.5-2.7 4.5-7.2 4.5S2.8 10 2.8 10z" />
      <circle cx="10" cy="10" r="2" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="5" height="5" rx=".6" />
      <rect x="11.5" y="3.5" width="5" height="5" rx=".6" />
      <rect x="3.5" y="11.5" width="5" height="5" rx=".6" />
      <rect x="11.5" y="11.5" width="5" height="5" rx=".6" />
    </>
  ),
  list: <path d="M4 5.5h12M4 10h12M4 14.5h12" />,
  details: (
    <>
      <path d="M3.5 4.5h13M3.5 10h13M3.5 15.5h13M7 3v13M12.5 3v13" />
    </>
  ),
  sortAsc: (
    <>
      <path d="M5 14V6M2.8 8.2 5 6l2.2 2.2" />
      <path d="M10 7h7M10 11h5M10 15h3" />
    </>
  ),
  sortDesc: (
    <>
      <path d="M5 6v8M2.8 11.8 5 14l2.2-2.2" />
      <path d="M10 7h3M10 11h5M10 15h7" />
    </>
  ),
  arrowRight: <path d="M4 10h11M11 6l4 4-4 4" />,
  copyPath: (
    <>
      <path d="M8 6.5h8v8H8z" />
      <path d="M12 4H4v8" />
      <path d="M10 10.5h4" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9.5h7.5a4 4 0 0 1 0 8H8" />
      <path d="M7 6 4 9.5 7 13" />
    </>
  ),
  star: <path d="m10 3.5 2 4 4.5.7-3.2 3.1.8 4.4-4.1-2.2-4.1 2.2.8-4.4L3.5 8.2 8 7.5z" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.5 1.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.6 9.5h6.8L14 6" />
      <path d="M8.5 9v4M11.5 9v4" />
    </>
  ),
  shield: <path d="M10 3.5 16 6v4c0 3.2-2.4 5.4-6 6.5-3.6-1.1-6-3.3-6-6.5V6z" />,
  sync: (
    <>
      <path d="M15.5 7A6 6 0 0 0 5 5.5L4 7" />
      <path d="M4.5 13A6 6 0 0 0 15 14.5l1-1.5" />
      <path d="M4 4v3h3M16 16v-3h-3" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
      <path d="M8 4.5v11" />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
      <path d="M12 4.5v11" />
    </>
  ),
  columns: (
    <>
      <rect x="3" y="4.5" width="6" height="11" rx="1" />
      <rect x="11" y="4.5" width="6" height="11" rx="1" />
    </>
  ),
  compare: (
    <>
      <rect x="3" y="5" width="5.5" height="10" rx="1" />
      <rect x="11.5" y="5" width="5.5" height="10" rx="1" />
      <path d="M9 7.5h2M9 12.5h2" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M3.5 8V3.5H8M12 3.5h4.5V8M16.5 12v4.5H12M8 16.5H3.5V12" />
    </>
  ),
  palette: (
    <>
      <path d="M10 3.2a6.8 6.8 0 0 0 0 13.6c1.1 0 1.6-.7 1.6-1.5 0-.5-.3-.9-.3-1.4 0-.7.6-1.3 1.4-1.3h1.1a3 3 0 0 0 3-3c0-3.5-3-6.4-6.8-6.4Z" />
      <circle cx="6.6" cy="8.2" r=".9" />
      <circle cx="9.6" cy="6.2" r=".9" />
      <circle cx="13" cy="7.2" r=".9" />
      <circle cx="6.9" cy="11.7" r=".9" />
    </>
  ),
  spinner: (
    <>
      <circle cx="10" cy="10" r="6.5" opacity=".25" />
      <path d="M10 3.5a6.5 6.5 0 0 1 6.5 6.5" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
  title?: string;
}

export function Icon({ name, size = 16, className, style, strokeWidth = 1.5, title }: IconProps) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {ICONS[name]}
    </svg>
  );
}
