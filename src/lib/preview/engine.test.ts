import { describe, expect, it } from "vitest";
import { classifyPreview, languageForExtension } from "./engine";
import { highlight } from "./highlight";
import type { PreviewMetadata } from "../types";

function metadata(overrides: Partial<PreviewMetadata> = {}): PreviewMetadata {
  return {
    path: "/tmp/sample",
    name: "sample",
    extension: null,
    contentType: "public.data",
    contentTypeTree: ["public.data"],
    kind: "File",
    size: 12,
    isDir: false,
    isSymlink: false,
    isReadable: true,
    isPackage: false,
    isICloudPlaceholder: false,
    isNetworkVolume: false,
    modified: null,
    created: null,
    duration: null,
    width: null,
    height: null,
    codecs: [],
    pageCount: null,
    tags: [],
    quickLookSupported: true,
    ...overrides,
  };
}

describe("preview classification", () => {
  it("selects specialised renderers from Uniform Type Identifiers", () => {
    expect(
      classifyPreview(metadata({ contentType: "public.jpeg", contentTypeTree: ["public.image"] })).rendererId,
    ).toBe("image");
    expect(
      classifyPreview(metadata({ contentType: "com.adobe.pdf", contentTypeTree: ["com.adobe.pdf"] })).rendererId,
    ).toBe("pdf");
    expect(
      classifyPreview(metadata({ contentType: "public.mpeg-4", contentTypeTree: ["public.movie"] })).rendererId,
    ).toBe("media");
    expect(
      classifyPreview(metadata({ extension: "zip", contentTypeTree: ["public.archive"] })).rendererId,
    ).toBe("archive");
  });

  it("treats folders and text/code as their own renderers", () => {
    expect(classifyPreview(metadata({ isDir: true, contentType: "public.folder" })).rendererId).toBe("folder");
    expect(classifyPreview(metadata({ extension: "json", contentType: "public.json" })).category).toBe("code");
    expect(classifyPreview(metadata({ extension: "md", contentType: "public.plain-text" })).category).toBe("text");
  });

  it("falls back to Quick Look for documents and unknown files", () => {
    expect(classifyPreview(metadata({ extension: "docx" })).rendererId).toBe("quicklook");
    expect(classifyPreview(metadata({ extension: "xyz" })).rendererId).toBe("quicklook");
  });

  it("maps extensions to syntax languages", () => {
    expect(languageForExtension("ts")).toBe("typescript");
    expect(languageForExtension("plist")).toBe("xml");
    expect(languageForExtension("yaml")).toBe("yaml");
    expect(languageForExtension(null)).toBe("text");
  });
});

describe("preview syntax tokenizer", () => {
  it("separates strings, numbers, keywords and comments without altering text", () => {
    const source = 'const answer = 42; // comment\n"hello"';
    const tokens = highlight(source, "javascript");
    expect(tokens.map((token) => token.text).join("")).toBe(source);
    expect(tokens.some((token) => token.type === "keyword")).toBe(true);
    expect(tokens.some((token) => token.type === "number")).toBe(true);
    expect(tokens.some((token) => token.type === "string")).toBe(true);
    expect(tokens.some((token) => token.type === "comment")).toBe(true);
  });

  it("marks JSON keys and keeps large text plain", () => {
    const tokens = highlight('{"name": "MAXplorer"}', "json");
    expect(tokens.some((token) => token.type === "key")).toBe(true);
    const large = "x".repeat(250_000);
    expect(highlight(large, "json")).toEqual([{ text: large, type: "plain" }]);
  });
});
