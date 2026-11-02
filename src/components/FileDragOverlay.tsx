import { useSyncExternalStore } from "react";
import { Icon } from "./Icon";
import { getFileDragState, subscribeFileDrag } from "../state/fileDrag";

/**
 * Floating drag feedback: a small chip next to the pointer plus a frame around
 * the folder or pane that will receive the drop.
 */
export function FileDragOverlay() {
  const drag = useSyncExternalStore(subscribeFileDrag, getFileDragState);
  if (!drag) return null;
  const target = drag.target;
  const verb = drag.copy ? "Copy" : "Move";
  const kind = drag.payload.kind;
  const isTab = kind === "tab";
  const isTag = kind === "tag";
  const isFavorite = kind === "favorite";
  const left = Math.min(drag.x + 16, window.innerWidth - 280);
  const top = Math.min(drag.y + 14, window.innerHeight - 44);
  const targetLabel =
    target?.kind === "tag"
      ? isTag
        ? `Reorder ${target.label}`
        : `Tag as ${target.label}`
      : target?.kind === "favorite"
        ? `Move ${target.label} here`
        : target
          ? `${verb} to ${target.label}`
          : null;

  return (
    <>
      {target ? (
        <div
          className="file-drop-frame"
          style={{
            left: target.rect.left,
            top: target.rect.top,
            width: target.rect.width,
            height: target.rect.height,
          }}
        >
          {target.kind !== "tab" && targetLabel ? (
            <span className="file-drop-frame-label">{targetLabel}</span>
          ) : null}
        </div>
      ) : null}
      <div
        className={`file-drag-ghost ${isTag || isFavorite ? "metadata-drag" : ""}`}
        style={{ left, top }}
      >
        <Icon
          name={
            isTag || target?.kind === "tag"
              ? "tag"
              : isFavorite
                ? "pin"
                : isTab
                  ? "folder"
                  : drag.copy
                    ? "copy"
                    : "cut"
          }
          size={14}
        />
        <span className="file-drag-ghost-label">{drag.payload.label}</span>
        {drag.payload.count > 1 ? (
          <span className="file-drag-ghost-count">{drag.payload.count}</span>
        ) : null}
      </div>
    </>
  );
}
