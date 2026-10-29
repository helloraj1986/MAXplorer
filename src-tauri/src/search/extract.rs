use flate2::read::DeflateDecoder;
use std::fs;
use std::io::Read;
use std::path::Path;

/// Content extraction state persisted in the search index. These values are
/// intentionally coarse: they describe what MAXplorer actually did, not what a
/// format could theoretically support.
pub const STATE_INDEXED: &str = "indexed";
pub const STATE_NO_TEXT: &str = "no_text";
pub const STATE_UNSUPPORTED: &str = "unsupported";
pub const STATE_SKIPPED: &str = "skipped";
pub const STATE_ERROR: &str = "error";

const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "text", "md", "markdown", "mdx", "rst", "adoc", "log", "csv", "tsv", "json", "jsonc",
    "json5", "xml", "html", "htm", "xhtml", "css", "scss", "sass", "less", "js", "jsx", "mjs",
    "cjs", "ts", "tsx", "rs", "py", "rb", "go", "java", "kt", "kts", "c", "h", "cc", "cpp", "cxx",
    "hpp", "hh", "cs", "swift", "m", "mm", "php", "pl", "lua", "r", "sql", "sh", "bash", "zsh",
    "fish", "ps1", "bat", "cmd", "toml", "yaml", "yml", "ini", "cfg", "conf", "env", "properties",
    "gradle", "cmake", "makefile", "dockerfile", "gitignore", "editorconfig", "tex", "bib", "org",
    "vue", "svelte", "astro", "graphql", "gql", "proto", "tf", "hcl", "plist", "nfo", "srt", "vtt",
];

const ARCHIVE_EXTENSIONS: &[&str] = &["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "dmg", "iso"];
const EXECUTABLE_EXTENSIONS: &[&str] = &["exe", "msi", "app", "bat", "cmd", "com", "dmg", "pkg"];
const DOCUMENT_EXTENSIONS: &[&str] = &["doc", "docx", "rtf", "pages", "odt"];
const SHEET_EXTENSIONS: &[&str] = &["xls", "xlsx", "numbers", "ods", "csv", "tsv"];
const SLIDES_EXTENSIONS: &[&str] = &["ppt", "pptx", "key", "odp"];
const FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "woff", "woff2"];
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "webp", "heic", "heif", "svg", "ico", "avif",
];
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "m4v", "avi", "mkv", "wmv", "flv", "webm", "mpg", "mpeg", "3gp",
];
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "wav", "aac", "flac", "ogg", "opus", "aiff", "aif", "wma", "mid", "midi",
];
const CODE_EXTENSIONS: &[&str] = &[
    "js", "jsx", "mjs", "cjs", "ts", "tsx", "rs", "py", "rb", "go", "java", "kt", "c", "h", "cc",
    "cpp", "cxx", "hpp", "cs", "swift", "php", "pl", "lua", "r", "sql", "sh", "bash", "zsh", "fish",
    "ps1", "vue", "svelte", "astro", "graphql", "gql", "proto",
];

pub fn extension_of(name: &str) -> String {
    let clean = name.trim_end_matches('.');
    match clean.rfind('.') {
        Some(index) if index > 0 => clean[index + 1..].to_lowercase(),
        _ => String::new(),
    }
}

/// Mirrors the frontend's file categories so filters and badges always agree.
pub fn kind_for(name: &str, is_dir: bool) -> String {
    if is_dir {
        return if extension_of(name) == "app" { "app".into() } else { "folder".into() };
    }
    let extension = extension_of(name);
    match extension.as_str() {
        "pdf" => "pdf",
        e if IMAGE_EXTENSIONS.contains(&e) => "image",
        e if VIDEO_EXTENSIONS.contains(&e) => "video",
        e if AUDIO_EXTENSIONS.contains(&e) => "audio",
        e if ARCHIVE_EXTENSIONS.contains(&e) => "archive",
        e if EXECUTABLE_EXTENSIONS.contains(&e) => "executable",
        e if DOCUMENT_EXTENSIONS.contains(&e) => "document",
        e if SHEET_EXTENSIONS.contains(&e) => "sheet",
        e if SLIDES_EXTENSIONS.contains(&e) => "slides",
        e if FONT_EXTENSIONS.contains(&e) => "font",
        e if CODE_EXTENSIONS.contains(&e) => "code",
        e if TEXT_EXTENSIONS.contains(&e) => "text",
        _ => "file",
    }
    .to_string()
}

