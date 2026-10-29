import { assetUrl } from "../api";
import type { FileEntry } from "../types";
import { fileVisualForEntry, isThumbnailCandidate } from "./fileIconRegistry";

/**
 * Lightweight thumbnail policy for the asset protocol already used by the app.
 *
 * The webview performs the actual lazy fetch (`loading="lazy"`), so directory
 * enumeration never blocks. This module remembers failures so a corrupt or
 * unreadable image is not retried on every virtual-row remount, and keeps the
 * URL cache bounded for very large folders.
 */
export const THUMBNAIL_CACHE_LIMIT = 512;
export const THUMBNAIL_FAILURE_LIMIT = 1024;

const urlCache = new Map<string, string>();
const failed = new Set<string>();

export function thumbnailUrlForEntry(entry: FileEntry): string | null {
  if (entry.isDir || entry.isSymlink) return null;
  const visual = fileVisualForEntry(entry);
  if (!isThumbnailCandidate(visual)) return null;

  const cached = urlCache.get(entry.path);
  if (cached) {
    // Refresh LRU order.
    urlCache.delete(entry.path);
    urlCache.set(entry.path, cached);
    return cached;
  }

  const url = assetUrl(entry.path);
  urlCache.set(entry.path, url);
  if (urlCache.size > THUMBNAIL_CACHE_LIMIT) {
    const oldest = urlCache.keys().next().value;
    if (oldest !== undefined) urlCache.delete(oldest);
  }
  return url;
}

export function isThumbnailFailed(path: string): boolean {
  return failed.has(path);
}

export function markThumbnailFailed(path: string): void {
  failed.add(path);
  if (failed.size > THUMBNAIL_FAILURE_LIMIT) {
    const oldest = failed.values().next().value;
    if (oldest !== undefined) failed.delete(oldest);
  }
}

export function clearThumbnailCache(): void {
  urlCache.clear();
  failed.clear();
}

export function thumbnailCacheSize(): number {
  return urlCache.size;
}

export function thumbnailFailureCount(): number {
  return failed.size;
}
