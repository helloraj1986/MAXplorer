use crate::error::AppError;
use crate::paths::system_time_ms;
use crate::types::{DirectoryListing, Entry};
use std::fs;
use std::path::Path;

pub const MAX_DIRECTORY_ENTRIES: usize = 50_000;

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
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

pub fn entry_from_path(path: &Path) -> Result<Entry, AppError> {
    let link_metadata = fs::symlink_metadata(path).map_err(|error| {
        let mapped = AppError::from(error);
        mapped.with_path(path.to_string_lossy())
    })?;
    let is_symlink = link_metadata.file_type().is_symlink();
    let target_metadata = if is_symlink {
        fs::metadata(path).ok()
    } else {
        None
    };
    let metadata = target_metadata.as_ref().unwrap_or(&link_metadata);
    let is_dir = metadata.is_dir();
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let target = if is_symlink {
        fs::read_link(path)
            .ok()
            .map(|value| value.to_string_lossy().to_string())
    } else {
        None
    };
    let extension = if is_dir {
        None
    } else {
        path.extension()
            .map(|value| value.to_string_lossy().to_lowercase())
    };
    Ok(Entry {
        name: name.clone(),
        path: path.to_string_lossy().to_string(),
        is_dir,
        is_symlink,
        size: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
        modified: system_time_ms(metadata.modified()),
        created: system_time_ms(metadata.created()),
        accessed: system_time_ms(metadata.accessed()),
        extension,
        is_hidden: is_hidden_name(&name) || metadata_hidden(&link_metadata),
        is_read_only: metadata.permissions().readonly(),
        target,
    })
}

pub fn list_directory(path: &Path, show_hidden: bool) -> Result<DirectoryListing, AppError> {
    let metadata = fs::metadata(path).map_err(|error| {
        let mapped = AppError::from(error);
        mapped.with_path(path.to_string_lossy())
    })?;
    if !metadata.is_dir() {
        return Err(AppError::new(
            "not_a_directory",
            "This path is not a folder.",
            Some(path.to_string_lossy().to_string()),
        ));
    }
    let reader = fs::read_dir(path).map_err(|error| {
        let mapped = AppError::from(error);
        mapped.with_path(path.to_string_lossy())
    })?;
    let mut entries = Vec::new();
    let mut truncated = false;
    let mut read_errors = 0u32;
    for item in reader {
        if entries.len() >= MAX_DIRECTORY_ENTRIES {
            truncated = true;
            break;
        }
        let item = match item {
            Ok(item) => item,
            Err(_) => {
                read_errors += 1;
                continue;
            }
        };
        let item_path = item.path();
        match entry_from_path(&item_path) {
            Ok(entry) => {
                if show_hidden || !entry.is_hidden {
                    entries.push(entry);
                }
            }
            Err(_) => {
                read_errors += 1;
            }
        }
    }
    Ok(DirectoryListing {
        path: path.to_string_lossy().to_string(),
        entries,
        truncated,
        read_errors,
    })
}
