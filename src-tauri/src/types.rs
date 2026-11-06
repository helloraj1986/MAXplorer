use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: Option<u64>,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub accessed: Option<i64>,
    pub extension: Option<String>,
    pub is_hidden: bool,
    pub is_read_only: bool,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    pub entries: Vec<Entry>,
    pub truncated: bool,
    pub read_errors: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub icon: String,
    pub is_volume: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub root: String,
    pub query: String,
    pub entries: Vec<Entry>,
    pub truncated: bool,
    pub cancelled: bool,
    pub scanned: u64,
    pub errors: u32,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy {
    Error,
    Replace,
    Rename,
    Skip,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferMode {
    Copy,
    Move,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    pub id: u64,
    pub paths: Vec<String>,
    pub destination: String,
    pub mode: TransferMode,
    pub conflict: ConflictPolicy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub id: u64,
    pub status: String,
    pub phase: String,
    pub current_file: Option<String>,
    pub processed_bytes: u64,
    pub total_bytes: u64,
    pub processed_items: u64,
    pub total_items: u64,
    pub bytes_per_second: f64,
    pub eta_seconds: Option<f64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOutcome {
    pub id: u64,
    pub cancelled: bool,
    pub paused: bool,
    pub results: Vec<OperationResult>,
    pub total_bytes: u64,
    pub processed_bytes: u64,
    pub total_items: u64,
    pub processed_items: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonEntry {
    pub name: String,
    pub left_path: Option<String>,
    pub right_path: Option<String>,
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
    pub left_modified: Option<i64>,
    pub right_modified: Option<i64>,
    pub is_dir: bool,
    pub size_differs: bool,
    pub modified_differs: bool,
    /// `None` means content was not verified. `Some(false)` means the bytes
    /// differ even though names and sizes matched.
    pub content_equal: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderComparison {
    pub left: String,
    pub right: String,
    pub entries: Vec<ComparisonEntry>,
    pub left_only: u64,
    pub right_only: u64,
    pub different: u64,
    pub identical: u64,
    pub content_verified: u64,
    pub cancelled: bool,
    pub scanned: u64,
    pub errors: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonProgress {
    pub request_id: u64,
    pub scanned: u64,
    pub total: u64,
    pub current: Option<String>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub source: String,
    pub destination: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

impl OperationResult {
    pub fn completed(source: &str, destination: &std::path::Path) -> Self {
        Self {
            source: source.to_string(),
            destination: Some(destination.to_string_lossy().to_string()),
            status: "completed".into(),
            error: None,
        }
    }

    pub fn skipped(source: &str) -> Self {
        Self {
            source: source.to_string(),
            destination: None,
            status: "skipped".into(),
            error: None,
        }
    }

    pub fn failed(source: &str, error: String) -> Self {
        Self {
            source: source.to_string(),
            destination: None,
            status: "failed".into(),
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Properties {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub target: Option<String>,
    pub size: Option<u64>,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub accessed: Option<i64>,
    pub extension: Option<String>,
    pub permissions: String,
    pub owner_id: Option<u32>,
    pub group_id: Option<u32>,
    pub is_read_only: bool,
    pub is_hidden: bool,
    pub item_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStats {
    pub total_size: u64,
    pub files: u64,
    pub folders: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPreview {
    pub text: String,
    pub truncated: bool,
    pub binary: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMetadata {
    pub path: String,
    pub name: String,
    pub extension: Option<String>,
    pub content_type: String,
    pub content_type_tree: Vec<String>,
    pub kind: String,
    pub size: Option<u64>,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_readable: bool,
    pub is_package: bool,
    pub is_icloud_placeholder: bool,
    pub is_network_volume: bool,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub duration: Option<f64>,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub codecs: Vec<String>,
    pub page_count: Option<u64>,
    pub tags: Vec<String>,
    pub quick_look_supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewThumbnail {
    pub data_url: Option<String>,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub mime: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub name: String,
    pub size: Option<u64>,
    pub compressed_size: Option<u64>,
    pub is_dir: bool,
    pub modified: Option<i64>,
    pub method: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListing {
    pub format: String,
    pub entries: Vec<ArchiveEntry>,
    pub total_size: u64,
    pub compressed_size: u64,
    pub truncated: bool,
    pub encrypted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPreview {
    pub path: String,
    pub item_count: u64,
    pub total_size: u64,
    pub files: u64,
    pub folders: u64,
    pub truncated: bool,
    pub cancelled: bool,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRangePreview {
    pub text: String,
    pub offset: u64,
    pub next_offset: u64,
    pub truncated: bool,
    pub binary: bool,
    pub size: u64,
    pub decoded_plist: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub platform: String,
    pub home: String,
    pub path_separator: String,
    pub modifier: String,
    pub computer_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationInfo {
    pub name: String,
    pub path: String,
}
