use crate::error::AppError;
use crate::listing::entry_from_path;
use crate::paths::{
    is_same_or_descendant, reject_unsafe_destruction, unique_copy_name, unique_destination,
    validate_name,
};
use crate::types::{ConflictPolicy, Entry, OperationResult};
use std::fs;
use std::path::{Path, PathBuf};

fn ensure_directory(path: &Path) -> Result<(), AppError> {
    let metadata = fs::metadata(path).map_err(|error| {
        let mapped = AppError::from(error);
        mapped.with_path(path.to_string_lossy())
    })?;
    if !metadata.is_dir() {
        return Err(AppError::new(
            "not_a_directory",
            "The destination is not a folder.",
            Some(path.to_string_lossy().to_string()),
        ));
    }
    Ok(())
}

fn remove_existing(path: &Path) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path).map_err(AppError::from)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(AppError::from)
    } else {
        fs::remove_file(path).map_err(AppError::from)
    }
}

fn prepare_destination(
    source: &Path,
    destination_directory: &Path,
    policy: ConflictPolicy,
) -> Result<Option<PathBuf>, AppError> {
    let name = source
        .file_name()
        .ok_or_else(|| AppError::invalid("The selected item has no name."))?;
    let destination = destination_directory.join(name);
    if !destination.exists() {
        return Ok(Some(destination));
    }
    match policy {
        ConflictPolicy::Error => Err(AppError::already_exists(destination.to_string_lossy())),
        ConflictPolicy::Skip => Ok(None),
        ConflictPolicy::Rename => Ok(Some(unique_destination(
            destination_directory,
            &name.to_string_lossy(),
        ))),
        ConflictPolicy::Replace => Ok(Some(destination)),
    }
}

fn create_symlink_at(target: &Path, link: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).map_err(AppError::from)
    }
    #[cfg(windows)]
    {
        let target_is_dir = fs::metadata(target)
            .map(|meta| meta.is_dir())
            .unwrap_or(false);
        if target_is_dir {
            std::os::windows::fs::symlink_dir(target, link).map_err(AppError::from)
        } else {
            std::os::windows::fs::symlink_file(target, link).map_err(AppError::from)
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, link);
        Err(AppError::new(
            "unsupported",
            "Symbolic links are not supported on this platform.",
            None,
        ))
    }
}

fn copy_one(source: &Path, destination: &Path, policy: ConflictPolicy) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(source).map_err(AppError::from)?;
    if metadata.file_type().is_symlink() {
        if destination.exists() {
            if matches!(policy, ConflictPolicy::Skip) {
                return Ok(());
            }
            remove_existing(destination)?;
        }
        let target = fs::read_link(source).map_err(AppError::from)?;
        return create_symlink_at(&target, destination);
    }
    if metadata.is_dir() {
        if destination.exists() {
            let destination_metadata = fs::metadata(destination).map_err(AppError::from)?;
            if !destination_metadata.is_dir() {
                return Err(AppError::new(
                    "type_mismatch",
                    "A file with this name already exists in the destination.",
                    Some(destination.to_string_lossy().to_string()),
                ));
            }
            if matches!(policy, ConflictPolicy::Skip) {
                return Ok(());
            }
            // Replace means merge for folders, matching Explorer's merge prompt.
        } else {
            fs::create_dir_all(destination).map_err(AppError::from)?;
        }
        let reader = fs::read_dir(source).map_err(AppError::from)?;
        for item in reader {
            let item = item.map_err(AppError::from)?;
            let child_destination = destination.join(item.file_name());
            copy_one(&item.path(), &child_destination, ConflictPolicy::Replace)?;
        }
        return Ok(());
    }
    if destination.exists() {
        if matches!(policy, ConflictPolicy::Skip) {
            return Ok(());
        }
        let destination_metadata = fs::symlink_metadata(destination).map_err(AppError::from)?;
        if destination_metadata.is_dir() && !destination_metadata.file_type().is_symlink() {
            return Err(AppError::new(
                "type_mismatch",
                "A folder with this name already exists in the destination.",
                Some(destination.to_string_lossy().to_string()),
            ));
        }
        remove_existing(destination)?;
    }
    fs::copy(source, destination).map_err(AppError::from)?;
    let permissions = metadata.permissions();
    let _ = fs::set_permissions(destination, permissions);
    Ok(())
}

