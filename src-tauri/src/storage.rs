//! Storage Space Analyzer backend.
//!
//! The analyzer is deliberately built on real filesystem metadata only:
//! `statvfs` for capacity, `symlink_metadata` for per-entry identity, block
//! counts for allocated size on Unix, and the existing `trash`/operations
//! layer for every destructive action. Nothing is uploaded and no file is
//! opened unless duplicate verification explicitly needs its bytes.

use crate::error::AppError;
use crate::listing::entry_from_path;
use crate::logging;
use crate::operations;
use crate::paths::{home_dir, normalize_path, reject_unsafe_destruction, system_time_ms};
use crate::search::engine::{hash_file, quick_fingerprint};
use crate::storage_cache::{CachedStorageScan, StorageCache};
use crate::types::{Entry, OperationResult};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

/// Absolute ceiling on entries walked, independent of memory. It exists only so a
/// pathological tree (or a hostile network mount) cannot keep the walker alive
/// forever; the real guard is the memory budget below. The Quick overview control
/// asks for 500,000 entries explicitly; Deep scan sends `0` (auto).
const MAX_ENTRIES_LIMIT: usize = 50_000_000;
/// Share of currently-available memory the in-memory index may claim. The rest
/// is headroom for the webview, the SQLite cache write, and the OS.
const INDEX_MEMORY_SHARE_PERCENT: u64 = 55;
/// Never plan an index smaller than this, so small machines still get a usable
/// 500,000-entry Quick scan instead of an immediately truncated one.
const MIN_INDEX_BUDGET_BYTES: u64 = 192 * 1024 * 1024;
/// Used when the platform cannot report available memory (Windows without a
/// probing crate): a fixed budget that still beats the old 5,000,000 ceiling.
const FALLBACK_INDEX_BUDGET_BYTES: u64 = 4 * 1024 * 1024 * 1024;
/// Per-entry bookkeeping the record strings do not cover: the `Vec`/`HashMap` slot,
/// the `(device, inode)` key, and the allocator header that rounds each small
/// string allocation up to a 16-byte boundary.
const ENTRY_INDEX_OVERHEAD: u64 = 160;
const MAX_SCAN_DEPTH: usize = 96;
const TOP_RESULT_LIMIT: usize = 500;
const ONE_GB: u64 = 1024 * 1024 * 1024;
const ONE_MB: u64 = 1024 * 1024;
const ONE_DAY_MS: i64 = 86_400_000;

/* ------------------------------------------------------------------------- */
/* Public contracts                                                           */
/* ------------------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageVolume {
    pub id: String,
    pub name: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f64,
    pub filesystem: Option<String>,
    pub is_removable: bool,
    pub is_network: bool,
    pub is_internal: bool,
    pub is_apfs: bool,
    pub is_virtual: bool,
    pub kind: String,
    pub container: Option<String>,
    pub device: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageScanRequest {
    pub scan_id: u64,
    pub root: String,
    /// Entry ceiling. `0` (the Deep scan control) means auto: the backend sizes the
    /// scan to the machine's available memory.
    #[serde(default)]
    pub max_entries: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageScanProgress {
    pub scan_id: u64,
    pub root: String,
    pub scanned_entries: u64,
    pub scanned_files: u64,
    pub scanned_directories: u64,
    pub logical_bytes: u64,
    pub current_path: Option<String>,
    pub elapsed_ms: u64,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageFile {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub extension: Option<String>,
    pub is_symlink: bool,
    pub size: u64,
    pub allocated: u64,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub accessed: Option<i64>,
    pub is_hidden: bool,
    pub is_package: bool,
    pub hard_link: bool,
    pub cloud_placeholder: bool,
    pub is_protected: bool,
    pub is_read_only: bool,
    pub category: String,
    pub file_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDirectory {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub size: u64,
    pub allocated: u64,
    pub files: u64,
    pub folders: u64,
    pub direct_files: u64,
    pub direct_folders: u64,
    pub largest_file_size: u64,
    pub largest_file_path: Option<String>,
    pub modified: Option<i64>,
    pub depth: u32,
    pub is_package: bool,
    pub is_protected: bool,
    pub is_read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCategory {
    pub id: String,
    pub label: String,
    pub bytes: u64,
    pub allocated: u64,
    pub files: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageFileType {
    pub id: String,
    pub label: String,
    pub bytes: u64,
    pub allocated: u64,
    pub files: u64,
    pub percent: f64,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRecommendation {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub reason: String,
    pub path: String,
    pub size: u64,
    pub recoverable_bytes: u64,
    pub risk: String,
    pub action: String,
    pub is_directory: bool,
    pub category: String,
    pub modified: Option<i64>,
    pub reversible: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageScanResult {
    pub scan_id: u64,
    pub root: String,
    pub volume: Option<StorageVolume>,
    pub started_at: i64,
    pub finished_at: i64,
    pub elapsed_ms: u64,
    pub scanned_entries: u64,
    pub scanned_files: u64,
    pub scanned_directories: u64,
    pub symbolic_links: u64,
    pub hard_links: u64,
    pub permission_errors: u64,
    pub read_errors: u64,
    pub skipped_mounts: u64,
    pub skipped_reserved: u64,
    pub total_logical_bytes: u64,
    pub total_allocated_bytes: u64,
    pub inspectable_bytes: u64,
    pub uninspected_bytes: u64,
    pub cleanup_recoverable_bytes: u64,
    pub cancelled: bool,
    pub truncated: bool,
    /// Prose describing which guard stopped the scan, set only when `truncated`.
    pub truncation_reason: Option<String>,
    pub max_entries: u64,
    pub categories: Vec<StorageCategory>,
    pub file_types: Vec<StorageFileType>,
    pub largest_files: Vec<StorageFile>,
    pub largest_directories: Vec<StorageDirectory>,
    pub recent_large_files: Vec<StorageFile>,
    pub stale_large_files: Vec<StorageFile>,
    pub cleanup: Vec<CleanupRecommendation>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageChildren {
    pub path: String,
    pub directory: StorageDirectory,
    pub directories: Vec<StorageDirectory>,
    pub files: Vec<StorageFile>,
    pub total_size: u64,
    pub total_files: u64,
    pub total_folders: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageFileQuery {
    pub scan_id: u64,
    #[serde(default)]
    pub directory: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub file_type: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub extension: Option<String>,
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
    pub hidden: Option<bool>,
    #[serde(default)]
    pub symlinks: Option<bool>,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageFilePage {
    pub files: Vec<StorageFile>,
    pub total: u64,
    pub total_bytes: u64,
    pub offset: u64,
    pub limit: u64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDuplicateRequest {
    pub request_id: u64,
    pub roots: Vec<String>,
    #[serde(default)]
    pub min_size: u64,
    #[serde(default)]
    pub limit: usize,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub max_candidates: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDuplicateFile {
    pub entry: Entry,
    pub hash: String,
    pub volume: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDuplicateGroup {
    pub id: String,
    pub size: u64,
    pub recoverable_bytes: u64,
    pub files: Vec<StorageDuplicateFile>,
    pub verified: bool,
    pub same_volume: bool,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDuplicateResponse {
    pub request_id: u64,
    pub groups: Vec<StorageDuplicateGroup>,
    pub scanned_files: u64,
    pub candidate_files: u64,
    pub hashed_files: u64,
    pub changed_files: u64,
    pub errors: u64,
    pub recoverable_bytes: u64,
    pub cancelled: bool,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDeleteItem {
    pub path: String,
    #[serde(default)]
    pub expected_size: Option<u64>,
    #[serde(default)]
    pub expected_modified: Option<i64>,
    #[serde(default)]
    pub is_directory: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDeleteRequest {
    pub operation_id: u64,
    pub scan_id: u64,
    pub items: Vec<StorageDeleteItem>,
    #[serde(default)]
    pub permanent: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDeleteOutcome {
    pub operation_id: u64,
    pub results: Vec<OperationResult>,
    pub requested_bytes: u64,
    pub reclaimed_bytes: u64,
    pub free_before: Option<u64>,
    pub free_after: Option<u64>,
    pub changed: Vec<String>,
    pub skipped_overlaps: Vec<String>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDeleteProgress {
    pub operation_id: u64,
    pub processed: u64,
    pub total: u64,
    pub completed: u64,
    pub failed: u64,
    pub current_path: Option<String>,
    pub cancelled: bool,
}

/* ------------------------------------------------------------------------- */
/* State                                                                      */
/* ------------------------------------------------------------------------- */

#[derive(Default)]
pub struct StorageState {
    current: Arc<Mutex<Option<Arc<ScanIndex>>>>,
    cancels: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    cache_path: PathBuf,
    cache: Mutex<Option<StorageCache>>,
}

impl StorageState {
    pub fn new(cache_path: PathBuf) -> Self {
        // Opening a multi-gigabyte cache synchronously used to delay the first
        // window. Keep only the path here and open the cache on first use.
        logging::info(
            "storage.cache",
            format!(
                "storage cache deferred until first use at {}",
                cache_path.display()
            ),
        );
        Self {
            current: Arc::new(Mutex::new(None)),
            cancels: Mutex::new(HashMap::new()),
            cache_path,
            cache: Mutex::new(None),
        }
    }

    fn cache(&self) -> Option<StorageCache> {
        let Ok(mut slot) = self.cache.lock() else {
            return None;
        };
        if let Some(cache) = slot.as_ref() {
            return Some(cache.clone());
        }
        let started = Instant::now();
        match StorageCache::new(self.cache_path.clone()) {
            Ok(cache) => {
                logging::info(
                    "storage.cache",
                    format!(
                        "storage cache opened at {} in {} ms",
                        cache.path().display(),
                        started.elapsed().as_millis()
                    ),
                );
                *slot = Some(cache.clone());
                Some(cache)
            }
            Err(error) => {
                logging::error(
                    "storage.cache",
                    format!("storage cache unavailable: {error}"),
                );
                None
            }
        }
    }

    pub(crate) fn store(&self, index: ScanIndex) -> Arc<ScanIndex> {
        let index = Arc::new(index);
        if let Ok(mut current) = self.current.lock() {
            *current = Some(index.clone());
        }
        index
    }

    pub(crate) fn persist_async(&self, index: Arc<ScanIndex>) {
        let Some(cache) = self.cache() else {
            logging::warn("storage.cache", "no cache available; scan will not persist");
            return;
        };
        let slot = self.current.clone();
        std::thread::spawn(move || {
            let directories = index.directories.values().cloned().collect::<Vec<_>>();
            if let Err(error) = cache.store(&index.scan, &index.files, &directories) {
                logging::error("storage.cache", format!("could not persist scan: {error}"));
                return;
            }
            // The rows are durable, so the multi-hundred-megabyte file index can be
            // released. Drill-down and paging now read the same rows from SQLite.
            let freed = index.file_index_bytes();
            let slim = ScanIndex {
                scan: index.scan.clone(),
                files: Vec::new(),
                directories: index.directories.clone(),
                persisted: Some(PersistedIndex {
                    cache: cache.clone(),
                    scan_id: index.scan.scan_id,
                }),
            };
            let mut guard = match slot.lock() {
                Ok(guard) => guard,
                Err(error) => error.into_inner(),
            };
            let replace = guard
                .as_ref()
                .map(|current| current.scan.scan_id == index.scan.scan_id)
                .unwrap_or(false);
            if replace {
                *guard = Some(Arc::new(slim));
                logging::info(
                    "storage.cache",
                    format!(
                        "released {} MiB of in-memory file index for scan {}; queries now read sqlite",
                        freed / (1024 * 1024),
                        index.scan.scan_id
                    ),
                );
            }
        });
    }

    fn cached(&self, root: Option<&str>) -> Option<CachedStorageScan> {
        let Some(cache) = self.cache() else {
            return None;
        };
        match cache.latest(root) {
            Ok(value) => {
                if let Some(value) = value.as_ref() {
                    logging::info(
                        "storage.cache",
                        format!(
                            "restored cached scan {} for {} (finished {})",
                            value.scan.scan_id, value.scan.root, value.cached_at
                        ),
                    );
                }
                value
            }
            Err(error) => {
                logging::error("storage.cache", format!("could not read cache: {error}"));
                None
            }
        }
    }

    fn cached_children(
        &self,
        scan_id: u64,
        path: &str,
        limit: usize,
    ) -> Result<StorageChildren, AppError> {
        let Some(cache) = self.cache() else {
            return Err(AppError::new(
                "no_scan",
                "No cached scan is available.",
                None,
            ));
        };
        cache.children(scan_id, path, limit)
    }

    fn cached_query(&self, query: &StorageFileQuery) -> Result<StorageFilePage, AppError> {
        let Some(cache) = self.cache() else {
            return Err(AppError::new(
                "no_scan",
                "No cached scan is available.",
                None,
            ));
        };
        cache.query_files(query)
    }

    pub(crate) fn current(&self) -> Option<Arc<ScanIndex>> {
        self.current.lock().ok().and_then(|value| value.clone())
    }

    fn register(&self, id: u64) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.cancels.lock() {
            map.insert(id, token.clone());
        }
        token
    }

    fn remove(&self, id: u64) {
        if let Ok(mut map) = self.cancels.lock() {
            map.remove(&id);
        }
    }

    fn cancel(&self, id: u64) {
        if let Ok(map) = self.cancels.lock() {
            if let Some(token) = map.get(&id) {
                token.store(true, Ordering::Relaxed);
            }
        }
    }

    fn clear(&self) {
        if let Ok(mut current) = self.current.lock() {
            *current = None;
        }
        if let Some(cache) = self.cache() {
            if let Err(error) = cache.clear() {
                logging::error("storage.cache", format!("could not clear cache: {error}"));
            }
        }
    }
}

/* ------------------------------------------------------------------------- */
/* Volume discovery and filesystem capacity                                   */
/* ------------------------------------------------------------------------- */

#[derive(Debug, Clone)]
struct MountEntry {
    mount: PathBuf,
    filesystem: String,
}

