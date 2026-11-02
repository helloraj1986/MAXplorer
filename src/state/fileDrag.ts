import { basename } from "../lib/format";
import type { FileEntry, PaneId } from "../lib/types";
import { useExplorerStore } from "./explorerStore";

/**
 * Internal drag and drop for files and tabs.
 *
 * The Tauri window keeps `dragDropEnabled` on so files can be dropped in from
 * Finder, which means the webview never delivers HTML5 drag events. This module
 * runs the drag itself with pointer events, which works in every webview, and
 * leaves OS drops to the Tauri event in `App`.
 */

export type DragKind = "files" | "tab" | "tag" | "favorite";

export interface DragPayload {
  kind: DragKind;
  paths: string[];
  tabId?: string;
  tabIndex?: number;
  tagId?: string;
  tagIndex?: number;
  favoritePath?: string;
  favoriteIndex?: number;
  sourcePane: PaneId;
  label: string;
  count: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type DragTarget =
  | { kind: "folder"; path: string; paneId: PaneId | null; rect: Rect; label: string }
  | { kind: "pane"; path: string; paneId: PaneId; rect: Rect; label: string }
  | { kind: "tab"; tabIndex: number; paneId: PaneId; rect: Rect; label: string }
  | { kind: "tag"; tagId: string; rect: Rect; label: string }
  | { kind: "favorite"; path: string; rect: Rect; label: string };

export interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  copy: boolean;
  target: DragTarget | null;
}

const DRAG_THRESHOLD = 5;

let state: DragState | null = null;
let pending: { payload: DragPayload; x: number; y: number } | null = null;
let clickGuardUntil = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeFileDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFileDragState(): DragState | null {
  return state;
}

function rectOf(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function paneOfElement(element: HTMLElement): PaneId | null {
  const host = element.closest<HTMLElement>("[data-pane]");
  const value = host?.dataset.pane;
  return value === "left" || value === "right" ? value : null;
}

function resolveTarget(x: number, y: number, payload: DragPayload): DragTarget | null {
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!element) return null;

  if (payload.kind === "tab") {
    const tab = element.closest<HTMLElement>("[data-drop-tab]");
    const paneId = tab ? paneOfElement(tab) : null;
    if (!tab || !paneId || paneId !== payload.sourcePane) return null;
    return {
      kind: "tab",
      tabIndex: Number(tab.dataset.dropTabIndex ?? "0"),
      paneId,
      rect: rectOf(tab),
      label: tab.dataset.dropTabLabel ?? "",
    };
  }

  if (payload.kind === "tag") {
    const tag = element.closest<HTMLElement>("[data-drop-tag]");
    if (!tag?.dataset.dropTag) return null;
    return {
      kind: "tag",
      tagId: tag.dataset.dropTag,
      rect: rectOf(tag),
      label: tag.dataset.dropLabel ?? "",
    };
  }

  if (payload.kind === "favorite") {
    const favorite = element.closest<HTMLElement>("[data-drop-favorite]");
    if (!favorite?.dataset.dropFavorite) return null;
    return {
      kind: "favorite",
      path: favorite.dataset.dropFavorite,
      rect: rectOf(favorite),
      label: favorite.dataset.dropLabel ?? basename(favorite.dataset.dropFavorite),
    };
  }

  // A file dropped on a sidebar tag is tagged rather than moved.
  const tag = element.closest<HTMLElement>("[data-drop-tag]");
  if (tag?.dataset.dropTag) {
    return {
      kind: "tag",
      tagId: tag.dataset.dropTag,
      rect: rectOf(tag),
      label: tag.dataset.dropLabel ?? "",
    };
  }

  const folder = element.closest<HTMLElement>("[data-drop-path]");
  if (folder?.dataset.dropPath) {
    return {
      kind: "folder",
      path: folder.dataset.dropPath,
      paneId: paneOfElement(folder),
      rect: rectOf(folder),
      label: folder.dataset.dropLabel ?? basename(folder.dataset.dropPath),
    };
  }

  const pane = element.closest<HTMLElement>("[data-drop-pane]");
  const paneId = pane?.dataset.dropPane;
  if (pane && (paneId === "left" || paneId === "right")) {
    const destination = useExplorerStore.getState().currentFolder(paneId);
    if (!destination) return null;
    return {
      kind: "pane",
      path: destination,
      paneId,
      rect: rectOf(pane),
      label: basename(destination) || destination,
    };
  }

  return null;
}

function swallowClick(event: MouseEvent) {
  if (performance.now() > clickGuardUntil) return;
  event.stopPropagation();
  event.preventDefault();
}

