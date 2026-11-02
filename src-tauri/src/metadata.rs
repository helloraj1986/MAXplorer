use crate::error::AppError;
use crate::listing::entry_from_path;
use crate::paths::{home_dir, system_time_ms};
use crate::types::{ApplicationInfo, FolderStats, Location, PlatformInfo, Properties, TextPreview};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn permission_string(metadata: &fs::Metadata) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode();
        let mut value = String::new();
        value.push(if metadata.is_dir() { 'd' } else { '-' });
        for shift in [6u32, 3, 0] {
            value.push(if mode & (4 << shift) != 0 { 'r' } else { '-' });
            value.push(if mode & (2 << shift) != 0 { 'w' } else { '-' });
            value.push(if mode & (1 << shift) != 0 { 'x' } else { '-' });
        }
        value
    }
    #[cfg(not(unix))]
    {
        if metadata.permissions().readonly() {
            "Read-only".to_string()
        } else {
            "Read/write".to_string()
        }
    }
}

pub fn get_properties(path: &Path) -> Result<Properties, AppError> {
    let entry = entry_from_path(path)?;
    let link_metadata = fs::symlink_metadata(path).map_err(AppError::from)?;
    let metadata = if entry.is_symlink {
        fs::metadata(path).unwrap_or(link_metadata)
    } else {
        link_metadata
    };
    let item_count = if entry.is_dir {
        fs::read_dir(path)
            .ok()
            .map(|reader| reader.filter_map(|item| item.ok()).count() as u64)
    } else {
        None
    };
    #[cfg(unix)]
    let (owner_id, group_id) = {
        use std::os::unix::fs::MetadataExt;
        (Some(metadata.uid()), Some(metadata.gid()))
    };
    #[cfg(not(unix))]
    let (owner_id, group_id) = (None, None);
    Ok(Properties {
        path: entry.path,
        name: entry.name,
        is_dir: entry.is_dir,
        is_symlink: entry.is_symlink,
        target: entry.target,
        size: entry.size,
        modified: entry
            .modified
            .or_else(|| system_time_ms(metadata.modified())),
        created: entry.created.or_else(|| system_time_ms(metadata.created())),
        accessed: entry
            .accessed
            .or_else(|| system_time_ms(metadata.accessed())),
        extension: entry.extension,
        permissions: permission_string(&metadata),
        owner_id,
        group_id,
        is_read_only: entry.is_read_only,
        is_hidden: entry.is_hidden,
        item_count,
    })
}