pub fn is_text_extension(extension: &str) -> bool {
    TEXT_EXTENSIONS.contains(&extension)
}

pub fn is_extractable(extension: &str) -> bool {
    is_text_extension(extension) || matches!(extension, "pdf" | "docx" | "pptx" | "xlsx" | "docm" | "xlsm" | "pptm")
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct Extraction {
    pub status: String,
    pub text: Option<String>,
    pub error: Option<String>,
    pub truncated: bool,
}

impl Extraction {
    fn unsupported() -> Self {
        Self { status: STATE_UNSUPPORTED.into(), text: None, error: None, truncated: false }
    }
    fn no_text(reason: Option<String>) -> Self {
        Self { status: STATE_NO_TEXT.into(), text: None, error: reason, truncated: false }
    }
    fn failed(message: String) -> Self {
        Self { status: STATE_ERROR.into(), text: None, error: Some(message), truncated: false }
    }
}

pub fn extract(path: &Path, extension: &str, max_bytes: u64) -> Extraction {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => return Extraction::failed(error.to_string()),
    };
    if metadata.len() > max_bytes {
        return Extraction {
            status: STATE_SKIPPED.into(),
            text: None,
            error: Some(format!("File is larger than the {} byte content-indexing limit.", max_bytes)),
            truncated: false,
        };
    }
    match extension {
        "pdf" => extract_pdf(path, max_bytes),
        "docx" | "docm" => extract_docx(path, max_bytes),
        "xlsx" | "xlsm" => extract_xlsx(path, max_bytes),
        "pptx" | "pptm" => extract_pptx(path, max_bytes),
        e if is_text_extension(e) => extract_plain(path, e, max_bytes),
        _ => Extraction::unsupported(),
    }
}

fn extract_plain(path: &Path, extension: &str, max_bytes: u64) -> Extraction {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) => return Extraction::failed(error.to_string()),
    };
    let truncated = bytes.len() as u64 > max_bytes;
    let slice = &bytes[..bytes.len().min(max_bytes as usize)];
    if looks_binary(slice) && !matches!(extension, "plist" | "nfo" | "srt" | "vtt") {
        return Extraction::no_text(Some("The file does not contain readable text.".into()));
    }
    let raw = String::from_utf8_lossy(slice).to_string();
    let text = match extension {
        "html" | "htm" | "xhtml" => {
            let without_scripts = strip_blocks(&raw, "script");
            let without_styles = strip_blocks(&without_scripts, "style");
            strip_markup(&without_styles, "")
        }
        "xml" => strip_markup(&raw, ""),
        "plist" => strip_markup(&raw, ""),
        _ => raw,
    };
    finish_text(text, truncated)
}

fn extract_docx(path: &Path, max_bytes: u64) -> Extraction {
    match zip_entry_text(path, &["word/document.xml", "word/header1.xml", "word/footer1.xml"], max_bytes) {
        Ok(Some(text)) => finish_text(strip_markup(&text, ""), false),
        Ok(None) => Extraction::no_text(Some("The document has no embedded text.".into())),
        Err(error) => Extraction::failed(error),
    }
}

fn extract_pptx(path: &Path, max_bytes: u64) -> Extraction {
    match zip_glob_text(path, "ppt/slides/", ".xml", max_bytes) {
        Ok(Some(text)) => finish_text(strip_markup(&text, ""), false),
        Ok(None) => Extraction::no_text(Some("The presentation has no embedded text.".into())),
        Err(error) => Extraction::failed(error),
    }
}

fn extract_xlsx(path: &Path, max_bytes: u64) -> Extraction {
    let mut collected = String::new();
    match zip_entry_text(path, &["xl/sharedStrings.xml"], max_bytes) {
        Ok(Some(text)) => collected.push_str(&strip_markup(&text, "")),
        Ok(None) => {}
        Err(error) => return Extraction::failed(error),
    }
    match zip_glob_text(path, "xl/worksheets/", ".xml", max_bytes) {
        Ok(Some(text)) => {
            if !collected.is_empty() {
                collected.push('\n');
            }
            collected.push_str(&strip_markup(&text, ""));
            finish_text(collected, true)
        }
        Ok(None) => finish_text(collected, false),
        Err(error) => Extraction::failed(error),
    }
}

