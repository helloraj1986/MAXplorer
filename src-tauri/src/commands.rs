use crate::app_icons;
use crate::compare::{self, CompareState};
use crate::error::AppError;
use crate::listing;
use crate::metadata;
use crate::network_discovery::{self, NetworkComputer};
use crate::network_mount;
use crate::operations;
use crate::paths::{expand_user, home_dir, normalize_path, parent_path};
use crate::search::model::{DuplicateRequest, DuplicateResponse, IndexError, IndexStatus, SearchRequest, SearchResponse, SearchSuggestion};
use crate::search::{self, SearchService};
use crate::storage_maintenance::{self, StorageAudit, StorageCleanupResult};
use crate::transfer::{self, TransferControl, TransferState};
use crate::types::{
    ApplicationInfo, ConflictPolicy, DirectoryListing, FolderComparison, FolderStats, Location,
    OperationResult, PlatformInfo, Properties, SearchResult, TextPreview, TransferOutcome,
    TransferRequest,
};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

async fn blocking<T, F>(work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| {
            AppError::new("internal", format!("Background task failed: {error}"), None)
        })?
}

fn operation_paths(raw: Vec<String>) -> (Vec<PathBuf>, Vec<OperationResult>) {
    let mut paths = Vec::new();
    let mut failures = Vec::new();
    for value in raw {
        let expanded = expand_user(&value);
        let path = PathBuf::from(&expanded);
        if !path.is_absolute() {
            failures.push(OperationResult::failed(
                &value,
                "The path must be absolute.".to_string(),
            ));
            continue;
        }
        paths.push(path);
    }
    (paths, failures)
}

#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    metadata::platform_info()
}

#[tauri::command]
pub async fn get_sidebar_locations() -> Result<Vec<Location>, AppError> {
    blocking(|| Ok(metadata::sidebar_locations())).await
}

#[tauri::command]
pub async fn get_storage_audit(app: tauri::AppHandle) -> Result<StorageAudit, AppError> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::new("storage", error.to_string(), None))?;
    let identifier = app.config().identifier.clone();
    blocking(move || Ok(storage_maintenance::audit(&data_directory, &identifier))).await
}

#[tauri::command]
pub async fn cleanup_legacy_storage(
    app: tauri::AppHandle,
    confirm: bool,
) -> Result<StorageCleanupResult, AppError> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::new("storage", error.to_string(), None))?;
    let identifier = app.config().identifier.clone();
    blocking(move || {
        storage_maintenance::cleanup(&data_directory, &identifier, confirm)
    })
    .await
}

#[tauri::command]
pub fn get_initial_path() -> Option<String> {
    if let Ok(value) = std::env::var("WIN11_EXPLORER_START_PATH") {
        if !value.trim().is_empty() {
            return Some(value);
        }
    }
    std::env::args().skip(1).find(|argument| {
        !argument.starts_with('-')
            && Path::new(argument).is_absolute()
            && Path::new(argument).exists()
    })
}

#[tauri::command]
pub fn resolve_path(path: String) -> Result<String, AppError> {
    let normalized = normalize_path(&path)?;
    Ok(normalized.to_string_lossy().to_string())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&expand_user(&path)).exists()
}

#[tauri::command]
pub async fn list_directory(path: String, show_hidden: bool) -> Result<DirectoryListing, AppError> {
    let normalized = normalize_path(&path)?;
    blocking(move || listing::list_directory(&normalized, show_hidden)).await
}

#[tauri::command]
pub async fn search_files(
    state: State<'_, SearchService>,
    root: String,
    query: String,
    show_hidden: bool,
    max_results: usize,
    request_id: u64,
) -> Result<SearchResult, AppError> {
    let normalized = normalize_path(&root)?;
    let service = state.inner().clone();
    let cancel = service.register_cancel(request_id);
    let result = blocking(move || {
        search::legacy_search_files(&normalized, &query, show_hidden, max_results, cancel)
    })
    .await;
    service.remove_cancel(request_id);
    result
}

#[tauri::command]
pub async fn universal_search(
    app: tauri::AppHandle,
    state: State<'_, SearchService>,
    request: SearchRequest,
) -> Result<SearchResponse, AppError> {
    let service = state.inner().clone();
    let query_id = request.query_id;
    tauri::async_runtime::spawn_blocking(move || {
        service.run_search_with_progress(request, &|progress| {
            if progress.query_id == query_id {
                let _ = app.emit("search-progress", progress);
            }
        })
    })
    .await
    .map_err(|error| {
        AppError::new("internal", format!("Search task failed: {error}"), None)
    })?
}

