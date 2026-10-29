import { useId } from "react";
import { AppIcon, type AppIconName } from "./AppIcon";

export type StorageVariant = "internal" | "external" | "removable" | "network" | "mounted" | "disconnected";
export type StorageStatus = "connected" | "disconnected";

export interface StorageIconProps {
  size?: number;
  variant?: StorageVariant;
  status?: StorageStatus;
  className?: string;
  title?: string;
}

const VARIANT_BADGES: Partial<Record<StorageVariant, AppIconName>> = {
  external: "usb",
  removable: "usb",
  network: "cloud",
  mounted: "check",
  disconnected: "cloudOff",
};

/**
 * Volume artwork. Connection state is rendered as a separate status dot so a
 * drive that is still listed but unavailable does not lose its identity.
 */
export function StorageIcon({
  size = 20,
  variant = "internal",
  status = "connected",
  className,
  title,
}: StorageIconProps) {
  const id = useId().replace(/:/g, "");
  const badge = VARIANT_BADGES[variant];
  const connected = status === "connected" && variant !== "disconnected";
  const badgeScale = size < 24 ? 1.3 : size < 32 ? 1.12 : 1;
  const statusScale = size < 24 ? 1.35 : 1;

  return (
    <svg
      className={`storage-icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-storage-variant={variant}
      data-storage-status={connected ? "connected" : "disconnected"}
      focusable="false"
    >
      <defs>
        <linearGradient id={`storage-body-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--storage-top)" />
          <stop offset="1" stopColor="var(--storage-bottom)" />
        </linearGradient>
      </defs>

      <ellipse cx="32" cy="53" rx="20" ry="4" fill="var(--file-page-shadow)" opacity=".35" />
      <rect
        x="8"
        y="14"
        width="48"
        height="34"
        rx="7"
        fill={`url(#storage-body-${id})`}
        stroke="var(--storage-stroke)"
        strokeWidth="1.2"
      />
      <rect x="12" y="18" width="40" height="7" rx="3" fill="var(--file-page-top)" opacity=".38" />
      <path d="M14 40h25" stroke="var(--storage-stroke)" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
      <circle
        cx="46"
        cy="40"
        r="2.4"
        fill={connected ? "var(--storage-led)" : "var(--storage-led-off)"}
      />

      {badge ? (
        <g transform={`translate(50 14) scale(${badgeScale}) translate(-50 -14)`}>
          <g transform="translate(38 2)">
            <circle cx="12" cy="12" r="12" fill="var(--accent-fill)" stroke="var(--surface)" strokeWidth="1.8" />
            <g transform="translate(6 6)">
              <AppIcon
                name={badge}
                size={12}
                strokeWidth={2.2}
                decorative
                style={{ color: "var(--accent-text)" }}
              />
            </g>
          </g>
        </g>
      ) : null}

      <g transform={`translate(51 48) scale(${statusScale}) translate(-51 -48)`}>
        <circle
          cx="51"
          cy="48"
          r="5"
          fill={connected ? "var(--success)" : "var(--danger)"}
          stroke="var(--surface)"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
}