#[derive(Debug, Default, Clone)]
struct DiskInfo {
    name: Option<String>,
    filesystem: Option<String>,
    internal: Option<bool>,
    removable: Option<bool>,
    virtual_disk: Option<bool>,
    container: Option<String>,
    device: Option<String>,
    apfs: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default)]
struct Usage {
    total: u64,
    free: u64,
    available: u64,
}

fn mount_table() -> Vec<MountEntry> {
    let output = match Command::new("mount").output() {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    for line in text.lines() {
        let Some((_device, rest)) = line.split_once(" on ") else {
            continue;
        };
        let (mount, tail) = match rest.split_once(" (") {
            Some((mount, tail)) => (mount, tail),
            None => (rest, ""),
        };
        let filesystem = tail.split(',').next().unwrap_or("").trim().to_string();
        entries.push(MountEntry {
            mount: PathBuf::from(mount),
            filesystem,
        });
    }
    entries
}

#[cfg(unix)]
fn filesystem_usage(path: &Path) -> Option<Usage> {
    use std::ffi::CString;
    let raw = CString::new(path.to_string_lossy().as_bytes()).ok()?;
    let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
    let result = unsafe { libc::statvfs(raw.as_ptr(), &mut stats) };
    if result != 0 {
        return None;
    }
    let fragment = if stats.f_frsize > 0 {
        stats.f_frsize as u64
    } else {
        stats.f_bsize as u64
    };
    let total = (stats.f_blocks as u64).saturating_mul(fragment);
    let free = (stats.f_bfree as u64).saturating_mul(fragment);
    let available = (stats.f_bavail as u64).saturating_mul(fragment);
    Some(Usage {
        total,
        free,
        available,
    })
}

#[cfg(not(unix))]
fn filesystem_usage(_path: &Path) -> Option<Usage> {
    None
}

#[cfg(target_os = "macos")]
fn disk_info(path: &Path) -> DiskInfo {
    use std::io::Cursor;
    let output = match Command::new("diskutil")
        .arg("info")
        .arg("-plist")
        .arg(path)
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return DiskInfo::default(),
    };
    let value = match plist::Value::from_reader(Cursor::new(output.stdout)) {
        Ok(value) => value,
        Err(_) => return DiskInfo::default(),
    };
    let Some(dict) = value.as_dictionary() else {
        return DiskInfo::default();
    };
    let string = |key: &str| {
        dict.get(key)
            .and_then(|value| value.as_string())
            .map(|value| value.to_string())
    };
    let boolean = |key: &str| dict.get(key).and_then(|value| value.as_boolean());
    let filesystem = string("FilesystemType")
        .or_else(|| string("FilesystemName"))
        .or_else(|| string("TypeBundle"));
    let location = string("DeviceLocation");
    let internal = boolean("Internal").or_else(|| {
        location.as_ref().map(|value| {
            value.eq_ignore_ascii_case("internal") || value.to_lowercase().contains("internal")
        })
    });
    let virtual_disk = boolean("VirtualOrPhysical")
        .map(|value| !value)
        .or_else(|| string("VirtualOrPhysical").map(|value| value.eq_ignore_ascii_case("virtual")));
    DiskInfo {
        name: string("VolumeName").or_else(|| string("MediaName")),
        filesystem: filesystem.clone(),
        internal,
        removable: boolean("RemovableMedia").or_else(|| boolean("Removable")),
        virtual_disk,
        container: string("APFSContainerReference")
            .or_else(|| string("APFSPhysicalStore"))
            .or_else(|| string("ParentWholeDisk")),
        device: string("DeviceNode").or_else(|| string("DeviceIdentifier")),
        apfs: filesystem
            .as_ref()
            .map(|value| value.to_lowercase().contains("apfs"))
            .or_else(|| dict.get("APFSContainerReference").map(|_| true)),
    }
}

#[cfg(not(target_os = "macos"))]
fn disk_info(_path: &Path) -> DiskInfo {
    DiskInfo::default()
}

fn filesystem_for(mounts: &[MountEntry], path: &Path) -> Option<String> {
    mounts
        .iter()
        .filter(|entry| path.starts_with(&entry.mount) && !entry.filesystem.is_empty())
        .max_by_key(|entry| entry.mount.components().count())
        .map(|entry| entry.filesystem.clone())
}

fn network_filesystem(filesystem: &str) -> bool {
    let lower = filesystem.to_lowercase();
    ["smbfs", "afpfs", "nfs", "webdav", "cifs", "ftp", "sshfs"]
        .iter()
        .any(|value| lower.contains(value))
}

fn volume_from_mount(
    mount: &Path,
    name: Option<&str>,
    mounts: &[MountEntry],
) -> Option<StorageVolume> {
    let usage = filesystem_usage(mount)?;
    let info = disk_info(mount);
    let filesystem = info
        .filesystem
        .clone()
        .or_else(|| filesystem_for(mounts, mount));
    let is_network = filesystem
        .as_deref()
        .map(network_filesystem)
        .unwrap_or(false)
        || mount.starts_with("/Network");
    let is_internal = info.internal.unwrap_or(mount == Path::new("/"));
    let is_removable = info.removable.unwrap_or(false);
    let is_virtual = info.virtual_disk.unwrap_or(false);
    let kind = if is_network {
        "network"
    } else if is_virtual {
        "diskImage"
    } else if is_removable {
        "removable"
    } else if is_internal {
        "internal"
    } else {
        "external"
    };
    let used = usage.total.saturating_sub(usage.free);
    let percent = if usage.total == 0 {
        0.0
    } else {
        (used as f64 / usage.total as f64) * 100.0
    };
    let display_name = info
        .name
        .filter(|value| !value.trim().is_empty())
        .or_else(|| name.map(|value| value.to_string()))
        .or_else(|| {
            mount
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| mount.to_string_lossy().to_string());
    Some(StorageVolume {
        id: format!("volume:{}", mount.to_string_lossy()),
        name: display_name,
        mount_point: mount.to_string_lossy().to_string(),
        total_bytes: usage.total,
        free_bytes: usage.free,
        available_bytes: usage.available,
        used_bytes: used,
        usage_percent: percent,
        filesystem,
        is_removable,
        is_network,
        is_internal,
        is_apfs: info.apfs.unwrap_or(false),
        is_virtual,
        kind: kind.into(),
        container: info.container,
        device: info.device,
    })
}

#[cfg(unix)]
pub fn discover_volumes() -> Vec<StorageVolume> {
    let mounts = mount_table();
    let mut candidates: Vec<(PathBuf, Option<String>)> = vec![(PathBuf::from("/"), None)];
    if let Ok(reader) = fs::read_dir("/Volumes") {
        let mut volumes: Vec<PathBuf> = reader
            .filter_map(|item| item.ok())
            .map(|item| item.path())
            .filter(|path| path.is_dir())
            .filter(|path| {
                path.file_name()
                    .map(|name| !name.to_string_lossy().starts_with('.'))
                    .unwrap_or(false)
            })
            .collect();
        volumes.sort();
        for volume in volumes {
            candidates.push((volume, None));
        }
    }
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for (mount, name) in candidates {
        let identity = fs::canonicalize(&mount).unwrap_or_else(|_| mount.clone());
        if !seen.insert(identity) {
            continue;
        }
        if let Some(volume) = volume_from_mount(&mount, name.as_deref(), &mounts) {
            result.push(volume);
        }
    }
    result.sort_by(|left, right| {
        right
            .is_internal
            .cmp(&left.is_internal)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    result
}

#[cfg(windows)]
pub fn discover_volumes() -> Vec<StorageVolume> {
    let script = "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace,DriveType | ConvertTo-Json -Compress";
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let rows = match value {
        serde_json::Value::Array(rows) => rows,
        row => vec![row],
    };
    let mut result = Vec::new();
    for row in rows {
        let device = row
            .get("DeviceID")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if device.is_empty() {
            continue;
        }
        let total = row
            .get("Size")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let free = row
            .get("FreeSpace")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let drive_type = row
            .get("DriveType")
            .and_then(|value| value.as_u64())
            .unwrap_or(3);
        let filesystem = row
            .get("FileSystem")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());
        let name = row
            .get("VolumeName")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .unwrap_or(device);
        let is_network = drive_type == 4;
        let is_removable = drive_type == 2 || drive_type == 5;
        let used = total.saturating_sub(free);
        result.push(StorageVolume {
            id: format!("volume:{device}"),
            name: format!("{name} ({device})"),
            mount_point: device.to_string(),
            total_bytes: total,
            free_bytes: free,
            available_bytes: free,
            used_bytes: used,
            usage_percent: if total == 0 {
                0.0
            } else {
                used as f64 / total as f64 * 100.0
            },
            filesystem,
            is_removable,
            is_network,
            is_internal: !is_removable && !is_network,
            is_apfs: false,
            is_virtual: false,
            kind: if is_network {
                "network"
            } else if is_removable {
                "removable"
            } else {
                "internal"
            }
            .into(),
            container: None,
            device: Some(device.to_string()),
        });
    }
    result
}

#[cfg(not(any(unix, windows)))]
pub fn discover_volumes() -> Vec<StorageVolume> {
    Vec::new()
}

fn volume_for_root(root: &Path) -> Option<StorageVolume> {
    let mounts = mount_table();
    #[cfg(unix)]
    {
        if root == Path::new("/") {
            return volume_from_mount(root, None, &mounts);
        }
        for volume in discover_volumes() {
            if root.starts_with(Path::new(&volume.mount_point)) {
                return Some(volume);
            }
        }
        None
    }
    #[cfg(windows)]
    {
        let root_text = root.to_string_lossy().to_lowercase();
        return discover_volumes()
            .into_iter()
            .find(|volume| root_text.starts_with(&volume.mount_point.to_lowercase()));
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = mounts;
        None
    }
}

/* ------------------------------------------------------------------------- */
/* Scanning helpers                                                           */
/* ------------------------------------------------------------------------- */

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn metadata_hidden(metadata: &fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    metadata.st_flags() & 0x8000 != 0
}

#[cfg(target_os = "windows")]
fn metadata_hidden(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x2 != 0
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn metadata_hidden(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn allocated_size(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.blocks().saturating_mul(512)
}

#[cfg(not(unix))]
fn allocated_size(metadata: &fs::Metadata) -> u64 {
    metadata.len()
}

#[cfg(unix)]
fn inode_identity(metadata: &fs::Metadata) -> Option<(u64, u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    if metadata.nlink() > 1 {
        Some((metadata.dev(), metadata.ino(), metadata.nlink()))
    } else {
        None
    }
}

#[cfg(not(unix))]
fn inode_identity(_metadata: &fs::Metadata) -> Option<(u64, u64, u64)> {
    None
}

fn is_package_directory(name: &str) -> bool {
    let lower = name.to_lowercase();
    [
        ".app",
        ".framework",
        ".bundle",
        ".xcodeproj",
        ".playground",
        ".plugin",
        ".kext",
        ".pkg",
        ".mpkg",
        ".utm",
        ".pvm",
    ]
    .iter()
    .any(|suffix| lower.ends_with(suffix))
}

fn category_label(id: &str) -> &'static str {
    match id {
        "applications" => "Applications",
        "documents" => "Documents",
        "photos" => "Photos",
        "videos" => "Videos",
        "audio" => "Audio",
        "downloads" => "Downloads",
        "archives" => "Archives & disk images",
        "developer" => "Developer files",
        "virtualMachines" => "Virtual machines",
        "mail" => "Mail & messages",
        "system" => "System",
        "caches" => "Caches & temporary files",
        "trash" => "Trash",
        _ => "Other files",
    }
}

fn file_type_label(id: &str) -> &'static str {
    match id {
        "videos" => "Videos",
        "images" => "Images",
        "audio" => "Audio",
        "pdf" => "PDF documents",
        "documents" => "Documents",
        "archives" => "Archives",
        "diskImages" => "Disk images",
        "applications" => "Applications",
        "developer" => "Source & build files",
        "virtualMachines" => "Virtual machines",
        "databases" => "Databases",
        "fonts" => "Fonts",
        _ => "Other",
    }
}

/// Case-insensitive ASCII substring search that never allocates. Every needle in
/// this module is lowercase ASCII, so comparing ASCII letters is equivalent to
/// the `to_lowercase()` copies this replaces.
fn contains_ignore_ascii_case(haystack: &str, needle: &str) -> bool {
    let hay = haystack.as_bytes();
    let needle = needle.as_bytes();
    if needle.is_empty() {
        return true;
    }
    if needle.len() > hay.len() {
        return false;
    }
    hay.windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle))
}

fn starts_with_ignore_ascii_case(haystack: &str, prefix: &str) -> bool {
    let hay = haystack.as_bytes();
    let prefix = prefix.as_bytes();
    if prefix.len() > hay.len() {
        return false;
    }
    hay[..prefix.len()].eq_ignore_ascii_case(prefix)
}

