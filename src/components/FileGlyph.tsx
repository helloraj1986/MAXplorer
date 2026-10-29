import { useEffect, useId, useState } from "react";
import type { FileEntry } from "../lib/types";
import { assetUrl } from "../lib/api";
import { isApplicationBundle, loadAppIcon, peekAppIcon } from "../lib/appIcons";
import { fileCategory, extensionOf, isImageEntry, type FileCategory } from "../lib/format";

function PageShape({
  gradientId,
  accent,
  children,
}: {
  gradientId: string;
  accent: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e9edf2" />
        </linearGradient>
      </defs>
      <path
        d="M14 5.5h24.5L50 17v41.5H14z"
        fill={`url(#${gradientId})`}
        stroke="rgba(0,0,0,.18)"
        strokeWidth="1"
      />
      <path d="M38.5 5.5V17H50" fill="#d7dde5" stroke="rgba(0,0,0,.12)" strokeWidth="1" />
      <path d="M14 48.5h36V58H14z" fill={accent} opacity=".95" />
      {children}
    </>
  );
}

function FolderShape({ gradientId }: { gradientId: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${gradientId}-back`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7C948" />
          <stop offset="1" stopColor="#E4A11B" />
        </linearGradient>
        <linearGradient id={`${gradientId}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFDE7A" />
          <stop offset="1" stopColor="#F5B93D" />
        </linearGradient>
      </defs>
      <path
        d="M6 16.5c0-1.7 1.3-3 3-3h15.2c.8 0 1.6.3 2.1.9l4.4 4.6H55c1.7 0 3 1.3 3 3v31c0 1.7-1.3 3-3 3H9c-1.7 0-3-1.3-3-3z"
        fill={`url(#${gradientId}-back)`}
        stroke="rgba(116,74,0,.22)"
        strokeWidth="1"
      />
      <path
        d="M6 27c0-1.7 1.3-3 3-3h46c1.7 0 3 1.3 3 3v25.5c0 1.7-1.3 3-3 3H9c-1.7 0-3-1.3-3-3z"
        fill={`url(#${gradientId}-front)`}
        stroke="rgba(116,74,0,.24)"
        strokeWidth="1"
      />
      <path d="M8 27.5h48" stroke="#fff" strokeOpacity=".28" strokeWidth="2" />
    </>
  );
}

function AppBundleShape({ gradientId }: { gradientId: string }) {
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e4ebf3" />
        </linearGradient>
      </defs>
      <rect
        x="6"
        y="6"
        width="52"
        height="52"
        rx="12"
        fill={`url(#${gradientId})`}
        stroke="rgba(0,0,0,.18)"
        strokeWidth="1"
      />
      <rect x="14" y="15" width="36" height="28" rx="3.5" fill="#0f6cbd" opacity=".16" />
      <path d="M14 21h36" stroke="#0f6cbd" strokeWidth="2" opacity=".5" />
      <circle cx="19" cy="18" r="1.3" fill="#0f6cbd" opacity=".7" />
      <circle cx="24" cy="18" r="1.3" fill="#0f6cbd" opacity=".5" />
      <path d="M20 28h24M20 33h17M20 38h21" stroke="#0f6cbd" strokeWidth="1.6" opacity=".55" />
      <path d="M24 49h16" stroke="#0f6cbd" strokeWidth="2.4" strokeLinecap="round" opacity=".35" />
    </>
  );
}

function Badge({ accent, label }: { accent: string; label: string }) {
  return (
    <>
      <rect x="30" y="41" width="21" height="15" rx="2" fill={accent} />
      <text
        x="40.5"
        y="52.3"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fontFamily="Segoe UI, sans-serif"
        fill="#fff"
      >
        {label}
      </text>
    </>
  );
}

