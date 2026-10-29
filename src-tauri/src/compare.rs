use crate::error::AppError;
use crate::listing::list_directory;
use crate::paths::normalize_path;
use crate::types::{ComparisonEntry, ComparisonProgress, FolderComparison};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const COMPARE_CHUNK: usize = 256 * 1024;

#[derive(Default)]
pub struct CompareState {
    pub cancels: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

fn cancelled_error() -> AppError {
    AppError::new("cancelled", "The folder comparison was cancelled.", None)
}

fn files_equal(left: &Path, right: &Path, cancel: &AtomicBool) -> Result<bool, AppError> {
    let mut left_file = File::open(left).map_err(AppError::from)?;
    let mut right_file = File::open(right).map_err(AppError::from)?;
    let mut left_buffer = vec![0u8; COMPARE_CHUNK];
    let mut right_buffer = vec![0u8; COMPARE_CHUNK];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(cancelled_error());
        }
        let left_read = left_file.read(&mut left_buffer).map_err(AppError::from)?;
        let right_read = right_file.read(&mut right_buffer).map_err(AppError::from)?;
        if left_read != right_read {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
        if left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
    }
}

fn build_comparison(
    left_normalized: &Path,
    right_normalized: &Path,
    verify_content: bool,
    cancel: &AtomicBool,
    request_id: u64,
    mut progress: impl FnMut(ComparisonProgress),
) -> Result<FolderComparison, AppError> {
    let left_listing = list_directory(left_normalized, false)?;
    let right_listing = list_directory(right_normalized, false)?;
    let mut errors = left_listing.read_errors + right_listing.read_errors;

    let mut left_by_name = HashMap::new();
    for entry in left_listing.entries {
        left_by_name.insert(entry.name.clone(), entry);
    }
    let mut right_by_name = HashMap::new();
    for entry in right_listing.entries {
        right_by_name.insert(entry.name.clone(), entry);
    }

    let mut names: Vec<String> = left_by_name
        .keys()
        .chain(right_by_name.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    names.sort();

    let total = names.len() as u64;
    let mut entries = Vec::with_capacity(names.len());
    let mut left_only = 0u64;
    let mut right_only = 0u64;
    let mut different = 0u64;
    let mut identical = 0u64;
    let mut content_verified = 0u64;
    let mut scanned = 0u64;
    let mut last_emit = Instant::now();

    for name in names {
        if cancel.load(Ordering::Relaxed) {
            progress(ComparisonProgress {
                request_id,
                scanned,
                total,
                current: None,
                cancelled: true,
            });
            return Ok(FolderComparison {
                left: left_normalized.to_string_lossy().to_string(),
                right: right_normalized.to_string_lossy().to_string(),
                entries,
                left_only,
                right_only,
                different,
                identical,
                content_verified,
                cancelled: true,
                scanned,
                errors,
            });
        }
        let left_entry = left_by_name.remove(&name);
        let right_entry = right_by_name.remove(&name);
        let is_dir = match (&left_entry, &right_entry) {
            (Some(left), Some(right)) => left.is_dir || right.is_dir,
            (Some(left), None) => left.is_dir,
            (None, Some(right)) => right.is_dir,
            (None, None) => false,
        };
        let left_size = left_entry.as_ref().and_then(|entry| entry.size);
        let right_size = right_entry.as_ref().and_then(|entry| entry.size);
        let size_differs = !is_dir
            && left_size.is_some()
            && right_size.is_some()
            && left_size != right_size;
        let modified_differs = left_entry
            .as_ref()
            .and_then(|entry| entry.modified)
            .zip(right_entry.as_ref().and_then(|entry| entry.modified))
            .map(|(left, right)| left != right)
            .unwrap_or(false);

        let mut content_equal = None;
        if verify_content && !is_dir {
            if let (Some(left), Some(right)) = (&left_entry, &right_entry) {
                if size_differs {
                    content_equal = Some(false);
                } else if !left.is_symlink && !right.is_symlink {
                    match files_equal(Path::new(&left.path), Path::new(&right.path), cancel) {
                        Ok(equal) => {
                            content_equal = Some(equal);
                            content_verified += 1;
                        }
                        Err(error) if error.code == "cancelled" => {
                            progress(ComparisonProgress {
                                request_id,
                                scanned,
                                total,
                                current: Some(name.clone()),
                                cancelled: true,
                            });
                            return Ok(FolderComparison {
                                left: left_normalized.to_string_lossy().to_string(),
                                right: right_normalized.to_string_lossy().to_string(),
                                entries,
                                left_only,
                                right_only,
                                different,
                                identical,
                                content_verified,
                                cancelled: true,
                                scanned,
                                errors,
                            });
                        }
                        Err(_) => {
                            errors += 1;
                        }
                    }
                }
            }
        }

        if left_entry.is_some() && right_entry.is_none() {
            left_only += 1;
        } else if right_entry.is_some() && left_entry.is_none() {
            right_only += 1;
        } else if size_differs || modified_differs || content_equal == Some(false) {
            different += 1;
        } else {
            identical += 1;
        }

        entries.push(ComparisonEntry {
            name: name.clone(),
            left_path: left_entry.as_ref().map(|entry| entry.path.clone()),
            right_path: right_entry.as_ref().map(|entry| entry.path.clone()),
            left_size,
            right_size,
            left_modified: left_entry.as_ref().and_then(|entry| entry.modified),
            right_modified: right_entry.as_ref().and_then(|entry| entry.modified),
            is_dir,
            size_differs,
            modified_differs,
            content_equal,
        });
        scanned += 1;

        if last_emit.elapsed() >= Duration::from_millis(120) {
            progress(ComparisonProgress {
                request_id,
                scanned,
                total,
                current: Some(name),
                cancelled: false,
            });
            last_emit = Instant::now();
        }
    }

    progress(ComparisonProgress {
        request_id,
        scanned,
        total,
        current: None,
        cancelled: false,
    });

    Ok(FolderComparison {
        left: left_normalized.to_string_lossy().to_string(),
        right: right_normalized.to_string_lossy().to_string(),
        entries,
        left_only,
        right_only,
        different,
        identical,
        content_verified,
        cancelled: false,
        scanned,
        errors,
    })
}

pub fn compare_folders(
    app: AppHandle,
    left: &Path,
    right: &Path,
    verify_content: bool,
    request_id: u64,
    cancel: Arc<AtomicBool>,
) -> Result<FolderComparison, AppError> {
    let left_normalized = normalize_path(&left.to_string_lossy())?;
    let right_normalized = normalize_path(&right.to_string_lossy())?;
    build_comparison(
        &left_normalized,
        &right_normalized,
        verify_content,
        &cancel,
        request_id,
        |payload| {
            let _ = app.emit("compare-progress", payload);
        },
    )
}

/// Testable comparison entry point. No Tauri handle is required, and no
/// filesystem mutation is performed.
#[cfg(test)]
pub fn compare_paths(
    left: &Path,
    right: &Path,
    verify_content: bool,
) -> Result<FolderComparison, AppError> {
    let left_normalized = normalize_path(&left.to_string_lossy())?;
    let right_normalized = normalize_path(&right.to_string_lossy())?;
    build_comparison(
        &left_normalized,
        &right_normalized,
        verify_content,
        &AtomicBool::new(false),
        0,
        |_| {},
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::fs::{File, FileTimes};
    use std::time::{Duration, SystemTime};
    use tempfile::tempdir;

    fn entry<'a>(comparison: &'a FolderComparison, name: &str) -> &'a ComparisonEntry {
        comparison
            .entries
            .iter()
            .find(|entry| entry.name == name)
            .unwrap_or_else(|| panic!("missing comparison entry {name}"))
    }

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let workspace = tempdir().unwrap();
        let left = workspace.path().join("left");
        let right = workspace.path().join("right");
        fs::create_dir_all(left.join("shared-dir")).unwrap();
        fs::create_dir_all(right.join("shared-dir")).unwrap();
        fs::write(left.join("same.txt"), "same").unwrap();
        fs::write(right.join("same.txt"), "same").unwrap();
        fs::write(left.join("left-only.txt"), "left").unwrap();
        fs::write(right.join("right-only.txt"), "right").unwrap();
        fs::write(left.join("size.txt"), "short").unwrap();
        fs::write(right.join("size.txt"), "much longer").unwrap();
        fs::write(left.join("content.txt"), "aaaa").unwrap();
        fs::write(right.join("content.txt"), "bbbb").unwrap();
        fs::write(left.join("shared-dir/nested.txt"), "nested").unwrap();
        fs::write(right.join("shared-dir/nested.txt"), "nested").unwrap();

        // File timestamps have sub-millisecond precision on APFS, so paired
        // files created in sequence would otherwise differ by metadata alone.
        // Pin the paired timestamps to make every category deterministic.
        let stamp = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        for relative in ["same.txt", "size.txt", "content.txt", "shared-dir"] {
            for root in [&left, &right] {
                let file = File::open(root.join(relative)).unwrap();
                file.set_times(FileTimes::new().set_modified(stamp)).unwrap();
            }
        }
        (workspace, left, right)
    }

    #[test]
    fn compares_names_sizes_and_directories_without_mutating_files() {
        let (_workspace, left, right) = fixture();
        let before = fs::read(left.join("content.txt")).unwrap();

        let comparison = compare_paths(&left, &right, false).unwrap();

        assert!(!comparison.cancelled);
        assert_eq!(comparison.left_only, 1);
        assert_eq!(comparison.right_only, 1);
        assert_eq!(comparison.different, 1);
        assert_eq!(comparison.identical, 3);
        assert_eq!(comparison.entries.len(), 6);
        assert_eq!(comparison.content_verified, 0);

        let left_only = entry(&comparison, "left-only.txt");
        assert!(left_only.left_path.is_some());
        assert!(left_only.right_path.is_none());
        let right_only = entry(&comparison, "right-only.txt");
        assert!(right_only.right_path.is_some());
        assert!(right_only.left_path.is_none());
        let size = entry(&comparison, "size.txt");
        assert!(size.size_differs);
        assert_eq!(size.content_equal, None);
        let shared_dir = entry(&comparison, "shared-dir");
        assert!(shared_dir.is_dir);
        assert!(!shared_dir.size_differs);

        assert_eq!(fs::read(left.join("content.txt")).unwrap(), before);
        assert_eq!(fs::read(right.join("content.txt")).unwrap(), b"bbbb");
    }

    #[test]
    fn verifies_content_only_when_requested() {
        let (_workspace, left, right) = fixture();

        let comparison = compare_paths(&left, &right, true).unwrap();

        let content = entry(&comparison, "content.txt");
        assert_eq!(content.content_equal, Some(false));
        assert!(!content.size_differs);
        assert!(comparison.different >= 2);
        assert!(comparison.content_verified >= 2);

        let same = entry(&comparison, "same.txt");
        assert_eq!(same.content_equal, Some(true));
        let nested = entry(&comparison, "shared-dir");
        assert_eq!(nested.content_equal, None);
    }

    #[test]
    fn normalizes_paths_and_reports_missing_folders() {
        let (_workspace, left, right) = fixture();
        let trailing = format!("{}/", left.to_string_lossy());
        let comparison = compare_paths(Path::new(&trailing), &right, false).unwrap();
        assert_eq!(
            comparison.left.trim_end_matches('/'),
            left.to_string_lossy()
        );

        let missing = left.join("does-not-exist");
        assert!(compare_paths(&missing, &right, false).is_err());
    }
}