function onPointerMove(event: PointerEvent) {
  if (!pending) return;
  const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
  if (!state && moved < DRAG_THRESHOLD) return;
  const copy = event.altKey || event.metaKey;
  if (!state) {
    document.body.classList.add("file-dragging");
    window.addEventListener("click", swallowClick, true);
  }
  document.body.classList.toggle("file-drag-copy", copy);
  state = {
    payload: pending.payload,
    x: event.clientX,
    y: event.clientY,
    copy,
    target: resolveTarget(event.clientX, event.clientY, pending.payload),
  };
  emit();
}

function onPointerUp(event: PointerEvent) {
  const dragged = state;
  const payload = pending?.payload ?? null;
  const target = dragged && payload ? resolveTarget(event.clientX, event.clientY, payload) : null;
  stop(dragged !== null);
  if (!dragged || !payload || !target) return;

  const store = useExplorerStore.getState();
  if (payload.kind === "tab" && target.kind === "tab") {
    store.reorderTab(payload.tabIndex ?? 0, target.tabIndex, target.paneId);
    return;
  }
  if (payload.kind === "tag" && target.kind === "tag") {
    if (payload.tagId) store.reorderTags(payload.tagId, target.tagId);
    return;
  }
  if (payload.kind === "favorite" && target.kind === "favorite") {
    if (payload.favoritePath) store.reorderPinned(payload.favoritePath, target.path);
    return;
  }
  if (payload.kind === "files" && target.kind === "tag") {
    store.assignTag(payload.paths, target.tagId);
    return;
  }
  if (payload.kind === "files" && (target.kind === "folder" || target.kind === "pane")) {
    void store.moveOrCopyPaths(
      payload.paths,
      target.path,
      dragged.copy ? "copy" : "move",
      payload.sourcePane,
      target.paneId ?? payload.sourcePane,
    );
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") stop(false);
}

function onCancel() {
  stop(false);
}

function stop(commitGuard: boolean) {
  pending = null;
  const hadState = state !== null;
  state = null;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp, true);
  window.removeEventListener("pointercancel", onCancel, true);
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("blur", onCancel);
  document.body.classList.remove("file-dragging", "file-drag-copy");
  if (commitGuard) {
    // The click that follows a drop would re-run row selection.
    clickGuardUntil = performance.now() + 250;
    window.setTimeout(() => window.removeEventListener("click", swallowClick, true), 300);
  } else {
    window.removeEventListener("click", swallowClick, true);
  }
  if (hadState) emit();
}

function arm(event: React.PointerEvent, payload: DragPayload) {
  pending = { payload, x: event.clientX, y: event.clientY };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", onCancel);
}

/** Starts dragging the pressed row, using the selection when the row is part of it. */
export function beginFileDrag(
  event: React.PointerEvent,
  entry: FileEntry,
  selection: string[],
  selected: Set<string>,
  paneId: PaneId,
) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, input, a, [role='separator']")) return;
  const paths = selected.has(entry.path) && selection.length ? selection : [entry.path];
  if (!selected.has(entry.path)) {
    useExplorerStore.getState().setSelection([entry.path], entry.path, paneId);
  }
  arm(event, {
    kind: "files",
    paths,
    sourcePane: paneId,
    label: paths.length > 1 ? `${paths.length} items` : basename(entry.path),
    count: paths.length,
  });
}

/** Starts reordering a tab. */
export function beginTabDrag(
  event: React.PointerEvent,
  tab: { id: string; index: number; label: string },
  paneId: PaneId,
) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button")) return;
  arm(event, {
    kind: "tab",
    paths: [],
    tabId: tab.id,
    tabIndex: tab.index,
    sourcePane: paneId,
    label: tab.label,
    count: 1,
  });
}

/** Starts reordering a tag in the sidebar. */
export function beginTagDrag(
  event: React.PointerEvent,
  tagId: string,
  label: string,
  index: number,
) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button")) return;
  arm(event, {
    kind: "tag",
    paths: [],
    tagId,
    tagIndex: index,
    sourcePane: useExplorerStore.getState().activePane,
    label,
    count: 1,
  });
}

/** Starts reordering a favorite in the sidebar. */
export function beginFavoriteDrag(
  event: React.PointerEvent,
  path: string,
  label: string,
  index: number,
) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button")) return;
  arm(event, {
    kind: "favorite",
    paths: [path],
    favoritePath: path,
    favoriteIndex: index,
    sourcePane: useExplorerStore.getState().activePane,
    label,
    count: 1,
  });
}