function categoryArt(category: FileCategory, accent: string): React.ReactNode {
  switch (category) {
    case "image":
      return (
        <>
          <rect x="20" y="24" width="24" height="18" rx="1.5" fill="#0F6CBD" opacity=".12" />
          <circle cx="27" cy="30" r="2.2" fill="#0F6CBD" />
          <path d="m21 40 7-7 5 5 3.5-3.5 6.5 5.5" fill="none" stroke="#0F6CBD" strokeWidth="2" />
        </>
      );
    case "video":
      return <path d="m30 27 11 7.5L30 42z" fill="#6b3fa0" />;
    case "audio":
      return (
        <>
          <path d="M29 42V25l13-3.5v16" fill="none" stroke="#b3326b" strokeWidth="2" />
          <circle cx="25.5" cy="42" r="4" fill="#b3326b" />
          <circle cx="38.5" cy="38.5" r="4" fill="#b3326b" />
        </>
      );
    case "archive":
      return (
        <>
          <path d="M38 18v6M42 20v6M38 28v6M42 30v6M38 36v6M42 38v6" stroke="#7a5b2e" strokeWidth="2" />
          <rect x="36.5" y="44" width="7" height="7" rx="1" fill="#7a5b2e" />
        </>
      );
    case "executable":
      return (
        <>
          <rect x="21" y="24" width="20" height="14" rx="1.5" fill="#0f548c" opacity=".14" />
          <path d="M21 28h20M24 26.5h1.5M27 26.5h1.5" stroke="#0f548c" strokeWidth="1.5" />
          <path d="m27 32 3 2-3 2" fill="none" stroke="#0f548c" strokeWidth="1.6" />
        </>
      );
    case "code":
      return (
        <path
          d="m27 28-5 6 5 6M35 28l5 6-5 6"
          fill="none"
          stroke={accent}
          strokeWidth="2"
          strokeLinecap="round"
        />
      );
    case "font":
      return (
        <text x="32" y="44" textAnchor="middle" fontSize="22" fontWeight="600" fill={accent} fontFamily="Georgia, serif">
          A
        </text>
      );
    case "sheet":
      return (
        <>
          <rect x="21" y="24" width="22" height="18" rx="1" fill="#1e7145" opacity=".12" />
          <path d="M21 30h22M21 36h22M28 24v18M35 24v18" stroke="#1e7145" strokeWidth="1.4" />
        </>
      );
    case "slides":
      return (
        <>
          <rect x="21" y="23" width="22" height="14" rx="1.5" fill="#c25100" opacity=".14" />
          <path d="M32 37v5M27 42h10" stroke="#c25100" strokeWidth="1.6" />
        </>
      );
    case "document":
      return (
        <>
          <path d="M23 27h13M23 31h16M23 35h14M23 39h9" stroke="#1f5a99" strokeWidth="1.6" />
        </>
      );
    case "text":
      return (
        <>
          <path d="M23 27h17M23 31h18M23 35h12M23 39h17" stroke="#5c6670" strokeWidth="1.6" />
        </>
      );
    default:
      return (
        <>
          <path d="M23 27h17M23 31h18M23 35h12" stroke="#6b737b" strokeWidth="1.6" />
        </>
      );
  }
}

export interface FileGlyphProps {
  entry?: FileEntry;
  category?: FileCategory;
  size?: number;
  thumbnail?: boolean;
  className?: string;
}

