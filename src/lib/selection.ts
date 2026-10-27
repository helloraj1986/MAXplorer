import type { FileEntry } from "./types";

export function selectionStats(entries: FileEntry[], selection: string[]): {
  count: number;
  bytes: number;
  entries: FileEntry[];
} {
  const selectedSet = new Set(selection);
  const selectedEntries = entries.filter((entry) => selectedSet.has(entry.path));
  return {
    count: selectedEntries.length,
    bytes: selectedEntries.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.size ?? 0), 0),
    entries: selectedEntries,
  };
}

export function pruneSelection(entries: FileEntry[], selection: string[]): string[] {
  const available = new Set(entries.map((entry) => entry.path));
  const next = selection.filter((path) => available.has(path));
  return next.length === selection.length ? selection : next;
}

export function toggleSelection(
  selection: string[],
  path: string,
): { selection: string[]; anchorPath: string } {
  if (selection.includes(path)) {
    return { selection: selection.filter((value) => value !== path), anchorPath: path };
  }
  return { selection: [...selection, path], anchorPath: path };
}

export function rangeSelection(
  entries: FileEntry[],
  selection: string[],
  anchorPath: string | null,
  targetPath: string,
  additive: boolean,
): { selection: string[]; anchorPath: string } {
  const targetIndex = entries.findIndex((entry) => entry.path === targetPath);
  if (targetIndex < 0) return { selection, anchorPath: targetPath };
  const anchorIndex = anchorPath
    ? entries.findIndex((entry) => entry.path === anchorPath)
    : -1;
  if (anchorIndex < 0) {
    return {
      selection: additive ? Array.from(new Set([...selection, targetPath])) : [targetPath],
      anchorPath: targetPath,
    };
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  const range = entries.slice(start, end + 1).map((entry) => entry.path);
  return {
    selection: additive ? Array.from(new Set([...selection, ...range])) : range,
    anchorPath: anchorPath ?? targetPath,
  };
}

export function singleSelection(path: string): string[] {
  return [path];
}

export function selectAll(entries: FileEntry[]): string[] {
  return entries.map((entry) => entry.path);
}