#[tauri::command]
pub async fn find_duplicates(
    state: State<'_, SearchService>,
    request: DuplicateRequest,
) -> Result<DuplicateResponse, AppError> {
    let service = state.inner().clone();
    blocking(move || service.find_duplicates(request)).await
}

#[tauri::command]
pub async fn search_suggestions(
    state: State<'_, SearchService>,
    prefix: String,
    limit: usize,
) -> Result<Vec<SearchSuggestion>, AppError> {
    let service = state.inner().clone();
    let limit = limit.clamp(1, 20);
    blocking(move || Ok(service.suggestions(&prefix, limit))).await
}

#[tauri::command]
pub async fn get_search_index_status(
    state: State<'_, SearchService>,
) -> Result<IndexStatus, AppError> {
    let service = state.inner().clone();
    blocking(move || Ok(service.status())).await
}

#[tauri::command]
pub async fn add_search_location(
    state: State<'_, SearchService>,
    path: String,
) -> Result<IndexStatus, AppError> {
    let normalized = normalize_path(&path)?;
    let service = state.inner().clone();
    blocking(move || {
        service.engine.add_location(&normalized.to_string_lossy())?;
        service.force_indexing_for(120_000);
        service.restart_indexer();
        Ok(service.status())
    })
    .await
}

#[tauri::command]
pub async fn remove_search_location(
    state: State<'_, SearchService>,
    path: String,
) -> Result<IndexStatus, AppError> {
    let service = state.inner().clone();
    blocking(move || {
        service.stop_indexer();
        service.engine.remove_location(&path)?;
        service.restart_indexer();
        Ok(service.status())
    })
    .await
}

#[tauri::command]
pub async fn set_search_index_paused(
    state: State<'_, SearchService>,
    paused: bool,
) -> Result<IndexStatus, AppError> {
    let service = state.inner().clone();
    blocking(move || {
        service.engine.set_paused(paused)?;
        if !paused {
            // Events received while paused are intentionally discarded. Marking
            // the locations partial makes the indexer reconcile them on resume
            // instead of waiting for the next periodic pass.
            for root in service.engine.enabled_roots() {
                let _ = service.engine.mark_location(&root, "partial", None);
            }
            service.force_indexing_for(120_000);
        }
        Ok(service.status())
    })
    .await
}

#[tauri::command]
pub async fn set_search_content_enabled(
    state: State<'_, SearchService>,
    enabled: bool,
) -> Result<IndexStatus, AppError> {
    let service = state.inner().clone();
    blocking(move || {
        service.engine.set_content_enabled(enabled)?;
        if enabled {
            service.force_indexing_for(120_000);
        }
        Ok(service.status())
    })
    .await
}

#[tauri::command]
pub async fn set_search_content_limit(
    state: State<'_, SearchService>,
    bytes: u64,
) -> Result<IndexStatus, AppError> {
    let service = state.inner().clone();
    blocking(move || {
        service.engine.set_max_content_bytes(bytes)?;
        Ok(service.status())
    })
    .await
}

#[tauri::command]
pub async fn rebuild_search_index(
    state: State<'_, SearchService>,
) -> Result<IndexStatus, AppError> {
    let service = state.inner().clone();
    blocking(move || {
        service.stop_indexer();
        service.engine.rebuild()?;
        service.force_indexing_for(120_000);
        service.restart_indexer();
        Ok(service.status())
    })
    .await
}

#[tauri::command]
pub async fn clear_search_index(
    state: State<'_, SearchService>,
) -> Result<IndexStatus, AppError> {
    let service = state.inner().clone();
    blocking(move || {
        service.stop_indexer();
        service.engine.clear_index()?;
        service.force_indexing_for(120_000);
        service.restart_indexer();
        Ok(service.status())
    })
    .await
}

#[tauri::command]
pub async fn retry_failed_extractions(
    state: State<'_, SearchService>,
) -> Result<IndexStatus, AppError> {
    let service = state.inner().clone();
    blocking(move || {
        service.engine.retry_failed()?;
        service.force_indexing_for(120_000);
        Ok(service.status())
    })
    .await
}

#[tauri::command]
pub async fn remove_search_path(
    state: State<'_, SearchService>,
    path: String,
) -> Result<(), AppError> {
    let service = state.inner().clone();
    blocking(move || service.engine.remove_path(&path)).await
}

