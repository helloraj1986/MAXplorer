use crate::types::Entry;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    Name,
    Content,
    Both,
}

impl Default for SearchMode {
    fn default() -> Self {
        SearchMode::Both
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchMode {
    All,
    Any,
    Phrase,
}

impl Default for MatchMode {
    fn default() -> Self {
        MatchMode::All
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortOrder {
    Relevance,
    Name,
    Modified,
    Created,
    Size,
    Kind,
}

impl Default for SortOrder {
    fn default() -> Self {
        SortOrder::Relevance
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Asc,
    Desc,
}

impl Default for SortDirection {
    fn default() -> Self {
        SortDirection::Desc
    }
}

/// A fully-resolved, verifiable search request. The natural-language interpreter
/// in the frontend produces this object; the backend never invents constraints.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query_id: u64,
    #[serde(default)]
    #[allow(dead_code)]
    pub text: String,
    #[serde(default)]
    pub terms: Vec<String>,
    #[serde(default)]
    pub name_terms: Vec<String>,
    #[serde(default)]
    pub content_terms: Vec<String>,
    #[serde(default)]
    pub exclude_terms: Vec<String>,
    #[serde(default)]
    pub kinds: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub roots: Vec<String>,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default = "default_true")]
    pub include_indexed: bool,
    #[serde(default = "default_true")]
    pub recursive: bool,
    #[serde(default)]
    pub include_live: bool,
    #[serde(default)]
    pub include_spotlight: bool,
    #[serde(default)]
    pub mode: SearchMode,
    #[serde(default)]
    pub match_mode: MatchMode,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    #[allow(dead_code)]
    pub exact_phrase: bool,
    #[serde(default)]
    pub min_size: Option<u64>,
    #[serde(default)]
    pub max_size: Option<u64>,
    #[serde(default)]
    pub modified_after: Option<i64>,
    #[serde(default)]
    pub modified_before: Option<i64>,
    #[serde(default)]
    pub created_after: Option<i64>,
    #[serde(default)]
    pub created_before: Option<i64>,
    #[serde(default)]
    pub accessed_after: Option<i64>,
    #[serde(default)]
    pub accessed_before: Option<i64>,
    #[serde(default)]
    pub no_extension: bool,
    #[serde(default)]
    pub empty_folders: bool,
    #[serde(default)]
    pub limit: usize,
    #[serde(default)]
    pub sort: SortOrder,
    #[serde(default)]
    pub sort_direction: SortDirection,
}

fn default_true() -> bool {
    true
}

impl SearchRequest {
    pub fn limit(&self) -> usize {
        self.limit.clamp(1, 5_000)
    }

    pub fn needs_content(&self) -> bool {
        matches!(self.mode, SearchMode::Content | SearchMode::Both) && !self.all_terms().is_empty()
    }

    pub fn all_terms(&self) -> Vec<String> {
        let mut terms = self.terms.clone();
        for term in self.name_terms.iter().chain(self.content_terms.iter()) {
            if !terms.iter().any(|existing| existing == term) {
                terms.push(term.clone());
            }
        }
        terms
    }

    /// True when the request only constrains metadata (used by empty queries
    /// with active filters, which are still valid searches).
    pub fn has_constraints(&self) -> bool {
        !self.all_terms().is_empty()
            || !self.kinds.is_empty()
            || !self.extensions.is_empty()
            || !self.roots.is_empty()
            || self.min_size.is_some()
            || self.max_size.is_some()
            || self.modified_after.is_some()
            || self.modified_before.is_some()
            || self.created_after.is_some()
            || self.created_before.is_some()
            || self.accessed_after.is_some()
            || self.accessed_before.is_some()
            || self.no_extension
            || self.empty_folders
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub entry: Entry,
    pub score: f64,
    pub match_kind: String,
    pub snippet: Option<String>,
    pub source: String,
    pub indexed: bool,
    pub explanation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationCoverage {
    pub path: String,
    pub name: String,
    pub status: String,
    pub indexed_files: u64,
    pub searchable_files: u64,
    pub last_indexed: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchStats {
    pub elapsed_ms: u64,
    pub index_hits: usize,
    pub live_scanned: u64,
    pub spotlight_hits: usize,
    pub content_hits: usize,
    pub total: usize,
    pub truncated: bool,
    pub errors: u64,
    pub fts_available: bool,
    pub index_files: u64,
    pub index_content: u64,
    pub coverage: Vec<LocationCoverage>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub query_id: u64,
    pub hits: Vec<SearchHit>,
    pub stats: SearchStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProgress {
    pub query_id: u64,
    pub phase: String,
    pub hits: Vec<SearchHit>,
    pub done: bool,
    pub stats: Option<SearchStats>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexError {
    pub path: String,
    pub message: String,
    pub kind: String,
    pub occurred_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub paused: bool,
    pub activity: String,
    pub current_path: Option<String>,
    pub fts_available: bool,
    pub content_enabled: bool,
    pub max_content_bytes: u64,
    pub db_path: String,
    pub index_size_bytes: u64,
    pub indexed_files: u64,
    pub indexed_folders: u64,
    pub searchable_content: u64,
    pub pending_content: u64,
    pub failed_content: u64,
    pub skipped_content: u64,
    pub last_reconciliation: Option<i64>,
    pub locations: Vec<LocationCoverage>,
    pub errors: Vec<IndexError>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateRequest {
    #[serde(default)]
    pub query_id: u64,
    #[serde(default)]
    pub roots: Vec<String>,
    #[serde(default)]
    pub min_size: u64,
    #[serde(default)]
    #[allow(dead_code)]
    pub include_similar_names: bool,
    #[serde(default)]
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateFile {
    pub entry: Entry,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub id: String,
    pub kind: String,
    pub files: Vec<DuplicateFile>,
    pub size: u64,
    pub recoverable_bytes: u64,
    pub verified: bool,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateResponse {
    pub query_id: u64,
    pub groups: Vec<DuplicateGroup>,
    pub scanned_files: u64,
    pub candidate_files: u64,
    pub hashed_files: u64,
    pub recoverable_bytes: u64,
    pub cancelled: bool,
    pub errors: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSuggestion {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub kind: String,
}
