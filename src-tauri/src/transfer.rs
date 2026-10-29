use crate::error::AppError;
use crate::paths::{is_same_or_descendant, normalize_path, unique_destination};
use crate::types::{
    ConflictPolicy, OperationResult, TransferMode, TransferOutcome, TransferProgress, TransferRequest,
};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const CHUNK_SIZE: usize = 256 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(120);

#[derive(Default)]
pub struct TransferState {
    pub controls: Mutex<HashMap<u64, Arc<TransferControl>>>,
}

pub struct TransferControl {
    pub cancel: AtomicBool,
    pub paused: AtomicBool,
}

impl TransferControl {
    pub fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            paused: AtomicBool::new(false),
        }
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
    }
}

#[derive(Default)]
struct ScanSummary {
    total_bytes: u64,
    total_items: u64,
}

struct Reporter {
    app: Option<AppHandle>,
    id: u64,
    total_bytes: u64,
    total_items: u64,
    processed_bytes: u64,
    processed_items: u64,
    current_file: Option<String>,
    started: Instant,
    last_emit: Instant,
    status: String,
    control: Arc<TransferControl>,
}

impl Reporter {
    fn new(
        app: Option<AppHandle>,
        id: u64,
        total_bytes: u64,
        total_items: u64,
        control: Arc<TransferControl>,
    ) -> Self {
        let now = Instant::now();
        Self {
            app,
            id,
            total_bytes,
            total_items,
            processed_bytes: 0,
            processed_items: 0,
            current_file: None,
            started: now,
            last_emit: now - PROGRESS_INTERVAL,
            status: "running".to_string(),
            control,
        }
    }

    fn emit(&mut self, phase: &str, message: Option<String>) {
        let elapsed = self.started.elapsed().as_secs_f64();
        let speed = if elapsed > 0.0 {
            self.processed_bytes as f64 / elapsed
        } else {
            0.0
        };
        let remaining = self.total_bytes.saturating_sub(self.processed_bytes);
        let eta = if speed > 1.0 {
            Some(remaining as f64 / speed)
        } else {
            None
        };
        let progress = TransferProgress {
            id: self.id,
            status: self.status.clone(),
            phase: phase.to_string(),
            current_file: self.current_file.clone(),
            processed_bytes: self.processed_bytes,
            total_bytes: self.total_bytes,
            processed_items: self.processed_items,
            total_items: self.total_items,
            bytes_per_second: speed,
            eta_seconds: eta,
            message,
        };
        if let Some(app) = &self.app {
            let _ = app.emit("transfer-progress", progress);
        }
        self.last_emit = Instant::now();
    }

    fn maybe_emit(&mut self, phase: &str, force: bool) {
        if force || self.last_emit.elapsed() >= PROGRESS_INTERVAL {
            self.emit(phase, None);
        }
    }

    fn set_current(&mut self, path: &Path) {
        let display = path.to_string_lossy().to_string();
        if self.current_file.as_deref() != Some(display.as_str()) {
            self.current_file = Some(display);
        }
    }

    fn add_bytes(&mut self, bytes: u64) {
        self.processed_bytes = self.processed_bytes.saturating_add(bytes);
    }

    fn add_item(&mut self) {
        self.processed_items = self.processed_items.saturating_add(1);
    }

    /// Returns `Ok(true)` when the user cancelled. Pauses are honoured by
    /// sleeping in short intervals without touching the filesystem.
    fn wait(&mut self) -> Result<bool, AppError> {
        let mut was_paused = false;
        loop {
            if self.control.cancel.load(Ordering::Relaxed) {
                return Ok(true);
            }
            if self.control.paused.load(Ordering::Relaxed) {
                if !was_paused {
                    was_paused = true;
                    self.status = "paused".to_string();
                    self.emit("transferring", Some("Paused".to_string()));
                }
                std::thread::sleep(Duration::from_millis(80));
            } else {
                if was_paused {
                    self.status = "running".to_string();
                    self.emit("transferring", Some("Resumed".to_string()));
                }
                return Ok(false);
            }
        }
    }

    fn cancelled_error() -> AppError {
        AppError::new(
            "cancelled",
            "The transfer was cancelled before it completed.",
            None,
        )
    }
}

fn scan_paths(
    paths: &[PathBuf],
    summary: &mut ScanSummary,
    control: &TransferControl,
) -> Result<(), AppError> {
    for path in paths {
        scan_one(path, summary, control)?;
    }
    Ok(())
}