#[tauri::command]
pub async fn get_index_errors(
    state: State<'_, SearchService>,
    limit: usize,
) -> Result<Vec<IndexError>, AppError> {
    let service = state.inner().clone();
    let limit = limit.clamp(1, 200);
    blocking(move || Ok(service.index_errors(limit))).await
}

#[tauri::command]
pub fn cancel_search(state: State<'_, SearchService>, request_id: u64) {
    state.cancel(request_id);
}

#[tauri::command]
pub async fn create_folder(parent: String, name: String) -> Result<crate::types::Entry, AppError> {
    let parent = normalize_path(&parent)?;
    blocking(move || operations::create_folder(&parent, &name)).await
}

#[tauri::command]
pub async fn create_text_file(
    parent: String,
    name: String,
    contents: Option<String>,
) -> Result<crate::types::Entry, AppError> {
    let parent = normalize_path(&parent)?;
    let contents = contents.unwrap_or_default();
    blocking(move || operations::create_text_file(&parent, &name, &contents)).await
}

#[tauri::command]
pub async fn create_symlink(
    parent: String,
    name: String,
    target: String,
) -> Result<crate::types::Entry, AppError> {
    let parent = normalize_path(&parent)?;
    let target = PathBuf::from(expand_user(&target));
    blocking(move || operations::create_symlink(&parent, &name, &target)).await
}

#[tauri::command]
pub async fn rename_path(path: String, new_name: String) -> Result<String, AppError> {
    let path = normalize_path(&path)?;
    blocking(move || operations::rename_path(&path, &new_name)).await
}

#[tauri::command]
pub async fn copy_paths(
    paths: Vec<String>,
    destination: String,
    conflict: ConflictPolicy,
) -> Result<Vec<OperationResult>, AppError> {
    let destination = normalize_path(&destination)?;
    let (paths, mut results) = operation_paths(paths);
    results.extend(
        blocking(move || Ok(operations::copy_paths(&paths, &destination, conflict))).await?,
    );
    Ok(results)
}

#[tauri::command]
pub async fn move_paths(
    paths: Vec<String>,
    destination: String,
    conflict: ConflictPolicy,
) -> Result<Vec<OperationResult>, AppError> {
    let destination = normalize_path(&destination)?;
    let (paths, mut results) = operation_paths(paths);
    results.extend(
        blocking(move || Ok(operations::move_paths(&paths, &destination, conflict))).await?,
    );
    Ok(results)
}

#[tauri::command]
pub async fn delete_paths(
    paths: Vec<String>,
    permanent: bool,
) -> Result<Vec<OperationResult>, AppError> {
    let (paths, mut results) = operation_paths(paths);
    results.extend(blocking(move || Ok(operations::delete_paths(&paths, permanent))).await?);
    Ok(results)
}

#[tauri::command]
pub async fn duplicate_paths(paths: Vec<String>) -> Result<Vec<OperationResult>, AppError> {
    let (paths, mut results) = operation_paths(paths);
    results.extend(blocking(move || Ok(operations::duplicate_paths(&paths))).await?);
    Ok(results)
}

#[tauri::command]
pub async fn transfer_paths(
    app: tauri::AppHandle,
    state: State<'_, TransferState>,
    request: TransferRequest,
) -> Result<TransferOutcome, AppError> {
    let id = request.id;
    let control = Arc::new(TransferControl::new());
    if let Ok(mut map) = state.controls.lock() {
        map.insert(id, control.clone());
    }
    let outcome = blocking(move || transfer::run_transfer(app, request, control)).await;
    if let Ok(mut map) = state.controls.lock() {
        map.remove(&id);
    }
    outcome
}

#[tauri::command]
pub fn cancel_transfer(state: State<'_, TransferState>, id: u64) {
    if let Ok(map) = state.controls.lock() {
        if let Some(control) = map.get(&id) {
            control.cancel();
        }
    }
}

#[tauri::command]
pub fn pause_transfer(state: State<'_, TransferState>, id: u64, paused: bool) {
    if let Ok(map) = state.controls.lock() {
        if let Some(control) = map.get(&id) {
            control.set_paused(paused);
        }
    }
}

