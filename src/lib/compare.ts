import type { ComparisonEntry, FolderComparison } from "./types";

export type ComparisonCategory =
  | "leftOnly"
  | "rightOnly"
  | "size"
  | "modified"
  | "content"
  | "identical";

export function comparisonCategory(entry: ComparisonEntry): ComparisonCategory {
  if (entry.leftPath && !entry.rightPath) return "leftOnly";
  if (!entry.leftPath && entry.rightPath) return "rightOnly";
  if (entry.contentEqual === false) return "content";
  if (entry.sizeDiffers) return "size";
  if (entry.modifiedDiffers) return "modified";
  return "identical";
}

export function isComparisonDifference(entry: ComparisonEntry): boolean {
  return comparisonCategory(entry) !== "identical";
}

export function visibleComparisonEntries(
  comparison: FolderComparison,
  differencesOnly: boolean,
): ComparisonEntry[] {
  return differencesOnly
    ? comparison.entries.filter(isComparisonDifference)
    : comparison.entries;
}

export function comparisonCategoryLabel(category: ComparisonCategory): string {
  switch (category) {
    case "leftOnly":
      return "Only in left";
    case "rightOnly":
      return "Only in right";
    case "size":
      return "Different size";
    case "modified":
      return "Different date";
    case "content":
      return "Different content";
    default:
      return "Identical";
  }
}

/**
 * Paths whose file rows should carry a comparison indicator in each pane.
 * Comparison is read-only and path-based, so it remains valid while sorting.
 */
export function comparisonIndicators(
  comparison: FolderComparison | null,
): { left: Map<string, ComparisonCategory>; right: Map<string, ComparisonCategory> } {
  const left = new Map<string, ComparisonCategory>();
  const right = new Map<string, ComparisonCategory>();
  if (!comparison) return { left, right };
  for (const entry of comparison.entries) {
    const category = comparisonCategory(entry);
    if (category === "identical") continue;
    if (entry.leftPath) left.set(entry.leftPath, category);
    if (entry.rightPath) right.set(entry.rightPath, category);
  }
  return { left, right };
}

export function comparisonSummary(comparison: FolderComparison): string {
  const parts = [
    `${comparison.leftOnly} only left`,
    `${comparison.rightOnly} only right`,
    `${comparison.different} different`,
    `${comparison.identical} identical`,
  ];
  if (comparison.contentVerified) parts.push(`${comparison.contentVerified} content checked`);
  if (comparison.errors) parts.push(`${comparison.errors} read errors`);
  return parts.join(" | ");
}
