import type { IconPack } from "./model";

/**
 * Icon packs are a separate axis from colour themes, exactly like the
 * interface theme is separate from light/dark. A theme can remember a pack, and
 * users can also choose a pack for the whole application.
 *
 * The built-in packs style the existing icon system through tokens. Imported
 * `.maxIcons` packages can change stroke weight, folder artwork colours and
 * tone without injecting markup or CSS.
 */
export const BUILTIN_ICON_PACKS: readonly IconPack[] = [
  {
    id: "classic",
    name: "MAXplorer Classic",
    description: "The familiar gold folders and balanced chrome icons.",
    author: "MAXplorer",
    builtIn: true,
    strokeWidth: 1.75,
    corner: "rounded",
    monochrome: false,
    folder: {
      backTop: "#f7c948",
      backBottom: "#e0a11c",
      frontTop: "#ffde7a",
      frontBottom: "#f5b93d",
      stroke: "#744a00",
      shine: "#ffffff",
    },
    accent: null,
  },
  {
    id: "soft-rounded",
    name: "Soft Rounded",
    description: "Lighter strokes, cool blue folders, and a gentle silhouette.",
    author: "MAXplorer",
    builtIn: true,
    strokeWidth: 1.5,
    corner: "rounded",
    monochrome: false,
    folder: {
      backTop: "#8cc7fa",
      backBottom: "#3b95f2",
      frontTop: "#a9d8ff",
      frontBottom: "#4aa2f7",
      stroke: "#0c3e78",
      shine: "#ffffff",
    },
    accent: null,
  },
  {
    id: "bold-contrast",
    name: "Bold Contrast",
    description: "Heavier strokes and graphite folders for maximum clarity.",
    author: "MAXplorer",
    builtIn: true,
    strokeWidth: 2.2,
    corner: "square",
    monochrome: false,
    folder: {
      backTop: "#64748b",
      backBottom: "#475569",
      frontTop: "#94a3b8",
      frontBottom: "#64748b",
      stroke: "#1e293b",
      shine: "#f8fafc",
    },
    accent: "#334155",
  },
  {
    id: "mono-ink",
    name: "Mono Ink",
    description: "Monochrome folders and icons for a calm, typographic workspace.",
    author: "MAXplorer",
    builtIn: true,
    strokeWidth: 1.65,
    corner: "rounded",
    monochrome: true,
    folder: {
      backTop: "#e2e8f0",
      backBottom: "#cbd5e1",
      frontTop: "#f8fafc",
      frontBottom: "#e2e8f0",
      stroke: "#64748b",
      shine: "#ffffff",
    },
    accent: "#64748b",
  },
  {
    id: "sunset-folders",
    name: "Sunset Folders",
    description: "Warm coral folders that pair with playful, colourful themes.",
    author: "MAXplorer",
    builtIn: true,
    strokeWidth: 1.8,
    corner: "rounded",
    monochrome: false,
    folder: {
      backTop: "#fdba74",
      backBottom: "#f97316",
      frontTop: "#fed7aa",
      frontBottom: "#fb923c",
      stroke: "#9a3412",
      shine: "#ffffff",
    },
    accent: "#ea580c",
  },
];

export const DEFAULT_ICON_PACK_ID = "classic";

export function iconPackForId(packs: readonly IconPack[], id: string | null | undefined): IconPack {
  return packs.find((pack) => pack.id === id) ?? packs[0] ?? BUILTIN_ICON_PACKS[0];
}

export function mergeIconPacks(customPacks: readonly IconPack[]): IconPack[] {
  const seen = new Set(BUILTIN_ICON_PACKS.map((pack) => pack.id));
  const custom = customPacks.filter((pack) => !seen.has(pack.id));
  return [...BUILTIN_ICON_PACKS, ...custom];
}
