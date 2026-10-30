//! Local-only diagnostic logging.
//!
//! MAXplorer writes a rotating text log next to its local application data and
//! installs a panic hook that records the panic message, thread, location, and
//! backtrace before the default hook runs. No filenames or storage reports are
//! sent anywhere; this file is only for the user and local debugging.

use crate::error::AppError;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;

static LOG_FILE: OnceLock<Option<Mutex<File>>> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static PANIC_HOOK: OnceLock<()> = OnceLock::new();
static DEBUG_LOGGING: OnceLock<bool> = OnceLock::new();

fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", now.as_secs(), now.subsec_millis())
}

fn rotate(path: &Path) {
    let too_large = fs::metadata(path)
        .map(|metadata| metadata.len() >= MAX_LOG_BYTES)
        .unwrap_or(false);
    if !too_large {
        return;
    }
    let rotated = path.with_file_name("maxplorer.log.1");
    let _ = fs::remove_file(&rotated);
    let _ = fs::rename(path, rotated);
}

/// Initialise the log file and panic hook. Safe to call once from Tauri setup.
pub fn init(data_directory: &Path) {
    let debug_enabled = std::env::var("MAXPLORER_LOG")
        .map(|value| {
            let value = value.to_ascii_lowercase();
            value == "debug" || value == "1" || value == "true"
        })
        .unwrap_or(cfg!(debug_assertions));
    let _ = DEBUG_LOGGING.set(debug_enabled);
    let directory = data_directory.join("logs");
    if let Err(error) = fs::create_dir_all(&directory) {
        eprintln!("MAXplorer logging directory could not be created: {error}");
        return;
    }
    let path = directory.join("maxplorer.log");
    rotate(&path);
    let file = match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => file,
        Err(error) => {
            eprintln!("MAXplorer log file could not be opened: {error}");
            return;
        }
    };
    let _ = LOG_PATH.set(path.clone());
    let _ = LOG_FILE.set(Some(Mutex::new(file)));
    install_panic_hook();
    info(
        "app",
        format!(
            "MAXplorer {} starting on {} ({})",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    );
    info("app", format!("log file: {}", path.display()));
    info(
        "app",
        format!(
            "debug logging {} (set MAXPLORER_LOG=debug to enable it in a release build)",
            if debug_enabled { "enabled" } else { "disabled" }
        ),
    );
}

pub fn install_panic_hook() {
    if PANIC_HOOK.set(()).is_err() {
        return;
    }
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("unnamed");
        let location = info
            .location()
            .map(|value| format!("{}:{}:{}", value.file(), value.line(), value.column()))
            .unwrap_or_else(|| "unknown location".into());
        let message = if let Some(value) = info.payload().downcast_ref::<&str>() {
            (*value).to_string()
        } else if let Some(value) = info.payload().downcast_ref::<String>() {
            value.clone()
        } else {
            "non-string panic payload".to_string()
        };
        let backtrace = std::backtrace::Backtrace::force_capture();
        error(
            "panic",
            format!("thread '{name}' panicked at {location}: {message}\nbacktrace:\n{backtrace}"),
        );
        previous(info);
    }));
}

fn write(level: &str, target: &str, message: &str) {
    let line = format!("{} [{level}] {target}: {message}\n", timestamp());
    eprintln!("{line}");
    if let Some(Some(file)) = LOG_FILE.get() {
        if let Ok(mut file) = file.lock() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
}

pub fn info(target: &str, message: impl Into<String>) {
    write("INFO", target, &message.into());
}

pub fn warn(target: &str, message: impl Into<String>) {
    write("WARN", target, &message.into());
}

pub fn error(target: &str, message: impl Into<String>) {
    write("ERROR", target, &message.into());
}

pub fn debug(target: &str, message: impl Into<String>) {
    let enabled = DEBUG_LOGGING
        .get()
        .copied()
        .unwrap_or(cfg!(debug_assertions));
    if enabled {
        write("DEBUG", target, &message.into());
    }
}

pub fn path() -> Option<String> {
    LOG_PATH
        .get()
        .map(|value| value.to_string_lossy().to_string())
}

/// Convert a panic in a background filesystem task into a normal command error
/// after recording it. This keeps the window alive long enough for the user to
/// read the error and send the log.
pub fn catch<T>(label: &str, work: impl FnOnce() -> Result<T, AppError>) -> Result<T, AppError> {
    match panic::catch_unwind(AssertUnwindSafe(work)) {
        Ok(result) => result,
        Err(_) => {
            error(label, "The operation panicked; see the panic entry above.");
            Err(AppError::new(
                "internal",
                format!(
                    "MAXplorer hit an internal error during {label}. The app kept running and wrote diagnostic details to {}.",
                    path().unwrap_or_else(|| "the application data logs folder".into())
                ),
                path(),
            ))
        }
    }
}

pub fn frontend(level: &str, target: &str, message: &str) {
    match level.to_ascii_lowercase().as_str() {
        "warn" | "warning" => warn(target, message),
        "error" => error(target, message),
        "debug" => debug(target, message),
        _ => info(target, message),
    }
}

#[tauri::command]
pub fn log_frontend_event(level: String, message: String, context: Option<String>) {
    let target = context.unwrap_or_else(|| "frontend".into());
    frontend(&level, &target, &message);
}

#[tauri::command]
pub fn get_log_path() -> Option<String> {
    path()
}

#[tauri::command]
pub fn log_storage_diagnostics() -> Option<String> {
    let path = path();
    if let Some(path) = path.as_ref() {
        info(
            "storage",
            format!("diagnostics requested; log file is {path}"),
        );
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontend_levels_do_not_panic_without_a_log_file() {
        frontend("error", "test", "frontend error");
        frontend("warning", "test", "frontend warning");
        assert!(catch("test", || Ok::<_, AppError>(42)).is_ok());
    }
}