fn ends_with_ignore_ascii_case(haystack: &str, suffix: &str) -> bool {
    let hay = haystack.as_bytes();
    let suffix = suffix.as_bytes();
    if suffix.len() > hay.len() {
        return false;
    }
    hay[hay.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
}

/// True when `path` contains `component` as a whole path segment, matching either
/// `/component/` or a trailing `/component`.
fn has_component(path: &str, component: &str) -> bool {
    let mut rest = path;
    loop {
        match rest.find('/') {
            Some(index) => {
                rest = &rest[index + 1..];
                if rest.len() >= component.len()
                    && rest.as_bytes()[..component.len()]
                        .eq_ignore_ascii_case(component.as_bytes())
                {
                    let after = &rest[component.len()..];
                    if after.is_empty() || after.starts_with('/') {
                        return true;
                    }
                }
            }
            None => return false,
        }
    }
}

/// Assign exactly one storage category per file. Location categories win over
/// extension categories so application resources, caches, and developer
/// artifacts are never double-counted as media or documents.
pub(crate) fn category_for(path: &Path, extension: Option<&str>) -> &'static str {
    // `to_string_lossy` borrows for valid UTF-8, so nothing is allocated here.
    let path = path.to_string_lossy();
    let ext = extension.unwrap_or("");
    if has_component(&path, ".trash") || has_component(&path, ".trashes") {
        return "trash";
    }
    if contains_ignore_ascii_case(&path, "/library/caches/")
        || contains_ignore_ascii_case(&path, "/library/logs/")
        || contains_ignore_ascii_case(&path, "/var/folders/")
        || contains_ignore_ascii_case(&path, "/private/var/folders/")
        || contains_ignore_ascii_case(&path, "/private/tmp/")
        || contains_ignore_ascii_case(&path, "/var/tmp/")
        || starts_with_ignore_ascii_case(&path, "/tmp/")
    {
        return "caches";
    }
    if contains_ignore_ascii_case(&path, "/library/developer/")
        || contains_ignore_ascii_case(&path, "/deriveddata/")
        || contains_ignore_ascii_case(&path, "/.cargo/")
        || contains_ignore_ascii_case(&path, "/.rustup/")
        || contains_ignore_ascii_case(&path, "/.npm/")
        || contains_ignore_ascii_case(&path, "/.pnpm-store/")
        || contains_ignore_ascii_case(&path, "/.yarn/")
        || contains_ignore_ascii_case(&path, "/.gradle/")
        || contains_ignore_ascii_case(&path, "/.m2/")
        || contains_ignore_ascii_case(&path, "/node_modules/")
        || contains_ignore_ascii_case(&path, "/android/sdk/")
        || contains_ignore_ascii_case(&path, "/.docker/")
        || contains_ignore_ascii_case(&path, "/.vscode/extensions/")
        || contains_ignore_ascii_case(&path, "/pods/")
        || contains_ignore_ascii_case(&path, "/target/debug/")
        || contains_ignore_ascii_case(&path, "/target/release/")
        || contains_ignore_ascii_case(&path, "/.build/")
        || contains_ignore_ascii_case(&path, "/.next/")
        || contains_ignore_ascii_case(&path, "/.nuxt/")
    {
        return "developer";
    }
    if matches!(ext, "vmdk" | "vdi" | "qcow2" | "vhd" | "vhdx")
        || contains_ignore_ascii_case(&path, "/virtual machines.localized/")
        || has_component(&path, ".utm")
        || has_component(&path, ".pvm")
    {
        return "virtualMachines";
    }
    if contains_ignore_ascii_case(&path, "/applications/") || contains_ignore_ascii_case(&path, ".app/") || contains_ignore_ascii_case(&path, ".framework/")
    {
        return "applications";
    }
    if contains_ignore_ascii_case(&path, "/library/mail/")
        || contains_ignore_ascii_case(&path, "/library/messages/")
        || contains_ignore_ascii_case(&path, "/library/containers/com.apple.mail/")
        || contains_ignore_ascii_case(&path, "/library/containers/com.apple.messages/")
    {
        return "mail";
    }
    if starts_with_ignore_ascii_case(&path, "/system/")
        || starts_with_ignore_ascii_case(&path, "/usr/")
        || starts_with_ignore_ascii_case(&path, "/bin/")
        || starts_with_ignore_ascii_case(&path, "/sbin/")
        || starts_with_ignore_ascii_case(&path, "/private/var/db/")
        || starts_with_ignore_ascii_case(&path, "/private/var/vm/")
        || starts_with_ignore_ascii_case(&path, "/library/")
    {
        return "system";
    }
    if has_component(&path, "downloads") {
        return "downloads";
    }
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "svg" | "tif" | "tiff" | "heic"
        | "heif" | "avif" | "raw" | "cr2" | "nef" | "arw" | "dng" => "photos",
        "mp4" | "mov" | "m4v" | "avi" | "mkv" | "wmv" | "webm" | "flv" | "mpg" | "mpeg" | "3g2"
        | "3gp" | "asf" | "divx" | "dv" | "f4v" | "m2ts" | "mts" | "mxf" | "ogv" | "rm"
        | "rmvb" | "ts" | "vob" | "vro" | "mod" => "videos",
        "mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "wma" | "aiff" | "mid" | "midi"
        | "opus" => "audio",
        "zip" | "7z" | "rar" | "tar" | "gz" | "bz2" | "xz" | "zst" | "dmg" | "iso" | "pkg"
        | "mpkg" => "archives",
        "pdf" | "doc" | "docx" | "rtf" | "pages" | "odt" | "txt" | "md" | "markdown" | "csv"
        | "tsv" | "xls" | "xlsx" | "numbers" | "ods" | "ppt" | "pptx" | "key" | "odp" | "epub" => {
            "documents"
        }
        _ => "other",
    }
}

pub(crate) fn file_type_for(path: &Path, extension: Option<&str>, category: &str) -> &'static str {
    let path = path.to_string_lossy();
    let ext = extension.unwrap_or("");
    if category == "virtualMachines" || matches!(ext, "vmdk" | "vdi" | "qcow2" | "vhd" | "vhdx") {
        return "virtualMachines";
    }
    if matches!(ext, "dmg" | "iso" | "img" | "sparseimage" | "sparsebundle") {
        return "diskImages";
    }
    if category == "applications" || contains_ignore_ascii_case(&path, ".app/") {
        return "applications";
    }
    if matches!(
        ext,
        "zip" | "7z" | "rar" | "tar" | "gz" | "bz2" | "xz" | "zst" | "pkg" | "mpkg"
    ) {
        return "archives";
    }
    if matches!(
        ext,
        "mp4"
            | "mov"
            | "m4v"
            | "avi"
            | "mkv"
            | "wmv"
            | "webm"
            | "flv"
            | "mpg"
            | "mpeg"
            | "3g2"
            | "3gp"
            | "asf"
            | "divx"
            | "dv"
            | "f4v"
            | "m2ts"
            | "mts"
            | "mxf"
            | "ogv"
            | "rm"
            | "rmvb"
            | "ts"
            | "vob"
            | "vro"
            | "mod"
    ) {
        return "videos";
    }
    if matches!(
        ext,
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "bmp"
            | "webp"
            | "svg"
            | "tif"
            | "tiff"
            | "heic"
            | "heif"
            | "avif"
    ) {
        return "images";
    }
    if matches!(
        ext,
        "mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "wma" | "aiff" | "mid" | "midi"
    ) {
        return "audio";
    }
    if ext == "pdf" {
        return "pdf";
    }
    if category == "developer"
        || matches!(
            ext,
            "rs" | "ts"
                | "tsx"
                | "js"
                | "jsx"
                | "py"
                | "rb"
                | "go"
                | "java"
                | "c"
                | "h"
                | "cpp"
                | "hpp"
                | "swift"
                | "kt"
                | "sh"
                | "zsh"
                | "bash"
                | "json"
                | "xml"
                | "yaml"
                | "yml"
                | "toml"
                | "lock"
                | "map"
                | "o"
                | "a"
                | "so"
                | "dylib"
        )
    {
        return "developer";
    }
    if matches!(ext, "db" | "sqlite" | "sqlite3" | "realm" | "mdb" | "accdb") {
        return "databases";
    }
    if matches!(ext, "ttf" | "otf" | "woff" | "woff2" | "ttc") {
        return "fonts";
    }
    if matches!(
        ext,
        "doc"
            | "docx"
            | "rtf"
            | "pages"
            | "odt"
            | "txt"
            | "md"
            | "markdown"
            | "csv"
            | "tsv"
            | "xls"
            | "xlsx"
            | "numbers"
            | "ods"
            | "ppt"
            | "pptx"
            | "key"
            | "odp"
            | "epub"
    ) {
        return "documents";
    }
    "other"
}

fn is_reserved_directory(name: &str) -> bool {
    matches!(
        name,
        ".Spotlight-V100"
            | ".fseventsd"
            | ".TemporaryItems"
            | ".DocumentRevisions-V100"
            | ".PKInstallSandboxManager"
            | ".MobileBackups"
            | "System Volume Information"
            | "$RECYCLE.BIN"
            | "proc"
            | "sys"
    )
}

fn excluded_mounts(root: &Path) -> Vec<PathBuf> {
    let mut excluded = Vec::new();
    for entry in mount_table() {
        if entry.mount != root && entry.mount.starts_with(root) {
            excluded.push(entry.mount);
        }
    }
    #[cfg(target_os = "linux")]
    for path in ["/dev", "/proc", "/sys", "/run"] {
        let path = PathBuf::from(path);
        if path != root && path.starts_with(root) {
            excluded.push(path);
        }
    }
    excluded
}

#[derive(Default)]
struct Bucket {
    bytes: u64,
    allocated: u64,
    files: u64,
}

/// Look up (or create) the bucket for a category/file-type id. The id set is tiny,
/// so the clone happens once per distinct id, never per file.
fn bucket_for<'a>(map: &'a mut HashMap<String, Bucket>, key: &str) -> &'a mut Bucket {
    if !map.contains_key(key) {
        map.insert(key.to_string(), Bucket::default());
    }
    map.get_mut(key).expect("bucket was just inserted")
}

fn extension_set<'a>(
    map: &'a mut HashMap<String, HashSet<String>>,
    key: &str,
) -> &'a mut HashSet<String> {
    if !map.contains_key(key) {
        map.insert(key.to_string(), HashSet::new());
    }
    map.get_mut(key).expect("extension set was just inserted")
}

struct DirWork {
    record: StorageDirectory,
    direct_size: u64,
    direct_allocated: u64,
}

/// Handle to a scan whose file rows live in the SQLite cache. Once this is set the
/// in-memory file vector is released, so drill-down and paging are served by the
/// `files` table (indexed by parent, size, type and category) instead of a full
/// scan of every entry.
#[derive(Clone)]
pub(crate) struct PersistedIndex {
    pub cache: crate::storage_cache::StorageCache,
    pub scan_id: u64,
}

pub(crate) struct ScanIndex {
    pub scan: StorageScanResult,
    pub files: Vec<StorageFile>,
    pub directories: HashMap<String, StorageDirectory>,
    pub persisted: Option<PersistedIndex>,
}

impl ScanIndex {
    /// Approximate bytes held by the in-memory file records.
    fn file_index_bytes(&self) -> u64 {
        self.files
            .iter()
            .map(|file| {
                std::mem::size_of::<StorageFile>() as u64
                    + file.path.len() as u64
                    + file.name.len() as u64
                    + file.parent.len() as u64
                    + file.extension.as_ref().map(|value| value.len()).unwrap_or(0) as u64
                    + file.category.len() as u64
                    + file.file_type.len() as u64
                    + ENTRY_INDEX_OVERHEAD
            })
            .sum()
    }
}

/// Serve a folder listing from SQLite when the scan has been persisted, and fall
/// back to the in-memory index while the write is still running.
pub(crate) fn children_for(
    index: &ScanIndex,
    path: &str,
    limit: usize,
) -> Result<StorageChildren, AppError> {
    if let Some(persisted) = index.persisted.as_ref() {
        match persisted.cache.children(persisted.scan_id, path, limit) {
            Ok(children) => return Ok(children),
            Err(error) => logging::warn(
                "storage.cache",
                format!("sqlite children failed; using the in-memory index: {error}"),
            ),
        }
    }
    children_core(index, path, limit)
}

pub(crate) fn query_files_for(index: &ScanIndex, query: &StorageFileQuery) -> StorageFilePage {
    if let Some(persisted) = index.persisted.as_ref() {
        match persisted.cache.query_files(query) {
            Ok(page) => return page,
            Err(error) => logging::warn(
                "storage.cache",
                format!("sqlite file query failed; using the in-memory index: {error}"),
            ),
        }
    }
    query_files_core(index, query)
}

/// Where a scan is allowed to stop. `max_entries` is a count guard the caller can
/// request; `max_index_bytes` is the memory guard the backend always applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ScanBudget {
    pub max_entries: usize,
    pub max_index_bytes: u64,
}

