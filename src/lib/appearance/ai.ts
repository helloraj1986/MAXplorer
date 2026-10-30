import { generateMatchingPalette, mix } from "./color";
import { normalizeThemeDesign, type ThemeAppearance, type ThemeDesign } from "./model";
import { designFromPreset, presetById, THEME_PRESETS, type ThemePreset } from "./presets";

/**
 * Optional natural-language theme creation.
 *
 * MAXplorer never sends a prompt anywhere unless the user explicitly configures
 * a provider. The default provider is local, deterministic and needs no account
 * or API key. Providers may only return a ThemeDesign; the result is normalized
 * against the same schema as a hand-made theme, so generated output cannot add
 * markup, CSS or unsupported tokens.
 */
export interface ThemeGenerationRequest {
  prompt: string;
  baseDesign?: ThemeDesign;
}

export interface ThemeGenerationResult {
  design: ThemeDesign;
  summary: string;
  provider: string;
}

export interface ThemeAIProvider {
  id: string;
  label: string;
  available(): boolean;
  generate(request: ThemeGenerationRequest): Promise<ThemeGenerationResult>;
}

const COLOUR_WORDS: Record<string, { accent: string; hue: number }> = {
  blue: { accent: "#3b82f6", hue: 217 },
  cyan: { accent: "#06b6d4", hue: 189 },
  teal: { accent: "#14b8a6", hue: 173 },
  turquoise: { accent: "#2dd4bf", hue: 173 },
  green: { accent: "#22c55e", hue: 142 },
  emerald: { accent: "#10b981", hue: 160 },
  forest: { accent: "#4d7c0f", hue: 84 },
  purple: { accent: "#8b5cf6", hue: 258 },
  violet: { accent: "#7c3aed", hue: 263 },
  lavender: { accent: "#a78bfa", hue: 255 },
  pink: { accent: "#ec4899", hue: 330 },
  rose: { accent: "#f43f5e", hue: 350 },
  red: { accent: "#ef4444", hue: 0 },
  orange: { accent: "#f97316", hue: 25 },
  amber: { accent: "#f59e0b", hue: 38 },
  gold: { accent: "#eab308", hue: 45 },
  yellow: { accent: "#facc15", hue: 48 },
  brown: { accent: "#a16207", hue: 33 },
  slate: { accent: "#64748b", hue: 215 },
};

const PRESET_KEYWORDS: ReadonlyArray<{ id: string; words: string[] }> = [
  { id: "pure-black-oled", words: ["oled", "pure black", "true black", "black theme", "black"] },
  { id: "high-contrast", words: ["high contrast", "accessible", "visibility", "readable"] },
  { id: "glass", words: ["glass", "frosted", "translucent", "acrylic", "futuristic"] },
  { id: "pastel", words: ["pastel", "soft colours", "soft colors", "gentle"] },
  { id: "colourful", words: ["colourful", "colorful", "vibrant", "bright", "playful"] },
  { id: "ocean-blue", words: ["ocean", "sea", "aqua", "deep blue"] },
  { id: "forest-green", words: ["forest", "nature", "leaf", "green"] },
  { id: "sunset", words: ["sunset", "sunrise", "warm", "evening"] },
  { id: "midnight-dark", words: ["midnight", "indigo", "night"] },
  { id: "windows-inspired", words: ["windows", "fluent", "explorer"] },
  { id: "macos-inspired", words: ["macos", "mac", "finder", "apple"] },
  { id: "modern-minimal", words: ["minimal", "clean", "simple", "professional", "modern"] },
];

function pickPreset(prompt: string, baseDesign?: ThemeDesign): ThemePreset {
  const lower = prompt.toLowerCase();
  let best: { preset: ThemePreset; score: number } | null = null;
  for (const entry of PRESET_KEYWORDS) {
    const score = entry.words.reduce((total, word) => (lower.includes(word) ? total + 1 : total), 0);
    if (score > 0 && (!best || score > best.score)) {
      const preset = presetById(entry.id);
      if (preset) best = { preset, score };
    }
  }
  if (best) return best.preset;
  if (baseDesign) {
    const current = THEME_PRESETS.find(
      (preset) => preset.base === baseDesign.base && preset.appearance === baseDesign.appearance,
    );
    if (current) return current;
  }
  return presetById("modern-minimal") ?? THEME_PRESETS[0];
}

function pickAppearance(prompt: string, fallback: ThemeAppearance): ThemeAppearance {
  const lower = prompt.toLowerCase();
  if (/\b(light|day|bright|white)\b/.test(lower) && !/black/.test(lower)) return "light";
  if (/\b(dark|night|midnight|black|oled)\b/.test(lower)) return "dark";
  return fallback;
}

