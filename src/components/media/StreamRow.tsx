import { useEffect, useRef } from "react";
import { api, normalizeError } from "../../lib/api";
import { useExplorerStore } from "../../state/explorerStore";
import { useMediaStore } from "../../state/mediaStore";
import { MediaIcon } from "./icons";
import type { RankedStream, StreamLanguageFlag } from "./types";
import { formatSize } from "./format";

/**
 * One 7-line stream row (docs/MEDIA_UI_SPEC.md §4.3, `crop-stream-row.png`).
 *
 * Lines, in the reference's order:
 *  1 quality + HDR/DV badges            (right: the play circle)
 *  2 release name                       (⌁ group glyph)
 *  3 source · codec · runtime
 *  4 audio format · channels · audio-language flags
 *  5 subtitle-language flags (omitted when the addon says nothing)
 *  6 size · bitrate
 *  7 availability (engine state) · provider
 *
 * The whole row is one click target: a transparent overlay `<button>` covers it,
 * so the row is a single tab stop and `Enter` plays — never a button nested in
 * another interactive element. Engine failures turn line 7 red and fire one toast.
 */
export function StreamRow({ ranked, metaId }: { ranked: RankedStream; metaId: string }) {
  const toast = useExplorerStore((state) => state.toast);
  const openPlayer = useMediaStore((state) => state.openPlayer);
  const streamTorrent = useMediaStore((state) => state.streamTorrent);
  const engine = useMediaStore((state) => state.engine);

  const facts = ranked.facts;
  const title = facts.release ?? ranked.label;
  const hash = ranked.stream.infoHash ?? null;
  const direct = ranked.direct;
  const resolving = Boolean(engine && hash && engine.phase === "resolving" && engine.infoHash === hash);
  const ready = Boolean(engine && hash && engine.phase === "ready" && engine.infoHash === hash);
  const engineError =
    engine && hash && engine.phase === "error" && engine.infoHash === hash
      ? engine.error ?? "Unknown engine error"
      : null;
  const lastError = useRef<string | null>(null);

  // The engine reports failures asynchronously (invalid hash, no peers); without
  // this the row would sit silent while the swarm does nothing.
  useEffect(() => {
    if (engineError && lastError.current !== engineError) {
      lastError.current = engineError;
      toast({ title: "Torrent stream failed", detail: engineError, tone: "error" });
    }
    if (!engineError) lastError.current = null;
  }, [engineError, toast]);

  const play = () => {
    if (engineError) {
      // Re-arm the same row: a retry is the only useful action after a failure.
      lastError.current = null;
    }
    if (direct && ranked.stream.url) {
      openPlayer(ranked.stream.url, title, metaId, ranked.qualityBadge);
      return;
    }
    if (hash) void streamTorrent(hash, title, metaId, ranked.qualityBadge);
  };

  const playExternal = async () => {
    if (!direct || !ranked.stream.url) return;
    try {
      const result = await api.playMediaStream(ranked.stream.url);
      toast({
        title: "Playing in external player",
        detail: `Player: ${result.player} · ${title}`,
        tone: "success",
      });
    } catch (error) {
      toast({ title: "Playback failed", detail: normalizeError(error).message, tone: "error" });
    }
  };

  const availability = engineError
    ? { tone: "error" as const, icon: "🚫" }
    : ready
      ? { tone: "good" as const, icon: "⚡" }
      : resolving
        ? { tone: "warn" as const, icon: "⏳" }
        : { tone: "plain" as const, icon: facts.peers ? "👤" : "⚡" };

  return (
    <li
      className={[
        "media-stream-row",
        ranked.direct ? "is-direct" : "is-torrent",
        resolving ? "is-resolving" : "",
        engineError ? "is-error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="media-stream-lines">
        <div
          className="media-stream-line media-stream-line-top"
          title={`Rank ${ranked.rank} · ${ranked.qualityBadge ?? "unknown quality"} · ${
            ranked.direct ? "direct" : "torrent"
          }`}
        >
          <LineGlyph name="quality" label="Quality" size={14} />
          {ranked.qualityBadge ? (
            <span className="media-stream-quality">{ranked.qualityBadge}</span>
          ) : null}
          {facts.hdr.includes("DV") ? (
            <span className="media-stream-hdr dv" title="Dolby Vision">
              <span className="media-stream-dot" aria-hidden="true" />
              DV
            </span>
          ) : null}
          {facts.hdr
            .filter((tag) => tag !== "DV")
            .map((tag) => (
              <span key={tag} className="media-stream-hdr" title={tag}>
                {tag}
              </span>
            ))}
          <span className="media-stream-rank">#{ranked.rank}</span>
        </div>

        <div className="media-stream-line media-stream-line-release" title={title}>
          <MediaIcon name="chevron-right" size={12} strokeWidth={2.4} className="media-stream-glyph" />
          <span className="media-stream-release-text">{title}</span>
        </div>

        <div className="media-stream-line">
          <LineGlyph name="source" label="Source" />
          <span>{facts.source ?? (direct ? "Direct" : "Torrent")}</span>
          {facts.codec ? (
            <>
              <LineGlyph name="codec" label="Codec" />
              <span>{facts.codec}</span>
            </>
          ) : null}
          {facts.runtime ? (
            <>
              <LineGlyph name="clock" label="Runtime" />
              <span>{facts.runtime}</span>
            </>
          ) : null}
        </div>

        {facts.audio.length > 0 || facts.channels || facts.audioLangs.length > 0 ? (
          <div className="media-stream-line">
            {facts.audio.length > 0 ? (
              <>
                <LineGlyph name="music" label="Audio format" />
                <span>{facts.audio.join(" | ")}</span>
              </>
            ) : null}
            {facts.channels ? (
              <>
                <LineGlyph name="channels" label="Channels" />
                <span>{facts.channels}</span>
              </>
            ) : null}
            {facts.audioLangs.length > 0 ? <LanguageFlags flags={facts.audioLangs} /> : null}
          </div>
        ) : null}

        {facts.subLangs.length > 0 ? (
          <div className="media-stream-line media-stream-line-subs">
            <LineGlyph name="subtitles" label="Subtitle languages" size={13} />
            <LanguageFlags flags={facts.subLangs} />
          </div>
        ) : null}

        <div className="media-stream-line">
          <LineGlyph name="size" label="Size" />
          <span>{ranked.sizeBytes ? formatSize(ranked.sizeBytes) : "—"}</span>
          {facts.bitrateMbps !== null ? (
            <>
              <LineGlyph name="bitrate" label="Bitrate" />
              <span>{facts.bitrateMbps} Mbps</span>
            </>
          ) : null}
        </div>

        <div className={`media-stream-line media-stream-line-avail ${availability.tone}`}>
          <span className="media-stream-avail-icon" aria-hidden="true">
            {availability.icon}
          </span>
          {engineError ? (
            <span className="media-stream-error" role="alert">
              {engineError}
            </span>
          ) : (
            <span>
              {resolving
                ? `Starting engine · ${Math.round((engine?.progress ?? 0) * 100)} % · ${(
                    engine?.speed ?? 0
                  ).toFixed(1)} MB/s · ${peerLabel(engine?.peers ?? 0)}`
                : ready
                  ? "Ready (engine)"
                  : facts.peers
                    ? peerLabel(facts.peers)
                    : "Torrent"}
            </span>
          )}
          {facts.provider && !resolving && !engineError ? (
            <span className="media-stream-provider">
              <MediaIcon name="addons" size={12} strokeWidth={2} />
              {facts.provider}
            </span>
          ) : null}
        </div>
      </div>

      <div className="media-stream-side">
        <span className="media-stream-play" aria-hidden="true">
          <MediaIcon name="play" size={16} strokeWidth={0} />
        </span>
        {direct ? (
          <button
            type="button"
            className="media-stream-external"
            onClick={(event) => {
              event.stopPropagation();
              void playExternal();
            }}
            aria-label={`Open ${title} in an external player`}
            title="Open in an external player (VLC / IINA / mpv)"
          >
            <MediaIcon name="external" size={14} />
          </button>
        ) : null}
      </div>

      {/* One click target and one tab stop for the whole row. */}
      <button
        type="button"
        className="media-stream-hit"
        onClick={play}
        aria-label={`Play ${title}`}
        aria-describedby={undefined}
        disabled={resolving}
      />
    </li>
  );
}

/** `1 peer` / `132 peers` — the row shows a count, never a faked split. */
function peerLabel(count: number): string {
  return count === 1 ? "1 peer" : `${count} peers`;
}

function LineGlyph({
  name,
  label,
  size = 13,
}: {
  name: Parameters<typeof MediaIcon>[0]["name"];
  label: string;
  size?: number;
}) {
  return (
    <span className="media-stream-glyph" aria-hidden="true" title={label}>
      <MediaIcon name={name} size={size} strokeWidth={1.7} />
    </span>
  );
}

/** 16×11 language tiles driven by the addon's flag emoji — no emoji fonts. */
function LanguageFlags({ flags }: { flags: StreamLanguageFlag[] }) {
  return (
    <span className="media-stream-langs">
      {flags.map((flag) => (
        <span
          key={flag.code}
          className="media-langflag"
          data-flag={flag.code}
          title={flag.label}
          aria-label={flag.label}
          role="img"
        >
          {flag.code}
        </span>
      ))}
    </span>
  );
}