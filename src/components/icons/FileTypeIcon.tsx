import { useEffect, useId, useMemo, useState } from "react";
import type { FileCategory } from "../../lib/format";
import type { FileEntry } from "../../lib/types";
import {
  accentVariable,
  fileVisualForCategory,
  fileVisualForEntry,
  type FileGlyph,
  type FileVisual,
} from "../../lib/icons/fileIconRegistry";
import {
  isNativeIconCandidate,
  loadNativeIcon,
  peekNativeIcon,
} from "../../lib/icons/nativeIconService";
import {
  isThumbnailFailed,
  markThumbnailFailed,
  thumbnailUrlForEntry,
} from "../../lib/icons/thumbnailService";
import { AppIcon, type AppIconName } from "./AppIcon";
import { FolderIcon, folderVariantForName, type FolderVariant } from "./FolderIcon";

const GLYPH_ICONS: Record<FileGlyph, AppIconName> = {
  file: "file",
  folder: "folder",
  fileText: "fileText",
  fileSpreadsheet: "fileSpreadsheet",
  presentation: "slides",
  fileCode: "fileCode",
  fileJson: "fileJson",
  fileArchive: "fileArchive",
  fileImage: "fileImage",
  fileVideo: "fileVideo",
  fileAudio: "fileAudio",
  fileKey: "fileKey",
  fileCog: "fileCog",
  database: "database",
  font: "font",
  exe: "exe",
  app: "appWindow",
  disk: "disk",
  text: "text",
  pdf: "pdf",
  image: "image",
  video: "video",
  audio: "audio",
  archive: "archive",
  code: "code",
  sheet: "sheet",
  slides: "slides",
  doc: "doc",
  unknown: "file",
};

export interface FileTypeIconProps {
  entry?: FileEntry;
  category?: FileCategory;
  size?: number;
  thumbnail?: boolean;
  className?: string;
  folderVariant?: FolderVariant;
  selected?: boolean;
  title?: string;
}

function SymlinkBadge({ size }: { size: number }) {
  return (
    <span
      className="symlink-badge"
      style={{ width: Math.max(8, Math.round(size * 0.38)), height: Math.max(8, Math.round(size * 0.38)) }}
      aria-hidden="true"
    >
      <AppIcon name="link" size={Math.max(6, Math.round(size * 0.26))} strokeWidth={2.4} />
    </span>
  );
}