impl ScanBudget {
    /// Budget for tests and callers that want an explicit byte ceiling.
    #[cfg(test)]
    pub(crate) fn with_bytes(max_entries: usize, max_index_bytes: u64) -> Self {
        Self {
            max_entries,
            max_index_bytes,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LimitHit {
    Entries,
    Memory,
}

#[cfg(target_os = "macos")]
fn sysctl_u64(name: &str) -> Option<u64> {
    let name = std::ffi::CString::new(name).ok()?;
    let mut value: u64 = 0;
    let mut size = std::mem::size_of::<u64>();
    let status = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            &mut value as *mut u64 as *mut libc::c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if status != 0 {
        return None;
    }
    // Most `vm.*` counters are 32-bit; sysctlbyname writes only the low bytes of
    // our u64 (little-endian, the only endianness macOS ships on).
    if size == 4 {
        Some(value & 0xFFFF_FFFF)
    } else {
        Some(value)
    }
}

/// Memory the process can grow into without pushing the machine into swap.
///
/// `sysctl vm.*` only exposes free/speculative counters, and `_SC_AVPHYS_PAGES`
/// reports free pages alone; both undercount a warm Mac by gigabytes. The
/// `host_statistics64` VM statistics are the same numbers `vm_stat` prints, so
/// free + speculative + inactive + purgeable is used as the reclaimable total.
#[cfg(target_os = "macos")]
#[allow(deprecated)] // libc's replacement is the mach2 crate; not worth a new dependency for one call per scan.
pub(crate) fn available_memory_bytes() -> Option<u64> {
    use std::mem::MaybeUninit;
    let mut stats = MaybeUninit::<libc::vm_statistics64>::uninit();
    let mut count = libc::HOST_VM_INFO64_COUNT;
    let status = unsafe {
        libc::host_statistics64(
            libc::mach_host_self(),
            libc::HOST_VM_INFO64,
            stats.as_mut_ptr() as libc::host_info64_t,
            &mut count,
        )
    };
    if status != 0 {
        return None;
    }
    let stats = unsafe { stats.assume_init() };
    let page_size = sysctl_u64("vm.pagesize").or_else(|| sysctl_u64("hw.pagesize"))?;
    let reclaimable = u64::from(stats.free_count)
        .saturating_add(u64::from(stats.speculative_count))
        .saturating_add(u64::from(stats.inactive_count))
        .saturating_add(u64::from(stats.purgeable_count));
    Some(reclaimable.saturating_mul(page_size))
}

#[cfg(target_os = "linux")]
fn available_memory_bytes() -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("MemAvailable:") {
            let kilobytes: u64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kilobytes.saturating_mul(1024));
        }
    }
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn available_memory_bytes() -> Option<u64> {
    None
}

/* ------------------------------------------------------------------------- */
/* Parallel directory walk                                                    */
/* ------------------------------------------------------------------------- */

/// Counters shared by walker threads. They exist for the memory/entry budget and
/// for progress; per-thread detail (errors, symlink counts) travels in
/// `WorkerOutput` and is summed once at the end.
#[derive(Default)]
struct WalkCounters {
    entries: AtomicU64,
    files: AtomicU64,
    directories: AtomicU64,
    /// Bytes seen while walking, including hard links that will not be counted twice.
    /// Progress only; the exact totals are computed after the walk.
    progress_bytes: AtomicU64,
    index_bytes: AtomicU64,
}

impl WalkCounters {
    fn entries(&self) -> u64 {
        self.entries.load(Ordering::Relaxed)
    }
    fn files(&self) -> u64 {
        self.files.load(Ordering::Relaxed)
    }
    fn directories(&self) -> u64 {
        self.directories.load(Ordering::Relaxed)
    }
    fn progress_bytes(&self) -> u64 {
        self.progress_bytes.load(Ordering::Relaxed)
    }
    fn index_bytes(&self) -> u64 {
        self.index_bytes.load(Ordering::Relaxed)
    }
}

/// First guard that stopped the walk wins, so a cancel cannot overwrite the
/// memory/entry reason that was already recorded.
#[derive(Default)]
struct Stoppage {
    limit: AtomicU8,
}

impl Stoppage {
    fn record(&self, hit: LimitHit) {
        let value = match hit {
            LimitHit::Entries => 1,
            LimitHit::Memory => 2,
        };
        let _ = self
            .limit
            .compare_exchange(0, value, Ordering::Relaxed, Ordering::Relaxed);
    }
    fn hit(&self) -> Option<LimitHit> {
        match self.limit.load(Ordering::Relaxed) {
            1 => Some(LimitHit::Entries),
            2 => Some(LimitHit::Memory),
            _ => None,
        }
    }
}

struct QueueState {
    pending: Vec<(PathBuf, u32)>,
    in_flight: usize,
}

/// Work-stealing queue of directories. A worker exits only when nothing is
/// pending *and* no other worker is mid-directory, because that worker may still
/// discover child directories.
struct WorkQueue {
    state: Mutex<QueueState>,
    ready: Condvar,
    last_path: Mutex<Option<String>>,
}

impl WorkQueue {
    fn new(root: PathBuf) -> Self {
        Self {
            state: Mutex::new(QueueState {
                pending: vec![(root, 0)],
                in_flight: 0,
            }),
            ready: Condvar::new(),
            last_path: Mutex::new(None),
        }
    }

    /// Blocks until a directory is available, or returns `None` when the walk is
    /// finished (or stopping).
    fn take(&self, stopping: impl Fn() -> bool) -> Option<(PathBuf, u32)> {
        let mut guard = self
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        loop {
            if stopping() {
                return None;
            }
            if let Some(item) = guard.pending.pop() {
                guard.in_flight += 1;
                return Some(item);
            }
            if guard.in_flight == 0 {
                return None;
            }
            guard = self
                .ready
                .wait(guard)
                .unwrap_or_else(|error| error.into_inner());
        }
    }

    fn finish(&self, children: Vec<(PathBuf, u32)>) {
        let mut guard = self
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        guard.in_flight = guard.in_flight.saturating_sub(1);
        guard.pending.extend(children);
        drop(guard);
        self.ready.notify_all();
    }

    fn note_path(&self, path: &str) {
        if let Ok(mut guard) = self.last_path.lock() {
            *guard = Some(path.to_string());
        }
    }

    fn last_path(&self) -> Option<String> {
        self.last_path.lock().ok().and_then(|guard| guard.clone())
    }
}

struct WorkerOutput {
    files: Vec<StorageFile>,
    inodes: Vec<Option<(u64, u64, u64)>>,
    directories: Vec<StorageDirectory>,
    symbolic_links: u64,
    permission_errors: u64,
    read_errors: u64,
    skipped_mounts: u64,
    skipped_reserved: u64,
}

/// Read one directory and produce the records for its direct children. Nothing
/// shared is mutated here except counters, so workers never contend on the index.
fn read_directory(
    directory: &Path,
    depth: u32,
    excluded: &[PathBuf],
    budget: &ScanBudget,
    counters: &WalkCounters,
    stoppage: &Stoppage,
    cancel: &AtomicBool,
) -> (
    Vec<StorageFile>,
    Vec<Option<(u64, u64, u64)>>,
    Vec<StorageDirectory>,
    Vec<(PathBuf, u32)>,
    u64,
    u64,
    u64,
    u64,
    u64,
) {
    let mut files = Vec::new();
    let mut inodes = Vec::new();
    let mut directories = Vec::new();
    let mut children = Vec::new();
    let mut symbolic_links = 0u64;
    let mut permission_errors = 0u64;
    let mut read_errors = 0u64;
    let mut skipped_mounts = 0u64;
    let mut skipped_reserved = 0u64;

    let listing = match fs::read_dir(directory) {
        Ok(listing) => listing,
        Err(error) => {
            read_errors += 1;
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                permission_errors += 1;
            }
            return (
                files,
                inodes,
                directories,
                children,
                symbolic_links,
                permission_errors,
                read_errors,
                skipped_mounts,
                skipped_reserved,
            );
        }
    };

    for entry in listing {
        if cancel.load(Ordering::Relaxed) || stoppage.hit().is_some() {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                read_errors += 1;
                if error.kind() == std::io::ErrorKind::PermissionDenied {
                    permission_errors += 1;
                }
                continue;
            }
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                read_errors += 1;
                if error.kind() == std::io::ErrorKind::PermissionDenied {
                    permission_errors += 1;
                }
                continue;
            }
        };
        let path_text = path.to_string_lossy().to_string();
        let summary = counters.entries.fetch_add(1, Ordering::Relaxed) + 1;
        if summary as usize > budget.max_entries {
            stoppage.record(LimitHit::Entries);
            break;
        }
        if counters.index_bytes() >= budget.max_index_bytes {
            stoppage.record(LimitHit::Memory);
            break;
        }
        let parent_text = path
            .parent()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| path_text.clone());
        let is_symlink = metadata.file_type().is_symlink();
        let child_depth = depth.saturating_add(1);
        if metadata.is_dir() {
            if excluded.iter().any(|mount| path == *mount) {
                skipped_mounts += 1;
                continue;
            }
            if is_reserved_directory(&name) {
                skipped_reserved += 1;
                continue;
            }
            counters.directories.fetch_add(1, Ordering::Relaxed);
            directories.push(StorageDirectory {
                path: path_text.clone(),
                name: name.clone(),
                parent: parent_text.clone(),
                size: 0,
                allocated: 0,
                files: 0,
                folders: 0,
                direct_files: 0,
                direct_folders: 0,
                largest_file_size: 0,
                largest_file_path: None,
                modified: system_time_ms(metadata.modified()),
                depth: child_depth,
                is_package: is_package_directory(&name),
                is_protected: system_protected_path(&path_text),
                is_read_only: metadata.permissions().readonly(),
            });
            counters.index_bytes.fetch_add(
                std::mem::size_of::<StorageDirectory>() as u64
                    + (path_text.len().saturating_mul(2)) as u64
                    + name.len() as u64
                    + parent_text.len() as u64
                    + ENTRY_INDEX_OVERHEAD,
                Ordering::Relaxed,
            );
            if (child_depth as usize) < MAX_SCAN_DEPTH {
                children.push((path, child_depth));
            }
            continue;
        }

        counters.files.fetch_add(1, Ordering::Relaxed);
        if is_symlink {
            symbolic_links += 1;
        }
        let extension = path
            .extension()
            .map(|value| value.to_string_lossy().to_lowercase())
            .filter(|value| !value.is_empty());
        let category = if is_symlink {
            "other"
        } else {
            category_for(&path, extension.as_deref())
        };
        let file_type = if is_symlink {
            "other"
        } else {
            file_type_for(&path, extension.as_deref(), category)
        };
        let size = metadata.len();
        let allocated = if is_symlink {
            0
        } else {
            allocated_size(&metadata)
        };
        counters.progress_bytes.fetch_add(size, Ordering::Relaxed);
        let is_hidden = name.starts_with('.') || metadata_hidden(&metadata);
        let cloud_placeholder = ends_with_ignore_ascii_case(&name, ".icloud");
        let file = StorageFile {
            path: path_text.clone(),
            name,
            parent: parent_text,
            extension,
            is_symlink,
            size,
            allocated,
            modified: system_time_ms(metadata.modified()),
            created: system_time_ms(metadata.created()),
            accessed: system_time_ms(metadata.accessed()),
            is_hidden,
            is_package: false,
            hard_link: false,
            cloud_placeholder,
            is_protected: system_protected_path(&path_text),
            is_read_only: metadata.permissions().readonly(),
            category: category.to_string(),
            file_type: file_type.to_string(),
        };
        counters.index_bytes.fetch_add(
            std::mem::size_of::<StorageFile>() as u64
                + file.path.len() as u64
                + file.name.len() as u64
                + file.parent.len() as u64
                + file
                    .extension
                    .as_ref()
                    .map(|value| value.len())
                    .unwrap_or(0) as u64
                + file.category.len() as u64
                + file.file_type.len() as u64
                + ENTRY_INDEX_OVERHEAD,
            Ordering::Relaxed,
        );
        inodes.push(if is_symlink {
            None
        } else {
            inode_identity(&metadata)
        });
        files.push(file);
    }

    (
        files,
        inodes,
        directories,
        children,
        symbolic_links,
        permission_errors,
        read_errors,
        skipped_mounts,
        skipped_reserved,
    )
}

fn walk_worker(
    queue: &WorkQueue,
    excluded: &[PathBuf],
    budget: &ScanBudget,
    cancel: &AtomicBool,
    counters: &WalkCounters,
    stoppage: &Stoppage,
) -> WorkerOutput {
    let mut output = WorkerOutput {
        files: Vec::new(),
        inodes: Vec::new(),
        directories: Vec::new(),
        symbolic_links: 0,
        permission_errors: 0,
        read_errors: 0,
        skipped_mounts: 0,
        skipped_reserved: 0,
    };
    while let Some((directory, depth)) = queue.take(|| {
        cancel.load(Ordering::Relaxed) || stoppage.hit().is_some()
    }) {
        queue.note_path(&directory.to_string_lossy());
        let (
            files,
            inodes,
            directories,
            children,
            symbolic_links,
            permission_errors,
            read_errors,
            skipped_mounts,
            skipped_reserved,
        ) = read_directory(
            &directory, depth, excluded, budget, counters, stoppage, cancel,
        );
        output.files.extend(files);
        output.inodes.extend(inodes);
        output.directories.extend(directories);
        output.symbolic_links += symbolic_links;
        output.permission_errors += permission_errors;
        output.read_errors += read_errors;
        output.skipped_mounts += skipped_mounts;
        output.skipped_reserved += skipped_reserved;
        queue.finish(children);
    }
    output
}

/// Turn the caller's entry request into a budget.
///
/// `max_entries == 0` means "auto" (the Deep scan control): the ceiling stays wide
/// open and the memory guard decides where to stop. Any explicit request is
/// clamped to the absolute ceiling but never silently lowered — the memory guard
/// still stops the walk, and the scan reports that it did.
pub(crate) fn resolve_scan_budget(requested_max_entries: usize) -> ScanBudget {
    let max_index_bytes = match available_memory_bytes() {
        Some(bytes) => (bytes.saturating_mul(INDEX_MEMORY_SHARE_PERCENT) / 100)
            .max(MIN_INDEX_BUDGET_BYTES),
        None => FALLBACK_INDEX_BUDGET_BYTES,
    };
    let max_entries = if requested_max_entries == 0 {
        MAX_ENTRIES_LIMIT
    } else {
        requested_max_entries.clamp(1_000, MAX_ENTRIES_LIMIT)
    };
    ScanBudget {
        max_entries,
        max_index_bytes,
    }
}

/// Convenience wrapper used by tests and by any caller that only has an entry
/// count; the app passes a resolved budget straight to the walker.
#[cfg(test)]
pub(crate) fn scan_storage_index(
    root: &Path,
    scan_id: u64,
    max_entries: usize,
    cancel: &AtomicBool,
    progress: &dyn Fn(StorageScanProgress),
) -> Result<ScanIndex, AppError> {
    scan_storage_index_with_budget(
        root,
        scan_id,
        resolve_scan_budget(max_entries),
        cancel,
        progress,
    )
}

