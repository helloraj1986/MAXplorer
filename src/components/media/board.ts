import type { MediaCatalogMeta, WatchProgress } from "./types";

/**
 * Board helpers (docs/MEDIA_UI_SPEC.md §3) — pure functions so the hero meta
 * line, the `NEW` badge and the Continue-watching selection are unit-testable
 * without a DOM.
 */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cinemeta reports runtime as `173 min`. The reference hero reads `2h20min`, so
 * normalise to `2h53min` / `45min`; anything unparseable is dropped rather than
 * rendered raw.
 */
export function formatRuntime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hoursMatch = /^(\d+)\s*h(?:ours?)?(?:\s*(\d+)\s*m(?:in(?:utes?)?)?)?/i.exec(trimmed);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    const minutes = Number(hoursMatch[2] ?? 0);
    return minutes > 0 ? `${hours}h${minutes}min` : `${hours}h`;
  }
  const minutesMatch = /^(\d+)\s*(?:m|min|mins|minute|minutes)$/i.exec(trimmed);
  if (minutesMatch) {
    const total = Number(minutesMatch[1]);
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    if (hours === 0) return `${minutes}min`;
    return minutes > 0 ? `${hours}h${minutes}min` : `${hours}h`;
  }
  return null;
}

/** True when a title was released within the badge window (spec §3.3: < 30 days). */
export function isNew(released: string | null | undefined, now = Date.now()): boolean {
  if (!released) return false;
  const stamp = Date.parse(released);
  if (!Number.isFinite(stamp)) return false;
  const age = now - stamp;
  return age >= 0 && age < MONTH_MS;
}

export interface HeroMetaLine {
  /** Non-genre parts, joined with `·` in the UI. */
  parts: string[];
  /** The `[IMDb]` pill is rendered separately: it is a badge, not text. */
  imdb: boolean;
  genres: string;
}

/** `2026 · 2h20min · 6.1 · [IMDb] · R, Action, Crime` (spec §3.1). */
export function heroMetaLine(meta: MediaCatalogMeta): HeroMetaLine {
  const parts: string[] = [];
  if (meta.releaseInfo) parts.push(meta.releaseInfo);
  const runtime = formatRuntime(meta.runtime);
  if (runtime) parts.push(runtime);
  if (meta.imdbRating) parts.push(meta.imdbRating);
  return {
    parts,
    imdb: Boolean(meta.imdbRating),
    genres: (meta.genres ?? []).slice(0, 4).join(", "),
  };
}

/** Fraction watched, 0–1, or null when unknown. */
export function progressRatio(entry: WatchProgress | undefined): number | null {
  if (!entry || !(entry.duration > 0)) return null;
  const ratio = entry.position / entry.duration;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.min(1, ratio);
}

/** Spec §3.2: Continue watching keeps only > 2 % and < 95 % watched. */
export const CONTINUE_MIN_RATIO = 0.02;
export const CONTINUE_MAX_RATIO = 0.95;

export function inContinueWindow(entry: WatchProgress | undefined): boolean {
  const ratio = progressRatio(entry);
  if (ratio === null) return false;
  return ratio > CONTINUE_MIN_RATIO && ratio < CONTINUE_MAX_RATIO;
}

/**
 * Continue-watching row: the board's own progress entries joined to the loaded
 * catalog metas, most recent first. Entries whose title is not in a loaded
 * catalog are skipped — WP5's `library.json` will store the meta alongside the
 * position, which is what removes that limitation.
 */
export function continueWatching(
  metas: MediaCatalogMeta[],
  progress: Record<string, WatchProgress>,
): MediaCatalogMeta[] {
  const byId = new Map(metas.map((meta) => [meta.id, meta]));
  return Object.entries(progress)
    .filter(([id, entry]) => byId.has(id) && inContinueWindow(entry))
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .map(([id]) => byId.get(id))
    .filter((meta): meta is MediaCatalogMeta => Boolean(meta));
}

/** Flattens every loaded row's metas, deduped, preserving row order. */
export function allMetas(rows: { metas: MediaCatalogMeta[] }[]): MediaCatalogMeta[] {
  const seen = new Set<string>();
  const out: MediaCatalogMeta[] = [];
  for (const row of rows) {
    for (const meta of row.metas) {
      if (seen.has(meta.id)) continue;
      seen.add(meta.id);
      out.push(meta);
    }
  }
  return out;
}

/** `S3` chip label for a series the progress store knows a season for. */
export function seasonLabel(entry: WatchProgress | undefined): string | null {
  if (!entry?.season) return null;
  return `S${entry.season}`;
}

/**
 * Hero backdrop URL. Cinemeta hands back the `medium` variant of the metahub
 * art, which is a 1280×720 (and often very dark) crop — measurably wrong for a
 * full-bleed backdrop at 3000+ px, so upgrade to the `large` variant on that
 * host. Anything else is used as-is.
 */
export function heroBackdrop(meta: MediaCatalogMeta): string | null {
  const raw = meta.background ?? meta.poster ?? null;
  if (!raw) return null;
  return raw.replace(
    /^(https:\/\/images\.metahub\.space\/background\/)medium(\/)/i,
    "$1large$2",
  );
}

/** First letter of the title, for the no-poster fallback tile. */
export function initialOf(title: string): string {
  const letter = title.trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}
