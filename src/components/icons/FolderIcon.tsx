import { useId } from "react";
import { useExplorerStore } from "../../state/explorerStore";
import { AppIcon, type AppIconName } from "./AppIcon";

export type FolderVariant =
  | "standard"
  | "open"
  | "shared"
  | "favorite"
  | "downloads"
  | "network"
  | "synced"
  | "special";

export interface FolderIconProps {
  size?: number;
  variant?: FolderVariant;
  selected?: boolean;
  className?: string;
  title?: string;
  /** Optional Lucide badge override for location-specific source lists. */
  badge?: AppIconName;
}

const VARIANT_BADGES: Partial<Record<FolderVariant, AppIconName>> = {
  shared: "share",
  favorite: "star",
  downloads: "downloads",
  network: "network",
  synced: "check",
  special: "star",
};

/**
 * Lightweight, name-based affordances for ordinary folders. These are visual
 * hints only; no filesystem or sync state is inferred from them.
 */
export function folderVariantForName(name: string): FolderVariant {
  const lower = name.trim().toLowerCase();
  if (lower === "downloads" || lower === "download") return "downloads";
  if (lower === "shared" || lower === "public" || lower === "share") return "shared";
  if (lower === "network" || lower === "networks") return "network";
  if (lower === "favorites" || lower === "favourites") return "favorite";
  return "standard";
}

/**
 * Theme-aware folder artwork. Windows uses the familiar gold folder; the
 * Finder interface uses macOS-style blue source-list folders. The same
 * component supports open, selected, shared and special-location states
 * without changing any filesystem behavior.
 */
export function FolderIcon({
  size = 20,
  variant = "standard",
  selected = false,
  className,
  title,
  badge,
}: FolderIconProps) {
  const id = useId().replace(/:/g, "");
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const resolvedBadge = badge ?? VARIANT_BADGES[variant];
  const open = variant === "open";
  const badgeScale = size < 24 ? 1.35 : size < 32 ? 1.15 : 1;

  return (
    <svg
      className={`folder-icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-folder-theme={interfaceTheme}
      data-folder-variant={variant}
      focusable="false"
    >
      <defs>
        <linearGradient id={`folder-back-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--folder-back-top)" />
          <stop offset="1" stopColor="var(--folder-back-bottom)" />
        </linearGradient>
        <linearGradient id={`folder-front-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--folder-front-top)" />
          <stop offset="1" stopColor="var(--folder-front-bottom)" />
        </linearGradient>
      </defs>

      {selected ? (
        <rect
          x="3.5"
          y="7.5"
          width="57"
          height="53"
          rx="10"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.4"
          opacity=".9"
        />
      ) : null}

      <path
        d="M6 17.2c0-2.1 1.7-3.8 3.8-3.8h15.6c1.1 0 2.2.5 2.9 1.3l4.1 4.3H54c2.1 0 3.8 1.7 3.8 3.8v29.4c0 2.1-1.7 3.8-3.8 3.8H9.8c-2.1 0-3.8-1.7-3.8-3.8z"
        fill={`url(#folder-back-${id})`}
        stroke="var(--folder-stroke)"
        strokeWidth="1"
      />

      {open ? (
        <path
          d="M9 26.5h46l-4.5 10H13.5z"
          fill="var(--folder-back-bottom)"
          opacity=".5"
        />
      ) : null}

      <g transform={open ? "translate(0 6) rotate(-4 32 42)" : undefined}>
        <path
          d="M6 27.4c0-2.1 1.7-3.8 3.8-3.8h44.4c2.1 0 3.8 1.7 3.8 3.8v23.2c0 2.1-1.7 3.8-3.8 3.8H9.8c-2.1 0-3.8-1.7-3.8-3.8z"
          fill={`url(#folder-front-${id})`}
          stroke="var(--folder-stroke)"
          strokeWidth="1"
        />
        <path
          d="M8.6 27.8h46.8"
          stroke="var(--folder-shine)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </g>

      {resolvedBadge ? (
        <g transform={`translate(53 52) scale(${badgeScale}) translate(-53 -52)`}>
          <g transform="translate(42 41)">
            <circle cx="11" cy="11" r="11" fill="var(--accent-fill)" stroke="var(--surface)" strokeWidth="1.6" />
            <g transform="translate(5 5)">
              <AppIcon
                name={resolvedBadge}
                size={12}
                strokeWidth={2.2}
                decorative
                style={{ color: "var(--accent-text)" }}
              />
            </g>
          </g>
        </g>
      ) : null}
    </svg>
  );
}
