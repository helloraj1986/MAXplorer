use serde::Serialize;
use std::fmt;
use std::io;

/// A stable, serializable error shape consumed by the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub path: Option<String>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, path: Option<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            path,
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_request", message, None)
    }

    pub fn not_found(path: impl fmt::Display) -> Self {
        Self::new(
            "not_found",
            "This item is no longer available. It might have been moved, renamed, or deleted.",
            Some(path.to_string()),
        )
    }

    pub fn already_exists(path: impl fmt::Display) -> Self {
        Self::new(
            "already_exists",
            "An item with this name already exists in this location.",
            Some(path.to_string()),
        )
    }

    pub fn with_path(mut self, path: impl fmt::Display) -> Self {
        self.path = Some(path.to_string());
        self
    }

    /// A kernel-level permission failure on a mounted network volume. This is a
    /// different macOS control from ordinary file permissions, so the UI should
    /// point at Network Volumes/Local Network rather than only Full Disk Access.
    pub fn network_permission(path: impl fmt::Display) -> Self {
        Self::new(
            "network_permission_denied",
            "macOS blocked access to this network volume. In System Settings > Privacy & Security, enable MAXplorer under Network Volumes (and Local Network for server discovery), then reconnect the server from MAXplorer.",
            Some(path.to_string()),
        )
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("database_error", error.to_string(), None)
    }
}

impl From<io::Error> for AppError {
    fn from(error: io::Error) -> Self {
        let code = match error.kind() {
            io::ErrorKind::NotFound => "not_found",
            io::ErrorKind::PermissionDenied => "permission_denied",
            io::ErrorKind::AlreadyExists => "already_exists",
            io::ErrorKind::InvalidInput => "invalid_request",
            io::ErrorKind::InvalidData => "invalid_data",
            io::ErrorKind::TimedOut => "timeout",
            io::ErrorKind::WriteZero => "io_error",
            _ => "io_error",
        };
        let message = match code {
            "not_found" => "This item is no longer available. It might have been moved, renamed, or deleted.".to_string(),
            "permission_denied" => "You don't have permission to access this item. Grant access in System Settings > Privacy & Security.".to_string(),
            "already_exists" => "An item with this name already exists in this location.".to_string(),
            "invalid_request" => "The path or name is not valid.".to_string(),
            "timeout" => "The operation timed out.".to_string(),
            _ => error.to_string(),
        };
        Self::new(code, message, None)
    }
}