fn finish_text(text: String, truncated: bool) -> Extraction {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Extraction::no_text(None);
    }
    Extraction {
        status: STATE_INDEXED.into(),
        text: Some(trimmed.to_string()),
        error: None,
        truncated,
    }
}

fn looks_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let sample = &bytes[..bytes.len().min(8192)];
    let control = sample
        .iter()
        .filter(|byte| **byte == 0 || (**byte < 9) || (**byte > 13 && **byte < 32))
        .count();
    control * 5 > sample.len()
}

fn strip_blocks(input: &str, tag: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    loop {
        let lower = rest.to_lowercase();
        let Some(start) = lower.find(&open) else {
            output.push_str(rest);
            break;
        };
        output.push_str(&rest[..start]);
        let Some(end) = lower[start..].find(&close) else {
            break;
        };
        rest = &rest[start + end + close.len()..];
    }
    output
}

fn decode_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
}

/// Lightweight markup stripper used for HTML, XML and OOXML text nodes. It
/// preserves text-node boundaries with spaces so full-text search does not glue
/// adjacent words together.
fn strip_markup(input: &str, block_tag: &str) -> String {
    let source = if block_tag.is_empty() {
        input.to_string()
    } else {
        strip_blocks(input, block_tag)
    };
    let mut output = String::with_capacity(source.len());
    let mut in_tag = false;
    let mut last_space = true;
    for character in source.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                if !last_space {
                    output.push(' ');
                    last_space = true;
                }
            }
            _ if in_tag => {}
            '\n' | '\r' | '\t' => {
                if !last_space {
                    output.push(' ');
                    last_space = true;
                }
            }
            _ => {
                output.push(character);
                last_space = character.is_whitespace();
            }
        }
    }
    decode_entities(&output)
}

/* ------------------------------------------------------------------------- */
/* Minimal ZIP reader (stored/deflated entries) for Office Open XML files.    */
/* ------------------------------------------------------------------------- */

struct ZipEntry {
    name: String,
    method: u16,
    compressed_size: u64,
    uncompressed_size: u64,
    local_offset: u64,
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes.get(offset..offset + 2).map(|slice| u16::from_le_bytes([slice[0], slice[1]]))
}
fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes
        .get(offset..offset + 4)
        .map(|slice| u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}
fn zip_entries(bytes: &[u8]) -> Result<Vec<ZipEntry>, String> {
    let search_start = bytes.len().saturating_sub(66_000);
    let mut eocd = None;
    for offset in (search_start..bytes.len().saturating_sub(3)).rev() {
        if bytes.get(offset..offset + 4) == Some(b"PK\x05\x06") {
            eocd = Some(offset);
            break;
        }
    }
    let eocd = eocd.ok_or_else(|| "The Office document is not a readable ZIP archive.".to_string())?;
    let count = read_u16(bytes, eocd + 10).ok_or("Invalid ZIP directory.")? as usize;
    let directory_offset = read_u32(bytes, eocd + 16).ok_or("Invalid ZIP directory.")? as usize;
    let mut entries = Vec::with_capacity(count);
    let mut offset = directory_offset;
    for _ in 0..count {
        if bytes.get(offset..offset + 4) != Some(b"PK\x01\x02") {
            break;
        }
        let method = read_u16(bytes, offset + 10).unwrap_or(0);
        let compressed_size = read_u32(bytes, offset + 20).unwrap_or(0) as u64;
        let uncompressed_size = read_u32(bytes, offset + 24).unwrap_or(0) as u64;
        let name_len = read_u16(bytes, offset + 28).unwrap_or(0) as usize;
        let extra_len = read_u16(bytes, offset + 30).unwrap_or(0) as usize;
        let comment_len = read_u16(bytes, offset + 32).unwrap_or(0) as usize;
        let local_offset = read_u32(bytes, offset + 42).unwrap_or(0) as u64;
        let name_start = offset + 46;
        let name = bytes
            .get(name_start..name_start + name_len)
            .map(|slice| String::from_utf8_lossy(slice).to_string())
            .unwrap_or_default();
        entries.push(ZipEntry { name, method, compressed_size, uncompressed_size, local_offset });
        offset = name_start + name_len + extra_len + comment_len;
    }
    Ok(entries)
}