#[tauri::command]
pub async fn compare_folders(
    app: tauri::AppHandle,
    state: State<'_, CompareState>,
    left: String,
    right: String,
    verify_content: bool,
    request_id: u64,
) -> Result<FolderComparison, AppError> {
    let left = normalize_path(&left)?;
    let right = normalize_path(&right)?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = state.cancels.lock() {
        map.insert(request_id, cancel.clone());
    }
    let result = blocking(move || {
        compare::compare_folders(app, &left, &right, verify_content, request_id, cancel)
    })
    .await;
    if let Ok(mut map) = state.cancels.lock() {
        map.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn cancel_compare(state: State<'_, CompareState>, request_id: u64) {
    if let Ok(map) = state.cancels.lock() {
        if let Some(cancel) = map.get(&request_id) {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub async fn get_properties(path: String) -> Result<Properties, AppError> {
    let path = normalize_path(&path)?;
    blocking(move || metadata::get_properties(&path)).await
}

#[tauri::command]
pub async fn get_folder_stats(path: String) -> Result<FolderStats, AppError> {
    let path = normalize_path(&path)?;
    blocking(move || metadata::get_folder_stats(&path)).await
}

#[tauri::command]
pub async fn read_text_preview(
    path: String,
    max_bytes: Option<usize>,
) -> Result<TextPreview, AppError> {
    let path = normalize_path(&path)?;
    let max_bytes = max_bytes.unwrap_or(128 * 1024);
    blocking(move || metadata::read_text_preview(&path, max_bytes)).await
}

#[tauri::command]
pub fn list_applications() -> Vec<ApplicationInfo> {
    metadata::list_applications()
}

/// Returns a PNG data URL for a macOS `.app` bundle, or `null` when the bundle
/// has no readable icon. The frontend falls back to its built-in glyph.
#[tauri::command]
pub async fn read_app_icon(path: String) -> Result<Option<String>, AppError> {
    let path = normalize_path(&path)?;
    blocking(move || Ok(app_icons::app_icon_data_url(&path))).await
}

fn spawn(command: &mut Command) -> Result<(), AppError> {
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::new("launch_failed", error.to_string(), None))
}

fn eject_path(path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("diskutil").arg("eject").arg(path).output()?;
        if output.status.success() {
            return Ok(());
        }
        // Network shares are not disks, so diskutil cannot eject them.
        if metadata::is_network_mount(path) {
            let unmount = Command::new("umount").arg(path).output()?;
            if unmount.status.success() {
                return Ok(());
            }
            let message = String::from_utf8_lossy(&unmount.stderr).trim().to_string();
            return Err(AppError::new(
                "eject_failed",
                if message.is_empty() {
                    "The server could not be disconnected.".to_string()
                } else {
                    message
                },
                Some(path.to_string_lossy().to_string()),
            ));
        }
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::new(
            "eject_failed",
            if message.is_empty() {
                "The volume could not be ejected.".to_string()
            } else {
                message
            },
            Some(path.to_string_lossy().to_string()),
        ));
    }
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("umount").arg(path).output()?;
        if output.status.success() {
            return Ok(());
        }
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::new(
            "eject_failed",
            if message.is_empty() {
                "The volume could not be unmounted.".to_string()
            } else {
                message
            },
            Some(path.to_string_lossy().to_string()),
        ));
    }
    #[cfg(target_os = "windows")]
    {
        Err(AppError::new(
            "not_supported",
            "Eject is not available in this build.".to_string(),
            Some(path.to_string_lossy().to_string()),
        ))
    }
}

#[tauri::command]
pub async fn eject_volume(path: String) -> Result<(), AppError> {
    let resolved = PathBuf::from(expand_user(&path));
    if !resolved.exists() {
        return Err(AppError::not_found(resolved.to_string_lossy()));
    }
    blocking(move || eject_path(&resolved)).await
}

fn validate_network_address(address: &str) -> Result<String, AppError> {
    let trimmed = address.trim();
    if trimmed.is_empty() || trimmed.len() > 2048 {
        return Err(AppError::invalid("Enter a server address."));
    }
    if trimmed
        .chars()
        .any(|character| character.is_control() || character == '"' || character == '\\')
    {
        return Err(AppError::invalid("The server address contains invalid characters."));
    }
    let lower = trimmed.to_ascii_lowercase();
    let scheme = lower.split("://").next().unwrap_or("");
    if !matches!(scheme, "smb" | "cifs" | "afp" | "nfs" | "ftp") {
        return Err(AppError::invalid(
            "Use an smb://, afp://, nfs://, or ftp:// server address.",
        ));
    }
    if !lower.contains("://") || lower.split("://").nth(1).unwrap_or("").is_empty() {
        return Err(AppError::invalid("Enter a server address."));
    }
    Ok(trimmed.to_string())
}