pub(crate) fn scan_storage_index_with_budget(
    root: &Path,
    scan_id: u64,
    budget: ScanBudget,
    cancel: &AtomicBool,
    progress: &dyn Fn(StorageScanProgress),
) -> Result<ScanIndex, AppError> {
    let root_metadata = fs::symlink_metadata(root).map_err(|error| {
        let mapped = AppError::from(error);
        mapped.with_path(root.to_string_lossy())
    })?;
    if !root_metadata.is_dir() {
        return Err(AppError::new(
            "not_a_directory",
            "Storage analysis needs a mounted folder or volume.",
            Some(root.to_string_lossy().to_string()),
        ));
    }
    let started = Instant::now();
    let started_at = now_ms();
    let root_display = root.to_string_lossy().to_string();
    let excluded = excluded_mounts(root);
    let mut directories: HashMap<String, DirWork> = HashMap::new();

    let root_name = root
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| root_display.clone());
    directories.insert(
        root_display.clone(),
        DirWork {
            record: StorageDirectory {
                path: root_display.clone(),
                name: root_name,
                parent: String::new(),
                size: 0,
                allocated: 0,
                files: 0,
                folders: 0,
                direct_files: 0,
                direct_folders: 0,
                largest_file_size: 0,
                largest_file_path: None,
                modified: system_time_ms(root_metadata.modified()),
                depth: 0,
                is_package: false,
                is_protected: system_protected_path(&root_display),
                is_read_only: root_metadata.permissions().readonly(),
            },
            direct_size: 0,
            direct_allocated: 0,
        },
    );

    progress(StorageScanProgress {
        scan_id,
        root: root_display.clone(),
        scanned_entries: 0,
        scanned_files: 0,
        scanned_directories: 0,
        logical_bytes: 0,
        current_path: None,
        elapsed_ms: 0,
        cancelled: false,
    });

    let threads = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .clamp(2, 8);
    let queue = WorkQueue::new(root.to_path_buf());
    let counters = WalkCounters::default();
    let stoppage = Stoppage::default();
    let walk_started = Instant::now();
    let workers: Vec<WorkerOutput> = std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(threads);
        for _ in 0..threads {
            handles.push(scope.spawn(|| {
                walk_worker(&queue, &excluded, &budget, cancel, &counters, &stoppage)
            }));
        }
        // Progress is emitted from the coordinating thread so the callback never
        // has to cross a thread boundary, and so it is throttled by wall clock
        // instead of firing every 1,500 entries.
        while !handles.iter().all(|handle| handle.is_finished()) {
            std::thread::sleep(std::time::Duration::from_millis(300));
            progress(StorageScanProgress {
                scan_id,
                root: root_display.clone(),
                scanned_entries: counters.entries(),
                scanned_files: counters.files(),
                scanned_directories: counters.directories(),
                logical_bytes: counters.progress_bytes(),
                current_path: queue.last_path(),
                elapsed_ms: walk_started.elapsed().as_millis() as u64,
                cancelled: cancel.load(Ordering::Relaxed),
            });
        }
        handles
            .into_iter()
            .filter_map(|handle| handle.join().ok())
            .collect::<Vec<_>>()
    });

    let cancelled = cancel.load(Ordering::Relaxed);
    let limit_hit = stoppage.hit();
    let truncated = limit_hit.is_some();
    let scanned_entries = counters.entries();
    let scanned_directories = counters.directories();

    let mut files: Vec<StorageFile> = Vec::with_capacity(scanned_entries as usize / 2);
    let mut inodes: Vec<Option<(u64, u64, u64)>> = Vec::new();
    let mut directory_records: Vec<StorageDirectory> = Vec::new();
    let mut scanned_files = 0u64;
    let mut symbolic_links = 0u64;
    let mut permission_errors = 0u64;
    let mut read_errors = 0u64;
    let mut skipped_mounts = 0u64;
    let mut skipped_reserved = 0u64;
    for output in workers {
        scanned_files += output.files.len() as u64;
        symbolic_links += output.symbolic_links;
        permission_errors += output.permission_errors;
        read_errors += output.read_errors;
        skipped_mounts += output.skipped_mounts;
        skipped_reserved += output.skipped_reserved;
        files.extend(output.files);
        inodes.extend(output.inodes);
        directory_records.extend(output.directories);
    }

    // Directory records arrive in walk order per worker, so parent links are
    // resolved in a second pass instead of relying on depth-first ordering.
    let mut parent_links: Vec<String> = Vec::with_capacity(directory_records.len());
    for record in directory_records {
        parent_links.push(record.parent.clone());
        directories.insert(
            record.path.clone(),
            DirWork {
                record,
                direct_size: 0,
                direct_allocated: 0,
            },
        );
    }
    for parent in parent_links {
        if let Some(parent_work) = directories.get_mut(&parent) {
            parent_work.record.direct_folders += 1;
        }
    }

    // Hard links, per-directory direct totals and category buckets are resolved
    // once, after the walk. Doing this with the walk would need a global inode set
    // inside every worker.
    let mut seen_inodes: HashSet<(u64, u64, u64)> = HashSet::new();
    let mut categories: HashMap<String, Bucket> = HashMap::new();
    let mut file_types: HashMap<String, Bucket> = HashMap::new();
    let mut type_extensions: HashMap<String, HashSet<String>> = HashMap::new();
    let mut logical_bytes = 0u64;
    let mut allocated_bytes = 0u64;
    let mut hard_links = 0u64;
    for (index, file) in files.iter_mut().enumerate() {
        let duplicate = inodes
            .get(index)
            .and_then(|identity| *identity)
            .map(|key| !seen_inodes.insert(key))
            .unwrap_or(false);
        file.hard_link = duplicate;
        if duplicate {
            hard_links += 1;
        }
        let counted = !duplicate;
        if counted {
            logical_bytes = logical_bytes.saturating_add(file.size);
            allocated_bytes = allocated_bytes.saturating_add(file.allocated);
            let category_bucket = bucket_for(&mut categories, &file.category);
            category_bucket.bytes = category_bucket.bytes.saturating_add(file.size);
            category_bucket.allocated = category_bucket.allocated.saturating_add(file.allocated);
            category_bucket.files += 1;
            let type_bucket = bucket_for(&mut file_types, &file.file_type);
            type_bucket.bytes = type_bucket.bytes.saturating_add(file.size);
            type_bucket.allocated = type_bucket.allocated.saturating_add(file.allocated);
            type_bucket.files += 1;
            if let Some(extension) = file.extension.as_ref() {
                extension_set(&mut type_extensions, &file.file_type).insert(extension.clone());
            }
        }
        if let Some(parent) = directories.get_mut(&file.parent) {
            parent.record.direct_files += 1;
            if counted {
                parent.direct_size = parent.direct_size.saturating_add(file.size);
                parent.direct_allocated = parent.direct_allocated.saturating_add(file.allocated);
                // Ties resolve by path so the result does not depend on walk order.
                let larger = file.size > parent.record.largest_file_size
                    || (file.size == parent.record.largest_file_size
                        && parent
                            .record
                            .largest_file_path
                            .as_deref()
                            .map(|current| file.path.as_str() < current)
                            .unwrap_or(true));
                if file.size > 0 && larger {
                    parent.record.largest_file_size = file.size;
                    parent.record.largest_file_path = Some(file.path.clone());
                }
            }
        }
    }
    drop(inodes);

    // Seed each directory with its direct-file totals, then propagate aggregate
    // totals bottom-up. A directory contributes to exactly one parent, so no
    // file or folder is counted twice.
    for work in directories.values_mut() {
        work.record.size = work.direct_size;
        work.record.allocated = work.direct_allocated;
        work.record.files = work.record.direct_files;
        work.record.folders = 0;
    }
    let mut order: Vec<String> = directories.keys().cloned().collect();
    order.sort_by_key(|path| std::cmp::Reverse(directories[path].record.depth));
    for path in order {
        let (parent, size, allocated, file_count, folder_count, largest_size, largest_path) = {
            let work = match directories.get(&path) {
                Some(work) => work,
                None => continue,
            };
            (
                work.record.parent.clone(),
                work.record.size,
                work.record.allocated,
                work.record.files,
                work.record.folders,
                work.record.largest_file_size,
                work.record.largest_file_path.clone(),
            )
        };
        if parent.is_empty() || parent == path {
            continue;
        }
        if let Some(parent_work) = directories.get_mut(&parent) {
            parent_work.record.size = parent_work.record.size.saturating_add(size);
            parent_work.record.allocated = parent_work.record.allocated.saturating_add(allocated);
            parent_work.record.files = parent_work.record.files.saturating_add(file_count);
            parent_work.record.folders =
                parent_work.record.folders.saturating_add(1 + folder_count);
            if largest_size > parent_work.record.largest_file_size {
                parent_work.record.largest_file_size = largest_size;
                parent_work.record.largest_file_path = largest_path;
            }
        }
    }

    let root_total = directories
        .get(&root_display)
        .map(|work| work.record.size)
        .unwrap_or(logical_bytes);
    let root_allocated = directories
        .get(&root_display)
        .map(|work| work.record.allocated)
        .unwrap_or(allocated_bytes);

    let mut category_list: Vec<StorageCategory> = categories
        .into_iter()
        .map(|(id, bucket)| StorageCategory {
            label: category_label(&id).to_string(),
            id,
            bytes: bucket.bytes,
            allocated: bucket.allocated,
            files: bucket.files,
            percent: percent_of(bucket.bytes, root_total),
        })
        .collect();
    category_list.sort_by(|left, right| right.bytes.cmp(&left.bytes));

    let mut file_type_list: Vec<StorageFileType> = file_types
        .into_iter()
        .map(|(id, bucket)| {
            let mut extensions: Vec<String> = type_extensions
                .remove(&id)
                .unwrap_or_default()
                .into_iter()
                .collect();
            extensions.sort();
            extensions.truncate(12);
            StorageFileType {
                label: file_type_label(&id).to_string(),
                id,
                bytes: bucket.bytes,
                allocated: bucket.allocated,
                files: bucket.files,
                percent: percent_of(bucket.bytes, root_total),
                extensions,
            }
        })
        .collect();
    file_type_list.sort_by(|left, right| right.bytes.cmp(&left.bytes));

    let mut directory_list: Vec<StorageDirectory> =
        directories.into_values().map(|work| work.record).collect();
    directory_list.sort_by(|left, right| right.size.cmp(&left.size));
    let largest_directories = directory_list
        .iter()
        .filter(|directory| directory.depth > 0)
        .take(TOP_RESULT_LIMIT)
        .cloned()
        .collect::<Vec<_>>();

    let mut largest_files = files.clone();
    largest_files.sort_by(|left, right| right.size.cmp(&left.size));
    largest_files.truncate(TOP_RESULT_LIMIT);

    let now = now_ms();
    let stale_threshold = now - 365 * ONE_DAY_MS;
    let mut recent_large_files: Vec<StorageFile> = files
        .iter()
        .filter(|file| file.size >= 50 * ONE_MB)
        .cloned()
        .collect();
    recent_large_files.sort_by(|left, right| right.modified.cmp(&left.modified));
    recent_large_files.truncate(100);
    let mut stale_large_files: Vec<StorageFile> = files
        .iter()
        .filter(|file| {
            file.size >= 500 * ONE_MB
                && file
                    .modified
                    .map(|value| value < stale_threshold)
                    .unwrap_or(false)
        })
        .cloned()
        .collect();
    stale_large_files.sort_by(|left, right| right.size.cmp(&left.size));
    stale_large_files.truncate(100);

    let cleanup = build_cleanup(&files, &directory_list, root);
    let cleanup_recoverable_bytes = deduplicated_cleanup_bytes(&cleanup);
    let volume = volume_for_root(root);
    let whole_volume = volume
        .as_ref()
        .map(|value| value.mount_point == root_display)
        .unwrap_or(false);
    let uninspected_bytes = if whole_volume {
        volume
            .as_ref()
            .map(|value| value.used_bytes.saturating_sub(allocated_bytes))
            .unwrap_or(0)
    } else {
        0
    };

    let mut notes = Vec::new();
    notes.push(
        "Categories assign every inspected file to exactly one bucket; media inside an application bundle is counted as Applications, not twice.".into(),
    );
    notes.push(
        "Logical size is the sum of file lengths. Allocated size uses filesystem blocks and can be smaller for sparse or compressed files.".into(),
    );
    notes.push(
        "Symbolic links are listed but never followed, so recursive loops and duplicate traversal cannot occur.".into(),
    );
    if symbolic_links > 0 {
        notes.push(format!(
            "{symbolic_links} symbolic link(s) were not followed."
        ));
    }
    if hard_links > 0 {
        notes.push(format!(
            "{hard_links} additional hard link(s) share storage with an inode already counted; their bytes are not counted twice."
        ));
    }
    if permission_errors > 0 || read_errors > 0 {
        notes.push(format!(
            "{} entries could not be read ({} permission errors). Grant Full Disk Access or rescan a narrower folder for deeper coverage.",
            read_errors, permission_errors
        ));
    }
    if skipped_mounts > 0 {
        notes.push(format!(
            "{} nested mount point(s) were skipped so the same files are not counted under two volumes.",
            skipped_mounts
        ));
    }
    if !whole_volume {
        notes.push(
            "This scan covers a folder rather than a full volume. Volume capacity is still reported, but uninspected space is not attributed to the folder."
                .into(),
        );
    }
    if uninspected_bytes > 0 {
        notes.push(format!(
            "The filesystem reports {} in use; MAXplorer inspected {}. The remainder can include snapshots, purgeable space, other volumes in the same APFS container, system-protected data, or unreadable locations.",
            format_bytes(volume.as_ref().map(|value| value.used_bytes).unwrap_or(0)),
            format_bytes(allocated_bytes)
        ));
    }
    let truncation_reason = limit_hit.map(|hit| match hit {
        LimitHit::Entries => format!("entry limit of {} entries", budget.max_entries),
        LimitHit::Memory => format!(
            "memory budget of {} of index space",
            format_bytes(budget.max_index_bytes)
        ),
    });
    if let Some(reason) = truncation_reason.as_deref() {
        notes.push(format!(
            "The scan stopped at its {reason} after {} entries were inspected. Scan a narrower folder for complete results.",
            scanned_entries
        ));
    }
    if cancelled {
        notes.push("The scan was cancelled. Results below are a partial snapshot and are labelled accordingly.".into());
    }
    if files.iter().any(|file| file.cloud_placeholder) {
        notes.push(
            "iCloud placeholder files are measured from local metadata only. Cloud-only content is not downloaded during analysis."
                .into(),
        );
    }
    notes.push(
        "macOS snapshots, System Data, purgeable space, and some application-managed storage are not attributable to individual files and are shown as uninspected when they cannot be measured."
            .into(),
    );

    let result = StorageScanResult {
        scan_id,
        root: root_display.clone(),
        volume,
        started_at,
        finished_at: now_ms(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        scanned_entries,
        scanned_files,
        scanned_directories,
        symbolic_links,
        hard_links,
        permission_errors,
        read_errors,
        skipped_mounts,
        skipped_reserved,
        total_logical_bytes: root_total,
        total_allocated_bytes: root_allocated,
        inspectable_bytes: root_total,
        uninspected_bytes,
        cleanup_recoverable_bytes,
        cancelled,
        truncated,
        truncation_reason,
        max_entries: budget.max_entries as u64,
        categories: category_list,
        file_types: file_type_list,
        largest_files,
        largest_directories,
        recent_large_files,
        stale_large_files,
        cleanup,
        notes,
    };

    progress(StorageScanProgress {
        scan_id,
        root: root_display.clone(),
        scanned_entries,
        scanned_files,
        scanned_directories,
        logical_bytes,
        current_path: queue.last_path(),
        elapsed_ms: result.elapsed_ms,
        cancelled,
    });

    Ok(ScanIndex {
        scan: result,
        persisted: None,
        files,
        directories: directory_list
            .into_iter()
            .map(|directory| (directory.path.clone(), directory))
            .collect(),
    })
}