fn move_one(source: &Path, destination: &Path) -> Result<(), AppError> {
    if destination.exists() {
        return Err(AppError::already_exists(destination.to_string_lossy()));
    }
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(error) => {
            // EXDEV on Unix, ERROR_NOT_SAME_DEVICE on Windows: fall back to copy + delete.
            let cross_device = matches!(error.raw_os_error(), Some(18) | Some(17));
            if !cross_device {
                return Err(AppError::from(error));
            }
            copy_one(source, destination, ConflictPolicy::Error)?;
            let metadata = fs::symlink_metadata(source).map_err(AppError::from)?;
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                fs::remove_dir_all(source).map_err(AppError::from)?;
            } else {
                fs::remove_file(source).map_err(AppError::from)?;
            }
            Ok(())
        }
    }
}

pub fn create_folder(parent: &Path, name: &str) -> Result<Entry, AppError> {
    ensure_directory(parent)?;
    let name = validate_name(name)?;
    let destination = parent.join(&name);
    if destination.exists() {
        return Err(AppError::already_exists(destination.to_string_lossy()));
    }
    fs::create_dir(&destination).map_err(AppError::from)?;
    entry_from_path(&destination)
}

pub fn create_text_file(parent: &Path, name: &str, contents: &str) -> Result<Entry, AppError> {
    ensure_directory(parent)?;
    let name = validate_name(name)?;
    let destination = parent.join(&name);
    if destination.exists() {
        return Err(AppError::already_exists(destination.to_string_lossy()));
    }
    fs::write(&destination, contents).map_err(AppError::from)?;
    entry_from_path(&destination)
}

pub fn create_symlink(parent: &Path, name: &str, target: &Path) -> Result<Entry, AppError> {
    ensure_directory(parent)?;
    let name = validate_name(name)?;
    let destination = parent.join(&name);
    if destination.exists() {
        return Err(AppError::already_exists(destination.to_string_lossy()));
    }
    create_symlink_at(target, &destination)?;
    entry_from_path(&destination)
}

pub fn rename_path(path: &Path, new_name: &str) -> Result<String, AppError> {
    let new_name = validate_name(new_name)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid("This item can't be renamed."))?;
    let destination = parent.join(&new_name);
    if destination == path {
        return Ok(path.to_string_lossy().to_string());
    }
    if destination.exists() {
        return Err(AppError::already_exists(destination.to_string_lossy()));
    }
    fs::rename(path, &destination).map_err(AppError::from)?;
    Ok(destination.to_string_lossy().to_string())
}

pub fn copy_paths(
    paths: &[PathBuf],
    destination_directory: &Path,
    policy: ConflictPolicy,
) -> Vec<OperationResult> {
    let mut results = Vec::new();
    if let Err(error) = ensure_directory(destination_directory) {
        return paths
            .iter()
            .map(|path| OperationResult::failed(&path.to_string_lossy(), error.message.clone()))
            .collect();
    }
    for source in paths {
        let source_display = source.to_string_lossy().to_string();
        if source.is_dir() && is_same_or_descendant(source, destination_directory) {
            results.push(OperationResult::failed(
                &source_display,
                "A folder can't be copied into itself.".to_string(),
            ));
            continue;
        }
        match prepare_destination(source, destination_directory, policy) {
            Ok(Some(destination)) => {
                if destination == *source {
                    results.push(OperationResult::failed(
                        &source_display,
                        "The source and destination are the same item.".to_string(),
                    ));
                    continue;
                }
                match copy_one(source, &destination, policy) {
                    Ok(()) => {
                        results.push(OperationResult::completed(&source_display, &destination))
                    }
                    Err(error) => {
                        results.push(OperationResult::failed(&source_display, error.message))
                    }
                }
            }
            Ok(None) => results.push(OperationResult::skipped(&source_display)),
            Err(error) => results.push(OperationResult::failed(&source_display, error.message)),
        }
    }
    results
}

