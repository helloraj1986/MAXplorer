import { Icon } from "./Icon";
import { useExplorerStore } from "../state/explorerStore";

export function Toasts() {
  const toasts = useExplorerStore((state) => state.toasts);
  const dismissToast = useExplorerStore((state) => state.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className={`toast ${toast.tone}`} key={toast.id} role="status">
          <span className="toast-icon">
            <Icon
              name={toast.tone === "error" ? "warning" : toast.tone === "success" ? "check" : "info"}
              size={16}
            />
          </span>
          <div className="toast-body">
            <div className="toast-title">{toast.title}</div>
            {toast.detail ? <div className="toast-detail">{toast.detail}</div> : null}
            {toast.actionLabel && toast.onAction ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.onAction?.();
                  dismissToast(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(toast.id)}
          >
            <Icon name="close" size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