fn scan_one(
    path: &Path,
    summary: &mut ScanSummary,
    control: &TransferControl,
) -> Result<(), AppError> {
    if control.cancel.load(Ordering::Relaxed) {
        return Err(Reporter::cancelled_error());
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        AppError::from(error).with_path(path.to_string_lossy())
    })?;
    summary.total_items = summary.total_items.saturating_add(1);
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    if metadata.is_dir() {
        let reader = fs::read_dir(path).map_err(|error| {
            AppError::from(error).with_path(path.to_string_lossy())
        })?;
        for item in reader {
            let item = item.map_err(AppError::from)?;
            scan_one(&item.path(), summary, control)?;
        }
        return Ok(());
    }
    summary.total_bytes = summary.total_bytes.saturating_add(metadata.len());
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
    suffix: u64,
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
        ConflictPolicy::Rename => {
            let mut candidate = unique_destination(destination_directory, &name.to_string_lossy());
            let mut counter = suffix;
            while candidate.exists() && counter < 10_000 {
                counter += 1;
                candidate = destination_directory.join(format!(
                    "{} ({counter})",
                    name.to_string_lossy()
                ));
            }
            Ok(Some(candidate))
        }
        ConflictPolicy::Replace => Ok(Some(destination)),
    }
}

fn temp_path(destination: &Path, id: u64) -> PathBuf {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let name = destination
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".to_string());
    for index in 0..10_000 {
        let candidate = parent.join(format!(".{name}.{id}.{index}.part"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!(".{name}.{id}.part"))
}

fn copy_file_stream(
    source: &Path,
    destination: &Path,
    reporter: &mut Reporter,
) -> Result<(), AppError> {
    let mut input = File::open(source).map_err(|error| {
        AppError::from(error).with_path(source.to_string_lossy())
    })?;
    let temp = temp_path(destination, reporter.id);
    let result = (|| -> Result<(), AppError> {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| AppError::from(error).with_path(temp.to_string_lossy()))?;
        let mut buffer = vec![0u8; CHUNK_SIZE];
        loop {
            if reporter.wait()? {
                return Err(Reporter::cancelled_error());
            }
            let read = input.read(&mut buffer).map_err(AppError::from)?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read]).map_err(AppError::from)?;
            reporter.add_bytes(read as u64);
            reporter.maybe_emit("transferring", false);
        }
        output.sync_all().map_err(AppError::from)?;
        drop(output);
        if let Ok(metadata) = fs::metadata(source) {
            let _ = fs::set_permissions(&temp, metadata.permissions());
        }
        if destination.exists() {
            remove_existing(destination)?;
        }
        fs::rename(&temp, destination).map_err(AppError::from)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
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

fn copy_entry(
    source: &Path,
    destination: &Path,
    policy: ConflictPolicy,
    reporter: &mut Reporter,
) -> Result<(), AppError> {
    if reporter.wait()? {
        return Err(Reporter::cancelled_error());
    }
    reporter.set_current(source);
    let metadata = fs::symlink_metadata(source).map_err(|error| {
        AppError::from(error).with_path(source.to_string_lossy())
    })?;
    if metadata.file_type().is_symlink() {
        if destination.exists() {
            match policy {
                ConflictPolicy::Skip => {
                    reporter.add_item();
                    return Ok(());
                }
                ConflictPolicy::Error => {
                    return Err(AppError::already_exists(destination.to_string_lossy()))
                }
                _ => remove_existing(destination)?,
            }
        }
        let target = fs::read_link(source).map_err(AppError::from)?;
        create_symlink_at(&target, destination)?;
        reporter.add_item();
        reporter.maybe_emit("transferring", false);
        return Ok(());
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
            // Replace merges folders. Rename already picked a unique top-level
            // name, so nested merges are only possible after an explicit Replace.
        } else {
            fs::create_dir_all(destination).map_err(|error| {
                AppError::from(error).with_path(destination.to_string_lossy())
            })?;
        }
        let reader = fs::read_dir(source).map_err(|error| {
            AppError::from(error).with_path(source.to_string_lossy())
        })?;
        for item in reader {
            if reporter.wait()? {
                return Err(Reporter::cancelled_error());
            }
            let item = item.map_err(AppError::from)?;
            let name = item.file_name();
            let child_destination = destination.join(&name);
            let child_policy = if child_destination.exists() {
                policy
            } else {
                ConflictPolicy::Error
            };
            if let Some(child_destination) =
                prepare_destination(&item.path(), destination, child_policy, reporter.id)?
            {
                copy_entry(&item.path(), &child_destination, policy, reporter)?;
            }
        }
        reporter.add_item();
        reporter.maybe_emit("transferring", false);
        return Ok(());
    }
    if destination.exists() {
        match policy {
            ConflictPolicy::Skip => {
                reporter.add_item();
                return Ok(());
            }
            ConflictPolicy::Error => {
                return Err(AppError::already_exists(destination.to_string_lossy()))
            }
            _ => {
                let destination_metadata =
                    fs::symlink_metadata(destination).map_err(AppError::from)?;
                if destination_metadata.is_dir()
                    && !destination_metadata.file_type().is_symlink()
                {
                    return Err(AppError::new(
                        "type_mismatch",
                        "A folder with this name already exists in the destination.",
                        Some(destination.to_string_lossy().to_string()),
                    ));
                }
                remove_existing(destination)?;
            }
        }
    }
    copy_file_stream(source, destination, reporter)?;
    reporter.add_item();
    reporter.maybe_emit("transferring", false);
    Ok(())
}

fn path_size(path: &Path) -> u64 {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return 0,
    };
    if metadata.file_type().is_symlink() {
        return 0;
    }
    if metadata.is_dir() {
        let mut total = 0u64;
        if let Ok(reader) = fs::read_dir(path) {
            for item in reader.flatten() {
                total = total.saturating_add(path_size(&item.path()));
            }
        }
        return total;
    }
    metadata.len()
}

