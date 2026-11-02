//! Application storage audit and safe consolidation.
//!
//! MAXplorer keeps exactly one authoritative copy of its indexes and caches
//! under the Tauri application-data directory. Earlier builds used different
//! product names, which left additional WebKit profiles and HTTP caches behind.
//! This module finds those copies, can migrate missing canonical data from an
//! older app-data identifier, and can archive user settings before removing
//! only regenerable cache files.

use crate::error::AppError;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const LEGACY_IDENTITIES: &[&str] = &[
    "maxplorer",
    "win11-explorer",
    "win11explorer",
    "com.maxplorer.app",
    "com.maxplorer.desktop",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageAuditEntry {
    pub id: String,
    pub label: String,
    pub path: String,
    pub category: String,
    pub status: String,
    pub bytes: u64,
    pub files: u64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageAudit {
    pub data_root: String,
    pub entries: Vec<StorageAuditEntry>,
    pub total_bytes: u64,
    pub active_bytes: u64,
    pub legacy_bytes: u64,
    pub reclaimable_bytes: u64,
    pub legacy_count: usize,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCleanupResult {
    pub archived: Vec<String>,
    pub removed_caches: Vec<String>,
    pub migrated: Vec<String>,
    pub skipped: Vec<String>,
    pub failures: Vec<String>,
    pub reclaimed_bytes: u64,
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn measure(path: &Path) -> (u64, u64) {
    if !path.exists() {
        return (0, 0);
    }
    let mut bytes = 0u64;
    let mut files = 0u64;
    for entry in WalkDir::new(path).follow_links(false).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Ok(metadata) = entry.metadata() {
                bytes = bytes.saturating_add(metadata.len());
                files = files.saturating_add(1);
            }
        }
    }
    (bytes, files)
}

fn entry(
    id: impl Into<String>,
    label: impl Into<String>,
    path: &Path,
    category: &str,
    status: &str,
    detail: impl Into<String>,
) -> StorageAuditEntry {
    let (bytes, files) = measure(path);
    StorageAuditEntry {
        id: id.into(),
        label: label.into(),
        path: path.to_string_lossy().to_string(),
        category: category.into(),
        status: status.into(),
        bytes,
        files,
        detail: detail.into(),
    }
}

fn legacy_identities(current: &str) -> Vec<String> {
    LEGACY_IDENTITIES
        .iter()
        .filter(|id| !id.eq_ignore_ascii_case(current))
        .map(|id| (*id).to_string())
        .collect()
}

fn webkit_root() -> PathBuf {
    home_dir().join("Library").join("WebKit")
}

fn caches_root() -> PathBuf {
    home_dir().join("Library").join("Caches")
}

fn app_support_root() -> PathBuf {
    home_dir().join("Library").join("Application Support")
}

fn timestamp_name() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("cleanup-{millis}")
}

fn unique_archive_root(data_root: &Path) -> PathBuf {
    let base = data_root.join("legacy-archive");
    let stamp = timestamp_name();
    let mut candidate = base.join(&stamp);
    let mut suffix = 2;
    while candidate.exists() {
        candidate = base.join(format!("{stamp}-{suffix}"));
        suffix += 1;
    }
    candidate
}

fn write_archive_readme(archive: &Path) -> std::io::Result<()> {
    fs::create_dir_all(archive)?;
    fs::write(
        archive.join("README.txt"),
        "MAXplorer legacy storage archive\n\n\
This folder preserves WebKit/localStorage profiles from older MAXplorer builds.\n\
They were archived instead of deleted so no user settings or history are lost.\n\
Regenerable HTTP/WebKit caches were removed separately.\n",
    )
}

fn move_path(source: &Path, destination: &Path) -> std::io::Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(source, destination)
}

