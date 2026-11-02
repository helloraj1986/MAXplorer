import { useMemo } from "react";
import { tagPathKey } from "../lib/tags";
import { useExplorerStore } from "../state/explorerStore";

/**
 * Compact colour dots that show which of the workspace tags a file carries.
 * Colours come from the user's tag definitions, never from a theme token, so a
 * tag keeps its identity when the interface theme changes.
 */
export function TagIndicators({
  path,
  max = 3,
  className,
}: {
  path: string;
  max?: number;
  className?: string;
}) {
  const tags = useExplorerStore((state) => state.tags);
  const tagIds = useExplorerStore(
    (state) =>
      state.tagAssignments.find(
        (assignment) => tagPathKey(assignment.path) === tagPathKey(path),
      )?.tagIds,
  );
  const assigned = useMemo(() => {
    if (!tagIds?.length) return [];
    const byId = new Map(tags.map((tag) => [tag.id, tag]));
    return tagIds
      .map((id) => byId.get(id))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
  }, [tagIds, tags]);

  if (!assigned.length) return null;
  const visible = assigned.slice(0, max);
  const hidden = assigned.length - visible.length;
  return (
    <span
      className={`tag-indicators ${className ?? ""}`}
      aria-label={`Tags: ${assigned.map((tag) => tag.name).join(", ")}`}
      title={assigned.map((tag) => tag.name).join("\n")}
    >
      {visible.map((tag) => (
        <span
          key={tag.id}
          className="tag-dot"
          style={{ backgroundColor: tag.color }}
          aria-hidden="true"
        />
      ))}
      {hidden > 0 ? <span className="tag-dot-more">+{hidden}</span> : null}
    </span>
  );
}