fn network_address_has_share(address: &str) -> bool {
    address
        .split("://")
        .nth(1)
        .map(|rest| rest.split('/').filter(|part| !part.is_empty()).count() > 1)
        .unwrap_or(false)
}

fn network_address_share_name(address: &str) -> Option<String> {
    address
        .split("://")
        .nth(1)?
        .split('/')
        .filter(|part| !part.is_empty())
        .last()
        .map(|part| part.to_string())
}

fn validate_network_credential(
    value: Option<String>,
    label: &str,
    trim: bool,
) -> Result<Option<String>, AppError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = if trim { value.trim().to_string() } else { value };
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 1024 || value.chars().any(char::is_control) {
        return Err(AppError::invalid(format!("The {label} contains invalid characters.")));
    }
    Ok(Some(value))
}

fn connect_network_address(
    address: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<Option<String>, AppError> {
    if !network_address_has_share(address) {
        return Err(AppError::new(
            "share_required",
            "Choose a share name before connecting. Use Find Shares in the connection dialog, or enter an address such as smb://server/share.",
            Some(address.to_string()),
        ));
    }
    #[cfg(target_os = "macos")]
    {
        let before = metadata::network_mount_paths();
        let mounted = network_mount::mount(address, username, password)?;
        let after = metadata::network_mount_paths();
        if let Some(path) = mounted {
            return Ok(Some(path));
        }
        if let Some(path) = after.iter().find(|path| !before.contains(path)) {
            return Ok(Some(path.to_string_lossy().to_string()));
        }
        if let Some(share) = network_address_share_name(address) {
            if let Some(path) = after.iter().find(|path| {
                path.file_name()
                    .map(|name| name.eq_ignore_ascii_case(&share))
                    .unwrap_or(false)
            }) {
                return Ok(Some(path.to_string_lossy().to_string()));
            }
        }
        return Ok(None);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = (username, password);
        return spawn(
            Command::new("cmd")
                .arg("/C")
                .arg("start")
                .arg("")
                .arg(address),
        )
        .map(|_| None);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = (username, password);
        return spawn(Command::new("xdg-open").arg(address)).map(|_| None);
    }
}

#[tauri::command]
pub async fn connect_network_location(
    address: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<Option<String>, AppError> {
    let address = validate_network_address(&address)?;
    let username = validate_network_credential(username, "username", true)?;
    let password = validate_network_credential(password, "password", false)?;
    crate::logging::info(
        "network.connect",
        format!(
            "request address={address} username={} password={}",
            if username.is_some() { "provided" } else { "none" },
            if password.is_some() { "provided" } else { "none" }
        ),
    );
    blocking(move || {
        connect_network_address(&address, username.as_deref(), password.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn discover_network_computers() -> Result<Vec<NetworkComputer>, AppError> {
    blocking(|| Ok(network_discovery::discover_computers())).await
}

#[tauri::command]
pub async fn list_network_shares(
    address: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<Vec<String>, AppError> {
    let username = validate_network_credential(username, "username", true)?;
    let password = validate_network_credential(password, "password", false)?;
    blocking(move || {
        network_discovery::list_shares(&address, username.as_deref(), password.as_deref())
    })
    .await
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), AppError> {
    let resolved = PathBuf::from(expand_user(&path));
    if !resolved.exists() {
        return Err(AppError::not_found(resolved.to_string_lossy()));
    }
    #[cfg(target_os = "macos")]
    {
        spawn(Command::new("open").arg(&resolved))
    }
    #[cfg(target_os = "windows")]
    {
        spawn(
            Command::new("cmd")
                .arg("/C")
                .arg("start")
                .arg("")
                .arg(&resolved),
        )
    }
    #[cfg(target_os = "linux")]
    {
        spawn(Command::new("xdg-open").arg(&resolved))
    }
}

/// Writes a portable `.maxTheme` or `.maxIcons` package into the user's
/// Downloads folder (or home folder when Downloads is unavailable).
///
/// The web view cannot reliably trigger a file download in every desktop
/// runtime, so the desktop app saves the package itself. The file name is
/// sanitised, the extension is checked, and existing files are never replaced.
#[tauri::command]
pub fn save_appearance_package(file_name: String, contents: String) -> Result<String, AppError> {
    const MAX_PACKAGE_BYTES: usize = 1_000_000;
    if contents.len() > MAX_PACKAGE_BYTES {
        return Err(AppError::invalid("This package is too large."));
    }
    let safe_name = safe_package_file_name(&file_name)?;
    let directory = dirs::download_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| AppError::new("internal", "No download folder is available.", None))?;
    std::fs::create_dir_all(&directory)?;
    let mut target = directory.join(&safe_name);
    if target.exists() {
        let path = Path::new(&safe_name);
        let stem = path
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "theme".to_string());
        let extension = path
            .extension()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "maxTheme".to_string());
        let mut available = false;
        for index in 2..=999 {
            let candidate = directory.join(format!("{stem}-{index}.{extension}"));
            if !candidate.exists() {
                target = candidate;
                available = true;
                break;
            }
        }
        if !available {
            return Err(AppError::new(
                "already_exists",
                "There are too many copies of this package in Downloads. Rename or remove an older copy first.",
                Some(target.to_string_lossy().to_string()),
            ));
        }
    }
    std::fs::write(&target, contents.as_bytes())?;
    Ok(target.to_string_lossy().to_string())
}

pub(crate) fn safe_package_file_name(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid("The package needs a file name."));
    }
    let lower = trimmed.to_lowercase();
    let extension = if lower.ends_with(".maxtheme") {
        "maxTheme"
    } else if lower.ends_with(".maxicons") {
        "maxIcons"
    } else {
        return Err(AppError::invalid(
            "Theme packages must end in .maxTheme or .maxIcons.",
        ));
    };
    let stem = trimmed[..trimmed.len() - 9].trim();
    let cleaned: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'
                || character == ' '
            {
                character
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned
        .trim_matches(|character: char| character == '-' || character == ' ' || character == '.');
    let cleaned = if cleaned.is_empty() {
        "maxplorer-theme"
    } else {
        cleaned
    };
    Ok(format!("{cleaned}.{extension}"))
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), AppError> {
    let resolved = PathBuf::from(expand_user(&path));
    if !resolved.exists() {
        return Err(AppError::not_found(resolved.to_string_lossy()));
    }
    #[cfg(target_os = "macos")]
    {
        spawn(Command::new("open").arg("-R").arg(&resolved))
    }
    #[cfg(target_os = "windows")]
    {
        spawn(Command::new("explorer").arg(format!("/select,{}", resolved.to_string_lossy())))
    }
    #[cfg(target_os = "linux")]
    {
        let target = if resolved.is_dir() {
            resolved.clone()
        } else {
            parent_path(&resolved).unwrap_or_else(|| home_dir())
        };
        spawn(Command::new("xdg-open").arg(target))
    }
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), AppError> {
    let resolved = PathBuf::from(expand_user(&path));
    let directory = if resolved.is_dir() {
        resolved
    } else {
        parent_path(&resolved).unwrap_or_else(|| home_dir())
    };
    #[cfg(target_os = "macos")]
    {
        spawn(
            Command::new("open")
                .arg("-a")
                .arg("Terminal")
                .arg(&directory),
        )
    }
    #[cfg(target_os = "windows")]
    {
        match spawn(Command::new("wt").arg("-d").arg(&directory)) {
            Ok(()) => Ok(()),
            Err(_) => spawn(
                Command::new("cmd")
                    .arg("/K")
                    .arg("cd")
                    .arg("/d")
                    .arg(&directory),
            ),
        }
    }
    #[cfg(target_os = "linux")]
    {
        spawn(Command::new("x-terminal-emulator").current_dir(&directory))
    }
}

#[tauri::command]
pub fn open_with(app: String, path: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        spawn(Command::new("open").arg("-a").arg(&app).arg(&path))
    }
    #[cfg(target_os = "windows")]
    {
        spawn(
            Command::new("cmd")
                .arg("/C")
                .arg("start")
                .arg("")
                .arg(&app)
                .arg(&path),
        )
    }
    #[cfg(target_os = "linux")]
    {
        spawn(Command::new(&app).arg(&path))
    }
}

#[tauri::command]
pub fn open_system_settings(section: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let url = match section.as_str() {
            "files" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"
            }
            "full_disk" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
            }
            "network_volumes" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_NetworkVolume"
            }
            "local_network" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork"
            }
            _ => "x-apple.systempreferences:com.apple.preference.security",
        };
        spawn(Command::new("open").arg(url))
    }
    #[cfg(target_os = "windows")]
    {
        let _ = section;
        spawn(
            Command::new("cmd")
                .arg("/C")
                .arg("start")
                .arg("ms-settings:privacy"),
        )
    }
    #[cfg(target_os = "linux")]
    {
        let _ = section;
        Ok(())
    }
}