/// Migrate missing canonical index/cache data from an older identifier. This
/// runs at startup and only moves when the canonical copy does not exist, so it
/// can never overwrite current data.
pub fn migrate_legacy_app_data(data_root: &Path, current_identifier: &str) -> Vec<String> {
    let mut migrated = Vec::new();
    for identity in legacy_identities(current_identifier) {
        let legacy = app_support_root().join(&identity);
        if !legacy.is_dir() {
            continue;
        }
        for child in ["search", "storage"] {
            let source = legacy.join(child);
            let destination = data_root.join(child);
            let canonical_file = match child {
                "search" => destination.join("index.sqlite3"),
                "storage" => destination.join("cache.sqlite3"),
                _ => destination.join(child),
            };
            if !source.exists() || canonical_file.exists() {
                continue;
            }
            let outcome = if destination.exists() {
                // The canonical directory may exist but be empty. Move its
                // contents without overwriting anything already present.
                let mut failed = None;
                if let Ok(entries) = fs::read_dir(&source) {
                    for entry in entries.flatten() {
                        let target = destination.join(entry.file_name());
                        if target.exists() {
                            continue;
                        }
                        if let Err(error) = fs::rename(entry.path(), &target) {
                            failed = Some(error);
                            break;
                        }
                    }
                }
                match failed {
                    Some(error) => Err(error),
                    None => {
                        let _ = fs::remove_dir(&source);
                        Ok(())
                    }
                }
            } else {
                move_path(&source, &destination)
            };
            match outcome {
                Ok(()) => {
                    crate::logging::info(
                        "storage.migrate",
                        format!(
                            "moved legacy {child} data from {} to {}",
                            source.display(),
                            destination.display()
                        ),
                    );
                    migrated.push(destination.to_string_lossy().to_string());
                }
                Err(error) => {
                    crate::logging::warn(
                        "storage.migrate",
                        format!(
                            "could not migrate legacy {child} data from {}: {error}",
                            source.display()
                        ),
                    );
                }
            }
        }
        if legacy.is_dir() {
            let _ = fs::remove_dir(&legacy);
        }
    }

    // The database used to fall back to the system temp directory when the
    // app-data folder could not be opened. Reuse it if the canonical copy is
    // still missing.
    let fallback = std::env::temp_dir().join("maxplorer-search");
    let canonical = data_root.join("search").join("index.sqlite3");
    if !canonical.exists() {
        for file in ["index.sqlite3", "index.sqlite3-wal", "index.sqlite3-shm"] {
            let source = fallback.join(file);
            if !source.exists() {
                continue;
            }
            let destination = data_root.join("search").join(file);
            if let Some(parent) = destination.parent() {
                let _ = fs::create_dir_all(parent);
            }
            match move_path(&source, &destination) {
                Ok(()) => {
                    crate::logging::info(
                        "storage.migrate",
                        format!("reused temp search data at {}", destination.display()),
                    );
                    migrated.push(destination.to_string_lossy().to_string());
                }
                Err(error) => crate::logging::warn(
                    "storage.migrate",
                    format!("could not reuse temp search data: {error}"),
                ),
            }
        }
    }
    migrated
}

/// Cheap startup check used only to point users at the audit dialog.
pub fn has_legacy_storage(current_identifier: &str) -> bool {
    if legacy_identities(current_identifier).iter().any(|identity| {
        webkit_root().join(identity).exists()
            || caches_root().join(identity).exists()
            || app_support_root().join(identity).exists()
    }) {
        return true;
    }
    std::env::temp_dir().join("maxplorer").join("WebKit").exists()
        || std::env::temp_dir().join("maxplorer-search").exists()
}

