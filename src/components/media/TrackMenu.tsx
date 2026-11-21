import { useEffect, useRef } from "react";
import type { PlayerTrack } from "./types";

/**
 * Audio / subtitle track menu (docs/MEDIA_LIBRARY_TRACKS_SPEC.md Phase 2).
 *
 * Pure: it never fetches. The caller hands it the tracks mpv reported and the
 * current selection, and it reports a click. Two menus share this component:
 * subtitles get an extra `Off` row first, audio does not (mpv has no "no audio").
 *
 * Keyboard (spec §Phase 2): opens with `A` (audio) / `S` (subtitles) in the
 * player, arrows move, Enter selects (native `<button>`), Esc closes. Every row
 * is a `role="menuitemradio"` with `aria-checked`, and the group is a single tab
 * stop — roving `tabIndex` within the menu.
 */

const LANGUAGE_NAMES: Record<string, string> = {
  eng: "English",
  en: "English",
  fra: "French",
  fre: "French",
  fr: "French",
  deu: "German",
  ger: "German",
  de: "German",
  spa: "Spanish",
  es: "Spanish",
  ita: "Italian",
  it: "Italian",
  jpn: "Japanese",
  ja: "Japanese",
  kor: "Korean",
  ko: "Korean",
  zho: "Chinese",
  chi: "Chinese",
  zh: "Chinese",
  rus: "Russian",
  ru: "Russian",
  hin: "Hindi",
  hi: "Hindi",
  tam: "Tamil",
  ta: "Tamil",
  tel: "Telugu",
  te: "Telugu",
  por: "Portuguese",
  pt: "Portuguese",
  ara: "Arabic",
  ar: "Arabic",
  nld: "Dutch",
  dut: "Dutch",
  nl: "Dutch",
  swe: "Swedish",
  sv: "Swedish",
  pol: "Polish",
  pl: "Polish",
  tur: "Turkish",
  tr: "Turkish",
  und: "Undetermined",
};

/** `eng` → `English`; anything unknown is shown as the raw code, uppercased. */
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code.trim().toLowerCase();
  if (!key) return null;
  return LANGUAGE_NAMES[key] ?? key.toUpperCase();
}

/** `English · EAC3 · 5.1` — the row's primary line. */
export function trackLabel(track: PlayerTrack): string {
  const language = languageName(track.lang) ?? track.title ?? `Track ${track.id}`;
  return [language, track.codec?.toUpperCase(), track.channels]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** `Default` / `Forced` / `External` markers; `Default` is only shown off-default rows. */
export function trackBadges(track: PlayerTrack): string[] {
  const badges: string[] = [];
  if (track.default) badges.push("Default");
  if (track.forced) badges.push("Forced");
  if (track.external) badges.push("External");
  return badges;
}

export interface TrackRow {
  /** `null` is the subtitle `Off` row; an audio track id otherwise. */
  id: number | null;
  key: string;
  label: string;
  badges: string[];
  checked: boolean;
}

/** Rows in menu order: `Off` first for subtitles, then mpv's own order. */
export function trackRows(
  kind: "audio" | "sub",
  tracks: PlayerTrack[],
  activeId: number | null,
): TrackRow[] {
  const ofKind = tracks.filter((track) => track.kind === kind);
  const rows: TrackRow[] = [];
  if (kind === "sub") {
    rows.push({
      id: null,
      key: "off",
      label: "Off",
      badges: [],
      checked: activeId === null,
    });
  }
  for (const track of ofKind) {
    rows.push({
      id: track.id,
      key: `${kind}-${track.id}`,
      label: trackLabel(track),
      badges: trackBadges(track),
      checked: activeId === track.id,
    });
  }
  return rows;
}

export function TrackMenu({
  kind,
  tracks,
  activeId,
  onSelect,
  onClose,
}: {
  kind: "audio" | "sub";
  tracks: PlayerTrack[];
  activeId: number | null;
  onSelect: (id: number | null) => void;
  onClose: () => void;
}) {
  const rows = trackRows(kind, tracks, activeId);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Focus the checked row (or the first one) when the menu opens, so arrow keys
  // and Enter work without a click.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const target =
      node.querySelector<HTMLButtonElement>('[data-track-row][aria-checked="true"]') ??
      node.querySelector<HTMLButtonElement>("[data-track-row]");
    target?.focus();
  }, []);

  const moveFocus = (step: number) => {
    const node = containerRef.current;
    if (!node) return;
    const items = Array.from(node.querySelectorAll<HTMLButtonElement>("[data-track-row]"));
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const next = (current + step + items.length) % items.length;
    items[next].focus();
  };

  if (rows.length === 0) return null;

  return (
    <div
      className="media-trackmenu"
      role="menu"
      aria-label={kind === "audio" ? "Audio tracks" : "Subtitles"}
      ref={containerRef}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          moveFocus(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          moveFocus(-1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {rows.map((row, index) => {
        const checkedIndex = rows.findIndex((entry) => entry.checked);
        const tabIndex = index === (checkedIndex >= 0 ? checkedIndex : 0) ? 0 : -1;
        return (
          <button
            key={row.key}
            type="button"
            role="menuitemradio"
            aria-checked={row.checked}
            tabIndex={tabIndex}
            data-track-row
            className={`media-trackmenu-row${row.checked ? " is-active" : ""}`}
            onClick={() => onSelect(row.id)}
          >
            <span className="media-trackmenu-label">{row.label}</span>
            {row.badges.map((badge) => (
              <span key={badge} className={`media-trackmenu-badge ${badge.toLowerCase()}`}>
                {badge}
              </span>
            ))}
            {row.checked ? (
              <span className="media-trackmenu-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}