function pickAccentWord(prompt: string): { accent: string; hue: number } | null {
  const lower = prompt.toLowerCase();
  for (const [word, entry] of Object.entries(COLOUR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return entry;
  }
  return null;
}

function applyPromptDetails(design: ThemeDesign, prompt: string): ThemeDesign {
  const lower = prompt.toLowerCase();
  let next: ThemeDesign = { ...design, style: { ...design.style }, palette: { ...design.palette } };

  if (/\b(rounded|round|soft corners)\b/.test(lower)) next.style.corners = "rounded";
  if (/\b(square|sharp corners|no radius)\b/.test(lower)) next.style.corners = "square";
  if (/\b(compact|dense|tight)\b/.test(lower)) next.style.density = "compact";
  if (/\b(spacious|roomy|airy|relaxed)\b/.test(lower)) next.style.density = "spacious";
  if (/\b(larger icons|big icons|large icons)\b/.test(lower)) next.style.iconSize = "large";
  if (/\b(smaller icons|small icons)\b/.test(lower)) next.style.iconSize = "small";
  if (/\b(larger text|bigger text|large text)\b/.test(lower)) next.style.textSize = "large";
  if (/\b(smaller text|small text)\b/.test(lower)) next.style.textSize = "small";
  if (/\b(flat|no shadows|matte)\b/.test(lower)) next.style.elevation = "flat";
  if (/\b(minimal borders|fewer borders|borderless)\b/.test(lower)) next.style.borders = "minimal";
  if (/\b(strong borders|visible borders|outlined)\b/.test(lower)) next.style.borders = "prominent";
  if (/\b(tinted sidebar|coloured sidebar|colored sidebar)\b/.test(lower)) next.style.sidebar = "tinted";
  if (/\b(monochrome|mono|black and white)\b/.test(lower)) next.iconPackId = "mono-ink";
  if (/\b(colourful icons|colorful icons)\b/.test(lower)) next.iconPackId = "sunset-folders";
  if (/\b(chunky icons|bold icons)\b/.test(lower)) next.iconPackId = "bold-contrast";

  const accentWord = pickAccentWord(prompt);
  if (accentWord) {
    const appearance = next.appearance;
    const generated = generateMatchingPalette(accentWord.accent, appearance);
    next = {
      ...next,
      palette: {
        ...generated,
        // Keep a custom background/sidebar if the user described one.
        background: next.palette.background,
        sidebar: next.palette.sidebar,
        surface: next.palette.surface,
        menu: next.palette.menu,
        accent: accentWord.accent,
        selection: accentWord.accent,
      },
    };
  } else if (/\b(softer colours|softer colors|muted|desaturated)\b/.test(lower)) {
    const softerAccent = mix(next.palette.accent, "#94a3b8", 0.3);
    const generated = generateMatchingPalette(softerAccent, next.appearance);
    next.palette = {
      ...next.palette,
      accent: softerAccent,
      selection: softerAccent,
      background: generated.background,
      sidebar: generated.sidebar,
      menu: generated.menu,
    };
  }
  return next;
}

function summaryFor(design: ThemeDesign, prompt: string): string {
  const mode = design.appearance === "dark" ? "dark" : "light";
  const accent = design.palette.accent;
  const pack = design.iconPackId ? `, with the ${design.iconPackId.replace(/-/g, " ")} icon pack` : "";
  const source = prompt.trim().replace(/\s+/g, " ").slice(0, 80);
  return `A ${mode} look with ${accent} highlights${pack}. Based on “${source}”.`;
}

/** The always-available, no-account, no-network provider. */
export const localThemeProvider: ThemeAIProvider = {
  id: "local",
  label: "Built-in style matcher",
  available: () => true,
  async generate({ prompt, baseDesign }) {
    const preset = pickPreset(prompt, baseDesign);
    const appearance = pickAppearance(prompt, preset.appearance);
    const sourcePalette = preset.palette;
    const start: ThemePreset = {
      ...preset,
      appearance,
      palette:
        appearance === preset.appearance
          ? sourcePalette
          : {
              ...generateMatchingPalette(sourcePalette.accent, appearance),
              selection: sourcePalette.accent,
            },
    };
    const generated = designFromPreset(start, {
      name: baseDesign?.name ?? "My Theme",
      description: `Suggested from a description: ${prompt.trim().slice(0, 120)}`,
      author: baseDesign?.author ?? "",
    });
    const next = applyPromptDetails(
      {
        ...generated,
        id: baseDesign?.id ?? generated.id,
        packageId: baseDesign?.packageId ?? generated.packageId,
        iconPackId: generated.iconPackId,
      },
      prompt,
    );
    const normalized =
      normalizeThemeDesign(next) ?? generated;
    return {
      design: normalized,
      summary: summaryFor(normalized, prompt),
      provider: "local",
    };
  },
};

/**
 * Provider registry. A future AI integration can register a provider here
 * without changing the creator. Unavailable providers are hidden in the UI.
 */
export const themeProviders: ThemeAIProvider[] = [localThemeProvider];

export function availableThemeProviders(): ThemeAIProvider[] {
  return themeProviders.filter((provider) => provider.available());
}

export async function generateThemeFromDescription(
  prompt: string,
  baseDesign?: ThemeDesign,
): Promise<ThemeGenerationResult> {
  const provider = availableThemeProviders()[0] ?? localThemeProvider;
  return provider.generate({ prompt, baseDesign });
}
