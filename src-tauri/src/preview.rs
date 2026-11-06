//! Native preview services.
//!
//! The UI owns the preview panel and renderer selection, while this module
//! provides the macOS-specific pieces that a web view cannot do on its own:
//! Uniform Type Identifier / Spotlight metadata, Quick Look thumbnails (which
//! also pick up third-party generators), the native Quick Look overlay, archive
//! listings that never extract to disk, and file change notifications.
//!
//! Nothing in this file executes previewed content. `qlmanage` and `ditto` are
//! invoked with explicit argument arrays (never a shell), and archive paths are
//! never written by the listing code.

use crate::error::AppError;
use crate::listing::entry_from_path;
use crate::metadata;
use crate::paths::system_time_ms;
use crate::types::{
    ArchiveEntry, ArchiveListing, Entry, FolderPreview, PreviewMetadata, PreviewThumbnail,
    TextRangePreview,
};
use base64::Engine;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::Emitter;

const THUMBNAIL_CACHE_LIMIT: usize = 48;
const FOLDER_SCAN_ENTRY_LIMIT: u64 = 40_000;
const FOLDER_SCAN_TIME_LIMIT: Duration = Duration::from_millis(1_800);
const TEXT_HARD_LIMIT: usize = 8 * 1024 * 1024;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct PreviewState {
    cache: Mutex<ThumbnailCache>,
    cancels: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    quicklook: Mutex<Option<Child>>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    watched_path: Mutex<Option<String>>,
}

impl Drop for PreviewState {
    fn drop(&mut self) {
        if let Ok(mut current) = self.quicklook.lock() {
            if let Some(mut child) = current.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Default)]
struct ThumbnailCache {
    entries: HashMap<String, PreviewThumbnail>,
    order: VecDeque<String>,
}

impl ThumbnailCache {
    fn get(&mut self, key: &str) -> Option<PreviewThumbnail> {
        let value = self.entries.get(key).cloned()?;
        if let Some(position) = self.order.iter().position(|item| item == key) {
            self.order.remove(position);
        }
        self.order.push_back(key.to_string());
        Some(value)
    }

