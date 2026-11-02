import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAG_COLOR,
  countForTag,
  createTagDefinition,
  duplicateAssignmentPaths,
  entriesForTag,
  isPathOrDescendant,
  normalizeTagColor,
  normalizeTagName,
  pathHasTag,
  pruneTagIds,
  removeAssignmentsForPaths,
  renameAssignmentPaths,
  replacePathPrefix,
  setTagOnPaths,
  tagIdsForPath,
  tagPathKey,
  uniqueTagName,
} from "./tags";
import type { TagAssignment, TagDefinition } from "./types";

function assignment(path: string, tagIds: string[]): TagAssignment {
  return {
    path,
    name: path.split("/").filter(Boolean).pop() ?? path,
    isDir: false,
    modified: null,
    size: null,
    tagIds,
    updatedAt: 1,
  };
}

const tags: TagDefinition[] = [
  { id: "tag-work", name: "Work", color: "#0090ff", createdAt: 1 },
  { id: "tag-home", name: "Home", color: "#30a46c", createdAt: 2 },
];

describe("tag definitions", () => {
  it("normalizes names and accepts any valid hex colour", () => {
    expect(normalizeTagName("  Client   Work  ")).toBe("Client Work");
    expect(normalizeTagColor("#ABC")).toBe("#aabbcc");
    expect(normalizeTagColor("30a46c")).toBe("#30a46c");
    expect(normalizeTagColor("not-a-colour")).toBe(DEFAULT_TAG_COLOR);
  });

  it("creates unique names and stable ids", () => {
    expect(uniqueTagName(tags, "work")).toBe("work 2");
    expect(uniqueTagName(tags, "Work", "tag-work")).toBe("Work");
    const created = createTagDefinition(tags, "Work", "#fff", 1000);
    expect(created.name).toBe("Work 2");
    expect(created.color).toBe("#ffffff");
    expect(created.id).toMatch(/^tag-/);
    expect(tags.some((tag) => tag.id === created.id)).toBe(false);
  });
});

describe("tag path identity", () => {
  it("compares paths case-insensitively and ignores trailing separators", () => {
    expect(tagPathKey("/Users/Test/Folder/")).toBe("/users/test/folder");
    expect(isPathOrDescendant("/Users/Test/Folder/a.txt", "/Users/Test/Folder")).toBe(true);
    expect(isPathOrDescendant("/Users/Test/Folderish/a.txt", "/Users/Test/Folder")).toBe(false);
  });

  it("rewrites only a matching subtree and keeps the suffix", () => {
    expect(replacePathPrefix("/a/old/file.txt", "/a/old", "/a/new")).toBe("/a/new/file.txt");
    expect(replacePathPrefix("/a/old", "/a/old", "/a/new")).toBe("/a/new");
    expect(replacePathPrefix("/a/other/file.txt", "/a/old", "/a/new")).toBeNull();
  });
});

describe("tag assignments", () => {
  it("adds tags to many paths and removes them again", () => {
    const added = setTagOnPaths(
      [],
      ["/a/file.txt", "/a/file.txt", "/a/folder"],
      "tag-work",
      true,
      undefined,
      5,
    );
    expect(added).toHaveLength(2);
    expect(tagIdsForPath(added, "/a/file.txt")).toEqual(["tag-work"]);
    expect(pathHasTag(added, "/a/folder", "tag-work")).toBe(true);

    const removed = setTagOnPaths(added, ["/a/file.txt"], "tag-work", false, undefined, 6);
    expect(tagIdsForPath(removed, "/a/file.txt")).toEqual([]);
    expect(pathHasTag(removed, "/a/folder", "tag-work")).toBe(true);
  });

  it("keeps multiple tags and deduplicates filter entries by path", () => {
    let assignments = setTagOnPaths([], ["/a/file.txt"], "tag-work", true);
    assignments = setTagOnPaths(assignments, ["/a/file.txt"], "tag-home", true);
    expect(tagIdsForPath(assignments, "/A/FILE.TXT")).toEqual(["tag-work", "tag-home"]);

    // A stale duplicate must not create two rows or two counts.
    const withDuplicate = [...assignments, assignment("/a/file.txt", ["tag-work"])];
    expect(entriesForTag(withDuplicate, "tag-work")).toHaveLength(1);
    expect(countForTag(withDuplicate, "tag-work")).toBe(1);
  });

  it("returns stable filter snapshots until tag metadata changes", () => {
    const assignments = [assignment("/a/file.txt", ["tag-work"])];
    const first = entriesForTag(assignments, "tag-work");
    expect(entriesForTag(assignments, "tag-work")).toBe(first);

    const updated = setTagOnPaths(assignments, ["/a/second.txt"], "tag-work", true);
    expect(entriesForTag(updated, "tag-work")).not.toBe(first);
    expect(entriesForTag(updated, "tag-work")).toHaveLength(2);
  });

  it("moves and renames every tagged descendant", () => {
    const assignments = [
      assignment("/a/old", ["tag-work"]),
      assignment("/a/old/file.txt", ["tag-home"]),
      assignment("/a/other.txt", ["tag-work"]),
    ];
    const renamed = renameAssignmentPaths(assignments, "/a/old", "/a/new", 10);
    expect(tagIdsForPath(renamed, "/a/new")).toEqual(["tag-work"]);
    expect(tagIdsForPath(renamed, "/a/new/file.txt")).toEqual(["tag-home"]);
    expect(tagIdsForPath(renamed, "/a/other.txt")).toEqual(["tag-work"]);
  });

  it("copies assignments to a duplicate subtree without changing the source", () => {
    const assignments = [
      assignment("/a/report.txt", ["tag-work"]),
      assignment("/a/folder/inside.txt", ["tag-home"]),
    ];
    const copied = duplicateAssignmentPaths(assignments, "/a", "/a copy", 10);
    expect(copied).toHaveLength(4);
    expect(tagIdsForPath(copied, "/a/report.txt")).toEqual(["tag-work"]);
    expect(tagIdsForPath(copied, "/a copy/report.txt")).toEqual(["tag-work"]);
    expect(tagIdsForPath(copied, "/a copy/folder/inside.txt")).toEqual(["tag-home"]);
  });

  it("removes a deleted subtree and prunes deleted tags", () => {
    const assignments = [
      assignment("/a/folder/inside.txt", ["tag-work", "tag-home"]),
      assignment("/a/keep.txt", ["tag-work"]),
    ];
    const removed = removeAssignmentsForPaths(assignments, ["/a/folder"]);
    expect(removed.map((item) => item.path)).toEqual(["/a/keep.txt"]);

    const pruned = pruneTagIds(assignments, new Set(["tag-home"]));
    expect(tagIdsForPath(pruned, "/a/folder/inside.txt")).toEqual(["tag-home"]);
    expect(tagIdsForPath(pruned, "/a/keep.txt")).toEqual([]);
  });
});
