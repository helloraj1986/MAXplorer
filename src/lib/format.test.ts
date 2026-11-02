import { describe, expect, it } from "vitest";
import type { FileEntry } from "./types";
import {
  basename,
  breadcrumbs,
  displayName,
  formatDate,
  formatSize,
  parentPath,
  typeName,
} from "./format";

function entry(partial: Partial<FileEntry>): FileEntry {
  return {
    name: "file.txt",
    path: "/tmp/file.txt",
    isDir: false,
    isSymlink: false,
    size: 0,
    modified: null,
    created: null,
    accessed: null,
    extension: "txt",
    isHidden: false,
    isReadOnly: false,
    target: null,
    ...partial,
  };
}

describe("formatSize", () => {
  it("matches the Windows 11 size column conventions", () => {
    expect(formatSize(32000)).toBe("31.2 KB");
    expect(formatSize(1280000)).toBe("1,250 KB");
    expect(formatSize(18400000)).toBe("17,969 KB");
    expect(formatSize(2350000)).toBe("2,295 KB");
    expect(formatSize(4096)).toBe("4 KB");
    expect(formatSize(512000)).toBe("500 KB");
    expect(formatSize(0)).toBe("0 KB");
    expect(formatSize(512)).toBe("1 KB");
  });
});

describe("formatDate", () => {
  it("uses the reference date format", () => {
    const value = new Date(2026, 9, 27, 19, 34).getTime();
    expect(formatDate(value)).toBe("10/27/2026 7:34 PM");
    expect(formatDate(new Date(2026, 0, 2, 0, 5).getTime())).toBe("1/2/2026 12:05 AM");
  });
});

describe("typeName", () => {
  it("uses Explorer-friendly type names", () => {
    expect(typeName(entry({ isDir: true, name: "Archive", extension: null }))).toBe("File folder");
    expect(typeName(entry({ name: "brief.docx", extension: "docx" }))).toBe("Word Document");
    expect(typeName(entry({ name: "notes.pdf", extension: "pdf" }))).toBe("PDF Document");
    expect(typeName(entry({ name: "backup.zip", extension: "zip" }))).toBe(
      "Compressed (zipped) Folder",
    );
    expect(typeName(entry({ name: "Safari.app", extension: "app", isDir: true }))).toBe(
      "Application",
    );
  });
});

describe("paths", () => {
  it("handles macOS paths", () => {
    expect(basename("/Users/rajee/Documents")).toBe("Documents");
    expect(parentPath("/Users/rajee/Documents")).toBe("/Users/rajee");
    expect(parentPath("/Users")).toBe("/");
    expect(parentPath("/")).toBeNull();
    expect(breadcrumbs("/Users/rajee/Documents", "Macintosh HD", "win11://home")).toEqual([
      { label: "Macintosh HD", path: "/" },
      { label: "Users", path: "/Users" },
      { label: "rajee", path: "/Users/rajee" },
      { label: "Documents", path: "/Users/rajee/Documents" },
    ]);
    expect(breadcrumbs("win11://recents", "Macintosh HD", "win11://home")).toEqual([
      { label: "Recents", path: "win11://recents" },
    ]);
    expect(breadcrumbs("win11://network", "Macintosh HD", "win11://home")).toEqual([
      { label: "Network", path: "win11://network" },
    ]);
  });

  it("handles Windows paths for development validation", () => {
    expect(basename("D:\\RKM_SYNC\\fileExplorer")).toBe("fileExplorer");
    expect(parentPath("D:\\RKM_SYNC\\fileExplorer")).toBe("D:\\RKM_SYNC");
    expect(parentPath("D:\\")).toBeNull();
  });
});

describe("displayName", () => {
  it("can hide known extensions", () => {
    expect(displayName(entry({ name: "Project Brief.docx" }), true)).toBe("Project Brief.docx");
    expect(displayName(entry({ name: "Project Brief.docx" }), false)).toBe("Project Brief");
    expect(displayName(entry({ name: "My Folder", isDir: true }), false)).toBe("My Folder");
  });
});
