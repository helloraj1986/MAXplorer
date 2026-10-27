import type { FileEntry, GroupBy, SortDirection, SortKey } from "./types";
import { fileCategory, naturalCompare, typeName } from "./format";

export interface EntryGroup {
  key: string;
  label: string;
  entries: FileEntry[];
}

function compareEntries(left: FileEntry, right: FileEntry, key: SortKey): number {
  if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
  switch (key) {
    case "name":
      return naturalCompare(left.name, right.name);
    case "date": {
      const leftValue = left.modified ?? 0;
      const rightValue = right.modified ?? 0;
      return leftValue - rightValue;
    }
    case "type": {
      const leftType = left.isDir ? "File folder" : typeName(left);
      const rightType = right.isDir ? "File folder" : typeName(right);
      const result = naturalCompare(leftType, rightType);
      return result !== 0 ? result : naturalCompare(left.name, right.name);
    }
    case "size": {
      const leftValue = left.size ?? -1;
      const rightValue = right.size ?? -1;
      return leftValue - rightValue;
    }
    default:
      return 0;
  }
}

export function sortEntries(
  entries: FileEntry[],
  key: SortKey,
  direction: SortDirection,
): FileEntry[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...entries].sort((left, right) => {
    const result = compareEntries(left, right, key);
    if (result === 0) return naturalCompare(left.name, right.name);
    if (left.isDir !== right.isDir) return result;
    return result * factor;
  });
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dateGroupLabel(timestamp: number | null): string {
  if (timestamp == null) return "Unknown";
  const now = new Date();
  const today = startOfDay(now);
  const value = timestamp;
  const day = 86_400_000;
  if (value >= today) return "Today";
  if (value >= today - day) return "Yesterday";
  if (value >= today - 7 * day) return "Last week";
  if (value >= new Date(now.getFullYear(), now.getMonth(), 1).getTime()) {
    return "Earlier this month";
  }
  if (value >= new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()) {
    return "Last month";
  }
  if (value >= new Date(now.getFullYear(), 0, 1).getTime()) return "Earlier this year";
  return "Long ago";
}

function sizeGroupLabel(size: number | null): string {
  if (size == null || size === 0) return "Empty";
  if (size <= 16 * 1024) return "Tiny";
  if (size <= 1024 * 1024) return "Small";
  if (size <= 100 * 1024 * 1024) return "Medium";
  if (size <= 1024 * 1024 * 1024) return "Large";
  return "Huge";
}

function categoryLabel(entry: FileEntry): string {
  if (entry.isDir) return "Folders";
  switch (fileCategory(entry)) {
    case "image":
      return "Pictures";
    case "video":
      return "Videos";
    case "audio":
      return "Music";
    case "document":
    case "sheet":
    case "slides":
    case "text":
    case "code":
    case "pdf":
      return "Documents";
    case "archive":
      return "Compressed";
    case "executable":
      return "Applications";
    default:
      return "Other";
  }
}

const TYPE_ORDER = [
  "Folders",
  "Documents",
  "Pictures",
  "Music",
  "Videos",
  "Compressed",
  "Applications",
  "Other",
];
const DATE_ORDER = [
  "Today",
  "Yesterday",
  "Last week",
  "Earlier this month",
  "Last month",
  "Earlier this year",
  "Long ago",
  "Unknown",
];
const SIZE_ORDER = ["Empty", "Tiny", "Small", "Medium", "Large", "Huge"];

export function groupEntries(entries: FileEntry[], groupBy: GroupBy): EntryGroup[] {
  if (groupBy === "none") return [{ key: "all", label: "", entries }];
  const buckets = new Map<string, FileEntry[]>();
  for (const entry of entries) {
    const label =
      groupBy === "type"
        ? categoryLabel(entry)
        : groupBy === "date"
          ? dateGroupLabel(entry.modified)
          : sizeGroupLabel(entry.size);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(entry);
    else buckets.set(label, [entry]);
  }
  const order = groupBy === "type" ? TYPE_ORDER : groupBy === "date" ? DATE_ORDER : SIZE_ORDER;
  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({
      key: label,
      label,
      entries: buckets.get(label) ?? [],
    }));
}

export function filterEntries(entries: FileEntry[], query: string): FileEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return entries;
  return entries.filter((entry) => entry.name.toLowerCase().includes(trimmed));
}
