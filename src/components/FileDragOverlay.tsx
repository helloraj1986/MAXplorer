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
  const isTab = drag.payload.kind === "tab";
  const left = Math.min(drag.x + 16, window.innerWidth - 280);
  const top = Math.min(drag.y + 14, window.innerHeight - 44);

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
          {target.kind !== "tab" ? (
            <span className="file-drop-frame-label">
              {verb} to {target.label}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="file-drag-ghost" style={{ left, top }}>
        <Icon name={isTab ? "folder" : drag.copy ? "copy" : "cut"} size={14} />
        <span className="file-drag-ghost-label">{drag.payload.label}</span>
        {drag.payload.count > 1 ? (
          <span className="file-drag-ghost-count">{drag.payload.count}</span>
        ) : null}
      </div>
    </>
  );
}