pub fn audit(data_root: &Path, current_identifier: &str) -> StorageAudit {
    let mut entries = Vec::new();
    let search = data_root.join("search").join("index.sqlite3");
    let storage_cache = data_root.join("storage").join("cache.sqlite3");
    let logs = data_root.join("logs");

    entries.push(entry(
        "canonical:search",
        "Search index",
        &search,
        "index",
        "active",
        "Authoritative search index used by this build.",
    ));
    entries.push(entry(
        "canonical:storage",
        "Storage Analyzer cache",
        &storage_cache,
        "cache",
        "active",
        "Authoritative storage-scan cache used by this build.",
    ));
    entries.push(entry(
        "canonical:logs",
        "Diagnostic logs",
        &logs,
        "logs",
        "active",
        "Local diagnostic log files.",
    ));
    entries.push(entry(
        "canonical:webkit",
        "Current WebKit profile",
        &webkit_root().join(current_identifier),
        "settings",
        "active",
        "Current localStorage, window state, tags, and preferences.",
    ));
    entries.push(entry(
        "canonical:caches",
        "Current WebKit cache",
        &caches_root().join(current_identifier),
        "cache",
        "active",
        "Regenerable HTTP/WebKit cache for this build.",
    ));

    for identity in legacy_identities(current_identifier) {
        let webkit = webkit_root().join(&identity);
        if webkit.exists() {
            entries.push(entry(
                format!("legacy:webkit:{identity}"),
                format!("Old WebKit profile: {identity}"),
                &webkit,
                "settings",
                "legacy",
                "Old localStorage/settings copy found. Archive it to preserve data.",
            ));
        }
        let cache = caches_root().join(&identity);
        if cache.exists() {
            entries.push(entry(
                format!("legacy:cache:{identity}"),
                format!("Old WebKit cache: {identity}"),
                &cache,
                "cache",
                "obsolete",
                "Regenerable network cache; safe to remove after review.",
            ));
        }
        let app_data = app_support_root().join(&identity);
        if app_data.exists() {
            entries.push(entry(
                format!("legacy:data:{identity}"),
                format!("Old application data: {identity}"),
                &app_data,
                "data",
                "legacy",
                "Older app-data folder. Missing canonical indexes are migrated at startup; reviewed leftovers remain here.",
            ));
        }
    }

    let temp_webkit = std::env::temp_dir().join("maxplorer").join("WebKit");
    if temp_webkit.exists() {
        entries.push(entry(
            "legacy:temp-webkit",
            "Temporary WebKit profile",
            &temp_webkit,
            "cache",
            "obsolete",
            "Temporary development WebKit data; safe to remove.",
        ));
    }
    let temp_search = std::env::temp_dir().join("maxplorer-search");
    if temp_search.exists() {
        entries.push(entry(
            "legacy:temp-search",
            "Temporary search index",
            &temp_search,
            "data",
            "legacy",
            "Fallback index from a previous launch; migrate it if the canonical index is missing.",
        ));
    }

    let total_bytes = entries.iter().map(|entry| entry.bytes).sum();
    let active_bytes = entries
        .iter()
        .filter(|entry| entry.status == "active")
        .map(|entry| entry.bytes)
        .sum();
    let legacy_bytes = entries
        .iter()
        .filter(|entry| entry.status == "legacy")
        .map(|entry| entry.bytes)
        .sum();
    let reclaimable_bytes = entries
        .iter()
        .filter(|entry| entry.status == "obsolete")
        .map(|entry| entry.bytes)
        .sum();
    let legacy_count = entries
        .iter()
        .filter(|entry| entry.status != "active")
        .count();

    let mut recommendations = Vec::new();
    if legacy_count == 0 {
        recommendations.push("No duplicate MAXplorer storage was found.".to_string());
    } else {
        recommendations.push(
            "Archive old WebKit profiles and remove obsolete caches to consolidate storage."
                .to_string(),
        );
    }
    let search_bytes = entries
        .iter()
        .find(|entry| entry.id == "canonical:search")
        .map(|entry| entry.bytes)
        .unwrap_or(0);
    if search_bytes > 5 * 1024 * 1024 * 1024 {
        recommendations.push(
            "The search index is very large. Review indexed locations or rebuild the index if search coverage is broader than needed."
                .to_string(),
        );
    }
    let storage_bytes = entries
        .iter()
        .find(|entry| entry.id == "canonical:storage")
        .map(|entry| entry.bytes)
        .unwrap_or(0);
    if storage_bytes > 1024 * 1024 * 1024 {
        recommendations.push(
            "The Storage Analyzer cache is large but regenerable. Clear it from Storage Analyzer if disk space is needed."
                .to_string(),
        );
    }

    StorageAudit {
        data_root: data_root.to_string_lossy().to_string(),
        entries,
        total_bytes,
        active_bytes,
        legacy_bytes,
        reclaimable_bytes,
        legacy_count,
        recommendations,
    }
}