fn zip_read_entry(bytes: &[u8], entry: &ZipEntry) -> Result<Vec<u8>, String> {
    let offset = entry.local_offset as usize;
    if bytes.get(offset..offset + 4) != Some(b"PK\x03\x04") {
        return Err("Invalid ZIP entry header.".into());
    }
    let name_len = read_u16(bytes, offset + 26).unwrap_or(0) as usize;
    let extra_len = read_u16(bytes, offset + 28).unwrap_or(0) as usize;
    let data_start = offset + 30 + name_len + extra_len;
    let end = data_start.saturating_add(entry.compressed_size as usize);
    let data = bytes
        .get(data_start..end)
        .ok_or_else(|| "ZIP entry is truncated.".to_string())?;
    match entry.method {
        0 => Ok(data.to_vec()),
        8 => {
            let mut decoder = DeflateDecoder::new(data);
            let mut output = Vec::with_capacity(entry.uncompressed_size.min(8 * 1024 * 1024) as usize);
            decoder
                .read_to_end(&mut output)
                .map_err(|error| format!("Could not decompress Office document: {error}"))?;
            Ok(output)
        }
        other => Err(format!("Unsupported ZIP compression method {other}.")),
    }
}

fn zip_entry_text(path: &Path, names: &[&str], max_bytes: u64) -> Result<Option<String>, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let entries = zip_entries(&bytes)?;
    let mut output = String::new();
    for entry in entries.iter().filter(|entry| names.contains(&entry.name.as_str())) {
        let data = zip_read_entry(&bytes, entry)?;
        if output.len() as u64 >= max_bytes {
            break;
        }
        output.push_str(&String::from_utf8_lossy(&data));
        output.push('\n');
    }
    if output.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(output))
    }
}

fn zip_glob_text(
    path: &Path,
    prefix: &str,
    suffix: &str,
    max_bytes: u64,
) -> Result<Option<String>, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let entries = zip_entries(&bytes)?;
    let mut output = String::new();
    for entry in entries
        .iter()
        .filter(|entry| entry.name.starts_with(prefix) && entry.name.ends_with(suffix))
    {
        if output.len() as u64 >= max_bytes {
            break;
        }
        match zip_read_entry(&bytes, entry) {
            Ok(data) => {
                output.push_str(&String::from_utf8_lossy(&data));
                output.push('\n');
            }
            Err(_) => continue,
        }
    }
    if output.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(output))
    }
}

/* ------------------------------------------------------------------------- */
/* Conservative PDF text extraction.                                          */
/*                                                                            */
/* This handles uncompressed and FlateDecode content streams with the common  */
/* Tj/TJ text operators. Scanned PDFs correctly report no embedded text so    */
/* the UI can offer OCR as an unimplemented optional capability instead of    */
/* pretending the document is searchable.                                     */
/* ------------------------------------------------------------------------- */

fn extract_pdf(path: &Path, max_bytes: u64) -> Extraction {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) => return Extraction::failed(error.to_string()),
    };
    let mut text = String::new();
    let mut index = 0usize;
    while index < bytes.len() && (text.len() as u64) < max_bytes {
        let Some(stream_at) = find_subslice(&bytes[index..], b"stream") else {
            break;
        };
        let mut start = index + stream_at + b"stream".len();
        if bytes.get(start) == Some(&b'\r') {
            start += 1;
        }
        if bytes.get(start) == Some(&b'\n') {
            start += 1;
        }
        let Some(end_at) = find_subslice(&bytes[start..], b"endstream") else {
            break;
        };
        let data = &bytes[start..start + end_at];
        let decoded = inflate(data).unwrap_or_else(|| data.to_vec());
        let chunk = pdf_text_from_stream(&decoded);
        if !chunk.trim().is_empty() {
            text.push_str(&chunk);
            text.push('\n');
        }
        index = start + end_at + b"endstream".len();
    }
    if text.trim().is_empty() {
        return Extraction::no_text(Some(
            "No embedded text was found. This may be a scanned document; OCR is not enabled.".into(),
        ));
    }
    let truncated = text.len() as u64 > max_bytes;
    if truncated {
        text.truncate(max_bytes as usize);
    }
    finish_text(text, truncated)
}

fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let trimmed = data
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .map(|start| &data[start..])?;
    let mut decoder = DeflateDecoder::new(trimmed);
    let mut output = Vec::new();
    decoder.read_to_end(&mut output).ok()?;
    Some(output)
}

fn find_subslice(data: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || data.len() < needle.len() {
        return None;
    }
    data.windows(needle.len()).position(|window| window == needle)
}

fn pdf_text_from_stream(data: &[u8]) -> String {
    let source = String::from_utf8_lossy(data);
    let mut output = String::new();
    let mut characters = source.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '(' => {
                let mut literal = String::new();
                let mut depth = 1;
                while let Some(next) = characters.next() {
                    match next {
                        '\\' => {
                            if let Some(escaped) = characters.next() {
                                match escaped {
                                    'n' => literal.push('\n'),
                                    'r' => literal.push('\n'),
                                    't' => literal.push('\t'),
                                    'b' => {}
                                    'f' => {}
                                    '(' | ')' | '\\' => literal.push(escaped),
                                    digit @ '0'..='7' => {
                                        let mut octal = String::from(digit);
                                        for _ in 0..2 {
                                            if let Some(digit) = characters.peek().copied() {
                                                if digit.is_ascii_digit() && digit < '8' {
                                                    octal.push(characters.next().unwrap());
                                                } else {
                                                    break;
                                                }
                                            }
                                        }
                                        if let Ok(value) = u32::from_str_radix(&octal, 8) {
                                            if let Some(character) = char::from_u32(value) {
                                                literal.push(character);
                                            }
                                        }
                                    }
                                    other => literal.push(other),
                                }
                            }
                        }
                        '(' => {
                            depth += 1;
                            literal.push('(');
                        }
                        ')' => {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                            literal.push(')');
                        }
                        other => literal.push(other),
                    }
                }
                if !literal.is_empty() {
                    output.push_str(&literal);
                    output.push(' ');
                }
            }
            '<' => {
                // Hex strings: <48656c6c6f>
                let mut hex = String::new();
                while let Some(next) = characters.next() {
                    if next == '>' || next == '<' {
                        break;
                    }
                    if next.is_ascii_hexdigit() {
                        hex.push(next);
                    }
                }
                if hex.len() >= 2 {
                    let mut bytes = Vec::new();
                    let mut chars = hex.chars();
                    while let (Some(a), Some(b)) = (chars.next(), chars.next()) {
                        if let Ok(value) = u8::from_str_radix(&format!("{a}{b}"), 16) {
                            bytes.push(value);
                        }
                    }
                    let decoded = String::from_utf8_lossy(&bytes);
                    if decoded.chars().all(|character| !character.is_control() || character.is_whitespace()) {
                        output.push_str(&decoded);
                        output.push(' ');
                    }
                }
            }
            _ => {}
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_match_frontend_categories() {
        assert_eq!(kind_for("notes.pdf", false), "pdf");
        assert_eq!(kind_for("photo.JPG", false), "image");
        assert_eq!(kind_for("app.tsx", false), "code");
        assert_eq!(kind_for("readme.md", false), "text");
        assert_eq!(kind_for("Project", true), "folder");
        assert_eq!(kind_for("Safari.app", true), "app");
    }

    #[test]
    fn markup_stripping_keeps_words_apart() {
        let text = strip_markup("<p>Hello&nbsp;<b>world</b></p>", "");
        assert!(text.contains("Hello"));
        assert!(text.contains("world"));
    }

    #[test]
    fn binary_detection_rejects_nul_heavy_files() {
        let bytes = vec![0u8; 100];
        assert!(looks_binary(&bytes));
        assert!(!looks_binary(b"hello world\n"));
    }

    #[test]
    fn pdf_hex_and_literal_strings_are_extracted() {
        let stream = b"BT (Invoice March) Tj <48656c6c6f> Tj ET";
        let text = pdf_text_from_stream(stream);
        assert!(text.contains("Invoice March"));
        assert!(text.contains("Hello"));
    }
}
