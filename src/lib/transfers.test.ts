import { describe, expect, it } from "vitest";
import {
  applyTransferProgress,
  createTransferItem,
  formatBytes,
  formatEta,
  formatSpeed,
  isTerminalTransfer,
  summarizeResults,
  transferPercent,
  transferStatusLabel,
  transferStatusText,
} from "./transfers";
import type { TransferProgress } from "./types";

function item() {
  return createTransferItem({
    mode: "copy",
    sources: ["/source/a.txt", "/source/b.txt"],
    destination: "/dest",
    sourcePane: "left",
    destinationPane: "right",
    conflict: "error",
  });
}

function progress(overrides: Partial<TransferProgress> = {}): TransferProgress {
  return {
    id: 1,
    status: "running",
    phase: "copying",
    currentFile: "/source/a.txt",
    processedBytes: 128,
    totalBytes: 256,
    processedItems: 1,
    totalItems: 2,
    bytesPerSecond: 64,
    etaSeconds: 2,
    message: null,
    ...overrides,
  };
}

describe("transfer helpers", () => {
  it("creates queued transfer items with unique identifiers", () => {
    const first = item();
    const second = item();
    expect(first.status).toBe("queued");
    expect(first.mode).toBe("copy");
    expect(first.sources).toHaveLength(2);
    expect(first.destination).toBe("/dest");
    expect(first.totalItems).toBe(2);
    expect(first.numericId).not.toBe(second.numericId);
    expect(first.id).not.toBe(second.id);
  });

  it("computes byte-based and item-based progress", () => {
    expect(transferPercent(item())).toBe(0);
    expect(transferPercent({ ...item(), processedBytes: 50, totalBytes: 200 })).toBe(25);
    expect(transferPercent({ ...item(), processedBytes: 0, totalBytes: 0, processedItems: 1 })).toBe(
      50,
    );
    expect(
      transferPercent({ ...item(), processedBytes: 300, totalBytes: 200 }),
    ).toBe(100);
    expect(
      transferPercent({ ...item(), processedBytes: 0, totalBytes: 0, totalItems: 0 }),
    ).toBeNull();
  });

  it("applies progress while keeping terminal item status", () => {
    const running = applyTransferProgress(item(), progress());
    expect(running.status).toBe("running");
    expect(running.currentFile).toBe("/source/a.txt");
    expect(running.processedBytes).toBe(128);
    expect(running.bytesPerSecond).toBe(64);

    const completed = { ...item(), status: "completed" as const };
    const updated = applyTransferProgress(completed, progress({ status: "completed" }));
    expect(updated.status).toBe("completed");
  });

  it("never decreases counters when progress arrives out of order", () => {
    const started = applyTransferProgress(item(), progress());
    const stale = applyTransferProgress(started, progress({ processedBytes: 10, processedItems: 0 }));
    expect(stale.processedBytes).toBe(128);
    expect(stale.processedItems).toBe(1);
  });

  it("renders transfer status labels", () => {
    expect(transferStatusText("queued")).toBe("Queued");
    expect(transferStatusText("scanning")).toBe("Scanning");
    expect(transferStatusText("running")).toBe("Running");
    expect(transferStatusText("paused")).toBe("Paused");
    expect(transferStatusText("completed")).toBe("Completed");
    expect(transferStatusText("failed")).toBe("Failed");
    expect(transferStatusText("cancelled")).toBe("Cancelled");
    expect(transferStatusLabel({ ...item(), status: "failed" })).toBe("Failed");
  });

  it("formats byte counts, speeds, and remaining time", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 3)).toBe("3.0 MB");
    expect(formatSpeed(0)).toBe("");
    expect(formatSpeed(2048)).toBe("2.0 KB/s");
    expect(formatEta(null)).toBe("");
    expect(formatEta(0)).toBe("");
    expect(formatEta(4)).toBe("4s left");
    expect(formatEta(65)).toBe("1m 5s left");
    expect(formatEta(3700)).toBe("1h 1m left");
  });

  it("summarizes operation outcomes", () => {
    expect(
      summarizeResults([
        { source: "/a", destination: "/b", status: "completed", error: null },
        { source: "/c", destination: "/d", status: "completed", error: null },
        { source: "/e", destination: null, status: "skipped", error: null },
        { source: "/f", destination: null, status: "failed", error: "denied" },
      ]),
    ).toBe("2 completed, 1 skipped, 1 failed");
    expect(summarizeResults([])).toBe("No items were transferred.");
  });

  it("classifies terminal statuses", () => {
    expect(isTerminalTransfer(item())).toBe(false);
    expect(isTerminalTransfer({ ...item(), status: "completed" })).toBe(true);
    expect(isTerminalTransfer({ ...item(), status: "failed" })).toBe(true);
    expect(isTerminalTransfer({ ...item(), status: "cancelled" })).toBe(true);
    expect(isTerminalTransfer({ ...item(), status: "paused" })).toBe(false);
  });
});