function AppBundleArt({
  size,
  className,
  symlink,
  title,
}: {
  size: number;
  className?: string;
  symlink?: boolean;
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <span
      className={`file-visual app-bundle-art ${className ?? ""}`}
      style={{ width: size, height: size }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-file-kind="app"
    >
      <svg width={size} height={size} viewBox="0 0 64 64" focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id={`app-tile-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--app-tile-top)" />
            <stop offset="1" stopColor="var(--app-tile-bottom)" />
          </linearGradient>
          <linearGradient id={`app-accent-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--app-tile-accent)" stopOpacity=".22" />
            <stop offset="1" stopColor="var(--app-tile-accent)" stopOpacity=".08" />
          </linearGradient>
        </defs>
        <rect x="6.5" y="6.5" width="51" height="51" rx="13" fill={`url(#app-tile-${id})`} stroke="var(--file-border)" />
        <rect x="13" y="14" width="38" height="31" rx="5" fill={`url(#app-accent-${id})`} />
        <path d="M13 21h38" stroke="var(--app-tile-accent)" strokeWidth="1.8" opacity=".55" />
        <circle cx="18" cy="17.7" r="1.2" fill="var(--app-tile-accent)" opacity=".75" />
        <circle cx="22.2" cy="17.7" r="1.2" fill="var(--app-tile-accent)" opacity=".5" />
        <circle cx="26.4" cy="17.7" r="1.2" fill="var(--app-tile-accent)" opacity=".35" />
        <g transform="translate(22 26)">
          <AppIcon
            name="appWindow"
            size={20}
            strokeWidth={2}
            decorative
            style={{ color: "var(--app-tile-accent)" }}
          />
        </g>
        <path d="M21 51h22" stroke="var(--app-tile-accent)" strokeWidth="2.4" strokeLinecap="round" opacity=".3" />
      </svg>
      {symlink ? <SymlinkBadge size={size} /> : null}
    </span>
  );
}

function PageArt({
  visual,
  size,
  className,
  symlink,
  title,
}: {
  visual: FileVisual;
  size: number;
  className?: string;
  symlink?: boolean;
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  const accent = accentVariable(visual.accent);
  const badge = visual.badgeText;
  const glyph = GLYPH_ICONS[visual.glyph];
  const compact = size < 24;

  return (
    <span
      className={`file-visual page-art ${className ?? ""}`}
      style={{ width: size, height: size }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-file-kind={visual.kind}
    >
      <svg width={size} height={size} viewBox="0 0 64 64" focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id={`page-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--file-page-top)" />
            <stop offset="1" stopColor="var(--file-page-bottom)" />
          </linearGradient>
          <linearGradient id={`page-fold-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--file-fold)" />
            <stop offset="1" stopColor="var(--file-page-top)" />
          </linearGradient>
        </defs>

        <path
          d="M13 10a4 4 0 0 1 4-4h22.5L52 18.5V54a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4z"
          fill={`url(#page-${id})`}
          stroke="var(--file-border)"
          strokeWidth="1.1"
        />
        <path d="M39.5 6v12.5H52" fill={`url(#page-fold-${id})`} stroke="var(--file-border)" strokeWidth="1.1" />
        <path d="M13 10a4 4 0 0 1 4-4h22.5" fill="none" stroke="var(--file-page-top)" strokeWidth="2" opacity=".55" />

        {compact ? (
          <>
            <rect x="16" y="16" width="32" height="27" rx="6" fill={accent} opacity=".16" />
            <g transform="translate(19 17)">
              <AppIcon name={glyph} size={26} strokeWidth={2.2} decorative style={{ color: accent }} />
            </g>
            <rect x="14" y="44" width="36" height="13" rx="3.5" fill={accent} opacity=".95" />
          </>
        ) : (
          <>
            <rect x="18" y="20" width="28" height="23" rx="5" fill={accent} opacity=".11" />
            <g transform="translate(24 24)">
              <AppIcon name={glyph} size={16} strokeWidth={2.05} decorative style={{ color: accent }} />
            </g>

            {badge ? (
              <g>
                <rect x={badge.length > 3 ? 24 : 27} y="44" width={badge.length > 3 ? 33 : 27} height="13.5" rx="3.4" fill={accent} />
                <text
                  x="40.5"
                  y="53.7"
                  textAnchor="middle"
                  fontSize={badge.length > 3 ? 7 : 8.2}
                  fontWeight="700"
                  fontFamily="var(--font-ui)"
                  fill="#ffffff"
                  letterSpacing=".2"
                >
                  {badge}
                </text>
              </g>
            ) : (
              <path d="M18 46h20" stroke={accent} strokeWidth="2" strokeLinecap="round" opacity=".55" />
            )}
          </>
        )}
      </svg>
      {symlink ? <SymlinkBadge size={size} /> : null}
    </span>
  );
}

function ThumbnailArt({
  entry,
  visual,
  size,
  className,
  symlink,
  title,
}: {
  entry: FileEntry;
  visual: FileVisual;
  size: number;
  className?: string;
  symlink?: boolean;
  title?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(() => isThumbnailFailed(entry.path));
  const url = useMemo(() => thumbnailUrlForEntry(entry), [entry]);

  if (failed || !url) {
    return <PageArt visual={visual} size={size} className={className} symlink={symlink} title={title} />;
  }

  return (
    <span
      className={`file-visual thumbnail-art ${loaded ? "loaded" : ""} ${className ?? ""}`}
      style={{ width: size, height: size }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-file-kind={visual.kind}
    >
      <span className="thumbnail-placeholder" aria-hidden="true">
        <PageArt visual={visual} size={size} symlink={false} />
      </span>
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => {
          markThumbnailFailed(entry.path);
          setFailed(true);
        }}
      />
      {symlink ? <SymlinkBadge size={size} /> : null}
    </span>
  );
}

/**
 * Central file/folder representation used by every view. It resolves the
 * registry visual, prefers native artwork for application bundles, and uses an
 * image thumbnail only when the existing asset protocol can serve one.
 */
export function FileTypeIcon({
  entry,
  category,
  size = 20,
  thumbnail = false,
  className,
  folderVariant = "standard",
  selected = false,
  title,
}: FileTypeIconProps) {
  const visual = useMemo(
    () => (entry ? fileVisualForEntry(entry) : fileVisualForCategory(category ?? "file")),
    [category, entry],
  );
  const resolvedFolderVariant =
    folderVariant !== "standard"
      ? folderVariant
      : entry?.isDir
        ? folderVariantForName(entry.name)
        : "standard";
  const applicationBundle = entry ? isNativeIconCandidate(entry) : false;
  const entryPath = entry?.path;
  const [nativeIcon, setNativeIcon] = useState<string | null>(() =>
    entryPath && applicationBundle ? (peekNativeIcon(entryPath) ?? null) : null,
  );

  useEffect(() => {
    if (!entryPath || !applicationBundle) {
      setNativeIcon(null);
      return;
    }
    const cached = peekNativeIcon(entryPath);
    if (cached !== undefined) {
      setNativeIcon(cached);
      return;
    }
    let active = true;
    setNativeIcon(null);
    void loadNativeIcon(entryPath).then((url) => {
      if (active) setNativeIcon(url);
    });
    return () => {
      active = false;
    };
  }, [entryPath, applicationBundle]);

  if (visual.kind === "folder") {
    if (entry?.isSymlink) {
      return (
        <span className={`file-visual folder-visual ${className ?? ""}`} style={{ width: size, height: size }}>
          <FolderIcon size={size} variant={resolvedFolderVariant} selected={selected} title={title} />
          <SymlinkBadge size={size} />
        </span>
      );
    }
    return (
      <FolderIcon
        size={size}
        variant={resolvedFolderVariant}
        selected={selected}
        className={className}
        title={title}
      />
    );
  }

  if (entry && applicationBundle && nativeIcon) {
    return (
      <span
        className={`file-visual native-app-art ${className ?? ""}`}
        style={{ width: size, height: size }}
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        data-file-kind="app"
      >
        <img src={nativeIcon} alt="" loading="lazy" decoding="async" draggable={false} />
        {entry.isSymlink ? <SymlinkBadge size={size} /> : null}
      </span>
    );
  }

  if (visual.kind === "app") {
    return <AppBundleArt size={size} className={className} symlink={entry?.isSymlink} title={title} />;
  }

  if (thumbnail && entry && visual.thumbnail && !entry.isSymlink) {
    return (
      <ThumbnailArt
        entry={entry}
        visual={visual}
        size={size}
        className={className}
        symlink={entry.isSymlink}
        title={title}
      />
    );
  }

  return (
    <PageArt
      visual={visual}
      size={size}
      className={className}
      symlink={entry?.isSymlink}
      title={title}
    />
  );
}