pub fn get_folder_stats(path: &Path) -> Result<FolderStats, AppError> {
    let metadata = fs::metadata(path).map_err(AppError::from)?;
    if !metadata.is_dir() {
        return Ok(FolderStats {
            total_size: metadata.len(),
            files: if metadata.is_file() { 1 } else { 0 },
            folders: 0,
            truncated: false,
        });
    }
    let started = Instant::now();
    let mut stack = vec![path.to_path_buf()];
    let mut total_size = 0u64;
    let mut files = 0u64;
    let mut folders = 0u64;
    let mut examined = 0u64;
    let mut truncated = false;
    while let Some(directory) = stack.pop() {
        if started.elapsed() > Duration::from_secs(20) || examined > 500_000 {
            truncated = true;
            break;
        }
        let reader = match fs::read_dir(&directory) {
            Ok(reader) => reader,
            Err(_) => continue,
        };
        for item in reader {
            examined += 1;
            if examined > 500_000 {
                truncated = true;
                break;
            }
            let item = match item {
                Ok(item) => item,
                Err(_) => continue,
            };
            let item_path = item.path();
            let item_metadata = match fs::symlink_metadata(&item_path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if item_metadata.file_type().is_symlink() {
                files += 1;
                continue;
            }
            if item_metadata.is_dir() {
                folders += 1;
                stack.push(item_path);
            } else if item_metadata.is_file() {
                files += 1;
                total_size = total_size.saturating_add(item_metadata.len());
            }
        }
    }
    Ok(FolderStats {
        total_size,
        files,
        folders,
        truncated,
    })
}

pub fn read_text_preview(path: &Path, max_bytes: usize) -> Result<TextPreview, AppError> {
    let metadata = fs::metadata(path).map_err(AppError::from)?;
    if !metadata.is_file() {
        return Err(AppError::new(
            "not_a_file",
            "Preview is only available for files.",
            Some(path.to_string_lossy().to_string()),
        ));
    }
    let read_limit = max_bytes.clamp(1024, 512 * 1024);
    let mut file = fs::File::open(path).map_err(AppError::from)?;
    use std::io::Read;
    let mut buffer = Vec::with_capacity(read_limit.min(metadata.len() as usize) + 1);
    file.by_ref()
        .take((read_limit + 1) as u64)
        .read_to_end(&mut buffer)
        .map_err(AppError::from)?;
    let size = metadata.len();
    let truncated = buffer.len() > read_limit;
    let slice = if truncated {
        &buffer[..read_limit]
    } else {
        &buffer[..]
    };
    let binary = slice.iter().take(8_192).any(|byte| *byte == 0);
    if binary {
        return Ok(TextPreview {
            text: String::new(),
            truncated,
            binary: true,
            size,
        });
    }
    Ok(TextPreview {
        text: String::from_utf8_lossy(slice).to_string(),
        truncated,
        binary: false,
        size,
    })
}

pub fn platform_info() -> PlatformInfo {
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    PlatformInfo {
        platform: platform.to_string(),
        home: home_dir().to_string_lossy().to_string(),
        path_separator: std::path::MAIN_SEPARATOR.to_string(),
        modifier: if cfg!(target_os = "macos") {
            "cmd".to_string()
        } else {
            "ctrl".to_string()
        },
        computer_label: if cfg!(target_os = "macos") {
            "This Mac".to_string()
        } else if cfg!(target_os = "windows") {
            "This PC".to_string()
        } else {
            "Computer".to_string()
        },
    }
}

fn push_location_unchecked(
    locations: &mut Vec<Location>,
    id: &str,
    name: &str,
    path: PathBuf,
    kind: &str,
    icon: &str,
    is_volume: bool,
) {
    locations.push(Location {
        id: id.to_string(),
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
        kind: kind.to_string(),
        icon: icon.to_string(),
        is_volume,
    });
}

fn push_location(
    locations: &mut Vec<Location>,
    id: &str,
    name: &str,
    path: PathBuf,
    kind: &str,
    icon: &str,
    is_volume: bool,
) {
    if path.exists() {
        push_location_unchecked(locations, id, name, path, kind, icon, is_volume);
    }
}

/// The filesystem type reported by the kernel for a path.
///
/// `stat -f %T` is not the filesystem type on macOS (it prints `/` for most
/// paths), so ask `statfs(2)` for `f_fstypename` directly instead.
#[cfg(target_os = "macos")]
pub(crate) fn filesystem_type(path: &Path) -> Option<String> {
    use std::ffi::{CStr, CString};
    use std::os::unix::ffi::OsStrExt;

    let raw = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stats: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(raw.as_ptr(), &mut stats) } != 0 {
        return None;
    }
    let name = unsafe { CStr::from_ptr(stats.f_fstypename.as_ptr()) };
    let name = name.to_string_lossy().trim().to_lowercase();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn network_filesystem_name(name: &str) -> bool {
    matches!(
        name,
        "smbfs" | "cifs" | "afpfs" | "nfs" | "webdav" | "webdavs" | "ftp"
    )
}

/// True when a mounted path belongs to a network filesystem.
pub(crate) fn is_network_mount(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        return filesystem_type(path)
            .map(|filesystem| network_filesystem_name(&filesystem))
            .unwrap_or(false)
            || path.starts_with("/Network");
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        false
    }
}

