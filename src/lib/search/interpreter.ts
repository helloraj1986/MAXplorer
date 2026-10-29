import {
  DEFAULT_SEARCH_FILTERS,
  KIND_LABELS,
  type SearchChip,
  type SearchContentMode,
  type SearchDateRange,
  type SearchFilters,
  type SearchInterpretation,
  type SearchKind,
  type SearchLocation,
  type SearchMatchMode,
  type SearchRequestPayload,
  type SearchScopeId,
  type SearchSort,
  type SearchSortDirection,
} from "./types";

const DAY = 24 * 60 * 60 * 1000;
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const KIND_WORDS: Array<{ pattern: string; kind: SearchKind }> = [
  { pattern: "pdfs?", kind: "pdf" },
  { pattern: "images?(?!\\s+of\\b)|photos?(?!\\s+of\\b)|pictures?(?!\\s+of\\b)", kind: "image" },
  { pattern: "videos?|movies?", kind: "video" },
  { pattern: "audio|music|songs?", kind: "audio" },
  { pattern: "archives?|zip files?", kind: "archive" },
  { pattern: "folders?|directories?", kind: "folder" },
  { pattern: "spreadsheets?|workbooks?", kind: "sheet" },
  { pattern: "presentations?|slides|decks?", kind: "slides" },
  { pattern: "documents?|docs?", kind: "document" },
  { pattern: "applications?|apps?", kind: "app" },
  { pattern: "source code|code files?", kind: "code" },
  { pattern: "fonts?", kind: "font" },
  { pattern: "text files?", kind: "text" },
];

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: ["ts", "tsx"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  python: ["py"],
  rust: ["rs"],
  swift: ["swift"],
  java: ["java"],
  kotlin: ["kt", "kts"],
  golang: ["go"],
  go: ["go"],
  ruby: ["rb"],
  php: ["php"],
  html: ["html", "htm"],
  css: ["css", "scss", "sass", "less"],
  json: ["json", "jsonc", "json5"],
  markdown: ["md", "markdown", "mdx"],
  yaml: ["yaml", "yml"],
  xml: ["xml"],
  sql: ["sql"],
  shell: ["sh", "bash", "zsh", "fish"],
  c: ["c", "h"],
  "c++": ["cpp", "cc", "cxx", "hpp", "hh"],
  csharp: ["cs"],
};

const STOP_WORDS = new Set([
  "find",
  "show",
  "me",
  "all",
  "any",
  "the",
  "a",
  "an",
  "with",
  "of",
  "about",
  "please",
  "files",
  "file",
  "items",
  "item",
  "documents",
  "that",
  "which",
  "where",
  "are",
  "is",
  "my",
  "our",
]);

export interface InterpretContext {
  now?: Date;
  home: string;
  currentFolder: string;
  locations: SearchLocation[];
  selectedFolders?: string[];
  largeFileBytes?: number;
  semanticEnabled?: boolean;
  visualEnabled?: boolean;
}

export interface InterpretedQuery extends SearchInterpretation {
  resolvedDateLabels: string[];
}

export function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function startOfWeek(date: Date): number {
  const day = date.getDay();
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - day));
}

export function startOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

export function startOfYear(date: Date): number {
  return new Date(date.getFullYear(), 0, 1).getTime();
}

export function monthRange(year: number, month: number): SearchDateRange {
  const after = new Date(year, month, 1).getTime();
  const before = new Date(year, month + 1, 1).getTime() - 1;
  return { after, before, label: `${MONTH_NAMES[month][0].toUpperCase()}${MONTH_NAMES[month].slice(1)} ${year}` };
}

function dayRange(date: Date, label: string): SearchDateRange {
  const after = startOfDay(date);
  return { after, before: after + DAY - 1, label };
}