export function FileGlyph({ entry, category, size = 20, thumbnail = false, className }: FileGlyphProps) {
  const id = useId().replace(/:/g, "");
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const resolvedCategory = category ?? (entry ? fileCategory(entry) : "file");
  const applicationBundle = entry ? isApplicationBundle(entry) : false;
  const entryPath = entry?.path;
  const [appIcon, setAppIcon] = useState<string | null>(() =>
    entryPath && applicationBundle ? (peekAppIcon(entryPath) ?? null) : null,
  );

  useEffect(() => {
    if (!entryPath || !applicationBundle) {
      setAppIcon(null);
      return;
    }
    const cached = peekAppIcon(entryPath);
    if (cached !== undefined) {
      setAppIcon(cached);
      return;
    }
    let active = true;
    setAppIcon(null);
    void loadAppIcon(entryPath).then((url) => {
      if (active) setAppIcon(url);
    });
    return () => {
      active = false;
    };
  }, [entryPath, applicationBundle]);

  if (entry && applicationBundle && appIcon) {
    return (
      <span className={`file-glyph app-icon ${className ?? ""}`} style={{ width: size, height: size }}>
        <img src={appIcon} alt="" draggable={false} />
        {entry.isSymlink ? <span className="symlink-badge" /> : null}
      </span>
    );
  }

  if (entry && applicationBundle) {
    return (
      <svg
        className={`file-glyph ${className ?? ""}`}
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
      >
        <AppBundleShape gradientId={`app-${id}`} />
        {entry.isSymlink ? (
          <g>
            <rect x="2" y="44" width="18" height="16" rx="3" fill="#0F6CBD" stroke="#fff" strokeWidth="1.5" />
            <path d="M7 55h7M11 51l4 4-4 4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </g>
        ) : null}
      </svg>
    );
  }

  if (entry && thumbnail && isImageEntry(entry) && !entry.isSymlink && !thumbnailFailed) {
    return (
      <span className={`file-glyph thumbnail ${className ?? ""}`} style={{ width: size, height: size }}>
        <img
          src={assetUrl(entry.path)}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setThumbnailFailed(true)}
        />
        {entry.isSymlink ? <span className="symlink-badge" /> : null}
      </span>
    );
  }

  if (resolvedCategory === "folder") {
    return (
      <svg
        className={`file-glyph ${className ?? ""}`}
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        style={entry?.isSymlink ? { opacity: 0.92 } : undefined}
      >
        <FolderShape gradientId={`folder-${id}`} />
        {entry?.isSymlink ? (
          <g>
            <rect x="2" y="44" width="18" height="16" rx="3" fill="#0F6CBD" stroke="#fff" strokeWidth="1.5" />
            <path d="M7 55h7M11 51l4 4-4 4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </g>
        ) : null}
      </svg>
    );
  }

  const pdf = resolvedCategory === "pdf";
  const extension = entry ? extensionOf(entry.name) : "";
  const accent =
    pdf
      ? "#C42B1C"
      : resolvedCategory === "archive"
        ? "#8a6a3a"
        : resolvedCategory === "image"
          ? "#0F6CBD"
          : resolvedCategory === "video"
            ? "#6b3fa0"
            : resolvedCategory === "audio"
              ? "#b3326b"
              : resolvedCategory === "sheet"
                ? "#1e7145"
                : resolvedCategory === "slides"
                  ? "#c25100"
                  : "#1f5a99";

  return (
    <svg
      className={`file-glyph ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <PageShape gradientId={`page-${id}`} accent={accent}>
        {pdf ? <Badge accent="#C42B1C" label="PDF" /> : null}
        {resolvedCategory === "archive" ? <Badge accent="#8a6a3a" label="ZIP" /> : null}
        {resolvedCategory === "executable" ? <Badge accent="#0f548c" label="EXE" /> : null}
        {resolvedCategory === "document" ? <Badge accent="#1f5a99" label="W" /> : null}
        {resolvedCategory === "sheet" ? <Badge accent="#1e7145" label="X" /> : null}
        {resolvedCategory === "slides" ? <Badge accent="#c25100" label="P" /> : null}
        {resolvedCategory === "video" ? <Badge accent="#6b3fa0" label="VID" /> : null}
        {resolvedCategory === "audio" ? <Badge accent="#b3326b" label="AUD" /> : null}
        {resolvedCategory === "code" ? (
          <Badge accent="#4b5563" label={extension.slice(0, 2).toUpperCase() || "SRC"} />
        ) : null}
        {categoryArt(resolvedCategory, accent)}
        {entry?.isSymlink ? (
          <g>
            <rect x="2" y="44" width="18" height="16" rx="3" fill="#0F6CBD" stroke="#fff" strokeWidth="1.5" />
            <path d="M7 55h7M11 51l4 4-4 4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </g>
        ) : null}
        {!pdf &&
        resolvedCategory !== "archive" &&
        resolvedCategory !== "executable" &&
        resolvedCategory !== "image" &&
        resolvedCategory !== "video" &&
        resolvedCategory !== "audio" &&
        resolvedCategory !== "sheet" &&
        resolvedCategory !== "slides" &&
        resolvedCategory !== "document" &&
        resolvedCategory !== "text" &&
        resolvedCategory !== "code" &&
        resolvedCategory !== "font" ? (
          <text
            x="32"
            y="46"
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill="#5c6670"
            fontFamily="Segoe UI, sans-serif"
          >
            {extension.slice(0, 4).toUpperCase()}
          </text>
        ) : null}
      </PageShape>
    </svg>
  );
}
