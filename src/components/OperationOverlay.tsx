import { Icon } from "./Icon";
import { useExplorerStore } from "../state/explorerStore";

export function OperationOverlay() {
  const operation = useExplorerStore((state) => state.operation);
  if (!operation) return null;
  return (
    <div className="operation-overlay" role="status" aria-live="polite">
      <span className="operation-spinner">
        <Icon name="spinner" size={18} className="spin" />
      </span>
      <div>
        <div className="operation-title">{operation.title}</div>
        {operation.detail ? <div className="operation-detail">{operation.detail}</div> : null}
      </div>
      <span className="operation-bar" aria-hidden="true">
        <span />
      </span>
    </div>
  );
}
