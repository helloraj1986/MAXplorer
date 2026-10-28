import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  APP_ICON_CACHE_LIMIT,
  appIconCacheSize,
  clearAppIconCache,
  isApplicationBundle,
  loadAppIcon,
  peekAppIcon,
} from "./appIcons";
import type { FileEntry } from "./types";

vi.mock("./api", () => ({
  api: { readAppIcon: vi.fn() },
}));

const readAppIcon = vi.mocked(api.readAppIcon);

function entry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: "Safari.app",
    path: "/Applications/Safari.app",
    isDir: true,
    isSymlink: false,
    size: null,
    modified: null,
    created: null,
    accessed: null,
    extension: null,
    isHidden: false,
    isReadOnly: false,
    target: null,
    ...overrides,
  };
}

beforeEach(() => {
  clearAppIconCache();
  readAppIcon.mockReset();
});

describe("isApplicationBundle", () => {
  it("detects .app directories regardless of case", () => {
    expect(isApplicationBundle(entry())).toBe(true);
    expect(isApplicationBundle(entry({ name: "Notes.APP" }))).toBe(true);
  });

  it("rejects files and lookalike names", () => {
    expect(isApplicationBundle(entry({ isDir: false }))).toBe(false);
    expect(isApplicationBundle(entry({ name: "notes.app.txt" }))).toBe(false);
    expect(isApplicationBundle(entry({ name: "Applications" }))).toBe(false);
  });
});

describe("loadAppIcon", () => {
  it("deduplicates concurrent requests for the same bundle", async () => {
    let resolve: (value: string | null) => void = () => undefined;
    readAppIcon.mockReturnValue(
      new Promise((next) => {
        resolve = next;
      }),
    );

    const first = loadAppIcon("/Applications/Safari.app");
    const second = loadAppIcon("/Applications/Safari.app");
    expect(readAppIcon).toHaveBeenCalledTimes(1);
    expect(peekAppIcon("/Applications/Safari.app")).toBeUndefined();

    resolve("data:image/png;base64,AAAA");
    await expect(first).resolves.toBe("data:image/png;base64,AAAA");
    await expect(second).resolves.toBe("data:image/png;base64,AAAA");
    expect(peekAppIcon("/Applications/Safari.app")).toBe("data:image/png;base64,AAAA");
  });

  it("reuses a resolved icon", async () => {
    readAppIcon.mockResolvedValue("data:image/png;base64,AAAA");
    await loadAppIcon("/Applications/Safari.app");
    await loadAppIcon("/Applications/Safari.app");
    expect(readAppIcon).toHaveBeenCalledTimes(1);
  });

  it("falls back to null and caches the failure", async () => {
    readAppIcon.mockRejectedValue(new Error("not available"));
    await expect(loadAppIcon("/Applications/Unknown.app")).resolves.toBeNull();
    expect(peekAppIcon("/Applications/Unknown.app")).toBeNull();
    await expect(loadAppIcon("/Applications/Unknown.app")).resolves.toBeNull();
    expect(readAppIcon).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used icon at the cache limit", async () => {
    readAppIcon.mockResolvedValue(null);
    for (let index = 0; index <= APP_ICON_CACHE_LIMIT; index += 1) {
      await loadAppIcon(`/Applications/App ${index}.app`);
    }
    expect(appIconCacheSize()).toBe(APP_ICON_CACHE_LIMIT);

    // The first path was evicted, so it is requested again.
    await loadAppIcon("/Applications/App 0.app");
    expect(readAppIcon).toHaveBeenCalledTimes(APP_ICON_CACHE_LIMIT + 2);
  });
});
