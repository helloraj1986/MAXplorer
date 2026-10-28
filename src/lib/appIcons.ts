import { api } from "./api";
import type { FileEntry } from "./types";

/**
 * macOS application bundles are directories, so the file list shows them as
 * folders. Their real icon lives inside the bundle (`Contents/Resources`), and
 * the Rust backend converts it to a PNG data URL. Results are cached here so
 * scrolling a large `/Applications` folder does not re-request icons.
 */
export const APP_ICON_CACHE_LIMIT = 256;

interface CacheEntry {
  promise: Promise<string | null>;
  /** Set once the request settles, so remounted rows paint without a flash. */
  value?: string | null;
}

const cache = new Map<string, CacheEntry>();

export function isApplicationBundle(entry: FileEntry): boolean {
  return entry.isDir && entry.name.toLowerCase().endsWith(".app");
}

/** Returns the resolved icon, `null` if it has none, or `undefined` if unknown. */
export function peekAppIcon(path: string): string | null | undefined {
  return cache.get(path)?.value;
}

export function loadAppIcon(path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached) {
    // Refresh insertion order so the least recently used icon is evicted.
    cache.delete(path);
    cache.set(path, cached);
    return cached.promise;
  }

  const entry: CacheEntry = { promise: Promise.resolve(null) };
  entry.promise = api
    .readAppIcon(path)
    .then((value) => {
      entry.value = value;
      return value;
    })
    .catch(() => {
      entry.value = null;
      return null;
    });
  cache.set(path, entry);
  if (cache.size > APP_ICON_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return entry.promise;
}

export function clearAppIconCache(): void {
  cache.clear();
}

export function appIconCacheSize(): number {
  return cache.size;
}