/// Currently mounted network volumes, used to avoid re-mounting a server and
/// to detect the new volume that appears after a connection completes.
///
/// The mount table is used instead of probing every `/Volumes` entry so a
/// volume still appears when TCC currently denies the app read access to it.
#[cfg(target_os = "macos")]
pub(crate) fn network_mount_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(output) = std::process::Command::new("mount").output() {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let Some((_source, rest)) = line.split_once(" on ") else {
                continue;
            };
            let Some((mount, tail)) = rest.rsplit_once(" (") else {
                continue;
            };
            let filesystem = tail
                .split(',')
                .next()
                .unwrap_or("")
                .trim()
                .to_lowercase();
            if network_filesystem_name(&filesystem) {
                paths.push(PathBuf::from(mount));
            }
        }
    }
    if paths.is_empty() {
        if let Ok(reader) = fs::read_dir("/Volumes") {
            for item in reader.flatten() {
                let path = item.path();
                if is_network_mount(&path) {
                    paths.push(path);
                }
            }
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn network_mount_paths() -> Vec<PathBuf> {
    Vec::new()
}

pub fn sidebar_locations() -> Vec<Location> {
    let mut locations = Vec::new();
    push_location(
        &mut locations,
        "home",
        "Home",
        home_dir(),
        "home",
        "home",
        false,
    );
    if let Some(path) = dirs::desktop_dir() {
        push_location(
            &mut locations,
            "desktop",
            "Desktop",
            path,
            "folder",
            "desktop",
            false,
        );
    }
    if let Some(path) = dirs::download_dir() {
        push_location(
            &mut locations,
            "downloads",
            "Downloads",
            path,
            "folder",
            "downloads",
            false,
        );
    }
    if let Some(path) = dirs::document_dir() {
        push_location(
            &mut locations,
            "documents",
            "Documents",
            path,
            "folder",
            "documents",
            false,
        );
    }
    if let Some(path) = dirs::picture_dir() {
        push_location(
            &mut locations,
            "pictures",
            "Pictures",
            path,
            "folder",
            "pictures",
            false,
        );
    }
    if let Some(path) = dirs::audio_dir() {
        push_location(
            &mut locations,
            "music",
            "Music",
            path,
            "folder",
            "music",
            false,
        );
    }
    if let Some(path) = dirs::video_dir() {
        push_location(
            &mut locations,
            "videos",
            "Videos",
            path,
            "folder",
            "movies",
            false,
        );
    }

    #[cfg(target_os = "macos")]
    {
        // Finder-style places that are not part of the standard user folders.
        // Each is optional: iCloud Drive only appears when the user has it.
        push_location(
            &mut locations,
            "shared",
            "Shared",
            PathBuf::from("/Users/Shared"),
            "folder",
            "shared",
            false,
        );
        if let Some(home) = dirs::home_dir() {
            push_location(
                &mut locations,
                "icloud",
                "iCloud Drive",
                home.join("Library/Mobile Documents/com~apple~CloudDocs"),
                "folder",
                "icloud",
                false,
            );
            push_location(
                &mut locations,
                "trash",
                "Trash",
                home.join(".Trash"),
                "folder",
                "trash",
                false,
            );
        }
        let applications = PathBuf::from("/Applications");
        push_location(
            &mut locations,
            "applications",
            "Applications",
            applications,
            "folder",
            "applications",
            false,
        );
        push_location(
            &mut locations,
            "root",
            "Macintosh HD",
            PathBuf::from("/"),
            "drive",
            "drive",
            true,
        );
        if let Ok(reader) = fs::read_dir("/Volumes") {
            let mut volumes: Vec<PathBuf> = reader
                .filter_map(|item| item.ok())
                .map(|item| item.path())
                .filter(|path| path.is_dir())
                .filter(|path| {
                    path.file_name()
                        .map(|name| !name.to_string_lossy().starts_with('.'))
                        .unwrap_or(false)
                })
                .filter(|path| {
                    fs::canonicalize(path)
                        .map(|canonical| canonical != Path::new("/"))
                        .unwrap_or(true)
                })
                .collect();
            volumes.sort();
            for volume in volumes {
                let name = volume
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Volume".to_string());
                let network = is_network_mount(&volume);
                push_location(
                    &mut locations,
                    &format!("volume:{name}"),
                    &name,
                    volume,
                    if network { "network" } else { "drive" },
                    if network { "network" } else { "drive" },
                    true,
                );
            }
        }
        // The mount table still knows about a mounted network volume even when
        // macOS TCC temporarily denies the app access to its mount point. Show
        // it so the user can click it and see the actionable permission error.
        for mount in network_mount_paths() {
            if locations
                .iter()
                .any(|location| Path::new(&location.path) == mount)
            {
                continue;
            }
            let name = mount
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "Network".to_string());
            push_location_unchecked(
                &mut locations,
                &format!("volume:{name}"),
                &name,
                mount,
                "network",
                "network",
                true,
            );
        }
        if Path::new("/Network").exists() {
            push_location(
                &mut locations,
                "network",
                "Network",
                PathBuf::from("/Network"),
                "network",
                "network",
                false,
            );
        }
    }

    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            let path = PathBuf::from(&drive);
            if path.exists() {
                push_location(
                    &mut locations,
                    &format!("drive:{}", letter as char),
                    &format!("Local Disk ({}:)", letter as char),
                    path,
                    "drive",
                    "drive",
                    true,
                );
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            push_location(
                &mut locations,
                "trash",
                "Trash",
                home.join(".local/share/Trash/files"),
                "folder",
                "trash",
                false,
            );
        }
        push_location(
            &mut locations,
            "root",
            "File System",
            PathBuf::from("/"),
            "drive",
            "drive",
            true,
        );
    }

    locations
}

pub fn list_applications() -> Vec<ApplicationInfo> {
    #[cfg(target_os = "macos")]
    {
        let mut applications = Vec::new();
        let mut roots = vec![
            PathBuf::from("/Applications"),
            PathBuf::from("/System/Applications"),
        ];
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Applications"));
        }
        for root in roots {
            let reader = match fs::read_dir(root) {
                Ok(reader) => reader,
                Err(_) => continue,
            };
            for item in reader.flatten() {
                let path = item.path();
                if path.extension().and_then(|value| value.to_str()) == Some("app") {
                    if let Some(name) = path.file_stem() {
                        applications.push(ApplicationInfo {
                            name: name.to_string_lossy().to_string(),
                            path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
        applications.sort_by(|left, right| left.name.cmp(&right.name));
        applications.truncate(400);
        applications
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}
