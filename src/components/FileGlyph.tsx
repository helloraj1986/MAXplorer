import type { FileCategory } from "../lib/format";
import type { FileEntry } from "../lib/types";
import { FileTypeIcon, type FileTypeIconProps } from "./icons/FileTypeIcon";

/**
 * Backwards-compatible name for the old glyph component. All rendering now
 * flows through the central `FileTypeIcon` system.
 */
export interface FileGlyphProps {
  entry?: FileEntry;
  category?: FileCategory;
  size?: number;
  thumbnail?: boolean;
  className?: string;
}

export function FileGlyph({ entry, category, size = 20, thumbnail = false, className }: FileGlyphProps) {
  return (
    <FileTypeIcon
      entry={entry}
      category={category}
      size={size}
      thumbnail={thumbnail}
      className={className}
    />
  );
}

export type { FileTypeIconProps };
