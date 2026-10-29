import type {
  ConflictPolicy,
  OperationResult,
  PaneId,
  TransferItem,
  TransferMode,
  TransferProgress,
  TransferStatus,
} from "./types";

let counter = 0;
let numericBase = Date.now();

export function nextTransferId(): { id: string; numericId: number } {
  counter += 1;
  numericBase += 1;
  return { id: `transfer-${counter}-${Date.now().toString(36)}`, numericId: numericBase };
}

export function createTransferItem(options: {
  mode: TransferMode;
  sources: string[];
  destination: string;
  sourcePane: PaneId;
  destinationPane: PaneId;
  conflict: ConflictPolicy;
}): TransferItem {
  const { id, numericId } = nextTransferId();
  return {
    id,
    numericId,
    mode: options.mode,
    status: "queued",
    sourcePane: options.sourcePane,
    destinationPane: options.destinationPane,
    sources: options.sources,
    destination: options.destination,
    conflict: options.conflict,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    phase: "queued",
    currentFile: null,
    processedBytes: 0,
    totalBytes: 0,
    processedItems: 0,
    totalItems: options.sources.length,
    bytesPerSecond: 0,
    etaSeconds: null,
    message: null,
    error: null,
    results: [],
  };
}

export function applyTransferProgress(item: TransferItem, progress: TransferProgress): TransferItem {
  const status = progress.status as TransferStatus;
  return {
    ...item,
    status: status === "running" || status === "paused" || status === "queued" ? status : item.status,
    phase: progress.phase,
    currentFile: progress.currentFile,
    processedBytes: Math.max(item.processedBytes, progress.processedBytes),
    totalBytes: Math.max(item.totalBytes, progress.totalBytes),
    processedItems: Math.max(item.processedItems, progress.processedItems),
    totalItems: Math.max(item.totalItems, progress.totalItems),
    bytesPerSecond: progress.bytesPerSecond,
    etaSeconds: progress.etaSeconds,
    message: progress.message,
  };
}

export function transferPercent(item: TransferItem): number | null {
  if (item.totalBytes > 0) {
    return Math.min(100, Math.max(0, (item.processedBytes / item.totalBytes) * 100));
  }
  if (item.totalItems > 0) {
    return Math.min(100, Math.max(0, (item.processedItems / item.totalItems) * 100));
  }
  return null;
}

export function transferStatusText(status: TransferStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "scanning":
      return "Scanning";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function transferStatusLabel(item: TransferItem): string {
  return transferStatusText(item.status);
}

export function summarizeResults(results: OperationResult[]): string {
  const completed = results.filter((result) => result.status === "completed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const parts: string[] = [];
  if (completed) parts.push(`${completed} completed`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(", ") || "No items were transferred.";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainder}s left`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m left`;
}

export function isTerminalTransfer(item: TransferItem): boolean {
  return item.status === "completed" || item.status === "failed" || item.status === "cancelled";
}
