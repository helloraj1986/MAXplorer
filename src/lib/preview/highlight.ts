export type TokenType =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "key"
  | "tag"
  | "attr"
  | "punct"
  | "mark";

export interface PreviewToken {
  text: string;
  type: TokenType;
}

const KEYWORDS = new Set([
  "true", "false", "null", "undefined", "NaN", "Infinity",
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch",
  "case", "break", "continue", "class", "extends", "new", "this", "super", "import", "from",
  "export", "default", "async", "await", "try", "catch", "finally", "throw", "typeof",
  "instanceof", "in", "of", "delete", "void", "yield", "static", "public", "private",
  "protected", "interface", "type", "enum", "implements", "package", "namespace", "declare",
  "fn", "pub", "struct", "impl", "trait", "use", "mod", "match", "mut", "ref", "self", "Self",
  "def", "elif", "except", "raise", "with", "as", "lambda", "pass", "assert", "None", "True",
  "False", "and", "or", "not", "is", "func", "range", "select", "go", "defer", "chan",
  "show", "hide", "media", "keyframes", "important", "none", "block", "flex", "grid",
]);

const HTML_LANGUAGES = new Set(["html", "xml"]);
const HASH_COMMENT_LANGUAGES = new Set(["shell", "python", "yaml", "toml", "ruby", "r"]);
const SLASH_COMMENT_LANGUAGES = new Set([
  "javascript", "typescript", "json", "css", "rust", "go", "java", "c", "cpp", "swift", "kotlin",
  "graphql", "vue", "svelte", "sql",
]);

function isWordStart(value: string): boolean {
  return /[A-Za-z_$@-]/.test(value);
}

function isWord(value: string): boolean {
  return /[A-Za-z0-9_$@-]/.test(value);
}

function nextNonSpace(text: string, index: number): string {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return text[cursor] ?? "";
}

/**
 * A deliberately small, theme-aware tokenizer. It is not a parser: it exists to
 * give code previews readable structure, never to interpret or execute content.
 */
export function highlight(text: string, language: string): PreviewToken[] {
  // Keep very large previews responsive. The plain text is still selectable and
  // searchable; only colouring is skipped.
  if (text.length > 240_000) return [{ text, type: "plain" }];
  const html = HTML_LANGUAGES.has(language);
  const hashComments = HASH_COMMENT_LANGUAGES.has(language);
  const slashComments = SLASH_COMMENT_LANGUAGES.has(language) || language === "toml";
  const tokens: PreviewToken[] = [];
  let index = 0;
  const push = (value: string, type: TokenType) => {
    if (!value) return;
    const previous = tokens[tokens.length - 1];
    if (previous && previous.type === type) previous.text += value;
    else tokens.push({ text: value, type });
  };
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      let end = index + 1;
      while (end < text.length && /\s/.test(text[end])) end += 1;
      push(text.slice(index, end), "plain");
      index = end;
      continue;
    }
    if (html && text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      const stop = end === -1 ? text.length : end + 3;
      push(text.slice(index, stop), "comment");
      index = stop;
      continue;
    }
    if (slashComments && text.startsWith("//", index)) {
      const end = text.indexOf("\n", index + 2);
      const stop = end === -1 ? text.length : end;
      push(text.slice(index, stop), "comment");
      index = stop;
      continue;
    }
    if (slashComments && text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      push(text.slice(index, stop), "comment");
      index = stop;
      continue;
    }
    if (hashComments && character === "#" && !text.startsWith("#!", index)) {
      const end = text.indexOf("\n", index + 1);
      const stop = end === -1 ? text.length : end;
      push(text.slice(index, stop), "comment");
      index = stop;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      let end = index + 1;
      let escaped = false;
      while (end < text.length) {
        const value = text[end];
        if (escaped) {
          escaped = false;
        } else if (value === "\\") {
          escaped = true;
        } else if (value === character) {
          end += 1;
          break;
        }
        end += 1;
      }
      const isKey =
        (language === "json" || language === "yaml") && nextNonSpace(text, end) === ":";
      push(text.slice(index, end), isKey ? "key" : "string");
      index = end;
      continue;
    }
    if (html && character === "<") {
      const end = text.indexOf(">", index + 1);
      const stop = end === -1 ? text.length : end + 1;
      push(text.slice(index, stop), "tag");
      index = stop;
      continue;
    }
    if (/[0-9]/.test(character) || (character === "." && /[0-9]/.test(text[index + 1] ?? ""))) {
      let end = index + 1;
      while (end < text.length && /[0-9a-fA-FxX._eE+\-]/.test(text[end])) end += 1;
      push(text.slice(index, end), "number");
      index = end;
      continue;
    }
    if (isWordStart(character)) {
      let end = index + 1;
      while (end < text.length && isWord(text[end])) end += 1;
      const word = text.slice(index, end);
      const next = nextNonSpace(text, end);
      const previous = text.slice(Math.max(0, index - 2), index);
      const type: TokenType =
        (language === "json" || language === "yaml") && next === ":"
          ? "key"
          : KEYWORDS.has(word) ||
              (/^(true|false|null|None|True|False)$/.test(word))
            ? "keyword"
            : previous.trimEnd().endsWith("<")
              ? "attr"
              : "plain";
      push(word, type);
      index = end;
      continue;
    }
    push(character, "punct");
    index += 1;
  }
  return tokens;
}