fn is_cross_device(error: &std::io::Error) -> bool {
    matches!(error.raw_os_error(), Some(18) | Some(17))
}

fn move_entry(
    source: &Path,
    destination: &Path,
    policy: ConflictPolicy,
    reporter: &mut Reporter,
) -> Result<(), AppError> {
    if reporter.wait()? {
        return Err(Reporter::cancelled_error());
    }
    reporter.set_current(source);
    if destination.exists() {
        let source_metadata = fs::symlink_metadata(source).map_err(AppError::from)?;
        let destination_metadata = fs::symlink_metadata(destination).map_err(AppError::from)?;
        if source_metadata.is_dir()
            && destination_metadata.is_dir()
            && !destination_metadata.file_type().is_symlink()
        {
            return Err(AppError::new(
                "already_exists",
                "Folders can't be replaced by a move. Choose Keep both or Skip instead.",
                Some(destination.to_string_lossy().to_string()),
            ));
        }
        match policy {
            ConflictPolicy::Skip => {
                reporter.add_item();
                return Ok(());
            }
            ConflictPolicy::Error => {
                return Err(AppError::already_exists(destination.to_string_lossy()))
            }
            _ => remove_existing(destination)?,
        }
    }
    match fs::rename(source, destination) {
        Ok(()) => {
            let bytes = path_size(destination);
            reporter.add_bytes(bytes);
            reporter.add_item();
            reporter.maybe_emit("transferring", false);
            Ok(())
        }
        Err(error) if is_cross_device(&error) => {
            // Copy first; the source is only removed after the copy succeeds.
            // The destination did not exist before this move, so a partial copy
            // can be removed safely to leave the retry in a clean state.
            if let Err(copy_error) = copy_entry(source, destination, ConflictPolicy::Error, reporter)
            {
                let _ = if destination.exists() {
                    remove_existing(destination)
                } else {
                    Ok(())
                };
                return Err(copy_error);
            }
            let metadata = fs::symlink_metadata(source).map_err(AppError::from)?;
            let removal = if metadata.is_dir() && !metadata.file_type().is_symlink() {
                fs::remove_dir_all(source)
            } else {
                fs::remove_file(source)
            };
            removal.map_err(AppError::from)
        }
        Err(error) => Err(AppError::from(error).with_path(source.to_string_lossy())),
    }
}

pub fn run_transfer(
    app: AppHandle,
    request: TransferRequest,
    control: Arc<TransferControl>,
) -> Result<TransferOutcome, AppError> {
    run_transfer_inner(Some(app), request, control)
}

