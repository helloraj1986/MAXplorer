import type { FileEntry } from "../types";
import {
  appIconCacheSize,
  clearAppIconCache,
  isApplicationBundle,
  loadAppIcon,
  peekAppIcon,
} from "../appIcons";

/**
 * Native artwork is only requested for representations where the host actually
 * owns a distinct icon. Today that is macOS `.app` bundles; ordinary files keep
 * the deterministic registry artwork instead of spawning a filesystem lookup
 * for every row.
 */
export function isNativeIconCandidate(entry: FileEntry): boolean {
  return isApplicationBundle(entry);
}

/** Cached value, or `undefined` when a request has not been made yet. */
export function peekNativeIcon(path: string): string | null | undefined {
  return peekAppIcon(path);
}

/** Deduplicated, LRU-cached native icon lookup. Rejects to `null` on failure. */
export function loadNativeIcon(path: string): Promise<string | null> {
  return loadAppIcon(path);
}

export function nativeIconCacheSize(): number {
  return appIconCacheSize();
}

export function clearNativeIconCache(): void {
  clearAppIconCache();
}
