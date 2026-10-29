import type { CSSProperties } from "react";
import {
  AppIcon,
  type AppIconName,
  type AppIconTone,
} from "./icons/AppIcon";

/**
 * Backwards-compatible facade over the central `AppIcon` component. Existing
 * chrome uses the semantic `Icon` API; new code can import `AppIcon` directly.
 */
export type IconName = AppIconName;

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
  title?: string;
  decorative?: boolean;
  tone?: AppIconTone;
  disabled?: boolean;
}

export function Icon({ name, size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
  return <AppIcon name={name} size={size} strokeWidth={strokeWidth} {...rest} />;
}
