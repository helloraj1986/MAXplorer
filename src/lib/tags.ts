import { basename } from "./format";
import type { FileEntry, TagAssignment, TagDefinition } from "./types";

/**
 * Tag metadata helpers.
 *
 * Everything here is pure and synchronous so the store, persistence parser and
 * tests can share exactly one implementation. Tag assignments are keyed by path
 * and carry a small snapshot, which keeps tag filters useful without walking the
 * filesystem or touching the tagged files themselves.
 */

export const DEFAULT_TAG_COLOR = "#0090ff";

/**
 * Convenience choices for the tag editor. These are suggestions only: users can
 * enter any valid hex colour, and no tags are created automatically.
 */
export const TAG_COLOR_PRESETS: readonly string[] = [
  "#e5484d",
  "#f76b15",
  "#f2b90c",
  "#30a46c",
  "#0090ff",
  "#8e4ec6",
  "#e93d82",
  "#8d8d8d",
];

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeTagColor(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_TAG_COLOR;
  const match = HEX_COLOR.exec(value.trim());
  if (!match) return DEFAULT_TAG_COLOR;
  const compact = match[1].toLowerCase();
  const expanded =
    compact.length === 3
      ? compact
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : compact;
  return `#${expanded}`;
}

export function normalizeTagName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}