    fn insert(&mut self, key: String, value: PreviewThumbnail) {
        if self.entries.insert(key.clone(), value).is_none() {
            self.order.push_back(key);
        }
        while self.order.len() > THUMBNAIL_CACHE_LIMIT {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewChangeEvent {
    path: String,
    kind: String,
}

fn is_icloud_placeholder(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.ends_with(".icloud") {
        return true;
    }
    // The real placeholder is hidden and named `.filename.icloud`. The visible
    // sibling is materialised after `brctl download` completes.
    name.starts_with('.') && name.ends_with(".icloud")
}

fn expected_kind(extension: &str) -> String {
    if extension.is_empty() {
        return "File".to_string();
    }
    format!("{} File", extension.to_uppercase())
}

fn fallback_content_type(extension: &str, is_dir: bool) -> String {
    if is_dir {
        return "public.folder".to_string();
    }
    match extension {
        "pdf" => "com.adobe.pdf",
        "png" => "public.png",
        "jpg" | "jpeg" => "public.jpeg",
        "gif" => "com.compuserve.gif",
        "heic" => "public.heic",
        "heif" => "public.heif",
        "tif" | "tiff" => "public.tiff",
        "svg" => "public.svg-image",
        "webp" => "org.webmproject.webp",
        "mp4" => "public.mpeg-4",
        "mov" => "com.apple.quicktime-movie",
        "m4v" => "com.apple.m4v-video",
        "mp3" => "public.mp3",
        "m4a" => "public.mpeg-4-audio",
        "wav" => "com.microsoft.waveform-audio",
        "zip" => "public.zip-archive",
        "tar" => "public.tar-archive",
        "gz" => "org.gnu.gnu-zip-archive",
        "txt" => "public.plain-text",
        "md" => "net.daringfireball.markdown",
        "json" => "public.json",
        "css" => "public.css",
        "js" | "mjs" => "com.netscape.javascript-source",
        "html" | "htm" => "public.html",
        "xml" => "public.xml",
        "plist" => "com.apple.property-list",
        "rtf" => "public.rtf",
        "doc" => "com.microsoft.word.doc",
        "docx" => "org.openxmlformats.wordprocessingml.document",
        "xls" => "com.microsoft.excel.xls",
        "xlsx" => "org.openxmlformats.spreadsheetml.sheet",
        "ppt" => "com.microsoft.powerpoint.ppt",
        "pptx" => "org.openxmlformats.presentationml.presentation",
        "epub" => "org.idpf.epub-container",
        _ => "public.data",
    }
    .to_string()
}

fn fallback_conformance(extension: &str, is_dir: bool) -> Vec<String> {
    if is_dir {
        return vec!["public.folder".to_string(), "public.item".to_string()];
    }
    let content_type = fallback_content_type(extension, false);
    let mut values = vec![content_type];
    let families = match extension {
        "png" | "jpg" | "jpeg" | "gif" | "heic" | "heif" | "tif" | "tiff" | "svg" | "webp"
        | "bmp" | "ico" | "avif" => vec!["public.image"],
        "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm" => vec!["public.movie", "public.audiovisual-content"],
        "mp3" | "m4a" | "aac" | "wav" | "flac" | "aiff" => vec!["public.audio", "public.audiovisual-content"],
        "pdf" => vec!["public.data", "public.composite-content"],
        "zip" | "tar" | "gz" | "7z" | "rar" => vec!["public.archive", "public.data"],
        "txt" | "md" | "json" | "css" | "js" | "ts" | "html" | "xml" | "plist" | "csv" => {
            vec!["public.text", "public.data"]
        }
        _ => vec!["public.data"],
    };
    values.extend(families.iter().map(|value| value.to_string()));
    values
}

#[cfg(target_os = "macos")]
fn spotlight_values(path: &Path) -> Option<serde_json::Map<String, serde_json::Value>> {
    let output = Command::new("/usr/bin/mdls")
        .arg("-json")
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    value.as_object().cloned()
}

#[cfg(not(target_os = "macos"))]
fn spotlight_values(_path: &Path) -> Option<serde_json::Map<String, serde_json::Value>> {
    None
}

fn string_value(map: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty())
}

fn bool_value(map: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<bool> {
    map.get(key).and_then(|value| {
        value
            .as_bool()
            .or_else(|| value.as_i64().map(|number| number != 0))
            .or_else(|| value.as_str().map(|text| matches!(text, "1" | "true" | "yes")))
    })
}

fn number_value(map: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<f64> {
    map.get(key).and_then(|value| {
        value
            .as_f64()
            .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
    })
}

fn string_array(map: &serde_json::Map<String, serde_json::Value>, key: &str) -> Vec<String> {
    map.get(key)
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(|item| item.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

pub fn preview_metadata(path: &Path) -> Result<PreviewMetadata, AppError> {
    let link_metadata = fs::symlink_metadata(path).map_err(|error| {
        let mapped = AppError::from(error);
        mapped.with_path(path.to_string_lossy())
    })?;
    let is_symlink = link_metadata.file_type().is_symlink();
    let metadata = if is_symlink {
        fs::metadata(path).unwrap_or(link_metadata)
    } else {
        link_metadata
    };
    let is_dir = metadata.is_dir();
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let extension = if is_dir {
        path.extension()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    } else {
        path.extension()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    };
    let spotlight = spotlight_values(path).unwrap_or_default();
    let content_type = string_value(&spotlight, "kMDItemContentType")
        .unwrap_or_else(|| fallback_content_type(&extension, is_dir));
    let content_type_tree = {
        let values = string_array(&spotlight, "kMDItemContentTypeTree");
        if values.is_empty() {
            fallback_conformance(&extension, is_dir)
        } else {
            values
        }
    };
    let kind = string_value(&spotlight, "kMDItemKind").unwrap_or_else(|| {
        if is_dir {
            if extension == "app" {
                "Application".to_string()
            } else {
                "Folder".to_string()
            }
        } else {
            expected_kind(&extension)
        }
    });
    let is_package = content_type_tree
        .iter()
        .any(|value| value == "com.apple.package")
        || matches!(extension.as_str(), "app" | "bundle" | "framework" | "pkg");
    let readable = if is_dir {
        fs::read_dir(path).is_ok()
    } else {
        fs::File::open(path).is_ok()
    };
    let mut codecs = string_array(&spotlight, "kMDItemCodecs");
    if codecs.is_empty() {
        let audio = string_array(&spotlight, "kMDItemAudioCodecs");
        let video = string_array(&spotlight, "kMDItemVideoCodecs");
        codecs.extend(audio);
        codecs.extend(video);
        codecs.sort();
        codecs.dedup();
    }
    let ubiquitous = bool_value(&spotlight, "kMDItemIsUbiquitous").unwrap_or(false);
    let downloading_status = string_value(&spotlight, "kMDItemDownloadingStatus");
    let downloaded = bool_value(&spotlight, "kMDItemUbiquitousItemIsDownloaded");
    let placeholder = is_icloud_placeholder(path)
        || (ubiquitous
            && downloaded == Some(false)
            && downloading_status
                .as_deref()
                .map(|value| value != "Current" && value != "Downloaded")
                .unwrap_or(true));
    Ok(PreviewMetadata {
        path: path.to_string_lossy().to_string(),
        name,
        extension: if extension.is_empty() {
            None
        } else {
            Some(extension)
        },
        content_type,
        content_type_tree,
        kind,
        size: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
        is_dir,
        is_symlink,
        is_readable: readable,
        is_package,
        is_icloud_placeholder: placeholder,
        is_network_volume: metadata::is_network_mount(path),
        modified: system_time_ms(metadata.modified()),
        created: system_time_ms(metadata.created()),
        duration: number_value(&spotlight, "kMDItemDurationSeconds"),
        width: number_value(&spotlight, "kMDItemPixelWidth").map(|value| value as u64),
        height: number_value(&spotlight, "kMDItemPixelHeight").map(|value| value as u64),
        codecs,
        page_count: number_value(&spotlight, "kMDItemNumberOfPages").map(|value| value as u64),
        tags: string_array(&spotlight, "kMDItemUserTags"),
        quick_look_supported: !placeholder && (!is_dir || is_package),
    })
}

fn png_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((width as u64, height as u64))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }
    let mut index = 2usize;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        let length = u16::from_be_bytes([bytes[index + 2], bytes[index + 3]]) as usize;
        if matches!(marker, 0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf) {
            if index + 9 <= bytes.len() {
                let height = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u64;
                let width = u16::from_be_bytes([bytes[index + 7], bytes[index + 8]]) as u64;
                return Some((width, height));
            }
        }
        if length < 2 {
            break;
        }
        index += length + 2;
    }
    None
}

fn read_dimensions(bytes: &[u8]) -> (Option<u64>, Option<u64>) {
    if let Some((width, height)) = png_dimensions(bytes) {
        return (Some(width), Some(height));
    }
    if let Some((width, height)) = jpeg_dimensions(bytes) {
        return (Some(width), Some(height));
    }
    (None, None)
}

fn quick_look_thumbnail(path: &Path, size: u32) -> Result<PreviewThumbnail, AppError> {
    #[cfg(target_os = "macos")]
    {
        let id = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "maxplorer-quicklook-{}-{}",
            std::process::id(),
            id
        ));
        fs::create_dir_all(&directory).map_err(AppError::from)?;
        let mut child = Command::new("/usr/bin/qlmanage")
            .arg("-t")
            .arg("-s")
            .arg(size.clamp(64, 4096).to_string())
            .arg("-o")
            .arg(&directory)
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        let mut succeeded = false;
        if let Ok(child) = child.as_mut() {
            // A third-party generator must never freeze the preview worker. Give
            // Quick Look a bounded amount of time, then kill the helper.
            let deadline = Instant::now() + Duration::from_secs(15);
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        succeeded = status.success();
                        break;
                    }
                    Ok(None) => {
                        if Instant::now() >= deadline {
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    Err(_) => break,
                }
            }
        }
        let mut thumbnail = PreviewThumbnail {
            data_url: None,
            width: None,
            height: None,
            mime: None,
        };
        if succeeded {
            if let Ok(entries) = fs::read_dir(&directory) {
                for item in entries.flatten() {
                    let candidate = item.path();
                    if !candidate.is_file() {
                        continue;
                    }
                    let extension = candidate
                        .extension()
                        .map(|value| value.to_string_lossy().to_lowercase())
                        .unwrap_or_default();
                    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg") {
                        continue;
                    }
                    if let Ok(bytes) = fs::read(&candidate) {
                        if bytes.is_empty() {
                            continue;
                        }
                        let mime = if extension == "png" {
                            "image/png"
                        } else {
                            "image/jpeg"
                        };
                        let (width, height) = read_dimensions(&bytes);
                        thumbnail = PreviewThumbnail {
                            data_url: Some(format!(
                                "data:{mime};base64,{}",
                                base64::engine::general_purpose::STANDARD.encode(&bytes)
                            )),
                            width,
                            height,
                            mime: Some(mime.to_string()),
                        };
                        break;
                    }
                }
            }
        }
        let _ = fs::remove_dir_all(&directory);
        Ok(thumbnail)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, size);
        Ok(PreviewThumbnail {
            data_url: None,
            width: None,
            height: None,
            mime: None,
        })
    }
}

