pub mod engine;
pub mod extract;
pub mod indexer;
pub mod live;
pub mod model;

use crate::error::AppError;
use crate::search::engine::{dedupe_hits, SearchEngine};
use crate::search::indexer::{IndexActivity, IndexerHandle};
use crate::search::model::{
    DuplicateRequest, DuplicateResponse, IndexError, IndexStatus, SearchHit, SearchProgress,
    SearchRequest, SearchResponse, SearchStats, SearchSuggestion,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone)]
pub struct SearchService {
    pub engine: Arc<SearchEngine>,
    activity: Arc<Mutex<IndexActivity>>,
    indexer: Arc<Mutex<Option<IndexerHandle>>>,
    cancels: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
}

impl SearchService {
    pub fn new(db_path: PathBuf) -> Result<Self, AppError> {
        let engine = Arc::new(SearchEngine::open(db_path)?);
        let _ = engine.ensure_default_location(&crate::paths::home_dir());
        let activity = Arc::new(Mutex::new(IndexActivity {
            activity: "starting".into(),
            current_path: None,
        }));
        let indexer = indexer::start(engine.clone(), activity.clone());
        Ok(Self {
            engine,
            activity,
            indexer: Arc::new(Mutex::new(Some(indexer))),
            cancels: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn stop_indexer(&self) {
        if let Ok(mut slot) = self.indexer.lock() {
            if let Some(handle) = slot.take() {
                handle.stop_and_join();
            }
        }
    }

    pub fn restart_indexer(&self) {
        self.stop_indexer();
        if let Ok(mut slot) = self.indexer.lock() {
            *slot = Some(indexer::start(self.engine.clone(), self.activity.clone()));
        }
    }

    pub fn cancel(&self, query_id: u64) {
        if let Ok(map) = self.cancels.lock() {
            if let Some(token) = map.get(&query_id) {
                token.store(true, Ordering::Relaxed);
            }
        }
    }

    pub fn register_cancel(&self, query_id: u64) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.cancels.lock() {
            map.insert(query_id, token.clone());
        }
        token
    }

    pub fn remove_cancel(&self, query_id: u64) {
        if let Ok(mut map) = self.cancels.lock() {
            map.remove(&query_id);
        }
    }

    pub fn status(&self) -> IndexStatus {
        let (activity, current_path) = self
            .activity
            .lock()
            .map(|value| {
                (
                    if value.activity.is_empty() { "idle".to_string() } else { value.activity.clone() },
                    value.current_path.clone(),
                )
            })
            .unwrap_or_else(|_| ("idle".into(), None));
        self.engine.status(&activity, current_path)
    }

    pub fn suggestions(&self, prefix: &str, limit: usize) -> Vec<SearchSuggestion> {
        self.engine.suggestions(prefix, limit)
    }

    pub fn index_errors(&self, limit: usize) -> Vec<IndexError> {
        self.engine.index_errors(limit)
    }

    pub fn run_search_with_progress(
        &self,
        request: SearchRequest,
        progress: &dyn Fn(SearchProgress),
    ) -> Result<SearchResponse, AppError> {
        let started = Instant::now();
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.cancels.lock() {
            map.insert(request.query_id, cancel.clone());
        }
        let result = self.execute_search(&request, &cancel, progress);
        if let Ok(mut map) = self.cancels.lock() {
            map.remove(&request.query_id);
        }
        let mut response = result?;
        response.stats.elapsed_ms = started.elapsed().as_millis() as u64;
        Ok(response)
    }

    fn execute_search(
        &self,
        request: &SearchRequest,
        cancel: &AtomicBool,
        progress: &dyn Fn(SearchProgress),
    ) -> Result<SearchResponse, AppError> {
        let status = self.status();
        let mut stats = SearchStats {
            fts_available: self.engine.fts_available(),
            index_files: status.indexed_files,
            index_content: status.searchable_content,
            ..Default::default()
        };
        stats.coverage = if request.roots.is_empty() {
            status.locations.clone()
        } else {
            status
                .locations
                .iter()
                .filter(|location| {
                    request.roots.iter().any(|root| {
                        crate::search::engine::path_under_root(&location.path, root)
                            || crate::search::engine::path_under_root(root, &location.path)
                    })
                })
                .cloned()
                .collect()
        };

        let mut all_hits: Vec<SearchHit> = Vec::new();
        if request.include_indexed && request.has_constraints() && !cancel.load(Ordering::Relaxed) {
            match self.engine.search(request, cancel, request.limit()) {
                Ok((mut hits, total, _)) => {
                    stats.index_hits = total;
                    stats.content_hits = hits.iter().filter(|hit| hit.match_kind == "content").count();
                    if !hits.is_empty() {
                        progress(SearchProgress {
                            query_id: request.query_id,
                            phase: "index".into(),
                            hits: hits.clone(),
                            done: false,
                            stats: None,
                            note: None,
                        });
                    }
                    all_hits.append(&mut hits);
                }
                Err(error) => {
                    stats.errors += 1;
                    stats.notes.push(format!(
                        "The index provider could not complete: {}. Other providers are still being searched.",
                        error.message
                    ));
                }
            }
        } else if request.include_indexed && !request.has_constraints() {
            stats.notes.push("Enter a search term or choose a filter to begin.".into());
        }

        if request.include_live && !cancel.load(Ordering::Relaxed) {
            let content_budget = if request.needs_content() { 120 } else { 0 };
            let live = live::scan_live(request, cancel, content_budget);
            stats.live_scanned = live.scanned;
            stats.errors += live.errors;
            for note in live.notes {
                if !stats.notes.iter().any(|existing| existing == &note) {
                    stats.notes.push(note);
                }
            }
            if !live.hits.is_empty() {
                progress(SearchProgress {
                    query_id: request.query_id,
                    phase: "filesystem".into(),
                    hits: live.hits.clone(),
                    done: false,
                    stats: None,
                    note: None,
                });
            }
            all_hits.extend(live.hits);
        }

        if request.include_spotlight && !cancel.load(Ordering::Relaxed) {
            let (spotlight_hits, notes) = live::spotlight_search(request);
            stats.spotlight_hits = spotlight_hits.len();
            for note in notes {
                if !stats.notes.iter().any(|existing| existing == &note) {
                    stats.notes.push(note);
                }
            }
            if !spotlight_hits.is_empty() {
                progress(SearchProgress {
                    query_id: request.query_id,
                    phase: "spotlight".into(),
                    hits: spotlight_hits.clone(),
                    done: false,
                    stats: None,
                    note: None,
                });
            }
            all_hits.extend(spotlight_hits);
        }

        let mut hits = dedupe_hits(all_hits);
        engine_sort(&mut hits, request);
        let total = hits.len();
        if hits.len() > request.limit() {
            hits.truncate(request.limit());
            stats.truncated = true;
        }
        stats.total = total;

        if request.needs_content() && stats.index_content == 0 {
            stats.notes.push("Full-text indexing has not produced searchable content yet; content results may be incomplete.".into());
        }
        if stats.index_files == 0 {
            stats.notes.push("The search index is still empty. Live filesystem results are being shown while indexing continues.".into());
        }
        let unavailable: Vec<String> = stats
            .coverage
            .iter()
            .filter(|location| location.status == "unavailable")
            .map(|location| location.path.clone())
            .collect();
        if !unavailable.is_empty() {
            stats.notes.push(format!(
                "{} indexed location(s) are currently unavailable and were not searched.",
                unavailable.len()
            ));
        }
        let incomplete = stats
            .coverage
            .iter()
            .filter(|location| matches!(location.status.as_str(), "indexing" | "pending" | "partial"))
            .count();
        if incomplete > 0 {
            stats.notes.push(format!(
                "{incomplete} location(s) are still being indexed or reconciled; results may grow as the index catches up."
            ));
        }

        progress(SearchProgress {
            query_id: request.query_id,
            phase: "complete".into(),
            hits: Vec::new(),
            done: true,
            stats: Some(stats.clone()),
            note: None,
        });
        Ok(SearchResponse { query_id: request.query_id, hits, stats })
    }

    pub fn find_duplicates(
        &self,
        request: DuplicateRequest,
    ) -> Result<DuplicateResponse, AppError> {
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.cancels.lock() {
            map.insert(request.query_id, cancel.clone());
        }
        let result = self.engine.find_duplicates(&request, &cancel);
        if let Ok(mut map) = self.cancels.lock() {
            map.remove(&request.query_id);
        }
        result
    }
}

fn engine_sort(hits: &mut [SearchHit], request: &SearchRequest) {
    engine::sort_hits(hits, request);
}

/* ------------------------------------------------------------------------- */
/* Contextual folder search                                                   */
/*                                                                            */
/* Kept as a fast, single-folder scan for command-F inside a folder. Global    */
/* Universal Search uses the indexed engine above.                            */
/* ------------------------------------------------------------------------- */

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

pub fn legacy_search_files(
    root: &std::path::Path,
    query: &str,
    show_hidden: bool,
    max_results: usize,
    cancel: Arc<AtomicBool>,
) -> Result<crate::types::SearchResult, AppError> {
    use crate::types::SearchResult;
    use std::time::Instant;
    let metadata = std::fs::metadata(root).map_err(|error| {
        let mapped = AppError::from(error);
        mapped.with_path(root.to_string_lossy())
    })?;
    if !metadata.is_dir() {
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
    let mut entries = Vec::new();
    let mut scanned = 0u64;
    let mut errors = 0u32;
    let mut truncated = false;
    let mut cancelled = false;
    let walker = walkdir::WalkDir::new(root)
        .follow_links(false)
        .max_depth(16)
        .into_iter()
        .filter_entry(|item| {
            if item.depth() == 0 || !item.file_type().is_dir() {
                return true;
            }
            let name = item.file_name().to_string_lossy();
            !live::should_skip_directory(&name, item.depth())
        });
    for item in walker {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        if started.elapsed() > std::time::Duration::from_secs(8) || scanned >= 200_000 {
            truncated = true;
            break;
        }
        scanned += 1;
        let item = match item {
            Ok(item) => item,
            Err(_) => {
                errors += 1;
                continue;
            }
        };
        let name = item.file_name().to_string_lossy();
        let matched = if wildcard {
            wildcard_match(trimmed, &name)
        } else {
            name.to_lowercase().contains(&trimmed.to_lowercase())
        };
        if !matched {
            continue;
        }
        match crate::listing::entry_from_path(item.path()) {
            Ok(entry) => {
                if show_hidden || !entry.is_hidden {
                    entries.push(entry);
                }
            }
            Err(_) => errors += 1,
        }
        if entries.len() >= result_cap {
            truncated = true;
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