fn percent_of(value: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        value as f64 / total as f64 * 100.0
    }
}

fn format_bytes(value: u64) -> String {
    const KB: f64 = 1024.0;
    let bytes = value as f64;
    if bytes >= KB * KB * KB {
        format!("{:.1} GB", bytes / (KB * KB * KB))
    } else if bytes >= KB * KB {
        format!("{:.1} MB", bytes / (KB * KB))
    } else if bytes >= KB {
        format!("{:.1} KB", bytes / KB)
    } else {
        format!("{value} bytes")
    }
}

/// Path containment without allocating: `format!` used to build a `root/` needle
/// here, and this runs once per file in every recursive query and per guarded
/// prefix in `system_protected_path`.
pub(crate) fn path_within(path: &str, root: &str) -> bool {
    if path == root {
        return true;
    }
    let normalized = root.trim_end_matches(['/', '\\']);
    if normalized.is_empty() {
        return path.starts_with('/');
    }
    let hay = path.as_bytes();
    let prefix = normalized.as_bytes();
    if hay.len() <= prefix.len() || !hay[..prefix.len()].eq(prefix) {
        return false;
    }
    matches!(hay[prefix.len()], b'/' | b'\\')
}

fn path_is_inside(path: &str, parent: &str) -> bool {
    path != parent && path_within(path, parent)
}

/// Generic cleanup rules must never remove core operating-system state even if
/// a user selected it from an unfiltered analysis table.
pub(crate) fn system_protected_path(path: &str) -> bool {
    const GUARDED: &[&str] = &[
        "/System",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/dev",
        "/private/var/db",
        "/private/var/vm",
        "/Library/Apple",
        "/Library/Keychains",
        "/Library/SystemExtensions",
        "/Library/StagedExtensions",
    ];
    GUARDED
        .iter()
        .any(|root| path == *root || path_within(path, root))
}

struct CleanupCandidate {
    kind: String,
    title: String,
    reason: String,
    path: String,
    size: u64,
    risk: String,
    action: String,
    is_directory: bool,
    category: String,
    modified: Option<i64>,
    reversible: bool,
    note: Option<String>,
}

pub(crate) fn build_cleanup(
    files: &[StorageFile],
    directories: &[StorageDirectory],
    scan_root: &Path,
) -> Vec<CleanupRecommendation> {
    let root_text = scan_root.to_string_lossy().to_string();
    let home = home_dir();
    let home_text = home.to_string_lossy().to_string();
    let by_path: HashMap<&str, &StorageDirectory> = directories
        .iter()
        .map(|directory| (directory.path.as_str(), directory))
        .collect();
    let mut candidates: Vec<CleanupCandidate> = Vec::new();
    let mut push_directory = |relative: &str,
                              kind: &str,
                              title: &str,
                              reason: &str,
                              risk: &str,
                              action: &str,
                              minimum: u64,
                              reversible: bool,
                              note: Option<&str>| {
        let path = if relative.is_empty() {
            home_text.clone()
        } else {
            format!("{}/{}", home_text.trim_end_matches('/'), relative)
        };
        if !path_within(&path, &root_text) {
            return;
        }
        if let Some(directory) = by_path.get(path.as_str()) {
            if directory.size >= minimum {
                candidates.push(CleanupCandidate {
                    kind: kind.into(),
                    title: title.into(),
                    reason: reason.into(),
                    path,
                    size: directory.size,
                    risk: risk.into(),
                    action: action.into(),
                    is_directory: true,
                    category: "other".into(),
                    modified: directory.modified,
                    reversible,
                    note: note.map(|value| value.to_string()),
                });
            }
        }
    };

    push_directory(
        ".Trash",
        "trash",
        "Trash",
        "Items already in your Trash are counted here. Removing them is permanent.",
        "review",
        "permanent",
        1,
        false,
        Some("Emptying Trash cannot be undone."),
    );
    push_directory(
        "Library/Caches",
        "applicationCaches",
        "Application caches",
        "Caches can be rebuilt by applications, but some applications store recoverable state here.",
        "review",
        "trash",
        100 * ONE_MB,
        true,
        Some("Prefer an application's own cache-clearing command when one exists."),
    );
    push_directory(
        "Library/Logs",
        "logs",
        "Application logs",
        "Logs consume space but may still be needed for diagnostics.",
        "review",
        "trash",
        20 * ONE_MB,
        true,
        None,
    );
    push_directory(
        "Library/Developer/Xcode/DerivedData",
        "developer",
        "Xcode DerivedData",
        "Build products and indexes generated by Xcode. Xcode recreates them when needed.",
        "low",
        "trash",
        100 * ONE_MB,
        true,
        Some("Close Xcode before removing DerivedData."),
    );
    push_directory(
        "Library/Developer/Xcode/iOS DeviceSupport",
        "developer",
        "Xcode device support",
        "Symbol and support files copied from iOS devices. Xcode can copy them again.",
        "low",
        "trash",
        100 * ONE_MB,
        true,
        None,
    );
    push_directory(
        "Library/Developer/CoreSimulator/Devices",
        "developer",
        "iOS Simulator data",
        "Simulator devices and their app data. Deleting a simulator discards its installed apps and state.",
        "review",
        "trash",
        500 * ONE_MB,
        true,
        Some("Use Xcode's Devices and Simulators window to remove individual simulators."),
    );
    push_directory(
        "Library/Developer/Xcode/Archives",
        "developer",
        "Xcode archives",
        "Archived app builds, including symbols needed to symbolicate crashes.",
        "high",
        "trash",
        100 * ONE_MB,
        true,
        Some("Archives may be required for App Store submissions and crash reports."),
    );
    push_directory(
        ".npm",
        "packageCache",
        "npm cache",
        "Downloaded npm packages cached for reuse.",
        "low",
        "trash",
        100 * ONE_MB,
        true,
        Some("npm can download the packages again."),
    );
    push_directory(
        ".cargo/registry",
        "packageCache",
        "Cargo registry cache",
        "Downloaded Rust crate sources and archives.",
        "low",
        "trash",
        100 * ONE_MB,
        true,
        None,
    );
    push_directory(
        ".gradle/caches",
        "packageCache",
        "Gradle cache",
        "Downloaded Gradle dependencies and build caches.",
        "low",
        "trash",
        100 * ONE_MB,
        true,
        None,
    );
    push_directory(
        ".m2/repository",
        "packageCache",
        "Maven repository cache",
        "Downloaded Maven artifacts.",
        "low",
        "trash",
        100 * ONE_MB,
        true,
        None,
    );
    push_directory(
        "Library/Android/sdk",
        "developer",
        "Android SDK",
        "Platforms, build tools, and emulator images used by Android development.",
        "review",
        "trash",
        500 * ONE_MB,
        true,
        Some("Removing this can break Android builds. Use Android Studio's SDK Manager instead."),
    );
    push_directory(
        "Library/Containers/com.docker.docker/Data/vms",
        "virtualMachines",
        "Docker virtual machine data",
        "Container images, volumes, and the Docker VM disk.",
        "high",
        "trash",
        ONE_GB,
        false,
        Some("Use Docker's own prune commands to avoid losing volumes."),
    );
    push_directory(
        "Library/Application Support/MobileSync/Backup",
        "backups",
        "iOS device backups",
        "Local backups of iOS and iPadOS devices.",
        "high",
        "trash",
        ONE_GB,
        false,
        Some("Deleting a backup can permanently lose the only copy of device data."),
    );
    push_directory(
        "Library/Application Support",
        "applicationSupport",
        "Application support data",
        "Databases, settings, and documents owned by applications.",
        "high",
        "trash",
        2 * ONE_GB,
        false,
        Some("Inspect the owning application first. This is not the same as the app bundle."),
    );
    push_directory(
        "Library/Mail",
        "mail",
        "Mail data",
        "Local mailboxes and attachments managed by Mail.",
        "high",
        "trash",
        ONE_GB,
        false,
        Some("Manage mail storage from Mail's own settings."),
    );

    // Recognised project/build directories anywhere in the scanned tree.
    let mut build_dirs: Vec<&StorageDirectory> = directories
        .iter()
        .filter(|directory| {
            matches!(
                directory.name.as_str(),
                "node_modules" | "target" | ".build" | "DerivedData"
            ) && directory.depth > 0
                && directory.size >= 100 * ONE_MB
        })
        .collect();
    build_dirs.sort_by(|left, right| right.size.cmp(&left.size));
    for directory in build_dirs.into_iter().take(12) {
        candidates.push(CleanupCandidate {
            kind: "buildArtifacts".into(),
            title: format!("Build artifacts ({})", directory.name),
            reason: "Dependencies and compiled output generated by a development tool.".into(),
            path: directory.path.clone(),
            size: directory.size,
            risk: "low".into(),
            action: "trash".into(),
            is_directory: true,
            category: "developer".into(),
            modified: directory.modified,
            reversible: true,
            note: Some("Regenerated by the owning tool; rebuild time may increase.".into()),
        });
    }

    let now = now_ms();
    let old_threshold = now - 365 * ONE_DAY_MS;
    for file in files {
        if !path_within(&file.path, &root_text) {
            continue;
        }
        if file.category == "system" || system_protected_path(&file.path) {
            continue;
        }
        let extension = file.extension.as_deref().unwrap_or("");
        let mut candidate: Option<CleanupCandidate> = None;
        if contains_ignore_ascii_case(&file.path, "/downloads/") && file.size >= 250 * ONE_MB {
            candidate = Some(CleanupCandidate {
                kind: "largeDownload".into(),
                title: "Large download".into(),
                reason: "A large file remains in Downloads. Its usefulness is not known.".into(),
                path: file.path.clone(),
                size: file.size,
                risk: "review".into(),
                action: "trash".into(),
                is_directory: false,
                category: "downloads".into(),
                modified: file.modified,
                reversible: true,
                note: None,
            });
        } else if matches!(extension, "dmg" | "pkg" | "mpkg" | "iso" | "exe" | "msi")
            && file.size >= 50 * ONE_MB
        {
            candidate = Some(CleanupCandidate {
                kind: "installer".into(),
                title: "Installer package".into(),
                reason: "An installer or disk image that may already have been used.".into(),
                path: file.path.clone(),
                size: file.size,
                risk: "review".into(),
                action: "trash".into(),
                is_directory: false,
                category: "archives".into(),
                modified: file.modified,
                reversible: true,
                note: None,
            });
        } else if matches!(
            extension,
            "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz"
        ) && file.size >= 500 * ONE_MB
        {
            candidate = Some(CleanupCandidate {
                kind: "archive".into(),
                title: "Large archive".into(),
                reason:
                    "A large compressed archive. It may contain the only copy of important data."
                        .into(),
                path: file.path.clone(),
                size: file.size,
                risk: "review".into(),
                action: "trash".into(),
                is_directory: false,
                category: "archives".into(),
                modified: file.modified,
                reversible: true,
                note: None,
            });
        } else if matches!(extension, "vmdk" | "vdi" | "qcow2" | "vhd" | "vhdx")
            && file.size >= ONE_GB
        {
            candidate = Some(CleanupCandidate {
                kind: "virtualMachine".into(),
                title: "Virtual machine disk".into(),
                reason: "VM state can contain unrecoverable data and application environments."
                    .into(),
                path: file.path.clone(),
                size: file.size,
                risk: "high".into(),
                action: "inspect".into(),
                is_directory: false,
                category: "virtualMachines".into(),
                modified: file.modified,
                reversible: false,
                note: Some("Use the virtual machine manager's own deletion flow.".into()),
            });
        } else if matches!(extension, "log" | "diag" | "crash") && file.size >= 50 * ONE_MB {
            candidate = Some(CleanupCandidate {
                kind: "logs".into(),
                title: "Large log file".into(),
                reason: "A large log file that may still be useful for troubleshooting.".into(),
                path: file.path.clone(),
                size: file.size,
                risk: "review".into(),
                action: "trash".into(),
                is_directory: false,
                category: "caches".into(),
                modified: file.modified,
                reversible: true,
                note: None,
            });
        } else if matches!(extension, "db" | "sqlite" | "sqlite3" | "realm")
            && file.size >= 500 * ONE_MB
        {
            candidate = Some(CleanupCandidate {
                kind: "database".into(),
                title: "Large database file".into(),
                reason: "Database files can hold live application or user data.".into(),
                path: file.path.clone(),
                size: file.size,
                risk: "high".into(),
                action: "inspect".into(),
                is_directory: false,
                category: "other".into(),
                modified: file.modified,
                reversible: false,
                note: Some("Back up or export data before removing a database.".into()),
            });
        } else if file.size >= ONE_GB
            && file
                .modified
                .map(|value| value < old_threshold)
                .unwrap_or(false)
        {
            candidate = Some(CleanupCandidate {
                kind: "oldLargeFile".into(),
                title: "Old large file".into(),
                reason: "This file is large and has not changed in over a year. Age alone does not make it unnecessary.".into(),
                path: file.path.clone(),
                size: file.size,
                risk: "review".into(),
                action: "trash".into(),
                is_directory: false,
                category: file.category.clone(),
                modified: file.modified,
                reversible: true,
                note: None,
            });
        }
        if let Some(candidate) = candidate {
            candidates.push(candidate);
        }
    }

    // Recommendations are kept individually so a specific high-risk item is
    // never hidden by a broader parent folder. The *total* shown in the UI is
    // deduplicated separately (see `deduplicated_cleanup_bytes`).
    candidates.sort_by(|left, right| right.size.cmp(&left.size));
    candidates
        .into_iter()
        .take(200)
        .enumerate()
        .map(|(index, item)| CleanupRecommendation {
            id: format!("cleanup-{index}"),
            kind: item.kind,
            title: item.title,
            reason: item.reason,
            path: item.path,
            size: item.size,
            recoverable_bytes: item.size,
            risk: item.risk,
            action: item.action,
            is_directory: item.is_directory,
            category: item.category,
            modified: item.modified,
            reversible: item.reversible,
            note: item.note,
        })
        .collect()
}