export function parseSize(value: string): number | null {
  const match = value
    .trim()
    .toLowerCase()
    .replace(/,/g, "")
    .match(/^([\d.]+)\s*(b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = match[2];
  const multiplier =
    unit === "b" || unit.startsWith("byte")
      ? 1
      : unit === "kb" || unit === "kib"
        ? 1024
        : unit === "mb" || unit === "mib"
          ? 1024 ** 2
          : unit === "gb" || unit === "gib"
            ? 1024 ** 3
            : 1024 ** 4;
  return Math.round(amount * multiplier);
}

export function formatSizeLabel(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes === 0) return "0 bytes";
  const units = [
    ["TiB", 1024 ** 4],
    ["GiB", 1024 ** 3],
    ["MiB", 1024 ** 2],
    ["KiB", 1024],
  ] as const;
  for (const [label, size] of units) {
    if (bytes >= size) {
      const value = bytes / size;
      return `${Number.isInteger(value) ? value : value.toFixed(1)} ${label}`;
    }
  }
  return `${bytes} bytes`;
}

function dateLabel(range: SearchDateRange | null, prefix: string): string | null {
  if (!range) return null;
  return `${prefix}: ${range.label ?? "Custom range"}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministic natural-language query interpreter. Every constraint it emits is
 * visible as a chip and is re-validated before it reaches the search backend.
 */
export function interpretQuery(raw: string, context: InterpretContext): InterpretedQuery {
  const now = context.now ?? new Date();
  const filters: SearchFilters = {
    ...DEFAULT_SEARCH_FILTERS,
    kinds: [],
    extensions: [],
    locations: [],
  };
  const notes: string[] = [];
  const terms: string[] = [];
  const nameTerms: string[] = [];
  const contentTerms: string[] = [];
  const excludeTerms: string[] = [];
  const locations: string[] = [];
  const resolvedDateLabels: string[] = [];
  let exactPhrase = false;
  let caseSensitive = false;
  let wantsDuplicates = false;
  let semanticHint = false;
  let visualHint = false;
  let working = raw;
  const largeBytes = context.largeFileBytes ?? 100 * 1024 * 1024;

  const replaceMatches = (pattern: RegExp, handler: (match: RegExpExecArray) => string | void): void => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const global = new RegExp(pattern.source, flags);
    let output = "";
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = global.exec(working))) {
      output += working.slice(last, match.index);
      const replacement = handler(match);
      output += replacement ?? " ";
      last = match.index + match[0].length;
      if (match[0].length === 0) global.lastIndex += 1;
    }
    output += working.slice(last);
    working = output;
  };

  const addKind = (kind: SearchKind) => {
    if (!filters.kinds.includes(kind)) filters.kinds.push(kind);
  };
  const addExtensions = (values: string[]) => {
    for (const value of values) {
      const normalized = value.replace(/^\./, "").toLowerCase();
      if (normalized && !filters.extensions.includes(normalized)) filters.extensions.push(normalized);
    }
  };
  const addLocation = (path: string) => {
    if (!locations.includes(path)) locations.push(path);
  };
  const setModified = (range: SearchDateRange | null) => {
    filters.modified = range;
    if (range?.label) resolvedDateLabels.push(`Modified: ${range.label}`);
  };
  const setCreated = (range: SearchDateRange | null) => {
    filters.created = range;
    if (range?.label) resolvedDateLabels.push(`Created: ${range.label}`);
  };
  const setAccessed = (range: SearchDateRange | null) => {
    filters.accessed = range;
    if (range?.label) resolvedDateLabels.push(`Accessed: ${range.label}`);
  };
  const setSize = (min: number | null, max: number | null) => {
    if (min != null) filters.minSize = min;
    if (max != null) filters.maxSize = max;
  };
  const resolveLocation = (value: string): string | null => {
    const needle = value.trim().replace(/^["']|["']$/g, "");
    if (!needle) return null;
    if (needle.startsWith("/") || needle.startsWith("~")) return needle;
    const matches = context.locations.filter(
      (location) =>
        location.name.toLowerCase() === needle.toLowerCase() ||
        location.path.toLowerCase().endsWith(`/${needle.toLowerCase()}`),
    );
    if (matches.length) {
      for (const match of matches) addLocation(match.path);
      return matches[0].name;
    }
    return null;
  };
  const dateRangeFor = (phrase: string): SearchDateRange | null => {
    const lower = phrase.toLowerCase().trim();
    if (lower === "today") return dayRange(now, "Today");
    if (lower === "yesterday") return dayRange(new Date(now.getTime() - DAY), "Yesterday");
    if (lower === "last week" || lower === "past week" || lower === "last 7 days" || lower === "past 7 days") {
      return { after: now.getTime() - 7 * DAY, before: now.getTime(), label: "Last 7 days" };
    }
    if (lower === "this week") {
      return { after: startOfWeek(now), before: now.getTime(), label: "This week" };
    }
    if (lower === "last month" || lower === "past month" || lower === "last 30 days" || lower === "past 30 days") {
      return { after: now.getTime() - 30 * DAY, before: now.getTime(), label: "Last 30 days" };
    }
    if (lower === "this month") {
      return { after: startOfMonth(now), before: now.getTime(), label: "This month" };
    }
    if (lower === "last year" || lower === "past year") {
      return { after: now.getTime() - 365 * DAY, before: now.getTime(), label: "Last 12 months" };
    }
    if (lower === "this year") {
      return { after: startOfYear(now), before: now.getTime(), label: "This year" };
    }
    if (lower === "last 90 days" || lower === "past 90 days") {
      return { after: now.getTime() - 90 * DAY, before: now.getTime(), label: "Last 90 days" };
    }
    const lastN = lower.match(/^(?:last|past)\s+(\d+)\s+(days?|weeks?|months?)$/);
    if (lastN) {
      const count = Number(lastN[1]);
      const unit = lastN[2];
      const span = unit.startsWith("day") ? count * DAY : unit.startsWith("week") ? count * 7 * DAY : count * 30 * DAY;
      return { after: now.getTime() - span, before: now.getTime(), label: `Last ${count} ${unit}` };
    }
    const month = MONTH_NAMES.findIndex((name) => lower.startsWith(name));
    if (month >= 0) {
      const yearMatch = lower.match(/\b(\d{4})\b/);
      let year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
      if (!yearMatch && month > now.getMonth()) year -= 1;
      return monthRange(year, month);
    }
    const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return dayRange(date, `${iso[1]}-${iso[2]}-${iso[3]}`);
    }
    return null;
  };

  // 1. Quoted phrases are literal terms.
  replaceMatches(/"([^"]+)"/, (match) => {
    const phrase = match[1].trim();
    if (phrase) {
      terms.push(phrase);
      exactPhrase = true;
    }
    return " ";
  });

  // 2. Explicit field prefixes.
  replaceMatches(/\b(?:content|text|contains|containing|with text)\s*:\s*("([^"]+)"|[^\s]+)/i, (match) => {
    const value = (match[2] ?? match[1]).replace(/^"|"$/g, "").trim();
    if (value) {
      if (!contentTerms.includes(value)) contentTerms.push(value);
    }
    return " ";
  });
  replaceMatches(/\b(?:name|filename|named)\s*:\s*("([^"]+)"|[^\s]+)/i, (match) => {
    const value = (match[2] ?? match[1]).replace(/^"|"$/g, "").trim();
    if (value) nameTerms.push(value);
    return " ";
  });
  replaceMatches(/\b(?:kind|type)\s*:\s*([a-z0-9]+)/i, (match) => {
    const value = match[1].toLowerCase();
    const known = Object.keys(KIND_LABELS).find((kind) => kind === value);
    if (known) addKind(known as SearchKind);
    else addExtensions([value]);
    return " ";
  });
  replaceMatches(/\b(?:ext|extension)\s*:\s*\.?([a-z0-9]+)/i, (match) => {
    addExtensions([match[1]]);
    return " ";
  });
  replaceMatches(/\b(?:exclude|excluding|without)\s*:?\s*("([^"]+)"|[^\s]+)/i, (match) => {
    const value = (match[2] ?? match[1]).replace(/^"|"$/g, "").trim();
    if (value) excludeTerms.push(value);
    return " ";
  });
  replaceMatches(/\b(?:size)\s*:\s*(>=|<=|>|<|=)?\s*([\d.]+\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib))/i, (match) => {
    const size = parseSize(match[2]);
    if (size != null) {
      const operator = match[1] ?? "";
      if (operator.startsWith(">") || operator === ">=") setSize(size, null);
      else if (operator.startsWith("<") || operator === "<=") setSize(null, size);
      else setSize(size, size);
    }
    return " ";
  });
  replaceMatches(/\b(modified|created|accessed)\s*:\s*(today|yesterday|last week|past week|this week|last month|past month|this month|last year|past year|this year|last \d+ (?:days?|weeks?|months?)|\d{4}-\d{2}-\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?)/i, (match) => {
    const field = match[1].toLowerCase();
    const range = dateRangeFor(match[2]);
    if (!range) {
      notes.push(`I couldn't resolve "${match[2].trim()}" as a date, so it was left as a search term.`);
      terms.push(match[2].trim());
      return " ";
    }
    if (field === "created") setCreated(range);
    else if (field === "accessed") setAccessed(range);
    else setModified(range);
    return " ";
  });

  // 3. Natural-language size constraints.
  replaceMatches(/\b(?:larger than|bigger than|over|above|more than|greater than)\s+([\d.]+\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib))/i, (match) => {
    const size = parseSize(match[1]);
    if (size != null) setSize(size, null);
    return " ";
  });
  replaceMatches(/\b(?:smaller than|under|below|less than)\s+([\d.]+\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib))/i, (match) => {
    const size = parseSize(match[1]);
    if (size != null) setSize(null, size);
    return " ";
  });
  replaceMatches(/\bbetween\s+([\d.]+\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib))\s+and\s+([\d.]+\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib))/i, (match) => {
    const min = parseSize(match[1]);
    const max = parseSize(match[2]);
    if (min != null && max != null) setSize(Math.min(min, max), Math.max(min, max));
    return " ";
  });
  replaceMatches(/\b(\d+(?:\.\d+)?\s*(?:gb|gib|mb|mib|kb|kib|tb|tib))\b/i, (match) => {
    const size = parseSize(match[1]);
    if (size != null) {
      notes.push(`Interpreted "${match[1]}" as a minimum file size. Use size:<value for a maximum.`);
      setSize(size, null);
    }
    return " ";
  });
  replaceMatches(/\b(empty files?|zero-byte files?)\b/i, () => {
    setSize(null, 0);
    return " ";
  });
  replaceMatches(/\b(empty folders?|empty directories?)\b/i, () => {
    setSize(null, 0);
    filters.emptyFolders = true;
    return " ";
  });
  replaceMatches(/\b(large|huge|big)\b(?=\s+(?:files?|items?|videos?|images?|photos?|documents?|pdfs?|folders?|archives?|spreadsheets?|presentations?)\b)/i, () => {
    if (filters.minSize == null) {
      setSize(largeBytes, null);
      notes.push(`"Large" means at least ${formatSizeLabel(largeBytes)}. Change the threshold in Filters.`);
    }
    return " ";
  });
  replaceMatches(/\b(small|tiny)\b(?=\s+(?:files?|items?|videos?|images?|photos?|documents?|pdfs?|folders?|archives?|spreadsheets?|presentations?)\b)/i, () => {
    setSize(null, 1024 * 1024);
    return " ";
  });

  // 4. Natural-language dates. A field word directly before a date phrase
  // selects which timestamp the constraint applies to.
  replaceMatches(/\b(modified|created|accessed)\s+(today|yesterday|last week|past week|this week|last month|past month|this month|last year|past year|this year|last \d+ (?:days?|weeks?|months?))\b/i, (match) => {
    const field = match[1].toLowerCase();
    const range = dateRangeFor(match[2]);
    if (!range) return " ";
    if (field === "created") setCreated(range);
    else if (field === "accessed") setAccessed(range);
    else setModified(range);
    return " ";
  });
  replaceMatches(
    /\b(today|yesterday|last week|past week|this week|last month|past month|this month|last year|past year|this year|last (?:7|30|90) days|past (?:7|30|90) days|last \d+ (?:days?|weeks?|months?))\b/i,
    (match) => {
      const range = dateRangeFor(match[1]);
      if (!range) return " ";
      const prefix = /^created/i.test(working) ? "created" : "modified";
      if (prefix === "created") setCreated(range);
      else setModified(range);
      return " ";
    },
  );
  replaceMatches(/\b(?:from|in)\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/i, (match) => {
    const month = MONTH_NAMES.indexOf(match[1].toLowerCase());
    if (month < 0) return " ";
    let year = match[2] ? Number(match[2]) : now.getFullYear();
    if (!match[2] && month > now.getMonth()) year -= 1;
    setModified(monthRange(year, month));
    return " ";
  });
  replaceMatches(/\b(?:after|since)\s+(\d{4}-\d{2}-\d{2})\b/i, (match) => {
    const range = dateRangeFor(match[1]);
    if (range) setModified({ after: range.after, before: filters.modified?.before ?? null, label: `After ${match[1]}` });
    return " ";
  });
  replaceMatches(/\b(?:before)\s+(\d{4}-\d{2}-\d{2})\b/i, (match) => {
    const range = dateRangeFor(match[1]);
    if (range) setModified({ after: filters.modified?.after ?? null, before: range.before, label: `Before ${match[1]}` });
    return " ";
  });

  // 5. File kinds and language-specific extensions.
  for (const word of KIND_WORDS) {
    replaceMatches(new RegExp(`\\b(?:${word.pattern})\\b`, "i"), () => {
      addKind(word.kind);
      return " ";
    });
  }
  replaceMatches(/\b(typescript|javascript|python|rust|swift|java|kotlin|golang|ruby|php|html|css|json|markdown|yaml|xml|sql|shell|c\+\+|csharp|c)\s+(?:files?|sources?|scripts?)\b/i, (match) => {
    const extensions = LANGUAGE_EXTENSIONS[match[1].toLowerCase()];
    if (extensions) addExtensions(extensions);
    return " ";
  });
  replaceMatches(/\*\.([a-z0-9]+)\b/i, (match) => {
    addExtensions([match[1]]);
    return " ";
  });

  // 6. Location constraints. Unresolved names stay in the term list.
  replaceMatches(/\b(?:in|inside|under)\s+("[^"]+"|[A-Za-z0-9._~/ -]+?)(?=\s+(?:with|containing|modified|created|from|over|under|size|kind|type)\b|$)/i, (match) => {
    const value = match[1].trim();
    const resolved = resolveLocation(value);
    if (resolved) return " ";
    notes.push(`"${value}" does not match a configured location, so it was searched as a name/path term instead.`);
    terms.push(value);
    return " ";
  });
  replaceMatches(/(?:^|\s)(~?\/[^\s]+)/, (match) => {
    const path = match[1];
    addLocation(path);
    return " ";
  });

  // 7. Content phrases.
  replaceMatches(/\b(?:containing|contains|with the text|with text|full text)\s+("([^"]+)"|[^\s]+)/i, (match) => {
    const value = (match[2] ?? match[1]).replace(/^"|"$/g, "").trim();
    if (value) contentTerms.push(value);
    return " ";
  });

  // 8. Toggles and optional capabilities.
  replaceMatches(/\b(hidden files?|include hidden)\b/i, () => {
    filters.includeHidden = true;
    return " ";
  });
  replaceMatches(/\b(no extension|without extension|without an extension)\b/i, () => {
    filters.noExtension = true;
    return " ";
  });
  replaceMatches(/\b(duplicate files?|duplicates?)\b/i, () => {
    wantsDuplicates = true;
    filters.duplicatesOnly = true;
    return " ";
  });
  replaceMatches(/\bcase[ -]?sensitive\b/i, () => {
    caseSensitive = true;
    return " ";
  });
  replaceMatches(/\b(?:similar to|semantic(?:ally)?|related to)\s+(.+)$/i, (match) => {
    semanticHint = true;
    const value = match[1].trim();
    if (value) terms.push(value);
    return " ";
  });
  replaceMatches(/\b(?:photos?|images?|pictures?)\s+of\s+(.+)$/i, (match) => {
    visualHint = true;
    addKind("image");
    const value = match[1].trim();
    if (value) terms.push(value);
    return " ";
  });
  replaceMatches(/\b(?:screenshots?)\s+(?:containing|with|showing)\s+(.+)$/i, (match) => {
    visualHint = true;
    addKind("image");
    const value = match[1].trim();
    if (value) terms.push(value);
    return " ";
  });

  // 9. Exclusions written as -term or "not term".
  replaceMatches(/(?:^|\s)-("([^"]+)"|\S+)/g, (match) => {
    const value = (match[2] ?? match[1]).replace(/^"|"$/g, "").trim();
    if (value) excludeTerms.push(value);
    return " ";
  });
  replaceMatches(/\bnot\s+("([^"]+)"|\S+)/i, (match) => {
    const value = (match[2] ?? match[1]).replace(/^"|"$/g, "").trim();
    if (value) excludeTerms.push(value);
    return " ";
  });

  // 10. Residual free-text terms.
  const residualTokens = working
    .split(/\s+/)
    .map((token) => token.replace(/^[,.;:]+|[,.;:]+$/g, ""))
    .filter(Boolean);
  const hasStructuredConstraint =
    contentTerms.length > 0 ||
    nameTerms.length > 0 ||
    filters.kinds.length > 0 ||
    filters.extensions.length > 0 ||
    filters.minSize != null ||
    filters.maxSize != null ||
    filters.modified != null ||
    filters.created != null ||
    filters.accessed != null ||
    locations.length > 0;
  const keepStopWords = !hasStructuredConstraint && residualTokens.every((token) => STOP_WORDS.has(token.toLowerCase()));
  for (const token of residualTokens) {
    if (!keepStopWords && STOP_WORDS.has(token.toLowerCase())) continue;
    if (!terms.includes(token)) terms.push(token);
  }

  // 11. Validate the structured query.
  if (filters.minSize != null && filters.maxSize != null && filters.minSize > filters.maxSize) {
    const swap = filters.minSize;
    filters.minSize = filters.maxSize;
    filters.maxSize = swap;
    notes.push("The size range was reversed; MAXplorer swapped the bounds.");
  }
  if (filters.modified?.after != null && filters.modified.before != null && filters.modified.after > filters.modified.before) {
    filters.modified = { after: filters.modified.before, before: filters.modified.after, label: filters.modified.label };
    notes.push("The modified-date range was reversed; MAXplorer swapped the bounds.");
  }
  for (const value of [...terms, ...nameTerms, ...contentTerms]) {
    if (value.length > 500) notes.push("A search term was truncated to 500 characters.");
  }
  filters.locations = [...locations];
  filters.matchMode = exactPhrase ? "phrase" : filters.matchMode;

  if (semanticHint && !context.semanticEnabled) {
    notes.push("Semantic search is not enabled. MAXplorer searched names, paths, and indexed content instead of pretending to understand meaning.");
  }
  if (visualHint && !context.visualEnabled) {
    notes.push("Visual image recognition is not enabled. Results are based on names, paths, metadata, and indexed text, not on what the images depict.");
  }

  const dedupedTerms = dedupe([...terms, ...nameTerms]);
  const mode: SearchContentMode =
    contentTerms.length > 0 && nameTerms.length === 0 && terms.length === 0
      ? "content"
      : nameTerms.length > 0 && contentTerms.length === 0
        ? "name"
        : filters.contentMode;
  const matchMode: SearchMatchMode = exactPhrase ? "phrase" : filters.matchMode;
  filters.contentMode = mode;

  return {
    original: raw,
    terms: dedupedTerms,
    nameTerms: dedupe(nameTerms),
    contentTerms: dedupe(contentTerms),
    excludeTerms: dedupe(excludeTerms),
    filters,
    locations: dedupe(locations),
    chips: chipsFor(filters, dedupedTerms, contentTerms, excludeTerms),
    mode,
    matchMode,
    caseSensitive,
    exactPhrase,
    wantsDuplicates,
    semanticHint,
    visualHint,
    notes: dedupe(notes),
    residualQuery: residualTokens.join(" "),
    resolvedDateLabels: dedupe(resolvedDateLabels),
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function chipsFor(
  filters: SearchFilters,
  terms: string[],
  contentTerms: string[],
  excludeTerms: string[],
): SearchChip[] {
  const chips: SearchChip[] = [];
  for (const kind of filters.kinds) {
    chips.push({ id: `kind:${kind}`, group: "kind", label: KIND_LABELS[kind], value: kind });
  }
  for (const extension of filters.extensions) {
    chips.push({ id: `ext:${extension}`, group: "extension", label: `*.${extension}`, value: extension });
  }
  if (filters.minSize != null || filters.maxSize != null) {
    const label =
      filters.minSize != null && filters.maxSize != null
        ? filters.minSize === filters.maxSize
          ? `Size: ${formatSizeLabel(filters.minSize)}`
          : `Size: ${formatSizeLabel(filters.minSize)} – ${formatSizeLabel(filters.maxSize)}`
        : filters.minSize != null
          ? `Size: > ${formatSizeLabel(filters.minSize)}`
          : `Size: < ${formatSizeLabel(filters.maxSize)}`;
    chips.push({ id: "size", group: "size", label, value: "size" });
  }
  for (const [key, range, prefix] of [
    ["modified", filters.modified, "Modified"],
    ["created", filters.created, "Created"],
    ["accessed", filters.accessed, "Accessed"],
  ] as const) {
    const label = dateLabel(range, prefix);
    if (label) chips.push({ id: key, group: "date", label, value: key });
  }
  for (const location of filters.locations) {
    const name = location.split(/[\\/]/).filter(Boolean).pop() ?? location;
    chips.push({ id: `location:${location}`, group: "location", label: `Location: ${name}`, value: location });
  }
  if (filters.contentMode === "content") {
    chips.push({ id: "content:only", group: "content", label: "Contents only", value: "content" });
  } else if (filters.contentMode === "name") {
    chips.push({ id: "content:name", group: "content", label: "File name only", value: "name" });
  } else if (contentTerms.length) {
    chips.push({ id: "content:both", group: "content", label: "Name and contents", value: "both" });
  }
  for (const term of contentTerms) {
    chips.push({ id: `contains:${term}`, group: "content", label: `Contains: ${term}`, value: term });
  }
  for (const term of excludeTerms) {
    chips.push({ id: `exclude:${term}`, group: "other", label: `Excludes: ${term}`, value: term });
  }
  if (filters.includeHidden) chips.push({ id: "hidden", group: "other", label: "Hidden files", value: "hidden" });
  if (filters.noExtension) chips.push({ id: "no-extension", group: "other", label: "No extension", value: "no-extension" });
  if (filters.emptyFolders) chips.push({ id: "empty-folders", group: "other", label: "Empty folders", value: "empty-folders" });
  if (filters.duplicatesOnly) chips.push({ id: "duplicates", group: "other", label: "Duplicate candidates", value: "duplicates" });
  if (filters.caseSensitive) chips.push({ id: "case", group: "other", label: "Match case", value: "case" });
  if (!terms.length && !chips.length && contentTerms.length === 0) {
    return chips;
  }
  return chips;
}

export function removeChip(filters: SearchFilters, chip: SearchChip): SearchFilters {
  const next: SearchFilters = { ...filters, kinds: [...filters.kinds], extensions: [...filters.extensions], locations: [...filters.locations] };
  switch (chip.group) {
    case "kind":
      next.kinds = next.kinds.filter((kind) => kind !== chip.value);
      break;
    case "extension":
      next.extensions = next.extensions.filter((extension) => extension !== chip.value);
      break;
    case "size":
      next.minSize = null;
      next.maxSize = null;
      break;
    case "date":
      if (chip.value === "modified") next.modified = null;
      if (chip.value === "created") next.created = null;
      if (chip.value === "accessed") next.accessed = null;
      break;
    case "location":
      next.locations = next.locations.filter((location) => location !== chip.value);
      break;
    case "content":
      if (chip.value === "content") next.contentMode = "both";
      if (chip.value === "name") next.contentMode = "both";
      if (chip.value === "both") next.contentMode = "name";
      break;
    case "other":
      if (chip.value === "hidden") next.includeHidden = false;
      if (chip.value === "no-extension") next.noExtension = false;
      if (chip.value === "empty-folders") next.emptyFolders = false;
      if (chip.value === "duplicates") next.duplicatesOnly = false;
      if (chip.value === "case") next.caseSensitive = false;
      break;
  }
  return next;
}

export function buildSearchRequest(options: {
  queryId: number;
  interpretation: SearchInterpretedLike;
  filters: SearchFilters;
  roots: string[];
  includeHidden: boolean;
  recursive?: boolean;
  includeLive: boolean;
  includeSpotlight: boolean;
  sort: SearchSort;
  sortDirection: SearchSortDirection;
  limit?: number;
}): SearchRequestPayload {
  const { interpretation, filters } = options;
  const terms = interpretation.terms;
  return {
    queryId: options.queryId,
    text: interpretation.original,
    terms,
    nameTerms: interpretation.nameTerms,
    contentTerms: interpretation.contentTerms,
    excludeTerms: interpretation.excludeTerms,
    kinds: filters.kinds,
    extensions: filters.extensions,
    roots: options.roots,
    includeHidden: filters.includeHidden || options.includeHidden,
    includeIndexed: true,
    recursive: options.recursive ?? true,
    includeLive: options.includeLive,
    includeSpotlight: options.includeSpotlight,
    mode: filters.contentMode,
    matchMode: filters.matchMode,
    caseSensitive: filters.caseSensitive,
    exactPhrase: interpretation.exactPhrase,
    minSize: filters.minSize,
    maxSize: filters.maxSize,
    modifiedAfter: filters.modified?.after ?? null,
    modifiedBefore: filters.modified?.before ?? null,
    createdAfter: filters.created?.after ?? null,
    createdBefore: filters.created?.before ?? null,
    accessedAfter: filters.accessed?.after ?? null,
    accessedBefore: filters.accessed?.before ?? null,
    noExtension: filters.noExtension,
    emptyFolders: filters.emptyFolders,
    limit: options.limit ?? 500,
    sort: options.sort,
    sortDirection: options.sortDirection,
  };
}

export interface SearchInterpretedLike {
  original: string;
  terms: string[];
  nameTerms: string[];
  contentTerms: string[];
  excludeTerms: string[];
  exactPhrase: boolean;
}

export function scopeRoots(options: {
  scope: SearchScopeId;
  currentFolder: string;
  home: string;
  indexedLocations: SearchLocation[];
  externalLocations: SearchLocation[];
  selectedFolders: string[];
  customRoots: string[];
}): string[] {
  switch (options.scope) {
    case "current":
    case "currentRecursive":
      return options.currentFolder ? [options.currentFolder] : [];
    case "home":
      return options.home ? [options.home] : [];
    case "selected":
      return [...options.selectedFolders];
    case "external":
      return options.externalLocations.map((location) => location.path);
    case "custom":
      return [...options.customRoots];
    case "indexed":
    default:
      return options.indexedLocations.map((location) => location.path);
  }
}

export function normalizeFilterChange(
  previous: SearchFilters,
  patch: Partial<SearchFilters>,
): SearchFilters {
  const next: SearchFilters = {
    ...previous,
    ...patch,
    kinds: patch.kinds ? [...patch.kinds] : previous.kinds,
    extensions: patch.extensions ? [...patch.extensions] : previous.extensions,
    locations: patch.locations ? [...patch.locations] : previous.locations,
  };
  if (next.minSize != null && next.maxSize != null && next.minSize > next.maxSize) {
    [next.minSize, next.maxSize] = [next.maxSize, next.minSize];
  }
  return next;
}

export function scopeLabel(scope: SearchScopeId): string {
  switch (scope) {
    case "current":
      return "Current folder";
    case "currentRecursive":
      return "Current folder and subfolders";
    case "home":
      return "Home folder";
    case "selected":
      return "Selected folders";
    case "indexed":
      return "All indexed locations";
    case "external":
      return "External drives";
    case "custom":
      return "Custom locations";
    default:
      return "Everywhere";
  }
}

export { escapeRegExp };
