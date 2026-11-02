import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { api } from "../../lib/api";
import { copyTextToClipboard } from "../../lib/clipboard";
import { formatSize } from "../../lib/format";
import { highlight } from "../../lib/preview/highlight";
import type { PreviewToken } from "../../lib/preview/highlight";
import type {
  FileEntry,
  PreviewMetadata,
  PreviewPreferences,
  TextRangePreview,
} from "../../lib/types";

interface MatchState {
  tokens: PreviewToken[];
  matches: number;
}

function withQuery(tokens: PreviewToken[], query: string): MatchState {
  if (!query) return { tokens, matches: 0 };
  const needle = query.toLowerCase();
  let matches = 0;
  const output: PreviewToken[] = [];
  for (const token of tokens) {
    const lower = token.text.toLowerCase();
    let start = 0;
    let index = lower.indexOf(needle, start);
    if (index === -1) {
      output.push(token);
      continue;
    }
    while (index !== -1) {
      if (index > start) {
        output.push({ text: token.text.slice(start, index), type: token.type });
      }
      output.push({ text: token.text.slice(index, index + query.length), type: "mark" });
      matches += 1;
      start = index + query.length;
      index = lower.indexOf(needle, start);
    }
    if (start < token.text.length) {
      output.push({ text: token.text.slice(start), type: token.type });
    }
  }
  return { tokens: output, matches };
}

function isMatchToken(token: PreviewToken): boolean {
  return (token.type as string) === "mark";
}

export function PreviewText({
  entry,
  metadata,
  text,
  language,
  preferences,
}: {
  entry: FileEntry;
  metadata: PreviewMetadata;
  text: TextRangePreview;
  language: string;
  preferences: PreviewPreferences;
}) {
  const [chunks, setChunks] = useState<TextRangePreview[]>([text]);
  const [loading, setLoading] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    setChunks([text]);
    setQuery("");
    setError(null);
    cancelRef.current = true;
    return () => {
      cancelRef.current = true;
    };
  }, [entry.path, text]);

  const combined = useMemo(
    () =>
      chunks
        .map((chunk) => chunk.text)
        .join(""),
    [chunks],
  );
  const nextOffset = chunks[chunks.length - 1]?.nextOffset ?? text.nextOffset;
  const truncated = chunks[chunks.length - 1]?.truncated ?? text.truncated;
  const decodedPlist = chunks.some((chunk) => chunk.decodedPlist);
  const previewLimitReached = combined.length >= 8 * 1024 * 1024;
  const tokens = useMemo(() => highlight(combined, language), [combined, language]);
  const matched = useMemo(() => withQuery(tokens, query.trim()), [query, tokens]);
  const lineCount = useMemo(() => combined.split("\n").length, [combined]);
  const showLineNumbers = !wrap && lineCount <= 20_000;

  const loadMore = useCallback(async () => {
    if (loading || !truncated || previewLimitReached) return;
    setLoading(true);
    setError(null);
    cancelRef.current = false;
    try {
      const next = await api.previewReadText(entry.path, nextOffset, preferences.textLimit);
      if (cancelRef.current) return;
      setChunks((current) => [...current, next]);
    } catch (cause) {
      if (!cancelRef.current) {
        setError(cause instanceof Error ? cause.message : "The rest of this file could not be loaded.");
      }
    } finally {
      if (!cancelRef.current) setLoading(false);
    }
  }, [entry.path, loading, nextOffset, preferences.textLimit, previewLimitReached, truncated]);

  const copyAll = useCallback(() => {
    void copyTextToClipboard(combined).catch(() => undefined);
  }, [combined]);

  const fullscreen = () => {
    scrollerRef.current?.parentElement?.requestFullscreen?.().catch(() => undefined);
  };

  if (text.binary) {
    return (
      <div className="preview-text-renderer">
        <div className="preview-empty-state compact">
          <Icon name="fileCode" size={34} />
          <p>This file contains binary data and cannot be shown as text.</p>
          <span className="preview-muted">{metadata.kind} · {formatSize(metadata.size)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`preview-text-renderer ${wrap ? "wrap" : "nowrap"}`}>
      <div className="preview-renderer-toolbar" role="toolbar" aria-label="Text preview controls">
        <span className="preview-tool-label">{language === "text" ? "Plain text" : language}</span>
        {decodedPlist ? <span className="preview-badge">Decoded plist</span> : null}
        <span className="preview-tool-divider" />
        <label className="preview-find">
          <Icon name="search" size={12} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find"
            aria-label="Find in preview"
            spellCheck={false}
          />
          {query ? (
            <span className="preview-find-count" aria-live="polite">
              {matched.matches}
            </span>
          ) : null}
        </label>
        <button
          type="button"
          className={`preview-tool ${wrap ? "active" : ""}`}
          onClick={() => setWrap((value) => !value)}
          title={wrap ? "Turn off word wrap" : "Wrap long lines"}
          aria-label={wrap ? "Turn off word wrap" : "Wrap long lines"}
          aria-pressed={wrap}
        >
          <Icon name="wrapText" size={14} />
        </button>
        <button type="button" className="preview-tool" onClick={copyAll} title="Copy all text" aria-label="Copy all text">
          <Icon name="copy" size={14} />
        </button>
        <button type="button" className="preview-tool" onClick={fullscreen} title="Fullscreen" aria-label="Fullscreen">
          <Icon name="maximize" size={14} />
        </button>
      </div>
      <div className="preview-text-stage" ref={scrollerRef} tabIndex={0} aria-label="Text preview">
        {showLineNumbers ? (
          <div className="preview-line-numbers" aria-hidden="true">
            {Array.from({ length: lineCount }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
        ) : null}
        <pre className="preview-code">
          {matched.tokens.map((token, index) => (
            <span
              key={index}
              className={
                isMatchToken(token)
                  ? "preview-token preview-token--mark"
                  : `preview-token preview-token--${token.type}`
              }
            >
              {token.text}
            </span>
          ))}
        </pre>
      </div>
      <div className="preview-renderer-footer">
        <span>{formatSize(combined.length)} shown of {formatSize(text.size)}</span>
        {truncated && !previewLimitReached ? (
          <button
            type="button"
            className="preview-inline-button"
            onClick={() => void loadMore()}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load more"}
          </button>
        ) : previewLimitReached ? (
          <span className="preview-muted">Preview limit reached</span>
        ) : (
          <span className="preview-muted">End of file</span>
        )}
        {error ? <span className="preview-error">{error}</span> : null}
      </div>
    </div>
  );
}
