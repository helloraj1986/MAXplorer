use crate::error::AppError;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

pub fn expand_user(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed == "~" {
        return home_dir().to_string_lossy().to_string();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return home_dir().join(rest).to_string_lossy().to_string();
    }
    trimmed.to_string()
}

pub fn normalize_path(input: &str) -> Result<PathBuf, AppError> {
    let expanded = expand_user(input);
    if expanded.is_empty() {
        return Err(AppError::invalid("Enter a folder path."));
    }
    let path = PathBuf::from(&expanded);
    if !path.is_absolute() {
        return Err(AppError::invalid(
            "Enter an absolute path, for example /Users/you/Documents.",
        ));
    }
    if path.exists() {
        // Canonicalize only for identity checks; callers decide whether to display
        // the canonical path or the user-entered path.
        return Ok(path);
    }
    Ok(path)
}

pub fn canonical(path: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok()
}

pub fn parent_path(path: &Path) -> Option<PathBuf> {
    let parent = path.parent()?;
    if parent.as_os_str().is_empty() {
        None
    } else if parent == path {
        None
    } else {
        Some(parent.to_path_buf())
    }
}

pub fn validate_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid("Enter a name for this item."));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(AppError::invalid("That name is reserved."));
    }
    if trimmed.len() > 255 {
        return Err(AppError::invalid("The name is too long."));
    }
    if trimmed.contains('\0') || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::invalid("A name can't contain a slash."));
    }
    if trimmed.chars().any(|character| character.is_control()) {
        return Err(AppError::invalid(
            "A name can't contain control characters.",
        ));
    }
    if cfg!(target_os = "windows")
        && trimmed
            .chars()
            .any(|character| matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err(AppError::invalid("A name can't contain < > : \" | ? *"));
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err(AppError::invalid(
            "A name can't end with a period or space.",
        ));
    }
    Ok(trimmed.to_string())
}

pub fn unique_destination(directory: &Path, name: &str) -> PathBuf {
    let candidate = directory.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_string());
    for index in 2..10_000 {
        let next_name = match &extension {
            Some(extension) if !stem.is_empty() => format!("{stem} ({index}).{extension}"),
            _ => format!("{name} ({index})"),
        };
        let next = directory.join(next_name);
        if !next.exists() {
            return next;
        }
    }
    directory.join(format!("{name} (copy)"))
}

pub fn unique_copy_name(directory: &Path, name: &str) -> PathBuf {
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_string());
    for index in 1..10_000 {
        let suffix = if index == 1 {
            " - Copy".to_string()
        } else {
            format!(" - Copy ({index})")
        };
        let candidate = match &extension {
            Some(extension) if !stem.is_empty() => {
                directory.join(format!("{stem}{suffix}.{extension}"))
            }
            _ => directory.join(format!("{name}{suffix}")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{name} - Copy"))
}

pub fn is_same_or_descendant(source: &Path, destination: &Path) -> bool {
    let source_canonical = canonical(source).unwrap_or_else(|| source.to_path_buf());
    let destination_canonical = canonical(destination).unwrap_or_else(|| destination.to_path_buf());
    destination_canonical == source_canonical
        || destination_canonical.starts_with(&source_canonical)
}

pub fn reject_unsafe_destruction(path: &Path) -> Result<(), AppError> {
    let home = canonical(&home_dir()).unwrap_or_else(home_dir);
    let target = canonical(path).unwrap_or_else(|| path.to_path_buf());
    if target == Path::new("/") || target.parent().is_none() {
        return Err(AppError::new(
            "protected_path",
            "This location is protected and can't be deleted.",
            Some(target.to_string_lossy().to_string()),
        ));
    }
    if target == home {
        return Err(AppError::new(
            "protected_path",
            "Your home folder is protected and can't be deleted from this app.",
            Some(target.to_string_lossy().to_string()),
        ));
    }
    let protected = [
        "/System",
        "/Library",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/private",
        "/dev",
        "/Applications",
    ];
    for guarded in protected {
        if target == Path::new(guarded) {
            return Err(AppError::new(
                "protected_path",
                "This system location is protected and can't be deleted.",
                Some(target.to_string_lossy().to_string()),
            ));
        }
    }
    Ok(())
}

pub fn system_time_ms(value: std::io::Result<SystemTime>) -> Option<i64> {
    let time = value.ok()?;
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}
