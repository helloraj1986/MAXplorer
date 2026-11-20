import { useCallback, useEffect, useRef, useState } from "react";
import { MediaIcon } from "./icons";
import { MediaPosterCard } from "./MediaPosterCard";
import type { MediaCatalogMeta, WatchProgress } from "./types";

const SKELETON_COUNT = 6;

/**
 * Horizontal poster row (docs/MEDIA_UI_SPEC.md §3.2) — snap scrolling with an
 * edge fade, hover chevrons, per-row loading/error states, and roving tabindex
 * so a whole row is one tab stop (spec §8).
 */
export function MediaCarousel({
  heading,
  items,
  progress = {},
  loading = false,
  error = null,
  onSelect,
  onRetry,
  labelledBy,
}: {
  heading: string;
  items: MediaCatalogMeta[];
  progress?: Record<string, WatchProgress>;
  loading?: boolean;
  error?: string | null;
  onSelect: (meta: MediaCatalogMeta) => void;
  onRetry?: () => void;
  labelledBy?: string;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [overflowing, setOverflowing] = useState(false);
  const headingId = labelledBy ?? `media-row-${heading.replace(/\s+/g, "-").toLowerCase()}`;

  // Chevrons only exist when the strip actually overflows. jsdom reports 0/0, so
  // this stays false in unit tests by design.
  const measure = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    setOverflowing(strip.scrollWidth > strip.clientWidth + 4);
  }, []);

  useEffect(() => {
    measure();
    const strip = stripRef.current;
    if (!strip) return;
    // jsdom has no ResizeObserver (and no layout): overflow detection is a
    // progressive enhancement, not a requirement.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [measure, items.length]);

  const scrollByPage = (direction: 1 | -1) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({ left: direction * strip.clientWidth * 0.8, behavior: "smooth" });
  };

  const moveFocus = (next: number) => {
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    setFocusIndex(clamped);
    cardRefs.current[clamped]?.focus();
  };

  const skeletons = loading && items.length === 0;

  return (
    <section className="media-row" aria-labelledby={headingId}>
      <div className="media-row-head">
        <h3 id={headingId}>{heading}</h3>
      </div>

      {error ? (
        <p className="media-row-error" role="alert">
          {error}
          {onRetry ? (
            <button type="button" className="media-row-retry" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </p>
      ) : skeletons ? (
        <div className="media-strip media-strip-skeleton" aria-busy="true" aria-hidden="true">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <div className="media-card media-card-skeleton" key={index}>
              <div className="media-card-art" />
              <div className="media-card-caption-skeleton" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="media-empty">Nothing here yet.</p>
      ) : (
        <div className="media-strip-wrap">
          <div
            className="media-strip"
            ref={stripRef}
            data-overflowing={overflowing ? "true" : "false"}
            onKeyDown={(event) => {
              switch (event.key) {
                case "ArrowRight":
                  event.preventDefault();
                  moveFocus(focusIndex + 1);
                  break;
                case "ArrowLeft":
                  event.preventDefault();
                  moveFocus(focusIndex - 1);
                  break;
                case "Home":
                  event.preventDefault();
                  moveFocus(0);
                  break;
                case "End":
                  event.preventDefault();
                  moveFocus(items.length - 1);
                  break;
                default:
                  break;
              }
            }}
          >
            {items.map((meta, index) => (
              <MediaPosterCard
                key={meta.id}
                meta={meta}
                progress={progress[meta.id]}
                tabIndex={index === focusIndex ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                onSelect={() => onSelect(meta)}
                nodeRef={(node) => {
                  cardRefs.current[index] = node;
                }}
              />
            ))}
          </div>

          {overflowing ? (
            <>
              <button
                type="button"
                className="media-strip-nav prev"
                aria-label={`Scroll ${heading} left`}
                onClick={() => scrollByPage(-1)}
              >
                <MediaIcon name="chevron-left" size={20} />
              </button>
              <button
                type="button"
                className="media-strip-nav next"
                aria-label={`Scroll ${heading} right`}
                onClick={() => scrollByPage(1)}
              >
                <MediaIcon name="chevron-right" size={20} />
              </button>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
