// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { FileTypeIcon } from "./FileTypeIcon";
import { FolderIcon } from "./FolderIcon";
import { StorageIcon } from "./StorageIcon";
import { SyncStatusIcon } from "./SyncStatusIcon";
import { useExplorerStore } from "../../state/explorerStore";
import { clearThumbnailCache } from "../../lib/icons/thumbnailService";
import type { FileEntry } from "../../lib/types";

const nativeMocks = vi.hoisted(() => ({
  isNativeIconCandidate: vi.fn(),
  peekNativeIcon: vi.fn(),
  loadNativeIcon: vi.fn(),
  nativeIconCacheSize: vi.fn(() => 0),
  clearNativeIconCache: vi.fn(),
}));

vi.mock("../../lib/icons/nativeIconService", () => nativeMocks);

function entry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: "file.txt",
    path: "/tmp/file.txt",
    isDir: false,
    isSymlink: false,
    size: 10,
    modified: null,
    created: null,
    accessed: null,
    extension: "txt",
    isHidden: false,
    isReadOnly: false,
    target: null,
    ...overrides,
  };
}

beforeEach(() => {
  clearThumbnailCache();
  nativeMocks.isNativeIconCandidate.mockImplementation(
    (item: FileEntry) => item.isDir && item.name.toLowerCase().endsWith(".app"),
  );
  nativeMocks.peekNativeIcon.mockReturnValue(undefined);
  nativeMocks.loadNativeIcon.mockResolvedValue(null);
  useExplorerStore.setState({ interfaceTheme: "windows", theme: "dark" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FileTypeIcon", () => {
  it("renders the registry artwork for a case-insensitive extension", () => {
    const { container, getByText } = render(
      <FileTypeIcon entry={entry({ name: "REPORT.PDF", extension: "PDF" })} size={48} />,
    );
    expect(container.querySelector('[data-file-kind="pdf"]')).toBeTruthy();
    expect(getByText("PDF")).toBeTruthy();
  });

  it("renders a neutral fallback for unknown and extensionless files", () => {
    const unknown = render(
      <FileTypeIcon entry={entry({ name: "weird.xyz", extension: "xyz" })} size={40} />,
    );
    expect(unknown.container.querySelector('[data-file-kind="unknown"]')).toBeTruthy();
    expect(unknown.getByText("XYZ")).toBeTruthy();
    cleanup();

    const missing = render(<FileTypeIcon entry={entry({ name: "mystery", extension: null })} />);
    expect(missing.container.querySelector('[data-file-kind="unknown"]')).toBeTruthy();
    expect(missing.container.querySelector("text")).toBeNull();
  });

  it("uses folder artwork for directories", () => {
    const { container } = render(
      <FileTypeIcon entry={entry({ name: "Projects", isDir: true, extension: null })} size={32} />,
    );
    expect(container.querySelector("[data-folder-theme]")).toBeTruthy();
    expect(container.querySelector('[data-file-kind="folder"]')).toBeNull();
  });

  it("adds visual affordances for well-known folder names", () => {
    const { container } = render(
      <FileTypeIcon entry={entry({ name: "Downloads", isDir: true, extension: null })} size={32} />,
    );
    expect(container.querySelector('[data-folder-variant="downloads"]')).toBeTruthy();
  });

  it("prefers a loaded native application icon and falls back cleanly", async () => {
    nativeMocks.loadNativeIcon.mockResolvedValueOnce("data:image/png;base64,AAAA");
    const success = render(
      <FileTypeIcon entry={entry({ name: "Safari.app", isDir: true, extension: null })} />,
    );
    await waitFor(() => {
      expect(success.container.querySelector('img[src="data:image/png;base64,AAAA"]')).toBeTruthy();
    });
    expect(success.container.querySelector('[data-file-kind="app"]')).toBeTruthy();
    cleanup();

    nativeMocks.loadNativeIcon.mockResolvedValueOnce(null);
    const fallback = render(
      <FileTypeIcon entry={entry({ name: "Unknown.app", isDir: true, extension: null })} />,
    );
    await waitFor(() => {
      expect(fallback.container.querySelector('[data-file-kind="app"]')).toBeTruthy();
    });
    expect(fallback.container.querySelector("img")).toBeNull();
  });

  it("falls back to category artwork when a thumbnail fails", () => {
    const image = entry({ name: "photo.png", path: "/tmp/photo.png", extension: "png" });
    const { container } = render(<FileTypeIcon entry={image} size={64} thumbnail />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    fireEvent.error(img as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-file-kind="image"]')).toBeTruthy();
  });

  it("keeps decorative icons out of the accessibility tree unless labelled", () => {
    const decorative = render(<FileTypeIcon entry={entry({ name: "notes.txt", extension: "txt" })} />);
    const art = decorative.container.querySelector('[data-file-kind="text"]');
    expect(art?.getAttribute("aria-hidden")).toBe("true");
    cleanup();

    const labelled = render(
      <FileTypeIcon entry={entry({ name: "notes.txt", extension: "txt" })} title="Text document" />,
    );
    const labelledArt = labelled.container.querySelector('[data-file-kind="text"]');
    expect(labelledArt?.getAttribute("role")).toBe("img");
    expect(labelledArt?.getAttribute("aria-label")).toBe("Text document");
  });

  it("does not request native artwork for ordinary files", () => {
    render(<FileTypeIcon entry={entry({ name: "notes.txt", extension: "txt" })} />);
    expect(nativeMocks.loadNativeIcon).not.toHaveBeenCalled();
  });
});

describe("FolderIcon theme rendering", () => {
  it("switches folder artwork with the interface theme", () => {
    const { container } = render(<FolderIcon size={32} />);
    expect(container.querySelector('[data-folder-theme="windows"]')).toBeTruthy();
    act(() => {
      useExplorerStore.setState({ interfaceTheme: "finder" });
    });
    expect(container.querySelector('[data-folder-theme="finder"]')).toBeTruthy();
  });

  it("supports selected, open, shared and favourite variants", () => {
    const { container, rerender } = render(<FolderIcon variant="open" selected />);
    expect(container.querySelector('[data-folder-variant="open"]')).toBeTruthy();
    rerender(<FolderIcon variant="shared" />);
    expect(container.querySelector('[data-folder-variant="shared"]')).toBeTruthy();
    rerender(<FolderIcon variant="favorite" />);
    expect(container.querySelector('[data-folder-variant="favorite"]')).toBeTruthy();
  });
});

describe("StorageIcon", () => {
  it("separates the volume identity from its connection state", () => {
    const { container } = render(<StorageIcon variant="network" status="disconnected" />);
    const icon = container.querySelector('[data-storage-variant="network"]');
    expect(icon?.getAttribute("data-storage-status")).toBe("disconnected");
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(1);
  });
});

describe("SyncStatusIcon", () => {
  it("is decorative inside a labelled control by default", () => {
    const { container } = render(<SyncStatusIcon state="syncing" />);
    const icon = container.querySelector(".sync-status-icon");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("exposes a label when used standalone", () => {
    const { container } = render(<SyncStatusIcon state="syncing" decorative={false} />);
    const icon = container.querySelector(".sync-status-icon");
    expect(icon?.getAttribute("role")).toBe("img");
    expect(icon?.getAttribute("aria-label")).toBe("Syncing");
  });
});
