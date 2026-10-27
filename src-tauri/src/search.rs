use crate::error::AppError;
use crate::listing::entry_from_path;
use crate::types::SearchResult;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct SearchState {
    pub cancels: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
}

const MAX_DEPTH: usize = 16;
const MAX_SCANNED: u64 = 200_000;
const MAX_SEARCH_TIME: Duration = Duration::from_secs(8);

fn wildcard_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.to_lowercase().chars().collect();
    let text: Vec<char> = text.to_lowercase().chars().collect();
    let (mut pattern_index, mut text_index) = (0usize, 0usize);
    let (mut star_index, mut star_text_index) = (None, 0usize);
    while text_index < text.len() {
        if pattern_index < pattern.len()
            && (pattern[pattern_index] == '?' || pattern[pattern_index] == text[text_index])
        {
            pattern_index += 1;
            text_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == '*' {
            star_index = Some(pattern_index);
            star_text_index = text_index;
            pattern_index += 1;
        } else if let Some(star) = star_index {
            pattern_index = star + 1;
            star_text_index += 1;
            text_index = star_text_index;
        } else {
            return false;
        }
    }
    while pattern_index < pattern.len() && pattern[pattern_index] == '*' {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}

fn should_skip_directory(name: &str, depth: usize) -> bool {
    if depth == 0 {
        return false;
    }
    matches!(
        name,
        "node_modules"
            | "target"
            | "dist"
            | ".git"
            | ".Trash"
            | "Library"
            | ".cache"
            | "$RECYCLE.BIN"
            | "System Volume Information"
    )
}

pub fn search_files(
    root: &Path,
    query: &str,
    show_hidden: bool,
    max_results: usize,
    cancel: Arc<AtomicBool>,
) -> Result<SearchResult, AppError> {
    let root_metadata = fs::metadata(root).map_err(|error| {
        let mapped = AppError::from(error);
        mapped.with_path(root.to_string_lossy())
    })?;
    if !root_metadata.is_dir() {
        return Err(AppError::new(
            "not_a_directory",
            "Search needs a folder.",
            Some(root.to_string_lossy().to_string()),
        ));
    }
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(SearchResult {
            root: root.to_string_lossy().to_string(),
            query: String::new(),
            entries: Vec::new(),
            truncated: false,
            cancelled: false,
            scanned: 0,
            errors: 0,
        });
    }
    let wildcard = trimmed.contains('*') || trimmed.contains('?');
    let result_cap = max_results.clamp(1, 2_000);
    let started = Instant::now();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    let mut entries = Vec::new();
    let mut scanned = 0u64;
    let mut errors = 0u32;
    let mut truncated = false;
    let mut cancelled = false;

    while let Some((directory, depth)) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        if started.elapsed() > MAX_SEARCH_TIME || scanned >= MAX_SCANNED {
            truncated = true;
            break;
        }
        let reader = match fs::read_dir(&directory) {
            Ok(reader) => reader,
            Err(_) => {
                errors += 1;
                continue;
            }
        };
        for item in reader {
            if cancel.load(Ordering::Relaxed) {
                cancelled = true;
                break;
            }
            scanned += 1;
            if scanned % 128 == 0 && started.elapsed() > MAX_SEARCH_TIME {
                truncated = true;
                break;
            }
            let item = match item {
                Ok(item) => item,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            let path = item.path();
            let name = item.file_name().to_string_lossy().to_string();
            let file_type = match item.file_type() {
                Ok(file_type) => file_type,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            let is_directory = file_type.is_dir();
            let hidden_name = name.starts_with('.');
            if !show_hidden && hidden_name {
                continue;
            }
            if wildcard {
                if wildcard_match(trimmed, &name) {
                    if let Ok(entry) = entry_from_path(&path) {
                        if show_hidden || !entry.is_hidden {
                            entries.push(entry);
                        }
                    } else {
                        errors += 1;
                    }
                }
            } else if name.to_lowercase().contains(&trimmed.to_lowercase()) {
                if let Ok(entry) = entry_from_path(&path) {
                    if show_hidden || !entry.is_hidden {
                        entries.push(entry);
                    }
                } else {
                    errors += 1;
                }
            }
            if entries.len() >= result_cap {
                truncated = true;
                break;
            }
            if is_directory
                && !file_type.is_symlink()
                && depth < MAX_DEPTH
                && !should_skip_directory(&name, depth)
            {
                stack.push((path, depth + 1));
            }
        }
        if entries.len() >= result_cap || cancelled || started.elapsed() > MAX_SEARCH_TIME {
            if entries.len() >= result_cap || started.elapsed() > MAX_SEARCH_TIME {
                truncated = true;
            }
            break;
        }
    }

    Ok(SearchResult {
        root: root.to_string_lossy().to_string(),
        query: trimmed.to_string(),
        entries,
        truncated,
        cancelled,
        scanned,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::wildcard_match;

    #[test]
    fn wildcard_matching_is_case_insensitive() {
        assert!(wildcard_match("*.pdf", "Notes.PDF"));
        assert!(wildcard_match("photo?.*", "Photo1.jpg"));
        assert!(!wildcard_match("*.pdf", "notes.txt"));
    }
}
