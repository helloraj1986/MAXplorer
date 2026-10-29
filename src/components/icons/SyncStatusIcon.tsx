import { AppIcon, type AppIconName } from "./AppIcon";

export type SyncState = "synced" | "syncing" | "pending" | "conflict" | "error" | "offline";

export interface SyncStatusIconProps {
  state: SyncState;
  size?: number;
  className?: string;
  title?: string;
  /** Defaults to true because status icons usually sit inside labelled controls. */
  decorative?: boolean;
}

const STATES: Record<SyncState, { icon: AppIconName; tone: "accent" | "success" | "warning" | "danger" | "muted"; label: string }> = {
  synced: { icon: "checkCircle", tone: "success", label: "Synced" },
  syncing: { icon: "sync", tone: "accent", label: "Syncing" },
  pending: { icon: "clock", tone: "warning", label: "Pending" },
  conflict: { icon: "alertCircle", tone: "warning", label: "Conflict" },
  error: { icon: "xCircle", tone: "danger", label: "Sync error" },
  offline: { icon: "cloudOff", tone: "muted", label: "Offline" },
};

/**
 * Status indicator for real transfer/synchronisation state. The application has
 * no background file-sync engine, so this is only rendered from actual transfer
 * state; it never fabricates a synced state.
 */
export function SyncStatusIcon({
  state,
  size = 14,
  className,
  title,
  decorative = true,
}: SyncStatusIconProps) {
  const definition = STATES[state];
  return (
    <span
      className={`sync-status-icon sync-status-${state} ${className ?? ""}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title ?? definition.label}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : title ?? definition.label}
    >
      <AppIcon
        name={definition.icon}
        size={size}
        tone={definition.tone}
        strokeWidth={state === "syncing" ? 2 : 1.9}
        className={state === "syncing" ? "spin" : undefined}
        decorative
      />
    </span>
  );
}
