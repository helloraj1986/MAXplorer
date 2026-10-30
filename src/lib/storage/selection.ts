import { isPathInside } from "../format";
import type {
  CleanupRecommendation,
  StorageDirectory,
  StorageDuplicateFile,
  StorageFile,
  StoragePick,
  StorageSelectionSummary,
} from "./types";

export function pickFromFile(file: StorageFile, source: StoragePick["source"] = "file"): StoragePick {
  return {
    path: file.path,
    name: file.name,
    size: file.size,
    isDirectory: false,
    modified: file.modified,
    category: file.category,
    risk: file.isProtected ? "high" : undefined,
    source,
  };
}

export function pickFromDirectory(directory: StorageDirectory): StoragePick {
  return {
    path: directory.path,
    name: directory.name,
    size: directory.size,
    isDirectory: true,
    modified: directory.modified,
    category: "other",
    risk: directory.isProtected ? "high" : undefined,
    source: "directory",
  };
}

export function pickFromRecommendation(recommendation: CleanupRecommendation): StoragePick {
  return {
    path: recommendation.path,
    name: recommendation.path.split(/[\\/]/).filter(Boolean).pop() ?? recommendation.title,
    size: recommendation.recoverableBytes,
    isDirectory: recommendation.isDirectory,
    modified: recommendation.modified,
    category: recommendation.category,
    risk: recommendation.risk,
    source: "recommendation",
  };
}

export function pickFromDuplicate(file: StorageDuplicateFile): StoragePick {
  return {
    path: file.entry.path,
    name: file.entry.name,
    size: file.entry.size ?? 0,
    isDirectory: false,
    modified: file.entry.modified,
    category: "other",
    source: "duplicate",
  };
}

/**
 * Selection accounting for cleanup. Ancestor selections subsume descendants,
 * so a folder and a file inside it never contribute the same bytes twice.
 */
export function summarizeSelection(picks: StoragePick[]): StorageSelectionSummary {
  const sorted = [...picks].sort(
    (left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path),
  );
  const accepted: StoragePick[] = [];
  const skipped: StoragePick[] = [];
  const seen = new Set<string>();
  for (const pick of sorted) {
    if (seen.has(pick.path)) {
      skipped.push(pick);
      continue;
    }
    seen.add(pick.path);
    if (accepted.some((existing) => isPathInside(pick.path, existing.path))) {
      skipped.push(pick);
      continue;
    }
    accepted.push(pick);
  }
  accepted.sort((left, right) => right.size - left.size || left.path.localeCompare(right.path));
  return {
    picks: accepted,
    skipped,
    totalBytes: accepted.reduce((sum, pick) => sum + pick.size, 0),
    count: accepted.length,
    highRisk: accepted.filter((pick) => pick.risk === "high").length,
    reviewRisk: accepted.filter((pick) => pick.risk === "review").length,
    lowRisk: accepted.filter((pick) => pick.risk === "low").length,
  };
}

export function recommendationSelection(recommendations: CleanupRecommendation[]): StorageSelectionSummary {
  return summarizeSelection(recommendations.map(pickFromRecommendation));
}

export function togglePick(picks: StoragePick[], pick: StoragePick): StoragePick[] {
  return picks.some((item) => item.path === pick.path)
    ? picks.filter((item) => item.path !== pick.path)
    : [...picks, pick];
}

export function addPicks(picks: StoragePick[], additions: StoragePick[]): StoragePick[] {
  const known = new Set(picks.map((pick) => pick.path));
  const next = [...picks];
  for (const pick of additions) {
    if (!known.has(pick.path)) {
      known.add(pick.path);
      next.push(pick);
    }
  }
  return next;
}

export function removePicks(picks: StoragePick[], paths: string[]): StoragePick[] {
  const removed = new Set(paths);
  return picks.filter((pick) => !removed.has(pick.path));
}

/** Duplicate groups must always keep at least one verified copy. */
export function canSelectDuplicate(
  groupFilePaths: string[],
  selectedPaths: string[],
  candidate: string,
): { allowed: boolean; reason?: string } {
  if (!groupFilePaths.includes(candidate)) {
    return { allowed: false, reason: "This file is not part of the duplicate group." };
  }
  if (selectedPaths.includes(candidate)) {
    return { allowed: true };
  }
  const selectedInGroup = groupFilePaths.filter((path) => selectedPaths.includes(path));
  if (selectedInGroup.length >= groupFilePaths.length - 1) {
    return {
      allowed: false,
      reason: "At least one verified copy must remain in every duplicate group.",
    };
  }
  return { allowed: true };
}

export function cleanupPicksAreSafeToTrash(summary: StorageSelectionSummary): boolean {
  return summary.highRisk === 0;
}