/// Archive legacy user settings and remove regenerable old caches. Callers must
/// pass `confirmed = true` after showing the audit to the user.
pub fn cleanup(
    data_root: &Path,
    current_identifier: &str,
    confirmed: bool,
) -> Result<StorageCleanupResult, AppError> {
    if !confirmed {
        return Err(AppError::invalid(
            "Confirm the storage cleanup after reviewing the audit.",
        ));
    }
    let mut result = StorageCleanupResult {
        archived: Vec::new(),
        removed_caches: Vec::new(),
        migrated: Vec::new(),
        skipped: Vec::new(),
        failures: Vec::new(),
        reclaimed_bytes: 0,
    };

    // Reuse any missing canonical data first.
    result.migrated = migrate_legacy_app_data(data_root, current_identifier);

    let archive = unique_archive_root(data_root);
    let mut archive_started = false;
    for identity in legacy_identities(current_identifier) {
        let webkit = webkit_root().join(&identity);
        if webkit.exists() {
            if !archive_started {
                if let Err(error) = write_archive_readme(&archive) {
                    result.failures.push(format!(
                        "Could not create archive {}: {error}",
                        archive.display()
                    ));
                    continue;
                }
                archive_started = true;
            }
            let destination = archive.join("WebKit").join(&identity);
            match move_path(&webkit, &destination) {
                Ok(()) => result.archived.push(destination.to_string_lossy().to_string()),
                Err(error) => result.failures.push(format!(
                    "Could not archive {}: {error}",
                    webkit.display()
                )),
            }
        }

        let cache = caches_root().join(&identity);
        if cache.exists() {
            let (bytes, _) = measure(&cache);
            match fs::remove_dir_all(&cache) {
                Ok(()) => {
                    result.reclaimed_bytes = result.reclaimed_bytes.saturating_add(bytes);
                    result.removed_caches.push(cache.to_string_lossy().to_string());
                }
                Err(error) => result.failures.push(format!(
                    "Could not remove cache {}: {error}",
                    cache.display()
                )),
            }
        }

        let app_data = app_support_root().join(&identity);
        if app_data.exists() {
            let has_index = app_data.join("search").join("index.sqlite3").exists()
                || app_data.join("storage").join("cache.sqlite3").exists();
            if has_index {
                result.skipped.push(format!(
                    "{} is retained for review because it may contain a second copy of an index.",
                    app_data.display()
                ));
            } else {
                if !archive_started {
                    if let Err(error) = write_archive_readme(&archive) {
                        result.failures.push(format!(
                            "Could not create archive {}: {error}",
                            archive.display()
                        ));
                        continue;
                    }
                    archive_started = true;
                }
                let destination = archive.join("Application Support").join(&identity);
                match move_path(&app_data, &destination) {
                    Ok(()) => result
                        .archived
                        .push(destination.to_string_lossy().to_string()),
                    Err(error) => result.failures.push(format!(
                        "Could not archive {}: {error}",
                        app_data.display()
                    )),
                }
            }
        }
    }

    let temp_webkit = std::env::temp_dir().join("maxplorer").join("WebKit");
    if temp_webkit.exists() {
        let (bytes, _) = measure(&temp_webkit);
        match fs::remove_dir_all(&temp_webkit) {
            Ok(()) => {
                result.reclaimed_bytes = result.reclaimed_bytes.saturating_add(bytes);
                result.removed_caches.push(temp_webkit.to_string_lossy().to_string());
            }
            Err(error) => result.failures.push(format!(
                "Could not remove temporary WebKit data {}: {error}",
                temp_webkit.display()
            )),
        }
    }

    let temp_search = std::env::temp_dir().join("maxplorer-search");
    if temp_search.exists() {
        result.skipped.push(format!(
            "{} is retained because a fallback index may contain recoverable search data.",
            temp_search.display()
        ));
    }

    if archive_started {
        crate::logging::info(
            "storage.cleanup",
            format!(
                "archived legacy WebKit data at {}; removed {} cache folder(s), reclaimed {} bytes",
                archive.display(),
                result.removed_caches.len(),
                result.reclaimed_bytes
            ),
        );
    }
    Ok(result)
}
