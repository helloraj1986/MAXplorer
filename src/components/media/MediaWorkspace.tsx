import { useMemo } from "react";
import { Icon } from "../Icon";
import { useMediaStore } from "../../state/mediaStore";
import { DEFAULT_MEDIA_CATALOGS, type MediaCatalogMeta } from "./types";

/**
 * Media workspace (phase 1): discover view backed by real Stremio addon
 * catalogs. Renders Cinemeta's trending movies and popular series with real
 * poster art. Playback, streams and the addon manager arrive in later phases.
 */
export function MediaWorkspace() {
  const manifest = useMediaStore((state) => state.manifest);
  const manifestLoading = useMediaStore((state) => state.manifestLoading);
  const manifestError = useMediaStore((state) => state.manifestError);
  const catalogs = useMediaStore((state) => state.catalogs);
  const closeWorkspace = useMediaStore((state) => state.closeWorkspace);
  const loadCatalog = useMediaStore((state) => state.loadCatalog);

  const rows = useMemo(() => {
    const wanted = DEFAULT_MEDIA_CATALOGS.map((entry) => `${entry.type}:${entry.id}`);
    const live = catalogs.filter((catalog) =>
      wanted.includes(`${catalog.type}:${catalog.id}`),
    );
    return wanted
      .map((key) => live.find((catalog) => `${catalog.type}:${catalog.id}` === key))
      .filter((catalog) => catalog !== undefined);
  }, [catalogs]);

  return (
    <section className="media-workspace" aria-label="Media">
      <header className="media-topbar">
        <div className="media-brand">
          <span className="media-brand-mark" aria-hidden="true" />
          <span>Media</span>
          <span className={`media-status ${manifest ? "ok" : "off"}`}>
            {manifest ? `${manifest.name} connected` : manifestLoading ? "Connecting…" : "Offline"}
          </span>
        </div>
        <button
          type="button"
          className="media-close"
          onClick={closeWorkspace}
          aria-label="Close media"
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="media-scroll">
        {manifestError ? (
          <div className="media-error" role="alert">
            <p>Couldn't reach the catalog addon.</p>
            <p className="media-error-detail">{manifestError}</p>
            <button
              type="button"
              className="media-retry"
              onClick={() => {
                for (const catalog of DEFAULT_MEDIA_CATALOGS) {
                  void loadCatalog(catalog.type, catalog.id, catalog.name);
                }
              }}
            >
              Retry
            </button>
          </div>
        ) : null}

        {rows.map((catalog) => (
          <div className="media-row" key={`${catalog.type}:${catalog.id}`}>
            <div className="media-row-head">
              <h3>{catalog.name}</h3>
              <span className="media-row-sub">
                {manifest?.name ?? "Cinemeta"} · catalog {catalog.id}
              </span>
            </div>
            {catalog.loading && catalog.metas.length === 0 ? (
              <div className="media-strip" aria-busy="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="media-card" key={index}>
                    <div className="media-poster media-poster-skeleton" />
                    <div className="media-skeleton-line" />
                  </div>
                ))}
              </div>
            ) : catalog.error ? (
              <p className="media-row-error">{catalog.error}</p>
            ) : (
              <div className="media-strip">
                {catalog.metas.map((meta) => (
                  <MediaCard key={meta.id} meta={meta} />
                ))}
              </div>
            )}
          </div>
        ))}

        {rows.length === 0 && !manifestError ? (
          <p className="media-empty">Loading catalogs…</p>
        ) : null}
      </div>
    </section>
  );
}

function MediaCard({ meta }: { meta: MediaCatalogMeta }) {
  const title = meta.name ?? meta.id;
  const metaBits = [meta.releaseInfo, meta.imdbRating ? `★ ${meta.imdbRating}` : null]
    .filter((bit): bit is string => Boolean(bit))
    .join(" · ");
  return (
    <article className="media-card" tabIndex={0}>
      {meta.poster ? (
        <img
          className="media-poster"
          src={meta.poster}
          alt=""
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div className="media-poster media-poster-fallback">
          <span>{title}</span>
        </div>
      )}
      <p className="media-card-title">{title}</p>
      {metaBits ? <p className="media-card-meta">{metaBits}</p> : null}
    </article>
  );
}
