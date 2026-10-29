use crate::app_icons;
use crate::compare::{self, CompareState};
use crate::error::AppError;
use crate::listing;
use crate::metadata;
use crate::operations;
use crate::paths::{expand_user, home_dir, normalize_path, parent_path};
use crate::search::model::{DuplicateRequest, DuplicateResponse, IndexError, IndexStatus, SearchRequest, SearchResponse, SearchSuggestion};
use crate::search::{self, SearchService};
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
use tauri::{Emitter, State};

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
pub fn get_sidebar_locations() -> Vec<Location> {
    metadata::sidebar_locations()
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
pub fn search_suggestions(
    state: State<'_, SearchService>,
    prefix: String,
    limit: usize,
) -> Vec<SearchSuggestion> {
    state.suggestions(&prefix, limit.clamp(1, 20))
}

#[tauri::command]
pub fn get_search_index_status(state: State<'_, SearchService>) -> IndexStatus {
    state.status()
}

#[tauri::command]
pub fn add_search_location(state: State<'_, SearchService>, path: String) -> Result<IndexStatus, AppError> {
    let normalized = normalize_path(&path)?;
    state.engine.add_location(&normalized.to_string_lossy())?;
    state.restart_indexer();
    Ok(state.status())
}

#[tauri::command]
pub fn remove_search_location(state: State<'_, SearchService>, path: String) -> Result<IndexStatus, AppError> {
    state.stop_indexer();
    state.engine.remove_location(&path)?;
    state.restart_indexer();
    Ok(state.status())
}

#[tauri::command]
pub fn set_search_index_paused(state: State<'_, SearchService>, paused: bool) -> Result<IndexStatus, AppError> {
    state.engine.set_paused(paused)?;
    if !paused {
        // Events received while paused are intentionally discarded. Marking the
        // locations partial makes the indexer reconcile them on resume instead
        // of waiting for the next periodic pass.
        for root in state.engine.enabled_roots() {
            let _ = state.engine.mark_location(&root, "partial", None);
        }
    }
    Ok(state.status())
}

#[tauri::command]
pub fn set_search_content_enabled(
    state: State<'_, SearchService>,
    enabled: bool,
) -> Result<IndexStatus, AppError> {
    state.engine.set_content_enabled(enabled)?;
    Ok(state.status())
}

#[tauri::command]
pub fn set_search_content_limit(
    state: State<'_, SearchService>,
    bytes: u64,
) -> Result<IndexStatus, AppError> {
    state.engine.set_max_content_bytes(bytes)?;
    Ok(state.status())
}

#[tauri::command]
pub fn rebuild_search_index(state: State<'_, SearchService>) -> Result<IndexStatus, AppError> {
    state.stop_indexer();
    state.engine.rebuild()?;
    state.restart_indexer();
    Ok(state.status())
}

#[tauri::command]
pub fn clear_search_index(state: State<'_, SearchService>) -> Result<IndexStatus, AppError> {
    state.stop_indexer();
    state.engine.clear_index()?;
    state.restart_indexer();
    Ok(state.status())
}

#[tauri::command]
pub fn retry_failed_extractions(state: State<'_, SearchService>) -> Result<IndexStatus, AppError> {
    state.engine.retry_failed()?;
    Ok(state.status())
}

#[tauri::command]
pub fn remove_search_path(state: State<'_, SearchService>, path: String) -> Result<(), AppError> {
    state.engine.remove_path(&path)
}

#[tauri::command]
pub fn get_index_errors(state: State<'_, SearchService>, limit: usize) -> Vec<IndexError> {
    state.index_errors(limit.clamp(1, 200))
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