pub fn move_paths(
    paths: &[PathBuf],
    destination_directory: &Path,
    policy: ConflictPolicy,
) -> Vec<OperationResult> {
    let mut results = Vec::new();
    if let Err(error) = ensure_directory(destination_directory) {
        return paths
            .iter()
            .map(|path| OperationResult::failed(&path.to_string_lossy(), error.message.clone()))
            .collect();
    }
    for source in paths {
        let source_display = source.to_string_lossy().to_string();
        if source.is_dir() && is_same_or_descendant(source, destination_directory) {
            results.push(OperationResult::failed(
                &source_display,
                "A folder can't be moved into itself.".to_string(),
            ));
            continue;
        }
        match prepare_destination(source, destination_directory, policy) {
            Ok(Some(destination)) => {
                if destination == *source {
                    results.push(OperationResult::skipped(&source_display));
                    continue;
                }
                if destination.exists() {
                    let destination_metadata = match fs::symlink_metadata(&destination) {
                        Ok(metadata) => metadata,
                        Err(error) => {
                            results
                                .push(OperationResult::failed(&source_display, error.to_string()));
                            continue;
                        }
                    };
                    let source_metadata = match fs::symlink_metadata(source) {
                        Ok(metadata) => metadata,
                        Err(error) => {
                            results
                                .push(OperationResult::failed(&source_display, error.to_string()));
                            continue;
                        }
                    };
                    if source_metadata.is_dir()
                        && destination_metadata.is_dir()
                        && !destination_metadata.file_type().is_symlink()
                    {
                        results.push(OperationResult::failed(
                            &source_display,
                            "Folders can't be replaced by a move. Choose Keep both instead."
                                .to_string(),
                        ));
                        continue;
                    }
                    if matches!(policy, ConflictPolicy::Replace) {
                        if let Err(error) = remove_existing(&destination) {
                            results.push(OperationResult::failed(&source_display, error.message));
                            continue;
                        }
                    }
                }
                match move_one(source, &destination) {
                    Ok(()) => {
                        results.push(OperationResult::completed(&source_display, &destination))
                    }
                    Err(error) => {
                        results.push(OperationResult::failed(&source_display, error.message))
                    }
                }
            }
            Ok(None) => results.push(OperationResult::skipped(&source_display)),
            Err(error) => results.push(OperationResult::failed(&source_display, error.message)),
        }
    }
    results
}

pub fn delete_paths(paths: &[PathBuf], permanent: bool) -> Vec<OperationResult> {
    let mut results = Vec::new();
    for path in paths {
        let display = path.to_string_lossy().to_string();
        if let Err(error) = reject_unsafe_destruction(path) {
            results.push(OperationResult::failed(&display, error.message));
            continue;
        }
        if permanent {
            let metadata = match fs::symlink_metadata(path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    results.push(OperationResult::failed(&display, error.to_string()));
                    continue;
                }
            };
            let result = if metadata.is_dir() && !metadata.file_type().is_symlink() {
                fs::remove_dir_all(path)
            } else {
                fs::remove_file(path)
            };
            match result {
                Ok(()) => results.push(OperationResult::completed(&display, path)),
                Err(error) => results.push(OperationResult::failed(&display, error.to_string())),
            }
        } else {
            match trash::delete(path) {
                Ok(()) => results.push(OperationResult::completed(&display, Path::new("Trash"))),
                Err(error) => results.push(OperationResult::failed(&display, error.to_string())),
            }
        }
    }
    results
}

pub fn duplicate_paths(paths: &[PathBuf]) -> Vec<OperationResult> {
    let mut results = Vec::new();
    for source in paths {
        let display = source.to_string_lossy().to_string();
        let parent = match source.parent() {
            Some(parent) => parent,
            None => {
                results.push(OperationResult::failed(
                    &display,
                    "This item can't be duplicated.".to_string(),
                ));
                continue;
            }
        };
        let name = source
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "item".to_string());
        let destination = unique_copy_name(parent, &name);
        match copy_one(source, &destination, ConflictPolicy::Error) {
            Ok(()) => results.push(OperationResult::completed(&display, &destination)),
            Err(error) => results.push(OperationResult::failed(&display, error.message)),
        }
    }
    results
}
