use crate::listing::entry_from_path;
use crate::search::engine::{
    entry_matches_request, score_entry, sort_hits, terms_match_text, text_contains,
};
use crate::search::extract;
use crate::search::model::{SearchHit, SearchRequest};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const SKIP_DIRECTORIES: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".cache",
    ".npm",
    ".yarn",
    ".cargo",
    ".rustup",
    "Library",
    "Caches",
    "DerivedData",
    "Pods",
    "__pycache__",
    ".venv",
    "venv",
    ".Trash",
    ".Trashes",
    "$RECYCLE.BIN",
    "System Volume Information",
];

pub fn should_skip_directory(name: &str, depth: usize) -> bool {
    if depth == 0 {
        return false;
    }
    SKIP_DIRECTORIES.iter().any(|skip| skip.eq_ignore_ascii_case(name))
        || name.ends_with(".app")
        || name.ends_with(".framework")
}

pub struct LiveScan {
    pub hits: Vec<SearchHit>,
    pub scanned: u64,
    pub errors: u64,
    pub notes: Vec<String>,
}

/// A bounded, cancellable filesystem provider. It keeps search useful while the
/// index is still building (and for folders deliberately excluded from the
/// index) without ever pretending that a partial scan is complete.
pub fn scan_live(
    request: &SearchRequest,
    cancel: &AtomicBool,
    content_budget: usize,
) -> LiveScan {
    let started = Instant::now();
    let mut notes = Vec::new();
    let mut hits = Vec::new();
    let mut scanned = 0u64;
    let mut errors = 0u64;
    let mut content_reads = 0usize;
    let mut seen = HashSet::new();
    if request.roots.is_empty() {
        notes.push("No live filesystem fallback was run because the scope has no accessible folders.".into());
        return LiveScan { hits, scanned, errors, notes };
    }
    let max_scanned = 25_000u64;
    let budget = Duration::from_millis(1_800);
    let terms = request.all_terms();
    let content_terms = if request.content_terms.is_empty() {
        request.terms.clone()
    } else {
        request.content_terms.clone()
    };
    let content_scan = request.mode == crate::search::model::SearchMode::Content
        || !request.content_terms.is_empty();

    for root in &request.roots {
        if cancel.load(Ordering::Relaxed) || scanned >= max_scanned || started.elapsed() > budget {
            break;
        }
        let root_path = PathBuf::from(root);
        if !root_path.is_dir() {
            notes.push(format!("{root} is unavailable and was not scanned."));
            continue;
        }
        let walker = walkdir::WalkDir::new(&root_path)
            .follow_links(false)
            .max_depth(if request.recursive { 48 } else { 1 })
            .into_iter()
            .filter_entry(|item| {
                if item.depth() == 0 || !item.file_type().is_dir() {
                    return true;
                }
                let name = item.file_name().to_string_lossy();
                !should_skip_directory(&name, item.depth())
            });
        for item in walker {
            if cancel.load(Ordering::Relaxed) {
                notes.push("Live scan was cancelled.".into());
                break;
            }
            if scanned >= max_scanned || started.elapsed() > budget {
                notes.push("Live scan stopped at its safety limit; index results are unaffected.".into());
                break;
            }
            let item = match item {
                Ok(item) => item,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            scanned += 1;
            let path = item.path();
            let entry = match entry_from_path(path) {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            if !entry_matches_request(&entry, request) {
                continue;
            }
            let name_match = !terms.is_empty()
                && terms_match_text(&entry.name, &terms, request.match_mode, request.case_sensitive);
            let path_match = !terms.is_empty()
                && terms_match_text(&entry.path, &terms, request.match_mode, request.case_sensitive);
            let mut matched_content = false;
            let mut snippet = None;
            if content_scan && content_reads < content_budget && !entry.is_dir && !entry.is_symlink {
                if let Some(extension) = entry.extension.as_deref() {
                    if extract::is_text_extension(extension) && entry.size.unwrap_or(0) <= 1_048_576 {
                        content_reads += 1;
                        if let Ok(text) = fs::read_to_string(path) {
                            if terms_match_text(&text, &content_terms, request.match_mode, request.case_sensitive) {
                                matched_content = true;
                                snippet = snippet_for(&text, &content_terms);
                            }
                        }
                    }
                }
            }
            if !terms.is_empty() && !name_match && !path_match && !matched_content {
                continue;
            }
            if request.exclude_terms.iter().any(|term| {
                text_contains(&entry.path, term, request.case_sensitive)
                    || text_contains(&entry.name, term, request.case_sensitive)
            }) {
                continue;
            }
            let key = normalize_key(&entry.path);
            if !seen.insert(key) {
                continue;
            }
            let (score, kind, explanation) = score_entry(
                &entry,
                request,
                name_match || terms.is_empty(),
                path_match,
                matched_content,
            );
            hits.push(SearchHit {
                entry,
                score,
                match_kind: kind.into(),
                snippet,
                source: "filesystem".into(),
                indexed: false,
                explanation: Some(explanation),
            });
            if hits.len() >= request.limit() * 3 {
                break;
            }
        }
    }
    if content_scan && content_reads >= content_budget {
        notes.push("Live content reading reached its safety limit; the index provides deeper content coverage.".into());
    }
    sort_hits(&mut hits, request);
    LiveScan { hits, scanned, errors, notes }
}

fn normalize_key(path: &str) -> String {
    #[cfg(target_os = "macos")]
    {
        path.to_lowercase()
    }
    #[cfg(not(target_os = "macos"))]
    {
        path.to_string()
    }
}

fn snippet_for(content: &str, terms: &[String]) -> Option<String> {
    let lower = content.to_lowercase();
    let position = terms
        .iter()
        .filter_map(|term| lower.find(&term.to_lowercase()))
        .min()?;
    let start = content[..position]
        .char_indices()
        .rev()
        .nth(48)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let end = content[position..]
        .char_indices()
        .nth(160)
        .map(|(index, _)| position + index)
        .unwrap_or(content.len());
    let mut snippet = content[start..end].replace(['\n', '\r', '\t'], " ");
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < content.len() {
        snippet.push_str("...");
    }
    Some(snippet.trim().to_string())
}

/// macOS Spotlight provider. Spotlight is treated as an additional source, not
/// as the source of truth: every returned path is re-stat'ed and re-filtered,
/// and inaccessible results are omitted with an explanatory note.
pub fn spotlight_search(request: &SearchRequest) -> (Vec<SearchHit>, Vec<String>) {
    #[cfg(target_os = "macos")]
    {
        spotlight_search_macos(request)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request;
        (Vec::new(), vec!["Spotlight is only available on macOS.".into()])
    }
}

#[cfg(target_os = "macos")]
fn spotlight_search_macos(request: &SearchRequest) -> (Vec<SearchHit>, Vec<String>) {
    use std::process::Command;
    let mut notes = Vec::new();
    let mut clauses = Vec::new();
    let terms = request.all_terms();
    if terms.is_empty() {
        return (Vec::new(), notes);
    }
    let content_terms = if request.content_terms.is_empty() {
        Vec::new()
    } else {
        request.content_terms.clone()
    };
    for term in &terms {
        if term.len() < 2 {
            continue;
        }
        let escaped = term.replace('\\', "\\\\").replace('"', "\\\"");
        if content_terms.iter().any(|content| content == term) {
            clauses.push(format!("kMDItemTextContent == \"*{escaped}*\"cd"));
        } else {
            clauses.push(format!("kMDItemFSName == \"*{escaped}*\"cd"));
        }
    }
    if clauses.is_empty() {
        return (Vec::new(), notes);
    }
    let query = clauses.join(" && ");
    let mut command = Command::new("mdfind");
    command.arg("-0");
    let accessible_roots: Vec<&String> = request
        .roots
        .iter()
        .filter(|root| Path::new(root).is_dir())
        .collect();
    // mdfind accepts one -onlyin scope. For multi-root scopes we query broadly
    // and enforce the real roots with the same filter gate used by every other
    // provider.
    if accessible_roots.len() == 1 {
        command.arg("-onlyin").arg(accessible_roots[0]);
    }
    command.arg(query);
    let output = match command.output() {
        Ok(output) => output,
        Err(error) => {
            notes.push(format!("Spotlight search could not run: {error}"));
            return (Vec::new(), notes);
        }
    };
    if !output.status.success() {
        notes.push("Spotlight returned an error; index and filesystem results are still shown.".into());
        return (Vec::new(), notes);
    }
    let mut hits = Vec::new();
    let mut inaccessible = 0u64;
    let text = String::from_utf8_lossy(&output.stdout);
    let content_evidence = request.mode == crate::search::model::SearchMode::Content
        || !request.content_terms.is_empty();
    for path in text.split('\0').filter(|value| !value.is_empty()).take(500) {
        let path = Path::new(path);
        let entry = match entry_from_path(path) {
            Ok(entry) => entry,
            Err(_) => {
                inaccessible += 1;
                continue;
            }
        };
        if !entry_matches_request(&entry, request) {
            continue;
        }
        let name_match = terms_match_text(&entry.name, &terms, request.match_mode, request.case_sensitive);
        let path_match = terms_match_text(&entry.path, &terms, request.match_mode, request.case_sensitive);
        if !name_match && !path_match && !content_evidence {
            continue;
        }
        let (score, kind, explanation) = score_entry(&entry, request, name_match, path_match, content_evidence);
        hits.push(SearchHit {
            entry,
            score: if content_evidence { score } else { score - 5.0 },
            match_kind: kind.into(),
            snippet: None,
            source: "spotlight".into(),
            indexed: false,
            explanation: Some(if content_evidence && !name_match && !path_match {
                "Spotlight content match".into()
            } else {
                explanation
            }),
        });
    }
    if inaccessible > 0 {
        notes.push(format!("{inaccessible} Spotlight result(s) were skipped because they are no longer accessible."));
    }
    sort_hits(&mut hits, request);
    if hits.len() >= 500 {
        notes.push("Spotlight results were limited to 500 items.".into());
    }
    (hits, notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_heavy_directories_but_not_the_root() {
        assert!(!should_skip_directory("node_modules", 0));
        assert!(should_skip_directory("node_modules", 2));
        assert!(should_skip_directory("Safari.app", 1));
        assert!(!should_skip_directory("Projects", 1));
    }
}
