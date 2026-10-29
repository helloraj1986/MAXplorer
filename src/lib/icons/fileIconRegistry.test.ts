import { describe, expect, it } from "vitest";
import type { FileEntry } from "../types";
import {
  accentVariable,
  compoundExtensionOf,
  extensionOfName,
  fileVisualForEntry,
  registeredExtensions,
  registryKindCount,
  resolveFileVisual,
} from "./fileIconRegistry";

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

describe("file icon registry", () => {
  it("maps the documented document formats", () => {
    expect(fileVisualForEntry(entry({ name: "report.pdf", extension: "pdf" })).kind).toBe("pdf");
    expect(fileVisualForEntry(entry({ name: "brief.docx", extension: "docx" })).kind).toBe("word");
    expect(fileVisualForEntry(entry({ name: "budget.xlsx", extension: "xlsx" })).kind).toBe("sheet");
    expect(fileVisualForEntry(entry({ name: "deck.pptx", extension: "pptx" })).kind).toBe("slides");
    expect(fileVisualForEntry(entry({ name: "notes.txt", extension: "txt" })).kind).toBe("text");
    expect(fileVisualForEntry(entry({ name: "notes.rtf", extension: "rtf" })).kind).toBe("rtf");
    expect(fileVisualForEntry(entry({ name: "data.csv", extension: "csv" })).kind).toBe("csv");
    expect(fileVisualForEntry(entry({ name: "README.md", extension: "md" })).kind).toBe("markdown");
    expect(fileVisualForEntry(entry({ name: "book.epub", extension: "epub" })).kind).toBe("ebook");
  });

  it("maps image, media and archive formats", () => {
    expect(fileVisualForEntry(entry({ name: "photo.PNG", extension: "png" })).kind).toBe("image");
    expect(fileVisualForEntry(entry({ name: "clip.mov", extension: "mov" })).kind).toBe("video");
    expect(fileVisualForEntry(entry({ name: "song.flac", extension: "flac" })).kind).toBe("audio");
    expect(fileVisualForEntry(entry({ name: "backup.zip", extension: "zip" })).kind).toBe("archive");
    expect(fileVisualForEntry(entry({ name: "installer.dmg", extension: "dmg" })).kind).toBe("diskImage");
    expect(fileVisualForEntry(entry({ name: "image.iso", extension: "iso" })).kind).toBe("virtualDisk");
  });

  it("maps development formats without opening the file", () => {
    expect(fileVisualForEntry(entry({ name: "app.js", extension: "js" })).kind).toBe("javascript");
    expect(fileVisualForEntry(entry({ name: "app.tsx", extension: "tsx" })).kind).toBe("typescript");
    expect(fileVisualForEntry(entry({ name: "index.html", extension: "html" })).kind).toBe("html");
    expect(fileVisualForEntry(entry({ name: "styles.scss", extension: "scss" })).kind).toBe("css");
    expect(fileVisualForEntry(entry({ name: "data.json", extension: "json" })).kind).toBe("json");
    expect(fileVisualForEntry(entry({ name: "config.yaml", extension: "yaml" })).kind).toBe("yaml");
    expect(fileVisualForEntry(entry({ name: "main.rs", extension: "rs" })).kind).toBe("rust");
    expect(fileVisualForEntry(entry({ name: "main.go", extension: "go" })).kind).toBe("go");
    expect(fileVisualForEntry(entry({ name: "main.py", extension: "py" })).kind).toBe("python");
    expect(fileVisualForEntry(entry({ name: "Main.java", extension: "java" })).kind).toBe("java");
    expect(fileVisualForEntry(entry({ name: "main.c", extension: "c" })).kind).toBe("c");
    expect(fileVisualForEntry(entry({ name: "main.cpp", extension: "cpp" })).kind).toBe("cpp");
    expect(fileVisualForEntry(entry({ name: "run.sh", extension: "sh" })).kind).toBe("shell");
    expect(fileVisualForEntry(entry({ name: "query.sql", extension: "sql" })).kind).toBe("sql");
  });

  it("maps applications, executables, fonts, certificates, databases and config", () => {
    expect(fileVisualForEntry(entry({ name: "Safari.app", extension: null, isDir: true })).kind).toBe("app");
    expect(fileVisualForEntry(entry({ name: "setup.exe", extension: "exe" })).kind).toBe("executable");
    expect(fileVisualForEntry(entry({ name: "Inter.woff2", extension: "woff2" })).kind).toBe("font");
    expect(fileVisualForEntry(entry({ name: "server.pem", extension: "pem" })).kind).toBe("certificate");
    expect(fileVisualForEntry(entry({ name: "cache.sqlite", extension: "sqlite" })).kind).toBe("database");
    expect(fileVisualForEntry(entry({ name: "app.toml", extension: "toml" })).kind).toBe("config");
  });

  it("is case-insensitive and uses the extension field when present", () => {
    expect(fileVisualForEntry(entry({ name: "PHOTO.JPEG", extension: "JPEG" })).kind).toBe("image");
    expect(fileVisualForEntry(entry({ name: "DOCUMENT.PDF", extension: null })).kind).toBe("pdf");
    expect(extensionOfName("Archive.TAR.GZ")).toBe("gz");
    expect(compoundExtensionOf("Archive.TAR.GZ")).toBe("tar.gz");
  });

  it("handles compound extensions before the final suffix", () => {
    const visual = fileVisualForEntry(entry({ name: "backup.tar.gz", extension: "gz" }));
    expect(visual.kind).toBe("archive");
    expect(visual.matchedExtension).toBe("tar.gz");
  });

  it("handles dotfiles and files without extensions deterministically", () => {
    const gitignore = fileVisualForEntry(entry({ name: ".gitignore", extension: null }));
    expect(gitignore.kind).toBe("config");
    expect(gitignore.badgeText).toBe("GIT");

    const noExtension = fileVisualForEntry(entry({ name: "README", extension: null }));
    expect(noExtension.kind).toBe("text");

    const plain = fileVisualForEntry(entry({ name: "Makefile", extension: null }));
    expect(plain.kind).toBe("config");

    const hiddenPlain = fileVisualForEntry(entry({ name: ".mystery", extension: null }));
    expect(hiddenPlain.kind).toBe("unknown");
    expect(hiddenPlain.badgeText).toBe("");
  });

  it("returns a clean fallback for unknown and missing extensions", () => {
    const unknown = fileVisualForEntry(entry({ name: "weird.xyz", extension: "xyz" }));
    expect(unknown.kind).toBe("unknown");
    expect(unknown.badgeText).toBe("XYZ");

    const missing = resolveFileVisual({ name: "mystery" });
    expect(missing.kind).toBe("unknown");
    expect(missing.badgeText).toBe("");
    expect(missing.category).toBe("file");
  });

  it("uses MIME metadata when the name has no useful extension", () => {
    expect(resolveFileVisual({ name: "download", mimeType: "image/png" }).kind).toBe("image");
    expect(resolveFileVisual({ name: "download", mimeType: "application/pdf" }).kind).toBe("pdf");
    expect(resolveFileVisual({ name: "download", mimeType: "text/plain; charset=utf-8" }).kind).toBe("text");
    expect(resolveFileVisual({ name: "download", mimeType: "application/x-unknown" }).kind).toBe("unknown");
  });

  it("resolves folders and symlinked folders without touching the filesystem", () => {
    expect(fileVisualForEntry(entry({ name: "Projects", isDir: true, extension: null })).kind).toBe("folder");
    const linked = fileVisualForEntry(entry({ name: "Projects Link", isDir: true, isSymlink: true, extension: null }));
    expect(linked.kind).toBe("folder");
  });

  it("exposes a broad, extensible extension registry", () => {
    expect(registryKindCount()).toBeGreaterThan(40);
    expect(registeredExtensions()).toContain("pdf");
    expect(registeredExtensions()).toContain("tsx");
    expect(registeredExtensions()).toContain("heic");
    expect(accentVariable("pdf")).toBe("var(--file-accent-pdf)");
  });
});