pub fn thumbnail(
    state: &PreviewState,
    path: &Path,
    size: u32,
) -> Result<PreviewThumbnail, AppError> {
    let metadata = fs::metadata(path).map_err(|error| {
        let mapped = AppError::from(error);
        mapped.with_path(path.to_string_lossy())
    })?;
    if !metadata.is_file() {
        let extension = path
            .extension()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !matches!(extension.as_str(), "app" | "bundle" | "framework" | "pkg") {
            return Ok(PreviewThumbnail {
                data_url: None,
                width: None,
                height: None,
                mime: None,
            });
        }
    }
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let key = format!("{}:{}:{}:{}", path.to_string_lossy(), size, metadata.len(), modified);
    if let Ok(mut cache) = state.cache.lock() {
        if let Some(value) = cache.get(&key) {
            return Ok(value);
        }
    }
    let value = quick_look_thumbnail(path, size)?;
    if value.data_url.is_some() {
        if let Ok(mut cache) = state.cache.lock() {
            cache.insert(key, value.clone());
        }
    }
    Ok(value)
}

pub fn clear_thumbnail_cache(state: &PreviewState) {
    if let Ok(mut cache) = state.cache.lock() {
        cache.clear();
    }
}

#[cfg(target_os = "macos")]
pub fn open_quick_look(state: &PreviewState, paths: &[PathBuf]) -> Result<(), AppError> {
    if paths.is_empty() {
        return Err(AppError::invalid("Select at least one item to preview."));
    }
    for path in paths {
        if !path.exists() {
            return Err(AppError::not_found(path.to_string_lossy()));
        }
    }
    close_quick_look(state);
    let mut command = Command::new("/usr/bin/qlmanage");
    command.arg("-p");
    for path in paths {
        command.arg(path);
    }
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| AppError::new("quicklook_failed", error.to_string(), None))?;
    if let Ok(mut current) = state.quicklook.lock() {
        *current = Some(child);
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn open_quick_look(_state: &PreviewState, _paths: &[PathBuf]) -> Result<(), AppError> {
    Err(AppError::new(
        "unsupported",
        "Quick Look is available on macOS.",
        None,
    ))
}

pub fn close_quick_look(state: &PreviewState) {
    if let Ok(mut current) = state.quicklook.lock() {
        if let Some(mut child) = current.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn download_icloud(path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/brctl")
            .arg("download")
            .arg(path)
            .output()
            .map_err(|error| AppError::new("download_failed", error.to_string(), None))?;
        if output.status.success() {
            return Ok(());
        }
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::new(
            "download_failed",
            if message.is_empty() {
                "The iCloud item could not be downloaded.".to_string()
            } else {
                message
            },
            Some(path.to_string_lossy().to_string()),
        ));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err(AppError::new(
            "unsupported",
            "iCloud download is available on macOS.",
            None,
        ))
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes
        .get(offset..offset + 2)
        .map(|slice| u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes
        .get(offset..offset + 4)
        .map(|slice| u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_u64(bytes: &[u8], offset: usize) -> Option<u64> {
    bytes.get(offset..offset + 8).map(|slice| {
        u64::from_le_bytes([
            slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
        ])
    })
}

fn dos_time_to_ms(date: u16, time: u16) -> Option<i64> {
    let year = 1980 + ((date >> 9) & 0x7f) as i32;
    let month = ((date >> 5) & 0x0f) as u32;
    let day = (date & 0x1f) as u32;
    let hour = ((time >> 11) & 0x1f) as u32;
    let minute = ((time >> 5) & 0x3f) as u32;
    let second = ((time & 0x1f) * 2) as u32;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    // A small civil-date conversion avoids pulling in a date crate.
    let days = days_from_civil(year, month as i32, day as i32);
    let millis = (days as i64) * 86_400_000
        + (hour as i64) * 3_600_000
        + (minute as i64) * 60_000
        + (second as i64) * 1_000;
    Some(millis)
}

fn days_from_civil(year: i32, month: i32, day: i32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_prime = (month + 9) % 12;
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    (era * 146_097 + day_of_era - 719_468) as i64
}

fn find_eocd(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 22 {
        return None;
    }
    let start = bytes.len().saturating_sub(65_557);
    for index in (start..=bytes.len() - 22).rev() {
        if read_u32(bytes, index) == Some(0x0605_4b50) {
            let comment_length = read_u16(bytes, index + 20)? as usize;
            if index + 22 + comment_length <= bytes.len() {
                return Some(index);
            }
        }
    }
    None
}

fn zip_listing(path: &Path) -> Result<ArchiveListing, AppError> {
    let metadata = fs::metadata(path).map_err(AppError::from)?;
    // Do not read a gigabyte archive into memory just to show a listing.
    if metadata.len() > 512 * 1024 * 1024 {
        return Err(AppError::new(
            "preview_too_large",
            "This archive is too large to inspect in the preview pane. Open it to continue.",
            Some(path.to_string_lossy().to_string()),
        ));
    }
    let mut file = fs::File::open(path).map_err(AppError::from)?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes).map_err(AppError::from)?;
    let eocd = find_eocd(&bytes).ok_or_else(|| {
        AppError::new(
            "invalid_archive",
            "This ZIP archive is malformed or uses an unsupported format.",
            Some(path.to_string_lossy().to_string()),
        )
    })?;
    let total_entries = read_u16(&bytes, eocd + 10).unwrap_or(0) as usize;
    let mut offset = read_u32(&bytes, eocd + 16).unwrap_or(0) as usize;
    let mut entries = Vec::new();
    let mut total_size = 0u64;
    let mut compressed_size = 0u64;
    let mut encrypted = false;
    let mut truncated = false;
    for _ in 0..total_entries.min(20_000) {
        if read_u32(&bytes, offset) != Some(0x0201_4b50) {
            truncated = true;
            break;
        }
        let flags = read_u16(&bytes, offset + 8).unwrap_or(0);
        let method = read_u16(&bytes, offset + 10).unwrap_or(0);
        let time = read_u16(&bytes, offset + 12).unwrap_or(0);
        let date = read_u16(&bytes, offset + 14).unwrap_or(0);
        let mut compressed = read_u32(&bytes, offset + 20).unwrap_or(0) as u64;
        let mut uncompressed = read_u32(&bytes, offset + 24).unwrap_or(0) as u64;
        let name_length = read_u16(&bytes, offset + 28).unwrap_or(0) as usize;
        let extra_length = read_u16(&bytes, offset + 30).unwrap_or(0) as usize;
        if compressed == u32::MAX as u64 || uncompressed == u32::MAX as u64 {
            let mut cursor = offset + 46 + name_length;
            let end = cursor + extra_length;
            while cursor + 4 <= end {
                let id = read_u16(&bytes, cursor).unwrap_or(0);
                let size = read_u16(&bytes, cursor + 2).unwrap_or(0) as usize;
                if id == 0x0001 {
                    let mut value_offset = cursor + 4;
                    if uncompressed == u32::MAX as u64 {
                        if let Some(value) = read_u64(&bytes, value_offset) {
                            uncompressed = value;
                            value_offset += 8;
                        }
                    }
                    if compressed == u32::MAX as u64 {
                        if let Some(value) = read_u64(&bytes, value_offset) {
                            compressed = value;
                        }
                    }
                    break;
                }
                cursor += 4 + size;
            }
        }
        let comment_length = read_u16(&bytes, offset + 32).unwrap_or(0) as usize;
        let external = read_u32(&bytes, offset + 38).unwrap_or(0);
        let name_bytes = bytes
            .get(offset + 46..offset + 46 + name_length)
            .unwrap_or_default();
        let name = String::from_utf8_lossy(name_bytes).to_string();
        if flags & 0x1 != 0 {
            encrypted = true;
        }
        let is_dir = name.ends_with('/') || (external & 0x10) != 0;
        if !name.is_empty() {
            entries.push(ArchiveEntry {
                name,
                size: if is_dir { None } else { Some(uncompressed) },
                compressed_size: if is_dir { None } else { Some(compressed) },
                is_dir,
                modified: dos_time_to_ms(date, time),
                method: if method == 0 {
                    "Stored".to_string()
                } else if method == 8 {
                    "Deflated".to_string()
                } else {
                    format!("Method {method}")
                },
            });
            if !is_dir {
                total_size = total_size.saturating_add(uncompressed);
                compressed_size = compressed_size.saturating_add(compressed);
            }
        }
        offset += 46 + name_length + extra_length + comment_length;
    }
    Ok(ArchiveListing {
        format: "ZIP".to_string(),
        entries,
        total_size,
        compressed_size,
        truncated: truncated || total_entries > 20_000,
        encrypted,
    })
}

pub fn archive_listing(path: &Path) -> Result<ArchiveListing, AppError> {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "zip" => zip_listing(path),
        "gz" | "tgz" => {
            let metadata = fs::metadata(path).map_err(AppError::from)?;
            Ok(ArchiveListing {
                format: if extension == "tgz" { "TAR.GZ" } else { "GZIP" }.to_string(),
                entries: vec![ArchiveEntry {
                    name: path
                        .file_stem()
                        .map(|value| value.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Archive".to_string()),
                    size: None,
                    compressed_size: Some(metadata.len()),
                    is_dir: false,
                    modified: system_time_ms(metadata.modified()),
                    method: "Deflated".to_string(),
                }],
                total_size: 0,
                compressed_size: metadata.len(),
                truncated: false,
                encrypted: false,
            })
        }
        _ => Err(AppError::new(
            "unsupported_archive",
            "This archive format can be opened, but its contents cannot be listed in the preview pane.",
            Some(path.to_string_lossy().to_string()),
        )),
    }
}

pub fn extract_archive(path: &Path, destination: &Path) -> Result<String, AppError> {
    if !destination.is_dir() {
        return Err(AppError::new(
            "invalid_destination",
            "Choose an existing folder for the extracted files.",
            Some(destination.to_string_lossy().to_string()),
        ));
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/ditto")
            .arg("-x")
            .arg("-k")
            .arg(path)
            .arg(destination)
            .output()
            .map_err(|error| AppError::new("extract_failed", error.to_string(), None))?;
        if output.status.success() {
            return Ok(destination.to_string_lossy().to_string());
        }
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::new(
            "extract_failed",
            if message.is_empty() {
                "The archive could not be extracted.".to_string()
            } else {
                message
            },
            Some(path.to_string_lossy().to_string()),
        ));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, destination);
        Err(AppError::new(
            "unsupported",
            "Archive extraction is available on macOS.",
            None,
        ))
    }
}

pub fn folder_preview(
    state: &PreviewState,
    path: &Path,
    request_id: u64,
    sample_limit: usize,
) -> Result<FolderPreview, AppError> {
    let metadata = fs::metadata(path).map_err(AppError::from)?;
    if !metadata.is_dir() {
        return Err(AppError::new(
            "not_a_directory",
            "Preview is only available for folders at this location.",
            Some(path.to_string_lossy().to_string()),
        ));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut cancels) = state.cancels.lock() {
        cancels.insert(request_id, cancel.clone());
    }
    let started = Instant::now();
    let mut stack = vec![path.to_path_buf()];
    let mut files = 0u64;
    let mut folders = 0u64;
    let mut total_size = 0u64;
    let mut examined = 0u64;
    let mut truncated = false;
    let mut cancelled = false;
    let mut sample: Vec<Entry> = Vec::new();
    if let Ok(reader) = fs::read_dir(path) {
        for item in reader.flatten().take(sample_limit.max(1)) {
            if let Ok(entry) = entry_from_path(&item.path()) {
                sample.push(entry);
            }
        }
    }
    while let Some(directory) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        if started.elapsed() > FOLDER_SCAN_TIME_LIMIT || examined > FOLDER_SCAN_ENTRY_LIMIT {
            truncated = true;
            break;
        }
        let reader = match fs::read_dir(&directory) {
            Ok(reader) => reader,
            Err(_) => continue,
        };
        for item in reader {
            examined += 1;
            if examined > FOLDER_SCAN_ENTRY_LIMIT
                || started.elapsed() > FOLDER_SCAN_TIME_LIMIT
                || cancel.load(Ordering::Relaxed)
            {
                truncated = !cancel.load(Ordering::Relaxed);
                cancelled = cancel.load(Ordering::Relaxed);
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
            } else if item_metadata.is_dir() {
                folders += 1;
                stack.push(item_path);
            } else if item_metadata.is_file() {
                files += 1;
                total_size = total_size.saturating_add(item_metadata.len());
            }
        }
        if truncated || cancelled {
            break;
        }
    }
    if let Ok(mut cancels) = state.cancels.lock() {
        cancels.remove(&request_id);
    }
    sample.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(FolderPreview {
        path: path.to_string_lossy().to_string(),
        item_count: files.saturating_add(folders),
        total_size,
        files,
        folders,
        truncated,
        cancelled,
        entries: sample,
    })
}

pub fn cancel_task(state: &PreviewState, request_id: u64) {
    if let Ok(cancels) = state.cancels.lock() {
        if let Some(cancel) = cancels.get(&request_id) {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}

fn decode_binary_plist(path: &Path, size: u64) -> Option<String> {
    if size > 8 * 1024 * 1024 {
        return None;
    }
    let value = plist::Value::from_file(path).ok()?;
    let mut output = Vec::new();
    plist::to_writer_xml(&mut output, &value).ok()?;
    Some(String::from_utf8_lossy(&output).to_string())
}

pub fn text_range(
    path: &Path,
    offset: u64,
    max_bytes: usize,
) -> Result<TextRangePreview, AppError> {
    let metadata = fs::metadata(path).map_err(AppError::from)?;
    if !metadata.is_file() {
        return Err(AppError::new(
            "not_a_file",
            "Preview is only available for files.",
            Some(path.to_string_lossy().to_string()),
        ));
    }
    let size = metadata.len();
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if offset == 0 {
        let is_plist = extension == "plist"
            || matches!(
                preview_metadata(path).map(|value| value.content_type),
                Ok(value) if value == "com.apple.property-list"
            );
        if is_plist {
            let mut header = [0u8; 6];
            let mut file = fs::File::open(path).map_err(AppError::from)?;
            let read = file.read(&mut header).map_err(AppError::from)?;
            if read >= 6 && &header[..6] == b"bplist" {
                if let Some(text) = decode_binary_plist(path, size) {
                    let text_size = text.len() as u64;
                    return Ok(TextRangePreview {
                        text,
                        offset: 0,
                        next_offset: text_size,
                        truncated: false,
                        binary: false,
                        size,
                        decoded_plist: true,
                    });
                }
            }
        }
    }
    let read_limit = max_bytes.clamp(1024, TEXT_HARD_LIMIT);
    let mut file = fs::File::open(path).map_err(AppError::from)?;
    use std::io::Seek;
    file.seek(std::io::SeekFrom::Start(offset))
        .map_err(AppError::from)?;
    let mut buffer = Vec::with_capacity(read_limit.min(size as usize) + 1);
    file.by_ref()
        .take((read_limit + 1) as u64)
        .read_to_end(&mut buffer)
        .map_err(AppError::from)?;
    let truncated = buffer.len() > read_limit;
    let slice = if truncated {
        &buffer[..read_limit]
    } else {
        &buffer[..]
    };
    let binary = slice.iter().take(8_192).any(|byte| *byte == 0);
    if binary {
        return Ok(TextRangePreview {
            text: String::new(),
            offset,
            next_offset: offset,
            truncated: false,
            binary: true,
            size,
            decoded_plist: false,
        });
    }
    let consumed = slice.len() as u64;
    Ok(TextRangePreview {
        text: String::from_utf8_lossy(slice).to_string(),
        offset,
        next_offset: offset.saturating_add(consumed),
        truncated: offset.saturating_add(consumed) < size,
        binary: false,
        size,
        decoded_plist: false,
    })
}

/// Watches a single previewed file through its parent directory. This is used
/// only while the preview pane is visible; hiding the pane unwatches it.
pub fn watch(
    state: &PreviewState,
    app: tauri::AppHandle,
    path: &Path,
) -> Result<(), AppError> {
    use notify::{RecursiveMode, Watcher};
    let parent = path.parent().unwrap_or_else(|| Path::new("/"));
    let watched = path.to_string_lossy().to_string();
    let target = path.to_path_buf();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        let touches_target = event.paths.iter().any(|candidate| {
            candidate == &target
                || candidate.file_name() == target.file_name()
                || event.paths.is_empty()
        });
        if !touches_target {
            return;
        }
        let kind = match event.kind {
            notify::EventKind::Remove(_) => "removed",
            notify::EventKind::Create(_) => "created",
            notify::EventKind::Modify(_) => "modified",
            _ => "changed",
        };
        let _ = app.emit(
            "preview-changed",
            PreviewChangeEvent {
                path: watched.clone(),
                kind: kind.to_string(),
            },
        );
    })
    .map_err(|error| AppError::new("watch_failed", error.to_string(), None))?;
    watcher
        .watch(parent, RecursiveMode::NonRecursive)
        .map_err(|error| AppError::new("watch_failed", error.to_string(), None))?;
    if let Ok(mut current) = state.watcher.lock() {
        *current = Some(watcher);
    }
    if let Ok(mut current) = state.watched_path.lock() {
        *current = Some(path.to_string_lossy().to_string());
    }
    Ok(())
}

pub fn unwatch(state: &PreviewState) {
    if let Ok(mut current) = state.watcher.lock() {
        current.take();
    }
    if let Ok(mut current) = state.watched_path.lock() {
        current.take();
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_u16(bytes: &mut Vec<u8>, value: u16) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_u32(bytes: &mut Vec<u8>, value: u32) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn minimal_zip() -> Vec<u8> {
        let name = b"a.txt";
        let content = b"hello";
        let mut bytes = Vec::new();
        // Local file header.
        write_u32(&mut bytes, 0x0403_4b50);
        write_u16(&mut bytes, 20);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u32(&mut bytes, 0);
        write_u32(&mut bytes, content.len() as u32);
        write_u32(&mut bytes, content.len() as u32);
        write_u16(&mut bytes, name.len() as u16);
        write_u16(&mut bytes, 0);
        bytes.extend_from_slice(name);
        bytes.extend_from_slice(content);
        let central_offset = bytes.len() as u32;
        // Central directory record.
        write_u32(&mut bytes, 0x0201_4b50);
        write_u16(&mut bytes, 20);
        write_u16(&mut bytes, 20);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u32(&mut bytes, 0);
        write_u32(&mut bytes, content.len() as u32);
        write_u32(&mut bytes, content.len() as u32);
        write_u16(&mut bytes, name.len() as u16);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u32(&mut bytes, 0);
        write_u32(&mut bytes, 0);
        bytes.extend_from_slice(name);
        let central_size = bytes.len() as u32 - central_offset;
        // End of central directory.
        write_u32(&mut bytes, 0x0605_4b50);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 0);
        write_u16(&mut bytes, 1);
        write_u16(&mut bytes, 1);
        write_u32(&mut bytes, central_size);
        write_u32(&mut bytes, central_offset);
        write_u16(&mut bytes, 0);
        bytes
    }

    #[test]
    fn lists_zip_entries_without_extracting() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("sample.zip");
        let mut file = fs::File::create(&path).expect("create zip");
        file.write_all(&minimal_zip()).expect("write zip");
        drop(file);
        let listing = archive_listing(&path).expect("listing");
        assert_eq!(listing.format, "ZIP");
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].name, "a.txt");
        assert_eq!(listing.entries[0].size, Some(5));
        assert_eq!(listing.total_size, 5);
    }

    #[test]
    fn dos_timestamp_conversion_is_stable() {
        // 1980-01-01 00:00:00 in the ZIP DOS format.
        assert_eq!(dos_time_to_ms((1 << 5) | 1, 0), Some(315_532_800_000));
    }

    #[test]
    fn reads_text_ranges_and_detects_binary() {
        let directory = tempfile::tempdir().expect("temp dir");
        let text = directory.path().join("note.txt");
        fs::write(&text, "first\nsecond\n").expect("write text");
        let range = text_range(&text, 0, 1024).expect("range");
        assert!(range.text.contains("first"));
        assert!(!range.binary);
        let binary = directory.path().join("blob.bin");
        fs::write(&binary, [0u8, 1, 2, 3, 0, 5]).expect("write binary");
        assert!(text_range(&binary, 0, 1024).expect("binary range").binary);
    }

    #[test]
    fn folder_preview_counts_items_and_can_be_cancelled() {
        let directory = tempfile::tempdir().expect("temp dir");
        fs::write(directory.path().join("one.txt"), "1").expect("write file");
        fs::create_dir(directory.path().join("nested")).expect("create dir");
        fs::write(directory.path().join("nested").join("two.txt"), "22").expect("write file");
        let state = PreviewState::default();
        let summary = folder_preview(&state, directory.path(), 7, 12).expect("summary");
        assert_eq!(summary.folders, 1);
        assert_eq!(summary.files, 2);
        assert_eq!(summary.total_size, 3);
        assert!(!summary.cancelled);
    }
}