/// Deduplicated cleanup estimate for the whole recommendation list. If a
/// folder and a file inside it are both recommended, only the folder's bytes
/// are counted once.
fn deduplicated_cleanup_bytes(cleanup: &[CleanupRecommendation]) -> u64 {
    let mut ordered: Vec<&CleanupRecommendation> = cleanup.iter().collect();
    ordered.sort_by_key(|item| item.path.len());
    let mut accepted: Vec<&str> = Vec::new();
    let mut total = 0u64;
    for item in ordered {
        if accepted.iter().any(|path| path_within(&item.path, path)) {
            continue;
        }
        accepted.push(&item.path);
        total = total.saturating_add(item.recoverable_bytes);
    }
    total
}

/* ------------------------------------------------------------------------- */
/* Queries over the in-memory scan index                                      */
/* ------------------------------------------------------------------------- */

pub fn children_core(
    index: &ScanIndex,
    path: &str,
    limit: usize,
) -> Result<StorageChildren, AppError> {
    let directory = index.directories.get(path).cloned().ok_or_else(|| {
        AppError::new(
            "not_in_scan",
            "This folder is not part of the current scan. Rescan it to inspect its contents.",
            Some(path.to_string()),
        )
    })?;
    let limit = limit.clamp(1, 10_000);
    let mut directories: Vec<StorageDirectory> = index
        .directories
        .values()
        .filter(|item| item.parent == path && item.path != path)
        .cloned()
        .collect();
    directories.sort_by(|left, right| right.size.cmp(&left.size));
    let directories_truncated = directories.len() > limit;
    directories.truncate(limit);
    let mut files: Vec<StorageFile> = index
        .files
        .iter()
        .filter(|item| item.parent == path)
        .cloned()
        .collect();
    files.sort_by(|left, right| right.size.cmp(&left.size));
    let files_truncated = files.len() > limit;
    files.truncate(limit);
    Ok(StorageChildren {
        path: path.to_string(),
        total_size: directory.size,
        total_files: directory.files,
        total_folders: directory.folders,
        directory,
        directories,
        files,
        truncated: directories_truncated || files_truncated,
    })
}

/// Allocating comparator for name sorting. ASCII names (the overwhelming
/// majority) never build a lowercase copy; only non-ASCII names fall back.
fn compare_names(left: &str, right: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    if left.is_ascii() && right.is_ascii() {
        let mut left_bytes = left.bytes().map(|value| value.to_ascii_lowercase());
        let mut right_bytes = right.bytes().map(|value| value.to_ascii_lowercase());
        loop {
            match (left_bytes.next(), right_bytes.next()) {
                (None, None) => return Ordering::Equal,
                (None, Some(_)) => return Ordering::Less,
                (Some(_), None) => return Ordering::Greater,
                (Some(left), Some(right)) => {
                    let ordering = left.cmp(&right);
                    if ordering != Ordering::Equal {
                        return ordering;
                    }
                }
            }
        }
    } else {
        left.to_lowercase().cmp(&right.to_lowercase())
    }
}

fn name_contains(name: &str, needle_lower: &str) -> bool {
    if name.is_ascii() {
        contains_ignore_ascii_case(name, needle_lower)
    } else {
        name.to_lowercase().contains(needle_lower)
    }
}

pub fn query_files_core(index: &ScanIndex, query: &StorageFileQuery) -> StorageFilePage {
    // The needles are prepared once. The previous implementation lowercased every
    // filename and extension, and rebuilt the directory prefix, for every query.
    let name_needle = query.name.as_deref().map(|value| value.to_lowercase());
    let extension_needle = query
        .extension
        .as_deref()
        .map(|value| value.to_ascii_lowercase());
    let mut filtered: Vec<&StorageFile> = index
        .files
        .iter()
        .filter(|file| {
            if let Some(directory) = query.directory.as_deref() {
                if query.recursive {
                    if !path_within(&file.path, directory) {
                        return false;
                    }
                } else if file.parent != directory {
                    return false;
                }
            }
            if let Some(category) = query.category.as_deref() {
                if file.category != category {
                    return false;
                }
            }
            if let Some(file_type) = query.file_type.as_deref() {
                if file.file_type != file_type {
                    return false;
                }
            }
            if let Some(name) = name_needle.as_deref() {
                if !name_contains(&file.name, name) {
                    return false;
                }
            }
            if let Some(extension) = extension_needle.as_deref() {
                if file.extension.as_deref() != Some(extension) {
                    return false;
                }
            }
            if let Some(minimum) = query.min_size {
                if file.size < minimum {
                    return false;
                }
            }
            if let Some(maximum) = query.max_size {
                if file.size > maximum {
                    return false;
                }
            }
            if let Some(after) = query.modified_after {
                if file.modified.map(|value| value < after).unwrap_or(true) {
                    return false;
                }
            }
            if let Some(before) = query.modified_before {
                if file.modified.map(|value| value > before).unwrap_or(true) {
                    return false;
                }
            }
            if let Some(after) = query.created_after {
                if file.created.map(|value| value < after).unwrap_or(true) {
                    return false;
                }
            }
            if let Some(before) = query.created_before {
                if file.created.map(|value| value > before).unwrap_or(true) {
                    return false;
                }
            }
            if let Some(hidden) = query.hidden {
                if file.is_hidden != hidden {
                    return false;
                }
            }
            if let Some(symlinks) = query.symlinks {
                if file.is_symlink != symlinks {
                    return false;
                }
            }
            true
        })
        .collect();
    let total_bytes = filtered.iter().map(|file| file.size).sum();
    let total = filtered.len() as u64;
    let ascending = query.direction.eq_ignore_ascii_case("asc");
    let sort = query.sort.as_str();
    // The path tiebreak makes the order deterministic, which also lets a partial
    // selection produce the same page a full sort would.
    let compare = |left: &&StorageFile, right: &&StorageFile| {
        let ordering = match sort {
            "name" => compare_names(&left.name, &right.name),
            "modified" => left.modified.cmp(&right.modified),
            "created" => left.created.cmp(&right.created),
            "type" => left
                .file_type
                .cmp(&right.file_type)
                .then_with(|| left.name.cmp(&right.name)),
            "path" => left.path.cmp(&right.path),
            _ => left.size.cmp(&right.size),
        }
        .then_with(|| left.path.cmp(&right.path));
        if ascending {
            ordering
        } else {
            ordering.reverse()
        }
    };
    let limit = query.limit.clamp(1, 5_000);
    let offset = query.offset;
    let has_more = filtered.len() > offset.saturating_add(limit);
    // Sorting the whole index costs seconds on a multi-million-entry scan while a
    // page only needs the first `offset + limit` rows ordered.
    let needed = offset.saturating_add(limit);
    if needed < filtered.len() {
        filtered.select_nth_unstable_by(needed, compare);
        filtered.truncate(needed);
    }
    filtered.sort_by(compare);
    let files = filtered
        .into_iter()
        .skip(offset)
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    StorageFilePage {
        files,
        total,
        total_bytes,
        offset: offset as u64,
        limit: limit as u64,
        has_more,
    }
}

/* ------------------------------------------------------------------------- */
/* Duplicate verification                                                     */
/* ------------------------------------------------------------------------- */

fn volume_name_for(path: &Path, volumes: &[StorageVolume]) -> String {
    volumes
        .iter()
        .filter(|volume| path.starts_with(Path::new(&volume.mount_point)))
        .max_by_key(|volume| Path::new(&volume.mount_point).components().count())
        .map(|volume| volume.name.clone())
        .unwrap_or_else(|| "Unknown volume".into())
}