export function uniqueTagName(
  tags: TagDefinition[],
  name: string,
  excludeId?: string,
): string {
  const normalized = normalizeTagName(name) || "Tag";
  const taken = new Set(
    tags
      .filter((tag) => tag.id !== excludeId)
      .map((tag) => tag.name.trim().toLowerCase()),
  );
  if (!taken.has(normalized.toLowerCase())) return normalized;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalized} ${index}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${normalized} ${Date.now().toString(36)}`;
}

let tagCounter = 0;

export function createTagDefinition(
  tags: TagDefinition[],
  name: string,
  color: string = DEFAULT_TAG_COLOR,
  now: number = Date.now(),
): TagDefinition {
  const existing = new Set(tags.map((tag) => tag.id));
  let id = "";
  do {
    tagCounter += 1;
    id = `tag-${now.toString(36)}-${tagCounter.toString(36)}`;
  } while (existing.has(id));
  return {
    id,
    name: uniqueTagName(tags, name),
    color: normalizeTagColor(color),
    createdAt: now,
  };
}

/** Stable, case-insensitive identity for a filesystem path. */
export function tagPathKey(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "/";
  return trimmed.toLowerCase();
}

export function samePath(left: string, right: string): boolean {
  return tagPathKey(left) === tagPathKey(right);
}

function stripTrailing(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed || path;
}

/** True when `candidate` is `root` itself or lives inside it. */
export function isPathOrDescendant(candidate: string, root: string): boolean {
  const candidateKey = tagPathKey(candidate);
  const rootKey = tagPathKey(root);
  if (candidateKey === rootKey) return true;
  if (rootKey === "/") return candidateKey.startsWith("/");
  const separator = candidate.includes("\\") && !candidate.includes("/") ? "\\" : "/";
  return candidateKey.startsWith(`${rootKey}${separator}`);
}

/**
 * Rewrites a path when its parent is renamed or moved. Returns `null` when the
 * path is unrelated. The suffix keeps the original casing and separators.
 */
export function replacePathPrefix(path: string, from: string, to: string): string | null {
  if (!path || !from || !to) return null;
  const root = stripTrailing(from);
  if (tagPathKey(path) === tagPathKey(root)) return to;
  if (!isPathOrDescendant(path, root)) return null;
  const suffix = path.slice(root.length);
  const destination = stripTrailing(to);
  if (root === "/") return `${destination}${suffix}`.replace(/[\\/]{2,}/g, "/");
  return `${destination}${suffix}`;
}

export interface TagSnapshot {
  path: string;
  name: string;
  isDir: boolean;
  modified: number | null;
  size: number | null;
}

export function snapshotForPath(
  path: string,
  source?: Partial<FileEntry> | null,
): TagSnapshot {
  return {
    path,
    name: source?.name ?? (basename(path) || path),
    isDir: source?.isDir ?? false,
    modified: source?.modified ?? null,
    size: source?.size ?? null,
  };
}

function mergeAssignmentList(assignments: TagAssignment[]): TagAssignment[] {
  const merged = new Map<string, TagAssignment>();
  for (const assignment of assignments) {
    if (!assignment.path || !assignment.tagIds.length) continue;
    const key = tagPathKey(assignment.path);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...assignment, tagIds: [...new Set(assignment.tagIds)] });
      continue;
    }
    merged.set(key, {
      ...existing,
      ...assignment,
      tagIds: [...new Set([...existing.tagIds, ...assignment.tagIds])],
      updatedAt: Math.max(existing.updatedAt, assignment.updatedAt),
    });
  }
  return [...merged.values()];
}

export function tagIdsForPath(assignments: TagAssignment[], path: string): string[] {
  const key = tagPathKey(path);
  return assignments.find((assignment) => tagPathKey(assignment.path) === key)?.tagIds ?? [];
}

export function pathHasTag(assignments: TagAssignment[], path: string, tagId: string): boolean {
  return tagIdsForPath(assignments, path).includes(tagId);
}

/** Adds or removes one tag across many paths in a single pass. */
export function setTagOnPaths(
  assignments: TagAssignment[],
  paths: string[],
  tagId: string,
  assign: boolean,
  snapshots?: Map<string, TagSnapshot>,
  now: number = Date.now(),
): TagAssignment[] {
  if (!tagId) return assignments;
  const uniquePaths = new Map<string, string>();
  for (const path of paths) {
    if (path) uniquePaths.set(tagPathKey(path), path);
  }
  if (!uniquePaths.size) return assignments;

  if (!assign) {
    return assignments
      .map((assignment) =>
        uniquePaths.has(tagPathKey(assignment.path))
          ? {
              ...assignment,
              tagIds: assignment.tagIds.filter((id) => id !== tagId),
              updatedAt: now,
            }
          : assignment,
      )
      .filter((assignment) => assignment.tagIds.length > 0);
  }

  const byKey = new Map<string, TagAssignment>();
  for (const assignment of assignments) {
    byKey.set(tagPathKey(assignment.path), assignment);
  }
  for (const [key, path] of uniquePaths) {
    const existing = byKey.get(key);
    const snapshot = snapshots?.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        ...(snapshot ?? {}),
        path: existing.path,
        tagIds: existing.tagIds.includes(tagId)
          ? existing.tagIds
          : [...existing.tagIds, tagId],
        updatedAt: now,
      });
    } else {
      const base = snapshot ?? snapshotForPath(path);
      byKey.set(key, {
        ...base,
        path,
        tagIds: [tagId],
        updatedAt: now,
      });
    }
  }
  return mergeAssignmentList([...byKey.values()]);
}

/** Removes tag assignments for a path and every path below it. */
export function removeAssignmentsForPaths(
  assignments: TagAssignment[],
  paths: string[],
): TagAssignment[] {
  const roots = paths.filter(Boolean);
  if (!roots.length) return assignments;
  return assignments.filter(
    (assignment) => !roots.some((root) => isPathOrDescendant(assignment.path, root)),
  );
}

/** Moves/renames tag assignments, including every tagged descendant. */
export function renameAssignmentPaths(
  assignments: TagAssignment[],
  from: string,
  to: string,
  now: number = Date.now(),
): TagAssignment[] {
  if (!from || !to || from === to) return assignments;
  return mergeAssignmentList(
    assignments.map((assignment) => {
      const nextPath = replacePathPrefix(assignment.path, from, to);
      if (!nextPath) return assignment;
      return {
        ...assignment,
        path: nextPath,
        name: samePath(assignment.path, from)
          ? basename(nextPath) || assignment.name
          : assignment.name,
        updatedAt: now,
      };
    }),
  );
}

/** Copies tag assignments to a duplicate/moved destination subtree. */
export function duplicateAssignmentPaths(
  assignments: TagAssignment[],
  from: string,
  to: string,
  now: number = Date.now(),
): TagAssignment[] {
  if (!from || !to) return assignments;
  const copies: TagAssignment[] = [];
  for (const assignment of assignments) {
    const nextPath = replacePathPrefix(assignment.path, from, to);
    if (!nextPath) continue;
    copies.push({
      ...assignment,
      path: nextPath,
      name: samePath(assignment.path, from)
        ? basename(nextPath) || assignment.name
        : assignment.name,
      tagIds: [...assignment.tagIds],
      updatedAt: now,
    });
  }
  return mergeAssignmentList([...assignments, ...copies]);
}

export function pruneTagIds(
  assignments: TagAssignment[],
  validTagIds: Set<string>,
): TagAssignment[] {
  return assignments
    .map((assignment) => ({
      ...assignment,
      tagIds: assignment.tagIds.filter((id) => validTagIds.has(id)),
    }))
    .filter((assignment) => assignment.tagIds.length > 0);
}

export function assignmentFromEntry(entry: FileEntry, tagIds: string[]): TagAssignment {
  return {
    path: entry.path,
    name: entry.name,
    isDir: entry.isDir,
    modified: entry.modified,
    size: entry.size,
    tagIds: [...new Set(tagIds)],
    updatedAt: Date.now(),
  };
}

export function entryFromAssignment(assignment: TagAssignment): FileEntry {
  const dot = assignment.name.lastIndexOf(".");
  return {
    name: assignment.name,
    path: assignment.path,
    isDir: assignment.isDir,
    isSymlink: false,
    size: assignment.size,
    modified: assignment.modified,
    created: null,
    accessed: null,
    extension:
      !assignment.isDir && dot > 0
        ? assignment.name.slice(dot + 1).toLowerCase()
        : null,
    isHidden: assignment.name.startsWith("."),
    isReadOnly: false,
    target: null,
  };
}

/**
 * Tag-filter entries are memoised by assignment-array identity. Store actions
 * always replace the array, so the cache invalidates exactly when tag metadata
 * changes, while selectors get a stable snapshot between updates.
 */
const entriesForTagCache = new WeakMap<TagAssignment[], Map<string, FileEntry[]>>();

/** Every tagged path for one tag, deduplicated by path identity. */
export function entriesForTag(
  assignments: TagAssignment[],
  tagId: string,
): FileEntry[] {
  let byTag = entriesForTagCache.get(assignments);
  if (!byTag) {
    byTag = new Map();
    entriesForTagCache.set(assignments, byTag);
  }
  const cached = byTag.get(tagId);
  if (cached) return cached;

  const seen = new Set<string>();
  const entries: FileEntry[] = [];
  for (const assignment of assignments) {
    if (!assignment.tagIds.includes(tagId)) continue;
    const key = tagPathKey(assignment.path);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entryFromAssignment(assignment));
  }
  byTag.set(tagId, entries);
  return entries;
}

export function countForTag(assignments: TagAssignment[], tagId: string): number {
  return entriesForTag(assignments, tagId).length;
}
