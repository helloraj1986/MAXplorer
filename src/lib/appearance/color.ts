/**
 * Small, dependency-free colour toolkit for the visual theme creator.
 *
 * Ordinary users never see colour maths. The creator uses these helpers to
 * generate coordinated palettes, keep generated text readable, and warn when a
 * hand-picked combination would be hard to read.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function byte(value: number): number {
  return clamp(Math.round(value), 0, 255);
}

/** Accepts #rgb, #rrggbb, rgb() and rgb() with an alpha channel. */
export function parseColor(input: unknown): Rgb | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((part) => part + part)
            .join("")
        : hex[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    };
  }
  const rgb = value.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/);
  if (rgb) {
    return { r: byte(Number(rgb[1])), g: byte(Number(rgb[2])), b: byte(Number(rgb[3])) };
  }
  return null;
}

export function isColor(value: unknown): value is string {
  return parseColor(value) !== null;
}

/** Normalises any supported colour to lowercase #rrggbb. */
export function normalizeHex(value: unknown, fallback = "#000000"): string {
  const parsed = parseColor(value);
  if (!parsed) return fallback;
  return rgbToHex(parsed);
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((channel) => byte(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(value: string): Rgb {
  return parseColor(value) ?? { r: 0, g: 0, b: 0 };
}

export function mix(first: string, second: string, weight = 0.5): string {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  const ratio = clamp(weight, 0, 1);
  return rgbToHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  });
}

export function withAlpha(value: string, alpha: number): string {
  const { r, g, b } = hexToRgb(value);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(clamp(alpha, 0, 1) * 1000) / 1000})`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { h: hue, s: saturation * 100, l: lightness * 100 };
}

function hslChannel(p: number, q: number, t: number): number {
  let channel = t;
  if (channel < 0) channel += 1;
  if (channel > 1) channel -= 1;
  if (channel < 1 / 6) return p + (q - p) * 6 * channel;
  if (channel < 1 / 2) return q;
  if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
  return p;
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360;
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;
  if (saturation === 0) {
    const channel = byte(lightness * 255);
    return rgbToHex({ r: channel, g: channel, b: channel });
  }
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return rgbToHex({
    r: hslChannel(p, q, hue + 1 / 3) * 255,
    g: hslChannel(p, q, hue) * 255,
    b: hslChannel(p, q, hue - 1 / 3) * 255,
  });
}

export function hueOf(value: string): number {
  return rgbToHsl(hexToRgb(value)).h;
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(value: string): number {
  const { r, g, b } = hexToRgb(value);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** WCAG 2.1 contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/** Black-ish and white-ish text choices that stay close to the hue's tone. */
export function readableOn(background: string, light = "#ffffff", dark = "#111827"): string {
  return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}

/**
 * Nudges a foreground toward the most readable extreme until it reaches the
 * requested contrast ratio. Used for generated secondary text and button labels.
 */
export function ensureContrast(foreground: string, background: string, minimum = 4.5): string {
  if (contrastRatio(foreground, background) >= minimum) return normalizeHex(foreground);
  const target = readableOn(background, "#ffffff", "#0b1020");
  let candidate = foreground;
  for (let step = 1; step <= 20; step += 1) {
    candidate = mix(foreground, target, step / 20);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}

/** Tints a neutral background toward an accent without losing readability. */
export function tint(background: string, accent: string, amount = 0.08): string {
  return mix(background, accent, amount);
}

export interface GeneratedPalette {
  accent: string;
  background: string;
  surface: string;
  sidebar: string;
  selection: string;
  text: string;
  menu: string;
}

/**
 * "Auto generate matching colours": one accent in, a coordinated full palette
 * out, with readable text and a surface hierarchy appropriate for the mode.
 */
export function generateMatchingPalette(accent: string, appearance: "light" | "dark"): GeneratedPalette {
  const source = normalizeHex(accent, appearance === "dark" ? "#60cdff" : "#0067c0");
  const hue = hueOf(source);
  if (appearance === "dark") {
    const background = hslToHex(hue, 20, 8);
    const surface = hslToHex(hue, 18, 11);
    return {
      accent: source,
      background,
      surface,
      sidebar: hslToHex(hue, 22, 9),
      selection: source,
      text: ensureContrast(hslToHex(hue, 12, 96), surface, 12),
      menu: hslToHex(hue, 18, 15),
    };
  }
  return {
    accent: source,
    background: hslToHex(hue, 30, 96),
    surface: "#ffffff",
    sidebar: hslToHex(hue, 26, 94),
    selection: source,
    text: ensureContrast(hslToHex(hue, 24, 13), "#ffffff", 12),
    menu: "#ffffff",
  };
}

/**
 * Returns a copy of the palette with unreadable text repaired. The creator uses
 * this for its one-click "Fix contrast" suggestion.
 */
export function repairPalette<T extends GeneratedPalette>(palette: T): T {
  return {
    ...palette,
    text: ensureContrast(palette.text, palette.surface, 7),
  };
}