fn run_transfer_inner(
    app: Option<AppHandle>,
    request: TransferRequest,
    control: Arc<TransferControl>,
) -> Result<TransferOutcome, AppError> {
    let destination = normalize_path(&request.destination)?;
    let destination_metadata = fs::metadata(&destination).map_err(|error| {
        AppError::from(error).with_path(destination.to_string_lossy())
    })?;
    if !destination_metadata.is_dir() {
        return Err(AppError::new(
            "not_a_directory",
            "The destination is not a folder.",
            Some(destination.to_string_lossy().to_string()),
        ));
    }

    let mut sources = Vec::new();
    let mut results = Vec::new();
    for value in &request.paths {
        let expanded = crate::paths::expand_user(value);
        let path = PathBuf::from(expanded);
        if !path.is_absolute() {
            results.push(OperationResult::failed(
                value,
                "The path must be absolute.".to_string(),
            ));
            continue;
        }
        sources.push(path);
    }

    let mut scan = ScanSummary::default();
    let scan_result = scan_paths(&sources, &mut scan, &control);
    if let Err(error) = scan_result {
        if error.code == "cancelled" {
            return Ok(TransferOutcome {
                id: request.id,
                cancelled: true,
                paused: false,
                results,
                total_bytes: scan.total_bytes,
                processed_bytes: 0,
                total_items: scan.total_items,
                processed_items: 0,
            });
        }
        return Err(error);
    }

    let mut reporter = Reporter::new(
        app,
        request.id,
        scan.total_bytes,
        scan.total_items,
        control.clone(),
    );
    reporter.emit("transferring", Some("Starting".to_string()));

    let mut cancelled = false;
    for source in sources {
        if reporter.wait()? {
            cancelled = true;
            break;
        }
        let source_display = source.to_string_lossy().to_string();
        if source.is_dir() && is_same_or_descendant(&source, &destination) {
            results.push(OperationResult::failed(
                &source_display,
                "A folder can't be copied or moved into itself.".to_string(),
            ));
            continue;
        }
        if source == destination {
            results.push(OperationResult::failed(
                &source_display,
                "The source and destination are the same item.".to_string(),
            ));
            continue;
        }
        match prepare_destination(&source, &destination, request.conflict, request.id) {
            Ok(Some(target)) => {
                let outcome = match request.mode {
                    TransferMode::Copy => copy_entry(&source, &target, request.conflict, &mut reporter),
                    TransferMode::Move => move_entry(&source, &target, request.conflict, &mut reporter),
                };
                match outcome {
                    Ok(()) => results.push(OperationResult::completed(&source_display, &target)),
                    Err(error) if error.code == "cancelled" => {
                        results.push(OperationResult::failed(&source_display, error.message));
                        cancelled = true;
                        break;
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

    let paused = control.paused.load(Ordering::Relaxed);
    reporter.status = if cancelled {
        "cancelled".to_string()
    } else {
        "completed".to_string()
    };
    reporter.emit(
        if cancelled { "cancelled" } else { "completed" },
        Some(if cancelled {
            "Cancelled".to_string()
        } else {
            "Finished".to_string()
        }),
    );

    Ok(TransferOutcome {
        id: request.id,
        cancelled,
        paused,
        results,
        total_bytes: scan.total_bytes,
        processed_bytes: reporter.processed_bytes,
        total_items: scan.total_items,
        processed_items: reporter.processed_items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn request(
        paths: Vec<PathBuf>,
        destination: &Path,
        mode: TransferMode,
        conflict: ConflictPolicy,
    ) -> TransferRequest {
        TransferRequest {
            id: 7,
            paths: paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            destination: destination.to_string_lossy().to_string(),
            mode,
            conflict,
        }
    }

    fn run(request: TransferRequest) -> TransferOutcome {
        run_transfer_inner(None, request, Arc::new(TransferControl::new())).unwrap()
    }

    #[test]
    fn copies_files_and_folders_recursively_without_removing_sources() {
        let workspace = tempdir().unwrap();
        let source = workspace.path().join("source");
        let destination = workspace.path().join("destination");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(source.join("root.txt"), "root").unwrap();
        fs::write(source.join("nested/child.txt"), "child").unwrap();

        let outcome = run(request(
            vec![source.join("root.txt"), source.join("nested")],
            &destination,
            TransferMode::Copy,
            ConflictPolicy::Error,
        ));

        assert!(!outcome.cancelled);
        assert_eq!(outcome.results.len(), 2);
        assert!(outcome.results.iter().all(|result| result.status == "completed"));
        assert_eq!(
            fs::read_to_string(destination.join("root.txt")).unwrap(),
            "root"
        );
        assert_eq!(
            fs::read_to_string(destination.join("nested/child.txt")).unwrap(),
            "child"
        );
        assert!(source.join("root.txt").exists());
        assert!(source.join("nested/child.txt").exists());
        assert!(outcome.processed_bytes >= 9);
    }

    #[test]
    fn moves_files_and_removes_only_the_source() {
        let workspace = tempdir().unwrap();
        let source = workspace.path().join("source.txt");
        let destination = workspace.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        fs::write(&source, "moving").unwrap();

        let outcome = run(request(
            vec![source.clone()],
            &destination,
            TransferMode::Move,
            ConflictPolicy::Error,
        ));

        assert!(!outcome.cancelled);
        assert_eq!(outcome.results[0].status, "completed");
        assert!(!source.exists());
        assert_eq!(
            fs::read_to_string(destination.join("source.txt")).unwrap(),
            "moving"
        );
    }

    #[test]
    fn never_silently_overwrites_an_existing_name() {
        let workspace = tempdir().unwrap();
        let destination = workspace.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("item.txt"), "old").unwrap();

        let source = workspace.path().join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("item.txt"), "new").unwrap();

        let outcome = run(request(
            vec![source.join("item.txt")],
            &destination,
            TransferMode::Copy,
            ConflictPolicy::Error,
        ));
        assert_eq!(outcome.results[0].status, "failed");
        assert_eq!(
            fs::read_to_string(destination.join("item.txt")).unwrap(),
            "old"
        );

        let outcome = run(request(
            vec![source.join("item.txt")],
            &destination,
            TransferMode::Copy,
            ConflictPolicy::Skip,
        ));
        assert_eq!(outcome.results[0].status, "skipped");
        assert_eq!(
            fs::read_to_string(destination.join("item.txt")).unwrap(),
            "old"
        );

        let outcome = run(request(
            vec![source.join("item.txt")],
            &destination,
            TransferMode::Copy,
            ConflictPolicy::Rename,
        ));
        assert_eq!(outcome.results[0].status, "completed");
        let renamed = outcome.results[0].destination.as_ref().unwrap();
        assert!(Path::new(renamed).exists());
        assert_ne!(Path::new(renamed), destination.join("item.txt"));
        assert_eq!(
            fs::read_to_string(destination.join("item.txt")).unwrap(),
            "old"
        );
        assert_eq!(fs::read_to_string(renamed).unwrap(), "new");
    }

    #[test]
    fn replaces_only_when_explicitly_requested() {
        let workspace = tempdir().unwrap();
        let destination = workspace.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("item.txt"), "old").unwrap();

        let source = workspace.path().join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("item.txt"), "new").unwrap();

        let outcome = run(request(
            vec![source.join("item.txt")],
            &destination,
            TransferMode::Copy,
            ConflictPolicy::Replace,
        ));

        assert_eq!(outcome.results[0].status, "completed");
        assert_eq!(
            fs::read_to_string(destination.join("item.txt")).unwrap(),
            "new"
        );
    }

    #[test]
    fn rejects_recursive_folder_transfers() {
        let workspace = tempdir().unwrap();
        let source = workspace.path().join("source");
        let inside = source.join("inside");
        fs::create_dir_all(&inside).unwrap();
        fs::write(source.join("file.txt"), "data").unwrap();

        let outcome = run(request(
            vec![source.clone()],
            &inside,
            TransferMode::Copy,
            ConflictPolicy::Error,
        ));

        assert!(!outcome.cancelled);
        assert_eq!(outcome.results[0].status, "failed");
        assert!(outcome.results[0]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("itself"));
        assert!(!inside.join("source").exists());
    }

    #[test]
    fn reports_relative_paths_and_non_directory_destinations() {
        let workspace = tempdir().unwrap();
        let destination = workspace.path().join("destination");
        fs::create_dir_all(&destination).unwrap();

        let mut transfer = request(Vec::new(), &destination, TransferMode::Copy, ConflictPolicy::Error);
        transfer.paths = vec!["relative.txt".to_string()];
        let outcome = run(transfer);
        assert_eq!(outcome.results[0].status, "failed");
        assert!(outcome.results[0]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("absolute"));

        let file_destination = workspace.path().join("file-destination");
        fs::write(&file_destination, "not a directory").unwrap();
        let source = workspace.path().join("source.txt");
        fs::write(&source, "data").unwrap();
        let error = run_transfer_inner(
            None,
            request(
                vec![source],
                &file_destination,
                TransferMode::Copy,
                ConflictPolicy::Error,
            ),
            Arc::new(TransferControl::new()),
        )
        .unwrap_err();
        assert_eq!(error.code, "not_a_directory");
    }

    #[test]
    fn supports_cancellation_before_any_bytes_are_written() {
        let workspace = tempdir().unwrap();
        let source = workspace.path().join("source.txt");
        let destination = workspace.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        fs::write(&source, "data").unwrap();

        let control = Arc::new(TransferControl::new());
        control.cancel();
        let outcome = run_transfer_inner(
            None,
            request(
                vec![source.clone()],
                &destination,
                TransferMode::Copy,
                ConflictPolicy::Error,
            ),
            control,
        )
        .unwrap();

        assert!(outcome.cancelled);
        assert!(outcome.results.is_empty());
        assert!(source.exists());
        assert!(!destination.join("source.txt").exists());
    }
}