pub fn find_duplicates_core(
    request: &StorageDuplicateRequest,
    cancel: &AtomicBool,
) -> Result<StorageDuplicateResponse, AppError> {
    let started = Instant::now();
    let min_size = request.min_size.max(1);
    let max_candidates = request.max_candidates.clamp(100, 200_000);
    let limit = request.limit.clamp(1, 1_000);
    let roots: Vec<PathBuf> = request
        .roots
        .iter()
        .map(|root| PathBuf::from(root))
        .filter(|root| root.is_dir())
        .collect();
    if roots.is_empty() {
        return Err(AppError::invalid(
            "Choose at least one accessible volume or folder to scan for duplicates.",
        ));
    }
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut scanned_files = 0u64;
    let mut errors = 0u64;
    let mut truncated = false;
    'roots: for root in &roots {
        let excluded = excluded_mounts(root);
        let walker = WalkDir::new(root)
            .follow_links(false)
            .max_depth(MAX_SCAN_DEPTH)
            .into_iter()
            .filter_entry(|item| {
                if item.depth() == 0 {
                    return true;
                }
                if excluded.iter().any(|mount| item.path() == mount) {
                    return false;
                }
                if item.file_type().is_dir() {
                    return !is_reserved_directory(&item.file_name().to_string_lossy());
                }
                true
            });
        for item in walker {
            if cancel.load(Ordering::Relaxed) {
                break 'roots;
            }
            let item = match item {
                Ok(item) => item,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            if !item.file_type().is_file() {
                continue;
            }
            let metadata = match fs::symlink_metadata(item.path()) {
                Ok(metadata) => metadata,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            if !request.include_hidden
                && (item.file_name().to_string_lossy().starts_with('.')
                    || metadata_hidden(&metadata))
            {
                continue;
            }
            let size = metadata.len();
            if size < min_size {
                continue;
            }
            scanned_files += 1;
            by_size
                .entry(size)
                .or_default()
                .push(item.path().to_path_buf());
        }
    }
    let mut candidate_paths: Vec<(u64, PathBuf)> = by_size
        .into_iter()
        .filter(|(_, paths)| paths.len() > 1)
        .flat_map(|(size, paths)| paths.into_iter().map(move |path| (size, path)))
        .collect();
    candidate_paths.sort_by(|left, right| right.0.cmp(&left.0));
    if candidate_paths.len() > max_candidates {
        candidate_paths.truncate(max_candidates);
        truncated = true;
    }
    let candidate_files = candidate_paths.len() as u64;
    let mut by_fingerprint: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for (_, path) in candidate_paths {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        if let Some(fingerprint) = quick_fingerprint(&path) {
            by_fingerprint.entry(fingerprint).or_default().push(path);
        } else {
            errors += 1;
        }
    }
    let volumes = discover_volumes();
    let mut groups = Vec::new();
    let mut hashed_files = 0u64;
    let mut changed_files = 0u64;
    let mut group_index = 0usize;
    for (fingerprint, paths) in by_fingerprint {
        if paths.len() < 2 || cancel.load(Ordering::Relaxed) {
            continue;
        }
        let mut by_hash: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for path in paths {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let before = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            match hash_file(&path) {
                Ok(hash) => {
                    hashed_files += 1;
                    match fs::symlink_metadata(&path) {
                        Ok(after) => {
                            if after.len() != before.len()
                                || system_time_ms(after.modified())
                                    != system_time_ms(before.modified())
                            {
                                changed_files += 1;
                                continue;
                            }
                            by_hash.entry(hash).or_default().push(path);
                        }
                        Err(_) => {
                            changed_files += 1;
                        }
                    }
                }
                Err(_) => {
                    errors += 1;
                }
            }
        }
        for (hash, matches) in by_hash {
            if matches.len() < 2 {
                continue;
            }
            let mut matches = matches;
            matches.sort();
            let mut files = Vec::new();
            let mut size = 0u64;
            let mut volume_names = HashSet::new();
            for path in &matches {
                let entry = match entry_from_path(path) {
                    Ok(entry) => entry,
                    Err(_) => {
                        changes_errors(&mut errors);
                        continue;
                    }
                };
                size = entry.size.unwrap_or(0);
                volume_names.insert(volume_name_for(path, &volumes));
                files.push(StorageDuplicateFile {
                    entry,
                    hash: hash.clone(),
                    volume: volume_name_for(path, &volumes),
                });
            }
            if files.len() < 2 {
                continue;
            }
            group_index += 1;
            let recoverable = size.saturating_mul(files.len() as u64 - 1);
            groups.push(StorageDuplicateGroup {
                id: format!("storage-dup-{group_index}-{}", fingerprint.chars().take(8).collect::<String>()),
                size,
                recoverable_bytes: recoverable,
                files,
                verified: true,
                same_volume: volume_names.len() == 1,
                explanation: "Byte-identical files confirmed with SHA-256. Keep at least one copy before removing anything.".into(),
            });
        }
    }
    groups.sort_by(|left, right| right.recoverable_bytes.cmp(&left.recoverable_bytes));
    if groups.len() > limit {
        groups.truncate(limit);
        truncated = true;
    }
    let recoverable_total = groups
        .iter()
        .map(|group| group.recoverable_bytes)
        .sum::<u64>();
    Ok(StorageDuplicateResponse {
        request_id: request.request_id,
        groups,
        scanned_files,
        candidate_files,
        hashed_files,
        changed_files,
        errors,
        recoverable_bytes: recoverable_total,
        cancelled: cancel.load(Ordering::Relaxed),
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

fn changes_errors(errors: &mut u64) {
    *errors += 1;
}

/* ------------------------------------------------------------------------- */
/* Revalidated destructive actions                                            */
/* ------------------------------------------------------------------------- */

#[allow(dead_code)]
pub fn delete_core(
    index: &ScanIndex,
    request: &StorageDeleteRequest,
    cancel: &AtomicBool,
) -> Result<StorageDeleteOutcome, AppError> {
    delete_core_with_progress(index, request, cancel, &|_| {})
}

pub fn delete_core_with_progress(
    index: &ScanIndex,
    request: &StorageDeleteRequest,
    cancel: &AtomicBool,
    progress: &dyn Fn(StorageDeleteProgress),
) -> Result<StorageDeleteOutcome, AppError> {
    if request.scan_id != index.scan.scan_id {
        return Err(AppError::new(
            "stale_scan",
            "These results are from an older scan. Rescan before removing anything.",
            None,
        ));
    }
    let root_text = index.scan.root.clone();
    let root_canonical_text = fs::canonicalize(Path::new(&root_text))
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| root_text.clone());
    let home = home_dir();
    let home_text = home.to_string_lossy().to_string();
    let volumes = discover_volumes();
    let mount_roots: Vec<String> = volumes
        .iter()
        .map(|volume| volume.mount_point.clone())
        .collect();
    let known: HashSet<&str> = index
        .directories
        .keys()
        .map(|path| path.as_str())
        .chain(index.files.iter().map(|file| file.path.as_str()))
        .collect();

    // Remove descendants when an ancestor is selected. This mirrors the
    // deduplicated cleanup estimate and prevents repeated removal attempts.
    let mut ordered: Vec<&StorageDeleteItem> = request.items.iter().collect();
    ordered.sort_by_key(|item| item.path.len());
    let mut selected: Vec<&StorageDeleteItem> = Vec::new();
    let mut skipped_overlaps = Vec::new();
    for item in ordered {
        if selected
            .iter()
            .any(|existing| path_is_inside(&item.path, &existing.path))
        {
            skipped_overlaps.push(item.path.clone());
        } else {
            selected.push(item);
        }
    }

    let free_before = filesystem_usage(Path::new(&root_text)).map(|usage| usage.available);
    let mut results = Vec::new();
    let mut requested_bytes = 0u64;
    let mut reclaimed_bytes = 0u64;
    let mut changed = Vec::new();
    let mut cancelled = false;
    let total = selected.len() as u64;
    let mut processed = 0u64;
    let mut completed = 0u64;
    let mut failed = 0u64;

    for item in selected {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        processed += 1;
        progress(StorageDeleteProgress {
            operation_id: request.operation_id,
            processed,
            total,
            completed,
            failed,
            current_path: Some(item.path.clone()),
            cancelled: false,
        });
        let path = PathBuf::from(&item.path);
        let display = item.path.clone();
        if !path.is_absolute() {
            results.push(OperationResult::failed(
                &display,
                "The path must be absolute.".into(),
            ));
            continue;
        }
        if !path_within(&item.path, &root_text) || item.path == root_text {
            results.push(OperationResult::failed(
                &display,
                "This item is outside the scanned volume and can't be removed here.".into(),
            ));
            continue;
        }
        if item.path == home_text || mount_roots.iter().any(|mount| mount == &item.path) {
            results.push(OperationResult::failed(
                &display,
                "A volume or home folder can't be removed by the storage analyzer.".into(),
            ));
            continue;
        }
        let persisted_known = || {
            index
                .persisted
                .as_ref()
                .and_then(|persisted| persisted.cache.has_path(persisted.scan_id, &item.path).ok())
                .unwrap_or(false)
        };
        if !known.contains(item.path.as_str()) && !persisted_known() {
            results.push(OperationResult::failed(
                &display,
                "This item was not part of the verified scan. Rescan before removing it.".into(),
            ));
            continue;
        }
        if system_protected_path(&item.path) {
            results.push(OperationResult::failed(
                &display,
                "This is a protected operating-system location and can't be removed by the storage analyzer.".into(),
            ));
            continue;
        }
        if let Ok(canonical) = fs::canonicalize(&path) {
            let canonical_text = canonical.to_string_lossy().to_string();
            let inside_root = path_within(&canonical_text, &root_text)
                || path_within(&canonical_text, &root_canonical_text);
            if !inside_root
                || canonical_text == root_text
                || canonical_text == root_canonical_text
                || system_protected_path(&canonical_text)
            {
                results.push(OperationResult::failed(
                    &display,
                    "This path resolves outside the scanned volume or into a protected location."
                        .into(),
                ));
                continue;
            }
        }
        if let Err(error) = reject_unsafe_destruction(&path) {
            results.push(OperationResult::failed(&display, error.message));
            continue;
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                changed.push(display.clone());
                results.push(OperationResult::failed(
                    &display,
                    format!("The item changed or disappeared after scanning: {error}"),
                ));
                continue;
            }
        };
        let is_directory = metadata.is_dir() && !metadata.file_type().is_symlink();
        if is_directory != item.is_directory && !metadata.file_type().is_symlink() {
            changed.push(display.clone());
            results.push(OperationResult::failed(
                &display,
                "The item type changed after scanning. Rescan before removing it.".into(),
            ));
            continue;
        }
        if !is_directory {
            if let Some(expected) = item.expected_size {
                if metadata.len() != expected {
                    changed.push(display.clone());
                    results.push(OperationResult::failed(
                        &display,
                        "The file size changed after scanning. Rescan before removing it.".into(),
                    ));
                    continue;
                }
            }
        }
        if let (Some(expected), Some(actual)) =
            (item.expected_modified, system_time_ms(metadata.modified()))
        {
            if expected != actual {
                changed.push(display.clone());
                results.push(OperationResult::failed(
                    &display,
                    "The modification date changed after scanning. Rescan before removing it."
                        .into(),
                ));
                continue;
            }
        }
        let measured_size = if is_directory {
            item.expected_size.unwrap_or(0)
        } else {
            metadata.len()
        };
        requested_bytes = requested_bytes.saturating_add(measured_size);
        let outcome = operations::delete_paths(&[path], request.permanent);
        let result = outcome.into_iter().next().unwrap_or_else(|| {
            OperationResult::failed(&display, "The operation did not return a result.".into())
        });
        if result.status == "completed" {
            reclaimed_bytes = reclaimed_bytes.saturating_add(measured_size);
            completed += 1;
        } else {
            failed += 1;
        }
        results.push(result);
    }

    let free_after = filesystem_usage(Path::new(&root_text)).map(|usage| usage.available);
    let completed_total = results
        .iter()
        .filter(|result| result.status == "completed")
        .count() as u64;
    let failed_total = results
        .iter()
        .filter(|result| result.status == "failed")
        .count() as u64;
    progress(StorageDeleteProgress {
        operation_id: request.operation_id,
        processed,
        total,
        completed: completed_total,
        failed: failed_total,
        current_path: None,
        cancelled,
    });
    Ok(StorageDeleteOutcome {
        operation_id: request.operation_id,
        results,
        requested_bytes,
        reclaimed_bytes,
        free_before,
        free_after,
        changed,
        skipped_overlaps,
        cancelled,
    })
}

/* ------------------------------------------------------------------------- */
/* Tauri command surface                                                      */
/* ------------------------------------------------------------------------- */

#[tauri::command]
pub async fn get_storage_volumes() -> Result<Vec<StorageVolume>, AppError> {
    logging::info("storage.volumes", "discovering volumes");
    let result = tauri::async_runtime::spawn_blocking(|| {
        logging::catch("volume discovery", || Ok::<_, AppError>(discover_volumes()))
    })
    .await
    .map_err(|error| {
        logging::error("storage.volumes", format!("volume task failed: {error}"));
        AppError::new(
            "internal",
            format!("Volume discovery failed: {error}"),
            None,
        )
    })?;
    let volumes = result?;
    logging::info(
        "storage.volumes",
        format!("discovered {} volume(s)", volumes.len()),
    );
    Ok(volumes)
}

#[tauri::command]
pub async fn scan_storage(
    app: tauri::AppHandle,
    state: tauri::State<'_, StorageState>,
    request: StorageScanRequest,
) -> Result<StorageScanResult, AppError> {
    use tauri::Emitter;
    let root = normalize_path(&request.root)?;
    let scan_id = request.scan_id;
    // `0` means auto: the Deep scan control lets the memory guard decide where the
    // walk stops instead of a fixed entry count.
    let budget = resolve_scan_budget(request.max_entries);
    let root_text = root.to_string_lossy().to_string();
    logging::info(
        "storage.scan",
        format!(
            "start id={scan_id} root={root_text} max_entries={} index_budget_bytes={}",
            budget.max_entries, budget.max_index_bytes
        ),
    );
    let cancel = state.register(scan_id);
    let app_handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        logging::catch("storage scan", || {
            scan_storage_index_with_budget(&root, scan_id, budget, &cancel, &|progress| {
                let _ = app_handle.emit("storage-scan-progress", progress);
            })
        })
    })
    .await
    .map_err(|error| {
        logging::error("storage.scan", format!("scan task failed: {error}"));
        AppError::new("internal", format!("Storage scan failed: {error}"), None)
    });
    state.remove(scan_id);
    let index = result??;
    let scan = index.scan.clone();
    logging::info(
        "storage.scan",
        format!(
            "complete id={scan_id} entries={} files={} dirs={} logical={} allocated={} errors={} cancelled={} truncated={} elapsed_ms={}",
            scan.scanned_entries,
            scan.scanned_files,
            scan.scanned_directories,
            scan.total_logical_bytes,
            scan.total_allocated_bytes,
            scan.read_errors,
            scan.cancelled,
            scan.truncated,
            scan.elapsed_ms
        ),
    );
    let index = state.store(index);
    state.persist_async(index);
    Ok(scan)
}

#[tauri::command]
pub fn cancel_storage_scan(state: tauri::State<'_, StorageState>, scan_id: u64) {
    logging::info("storage.scan", format!("cancel requested id={scan_id}"));
    state.cancel(scan_id);
}

#[tauri::command]
pub fn get_storage_scan_result(state: tauri::State<'_, StorageState>) -> Option<StorageScanResult> {
    state.current().map(|index| index.scan.clone())
}

#[tauri::command]
pub fn get_storage_cached_scan(
    state: tauri::State<'_, StorageState>,
    root: Option<String>,
) -> Option<CachedStorageScan> {
    state.cached(root.as_deref())
}

#[tauri::command]
pub fn get_storage_children(
    state: tauri::State<'_, StorageState>,
    scan_id: u64,
    path: String,
    limit: Option<usize>,
) -> Result<StorageChildren, AppError> {
    if let Some(index) = state.current() {
        if index.scan.scan_id == scan_id {
            return children_for(&index, &path, limit.unwrap_or(2_000));
        }
    }
    state.cached_children(scan_id, &path, limit.unwrap_or(2_000))
}

#[tauri::command]
pub fn query_storage_files(
    state: tauri::State<'_, StorageState>,
    query: StorageFileQuery,
) -> Result<StorageFilePage, AppError> {
    if let Some(index) = state.current() {
        if index.scan.scan_id == query.scan_id {
            return Ok(query_files_for(&index, &query));
        }
    }
    state.cached_query(&query)
}

#[tauri::command]
pub async fn find_storage_duplicates(
    state: tauri::State<'_, StorageState>,
    request: StorageDuplicateRequest,
) -> Result<StorageDuplicateResponse, AppError> {
    let request_id = request.request_id;
    logging::info(
        "storage.duplicates",
        format!(
            "start id={request_id} roots={:?} min_size={} limit={}",
            request.roots, request.min_size, request.limit
        ),
    );
    let cancel = state.register(request_id);
    let result = tauri::async_runtime::spawn_blocking(move || {
        logging::catch("duplicate scan", || find_duplicates_core(&request, &cancel))
    })
    .await
    .map_err(|error| {
        logging::error(
            "storage.duplicates",
            format!("duplicate task failed: {error}"),
        );
        AppError::new("internal", format!("Duplicate scan failed: {error}"), None)
    });
    state.remove(request_id);
    let response = result?;
    match response {
        Ok(value) => {
            logging::info(
                "storage.duplicates",
                format!(
                    "complete id={request_id} groups={} scanned={} hashed={} changed={} errors={} cancelled={} elapsed_ms={}",
                    value.groups.len(),
                    value.scanned_files,
                    value.hashed_files,
                    value.changed_files,
                    value.errors,
                    value.cancelled,
                    value.elapsed_ms
                ),
            );
            Ok(value)
        }
        Err(error) => {
            logging::error("storage.duplicates", error.message.clone());
            Err(error)
        }
    }
}

#[tauri::command]
pub fn cancel_storage_duplicates(state: tauri::State<'_, StorageState>, request_id: u64) {
    state.cancel(request_id);
}

#[tauri::command]
pub async fn delete_storage_paths(
    app: tauri::AppHandle,
    state: tauri::State<'_, StorageState>,
    request: StorageDeleteRequest,
) -> Result<StorageDeleteOutcome, AppError> {
    use tauri::Emitter;
    let index = state.current().ok_or_else(|| {
        AppError::new("no_scan", "Run a storage scan before removing files.", None)
    })?;
    let operation_id = request.operation_id;
    logging::info(
        "storage.cleanup",
        format!(
            "start id={operation_id} scan_id={} items={} permanent={}",
            request.scan_id,
            request.items.len(),
            request.permanent
        ),
    );
    let cancel = state.register(operation_id);
    let app_handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        logging::catch("storage cleanup", || {
            delete_core_with_progress(&index, &request, &cancel, &|progress| {
                let _ = app_handle.emit("storage-delete-progress", progress);
            })
        })
    })
    .await
    .map_err(|error| {
        logging::error("storage.cleanup", format!("cleanup task failed: {error}"));
        AppError::new("internal", format!("Cleanup failed: {error}"), None)
    });
    state.remove(operation_id);
    let outcome = result?;
    match outcome {
        Ok(value) => {
            logging::info(
                "storage.cleanup",
                format!(
                    "complete id={operation_id} results={} changed={} overlaps={} cancelled={} requested={} reclaimed={}",
                    value.results.len(),
                    value.changed.len(),
                    value.skipped_overlaps.len(),
                    value.cancelled,
                    value.requested_bytes,
                    value.reclaimed_bytes
                ),
            );
            Ok(value)
        }
        Err(error) => {
            logging::error("storage.cleanup", error.message.clone());
            Err(error)
        }
    }
}

#[tauri::command]
pub fn cancel_storage_delete(state: tauri::State<'_, StorageState>, operation_id: u64) {
    logging::info(
        "storage.cleanup",
        format!("cancel requested id={operation_id}"),
    );
    state.cancel(operation_id);
}

#[tauri::command]
pub fn clear_storage_index(state: tauri::State<'_, StorageState>) {
    logging::info("storage", "clear in-memory analysis index");
    state.clear();
}
