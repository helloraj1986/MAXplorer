import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "./Icon";
import { FileTypeIcon } from "./icons/FileTypeIcon";
import { TagIndicators } from "./TagIndicators";
import { PreviewImage } from "./preview/PreviewImage";
import { PreviewPdf } from "./preview/PreviewPdf";
import { PreviewMedia } from "./preview/PreviewMedia";
import { PreviewText } from "./preview/PreviewText";
import { PreviewArchive } from "./preview/PreviewArchive";
import { PreviewFolder } from "./preview/PreviewFolder";
import { PreviewQuickLook } from "./preview/PreviewQuickLook";
import { PreviewMetadataCard } from "./preview/PreviewMetadataCard";
import { PreviewEngine } from "../lib/preview/engine";
import type { PreviewResult } from "../lib/preview/types";
import { api, isTauri } from "../lib/api";
import { formatCount, formatSize, typeName } from "../lib/format";
import { useExplorerStore } from "../state/explorerStore";
import { beginFileDrag } from "../state/fileDrag";
import type { FileEntry } from "../lib/types";

type LoadState =
  | { status: "idle" }
  | { status: "loading"; progress: string | null }
  | { status: "ready"; result: PreviewResult }
  | { status: "error"; message: string; error: unknown };

function PreviewHeader({
  entry,
  metadataKind,
  metadataSize,
  hasSelection,
  onRefresh,
}: {
  entry: FileEntry | null;
  metadataKind: string | null;
  metadataSize: number | null;
  hasSelection: boolean;
  onRefresh?: () => void;
}) {
  const openEntry = useExplorerStore((state) => state.openEntry);
  const revealInPane = useExplorerStore((state) => state.revealInPane);
  const shareSelection = useExplorerStore((state) => state.shareSelection);
  const copyPathsToClipboard = useExplorerStore((state) => state.copyPathsToClipboard);
  const setPreviewPane = useExplorerStore((state) => state.setPreviewPane);
  const openQuickLook = useExplorerStore((state) => state.openQuickLook);
  const selected = useExplorerStore(useShallow((state) => state.selectedEntries(state.activePane)));
  const activePane = useExplorerStore((state) => state.activePane);

  return (
    <div className="preview-header">
      <div className="preview-header-identity">
        {entry ? <FileTypeIcon entry={entry} size={18} /> : <Icon name="eye" size={16} />}
        <div className="preview-header-copy">
          <strong title={entry?.path ?? undefined}>{entry?.name ?? "Preview"}</strong>
          <span>
            {entry
              ? [metadataKind || typeName(entry), metadataSize != null ? formatSize(metadataSize) : null]
                  .filter(Boolean)
                  .join(" · ")
              : "Follows the active pane"}
          </span>
          {entry ? <TagIndicators path={entry.path} /> : null}
        </div>
      </div>
      <div className="preview-header-actions" role="toolbar" aria-label="Preview actions">
        {entry ? (
          <>
            <button
              type="button"
              className="preview-icon-button"
              title="Open"
              aria-label="Open"
              onClick={() => void openEntry(entry, activePane)}
            >
              <Icon name="open" size={14} />
            </button>
            <button
              type="button"
              className="preview-icon-button"
              title="Reveal in active pane"
              aria-label="Reveal in active pane"
              onClick={() => void revealInPane(entry.path, activePane)}
            >
              <Icon name="folderOpen" size={14} />
            </button>
            <button
              type="button"
              className="preview-icon-button"
              title="Quick Look"
              aria-label="Quick Look"
              onClick={() => void openQuickLook(selected.map((item) => item.path))}
            >
              <Icon name="eye" size={14} />
            </button>
            <button
              type="button"
              className="preview-icon-button"
              title="Share"
              aria-label="Share"
              onClick={() => void shareSelection(activePane)}
            >
              <Icon name="share" size={14} />
            </button>
            <button
              type="button"
              className="preview-icon-button"
              title="Copy path"
              aria-label="Copy path"
              onClick={() => copyPathsToClipboard([entry.path])}
            >
              <Icon name="copyPath" size={14} />
            </button>
          </>
        ) : hasSelection ? (
          <button
            type="button"
            className="preview-icon-button"
            title="Quick Look"
            aria-label="Quick Look"
            onClick={() => void openQuickLook(selected.map((item) => item.path))}
          >
            <Icon name="eye" size={14} />
          </button>
        ) : null}
        <span className="preview-tool-divider" />
        {entry && onRefresh ? (
          <button
            type="button"
            className="preview-icon-button"
            title="Refresh preview"
            aria-label="Refresh preview"
            onClick={onRefresh}
          >
            <Icon name="refresh" size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="preview-icon-button"
          title="Close preview pane"
          aria-label="Close preview pane"
          onClick={() => setPreviewPane(false)}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}

function MultiSelectionPreview({ selection }: { selection: FileEntry[] }) {
  const bytes = selection.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.size ?? 0), 0);
  return (
    <div className="preview-multi">
      <div className="preview-multi-stack" aria-hidden="true">
        {selection.slice(0, 4).map((entry, index) => (
          <span key={entry.path} style={{ transform: `translate(${index * 8}px, ${index * -4}px)` }}>
            <FileTypeIcon entry={entry} size={64} />
          </span>
        ))}
      </div>
      <h3>{formatCount(selection.length)} items selected</h3>
      <p>{formatSize(bytes)}</p>
      <div className="preview-multi-list">
        {selection.slice(0, 10).map((entry) => (
          <div className="preview-multi-row" key={entry.path} title={entry.path}>
            <FileTypeIcon entry={entry} size={15} />
            <span>{entry.name}</span>
          </div>
        ))}
        {selection.length > 10 ? (
          <div className="preview-multi-more">and {formatCount(selection.length - 10)} more</div>
        ) : null}
      </div>
    </div>
  );
}

function EmptyPreview({ hasSelection }: { hasSelection: boolean }) {
  return (
    <div className="preview-empty">
      <Icon name="eye" size={34} />
      <p>
        {hasSelection
          ? "Select a single item to preview it"
          : "Select an item in either pane to preview it"}
      </p>
      <span className="preview-muted">
        The preview always follows the active pane. Press Space for Quick Look.
      </span>
    </div>
  );
}

export function PreviewPane() {
  const activePane = useExplorerStore((state) => state.activePane);
  const selection = useExplorerStore(useShallow((state) => state.selectedEntries(state.activePane)));
  const preferences = useExplorerStore((state) => state.preview);
  const setPreviewPane = useExplorerStore((state) => state.setPreviewPane);
  const toast = useExplorerStore((state) => state.toast);
  const toastError = useExplorerStore((state) => state.toastError);
  const [target, setTarget] = useState<FileEntry | null>(null);
  const [multi, setMulti] = useState<FileEntry[]>([]);
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [refreshToken, setRefreshToken] = useState(0);
  const engineRef = useRef<PreviewEngine | null>(null);
  const requestId = useRef(0);
  const watchTimerRef = useRef<number | null>(null);
  const selectionKey = `${activePane}:${selection.map((entry) => entry.path).join("\u0000")}`;

  // Debounce fast arrow-key navigation so the renderer is not destroyed and
  // recreated for every intermediate selection.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMulti(selection);
      setTarget(selection.length === 1 ? selection[0] : null);
    }, 120);
    return () => window.clearTimeout(timer);
    // The key already contains pane and path identity; the array itself is a
    // fresh store projection on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const rendererKey = preferences.renderers.join(",");
  const textLimit = preferences.textLimit;

  useEffect(() => {
    const openPanel = useExplorerStore.getState().quickLookOpen;
    if (openPanel) void useExplorerStore.getState().closeQuickLook();
    if (!target) {
      engineRef.current?.cancel();
      engineRef.current = null;
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const id = requestId.current + 1;
    requestId.current = id;
    engineRef.current?.cancel();
    const engine = new PreviewEngine({
      preferences: useExplorerStore.getState().preview,
      requestId: id,
      signal: controller.signal,
      onProgress: (progress) => {
        if (!controller.signal.aborted && requestId.current === id) {
          setState({ status: "loading", progress });
        }
      },
    });
    engineRef.current = engine;
    setState({ status: "loading", progress: null });
    void engine
      .load(target)
      .then((result) => {
        if (controller.signal.aborted || requestId.current !== id) return;
        setState({ status: "ready", result });
      })
      .catch((error) => {
        if (controller.signal.aborted || requestId.current !== id) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "This item could not be previewed.",
          error,
        });
      });
    return () => {
      controller.abort();
      engine.cancel();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // refreshToken intentionally reloads the same selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.path, refreshToken, rendererKey, textLimit]);

  // Watch the previewed file while the panel is visible. The native watcher is
  // best-effort; if a network volume cannot be watched, manual refresh remains.
  useEffect(() => {
    if (!target || !isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      void api.previewWatch(target.path).catch(() => undefined);
      void api
        .onPreviewChanged((event) => {
          if (cancelled || event.path !== target.path) return;
          if (watchTimerRef.current) window.clearTimeout(watchTimerRef.current);
          watchTimerRef.current = window.setTimeout(() => {
            watchTimerRef.current = null;
            if (!cancelled) setRefreshToken((value) => value + 1);
          }, 300);
        })
        .then((cleanup) => {
          if (cancelled) cleanup();
          else unlisten = cleanup;
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (watchTimerRef.current) {
        window.clearTimeout(watchTimerRef.current);
        watchTimerRef.current = null;
      }
      unlisten?.();
      void api.previewUnwatch().catch(() => undefined);
    };
  }, [target?.path]);

  useEffect(() => {
    return () => {
      engineRef.current?.cancel();
      engineRef.current = null;
      if (isTauri) {
        void api.previewQuickLookClose().catch(() => undefined);
        void api.clearPreviewCache().catch(() => undefined);
      }
    };
  }, []);

  const metadata = state.status === "ready" ? state.result.metadata : null;
  const retry = useCallback(() => setRefreshToken((value) => value + 1), []);

  const downloadICloud = useCallback(async () => {
    if (!target) return;
    try {
      await api.previewDownloadICloud(target.path);
      toast({
        title: "Download started",
        detail: "The iCloud item will appear when macOS finishes downloading it.",
        tone: "info",
      });
    } catch (error) {
      toastError(error);
    }
  }, [target, toast, toastError]);

  const body = useMemo(() => {
    if (state.status === "loading") {
      return (
        <div className="preview-loading">
          <Icon name="spinner" size={18} className="spin" />
          <span>{state.progress ?? "Loading preview..."}</span>
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <div className="preview-error-state">
          <Icon name="warning" size={30} />
          <h3>Preview unavailable</h3>
          <p>{state.message}</p>
          {target ? <code className="preview-path">{target.path}</code> : null}
          <div className="preview-error-actions">
            <button type="button" className="preview-action" onClick={retry}>
              <Icon name="refresh" size={13} />
              Try again
            </button>
            {target ? (
              <button
                type="button"
                className="preview-action"
                onClick={() => void useExplorerStore.getState().openEntry(target, activePane)}
              >
                <Icon name="open" size={13} />
                Open with default app
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    if (state.status !== "ready") return null;
    const { result } = state;
    const info = result.metadata;
    if (info.isICloudPlaceholder) {
      return (
        <div className="preview-empty-state">
          <Icon name="cloudDownload" size={38} />
          <h3>iCloud item not downloaded</h3>
          <p>
            This file is stored in iCloud. The preview never waits on the network; download it
            explicitly and the pane will refresh when macOS finishes.
          </p>
          <button type="button" className="preview-action primary" onClick={() => void downloadICloud()}>
            <Icon name="cloudDownload" size={13} />
            Download
          </button>
        </div>
      );
    }
    if (!info.isReadable) {
      return (
        <div className="preview-error-state">
          <Icon name="lock" size={30} />
          <h3>You don't have permission to read this item</h3>
          <p>
            Grant access in System Settings &gt; Privacy &amp; Security. The file was not modified
            or opened by the preview.
          </p>
          <code className="preview-path">{info.path}</code>
        </div>
      );
    }
    switch (result.payload.kind) {
      case "image":
        return <PreviewImage entry={target!} metadata={info} />;
      case "pdf":
        return <PreviewPdf entry={target!} metadata={info} />;
      case "media":
        return <PreviewMedia entry={target!} metadata={info} />;
      case "text":
        return (
          <PreviewText
            entry={target!}
            metadata={info}
            text={result.payload.text}
            language={result.payload.language}
            preferences={preferences}
          />
        );
      case "archive":
        return <PreviewArchive entry={target!} listing={result.payload.archive} />;
      case "folder":
        return <PreviewFolder entry={target!} metadata={info} folder={result.payload.folder} />;
      case "quicklook":
        return (
          <PreviewQuickLook entry={target!} metadata={info} thumbnail={result.payload.thumbnail} />
        );
      default:
        return (
          <PreviewMetadataCard
            entry={target!}
            metadata={info}
            note={
              result.error ??
              "No specialised preview is available. You can open the item in its default app or Quick Look."
            }
          />
        );
    }
    // target is guaranteed by the ready state; preferences intentionally not a
    // dependency of payload rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePane, downloadICloud, preferences, retry, state, target]);

  const hasSelection = selection.length > 0;

  const beginPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!target || event.button !== 0) return;
    const element = event.target as HTMLElement | null;
    if (element?.closest("button, input, textarea, a, video, audio, .preview-text-stage, [role='separator']")) {
      return;
    }
    const paths = selection.some((entry) => entry.path === target.path)
      ? selection.map((entry) => entry.path)
      : [target.path];
    beginFileDrag(event, target, paths, new Set(paths), activePane);
  };

  return (
    <aside
      className="preview-pane"
      aria-label="Preview pane"
      aria-busy={state.status === "loading"}
      data-preview-renderer={state.status === "ready" ? state.result.rendererId : state.status}
    >
      <PreviewHeader
        entry={target}
        metadataKind={metadata?.kind ?? null}
        metadataSize={metadata?.size ?? target?.size ?? null}
        hasSelection={hasSelection}
        onRefresh={target ? retry : undefined}
      />
      <div className="preview-pane-body" onPointerDown={beginPreviewDrag}>
        {multi.length > 1 && !target ? (
          <MultiSelectionPreview selection={multi} />
        ) : target ? (
          body
        ) : (
          <EmptyPreview hasSelection={hasSelection} />
        )}
      </div>
    </aside>
  );
}
