use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use base64::Engine as _;

const CACHE_LIMIT: usize = 128;
/// Largest PNG we prefer to hand to the webview. 256 px is sharp for the
/// 112 px preview pane and small enough to keep the IPC payload reasonable.
const TARGET_ICON_PX: u32 = 256;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<PathBuf, Option<String>>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Returns a `data:image/png;base64,...` URL for a macOS `.app` bundle, or
/// `None` when the bundle has no readable icon. The result is cached for the
/// lifetime of the process.
pub fn app_icon_data_url(app_path: &Path) -> Option<String> {
    if !is_app_bundle(app_path) {
        return None;
    }

    let key = app_path.to_path_buf();
    if let Some(cached) = lock_cache().get(&key) {
        return cached.clone();
    }

    let value = read_bundle_icon(app_path);
    let mut entries = lock_cache();
    if entries.len() >= CACHE_LIMIT {
        entries.clear();
    }
    entries.insert(key, value.clone());
    value
}

fn lock_cache() -> std::sync::MutexGuard<'static, HashMap<PathBuf, Option<String>>> {
    cache().lock().unwrap_or_else(|error| error.into_inner())
}

pub fn is_app_bundle(path: &Path) -> bool {
    path.is_dir()
        && path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("app"))
}

fn read_bundle_icon(app_path: &Path) -> Option<String> {
    let contents = app_path.join("Contents");
    let resources = contents.join("Resources");
    let icon_path = locate_icon(app_path, &contents, &resources)?;
    let png = icon_png(&icon_path)?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

/// Finds the icon file declared by `Info.plist`, falling back to the bundle's
/// resource directory. Binary and XML plists are both supported.
fn locate_icon(app_path: &Path, contents: &Path, resources: &Path) -> Option<PathBuf> {
    if let Some(name) = plist_icon_name(&contents.join("Info.plist")) {
        let direct = resources.join(&name);
        if direct.is_file() {
            return Some(direct);
        }
        if Path::new(&name).extension().is_none() {
            let with_extension = resources.join(format!("{name}.icns"));
            if with_extension.is_file() {
                return Some(with_extension);
            }
        }
    }

    let candidates: Vec<PathBuf> = fs::read_dir(resources)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("icns"))
        })
        .collect();
    if candidates.is_empty() {
        return None;
    }

    let bundle_stem = app_path
        .file_stem()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if let Some(matching) = candidates
        .iter()
        .find(|path| file_stem(path).eq_ignore_ascii_case(&bundle_stem))
    {
        return Some(matching.clone());
    }
    for preferred in ["appicon", "app"] {
        if let Some(matching) = candidates
            .iter()
            .find(|path| file_stem(path).eq_ignore_ascii_case(preferred))
        {
            return Some(matching.clone());
        }
    }
    candidates.into_iter().max_by_key(|path| {
        fs::metadata(path)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
    })
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn plist_icon_name(path: &Path) -> Option<String> {
    let value = plist::Value::from_file(path).ok()?;
    let dictionary = value.as_dictionary()?;
    for key in ["CFBundleIconFile", "CFBundleIconName"] {
        if let Some(name) = dictionary.get(key).and_then(|value| value.as_string()) {
            let name = name.trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn icon_png(path: &Path) -> Option<Vec<u8>> {
    let bytes = fs::read(path).ok()?;
    if bytes.starts_with(PNG_SIGNATURE) {
        return Some(bytes);
    }
    if let Some(png) = png_from_icns(&bytes) {
        return Some(png);
    }
    #[cfg(target_os = "macos")]
    {
        convert_with_sips(path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// ICNS is a container of icon chunks. Modern bundles store PNG data in
/// `ic07`–`ic10`/`icp4`–`icp6` chunks, so the best PNG can be lifted out
/// without decoding the image.
fn png_from_icns(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() < 8 || &bytes[0..4] != b"icns" {
        return None;
    }
    let declared = u32::from_be_bytes(bytes[4..8].try_into().ok()?) as usize;
    let end = declared.min(bytes.len());
    let mut preferred: Option<&[u8]> = None;
    let mut fallback: Option<&[u8]> = None;
    let mut offset = 8;

    while offset + 8 <= end {
        let length = u32::from_be_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
        if length < 8 || offset.saturating_add(length) > end {
            break;
        }
        let data = &bytes[offset + 8..offset + length];
        if data.starts_with(PNG_SIGNATURE) {
            let width = png_width(data);
            let is_larger = match fallback {
                None => true,
                Some(current) => match (width, png_width(current)) {
                    (Some(width), Some(current_width)) => width > current_width,
                    _ => data.len() > current.len(),
                },
            };
            if is_larger {
                fallback = Some(data);
            }
            if let Some(width) = width {
                if width >= TARGET_ICON_PX
                    && preferred
                        .and_then(png_width)
                        .is_none_or(|current| width < current)
                {
                    preferred = Some(data);
                }
            }
        }
        offset += length;
    }

    preferred.or(fallback).map(|data| data.to_vec())
}

fn png_width(data: &[u8]) -> Option<u32> {
    if data.len() < 24 || !data.starts_with(PNG_SIGNATURE) || &data[12..16] != b"IHDR" {
        return None;
    }
    Some(u32::from_be_bytes(data[16..20].try_into().ok()?))
}

/// Fallback for legacy ICNS files that only contain raw ARGB bitmaps. `sips`
/// ships with macOS and converts every ICNS variant to PNG.
#[cfg(target_os = "macos")]
fn convert_with_sips(icns_path: &Path) -> Option<Vec<u8>> {
    use std::process::{Command, Stdio};
    use std::time::{SystemTime, UNIX_EPOCH};

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let output = std::env::temp_dir().join(format!(
        "maxplorer-icon-{}-{stamp}.png",
        std::process::id()
    ));
    let status = Command::new("sips")
        .args(["-s", "format", "png", "--resampleHeightWidthMax", "256"])
        .arg(icns_path)
        .arg("--out")
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;
    if !status.success() {
        let _ = fs::remove_file(&output);
        return None;
    }
    let bytes = fs::read(&output).ok();
    let _ = fs::remove_file(&output);
    bytes.filter(|data| data.starts_with(PNG_SIGNATURE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_png(width: u32, padding: usize) -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes.extend(std::iter::repeat_n(0, padding));
        bytes
    }

    fn icns(chunks: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
        let mut body = Vec::new();
        for (kind, data) in chunks {
            body.extend_from_slice(*kind);
            body.extend_from_slice(&((data.len() + 8) as u32).to_be_bytes());
            body.extend_from_slice(data);
        }
        let mut container = b"icns".to_vec();
        container.extend_from_slice(&((body.len() + 8) as u32).to_be_bytes());
        container.extend_from_slice(&body);
        container
    }

    fn decode(data_url: &str) -> Vec<u8> {
        let encoded = data_url
            .strip_prefix("data:image/png;base64,")
            .expect("data URL prefix");
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("valid base64")
    }

    fn make_bundle(
        root: &Path,
        stem: &str,
        icon: &[u8],
        plist_icon: Option<&str>,
    ) -> PathBuf {
        let app = root.join(format!("{stem}.app"));
        let resources = app.join("Contents").join("Resources");
        fs::create_dir_all(&resources).expect("resources");
        fs::write(resources.join(format!("{stem}.icns")), icon).expect("icon");
        if let Some(name) = plist_icon {
            let mut dictionary = plist::Dictionary::new();
            dictionary.insert(
                "CFBundleIconFile".to_string(),
                plist::Value::String(name.to_string()),
            );
            plist::Value::Dictionary(dictionary)
                .to_file_binary(app.join("Contents").join("Info.plist"))
                .expect("plist");
        }
        app
    }

    #[test]
    fn picks_the_smallest_png_at_or_above_the_target_width() {
        let small = fake_png(128, 10);
        let medium = fake_png(512, 10);
        let large = fake_png(1024, 10);
        let container = icns(&[
            (b"ic07", &small),
            (b"ic09", &medium),
            (b"ic10", &large),
        ]);
        assert_eq!(png_from_icns(&container), Some(medium));
    }

    #[test]
    fn falls_back_to_the_largest_png_when_all_are_small() {
        let tiny = fake_png(16, 10);
        let small = fake_png(32, 10);
        let container = icns(&[(b"icp4", &tiny), (b"icp5", &small)]);
        assert_eq!(png_from_icns(&container), Some(small));
    }

    #[test]
    fn ignores_chunks_that_are_not_png() {
        let legacy = vec![0u8; 64];
        let png = fake_png(256, 10);
        let container = icns(&[(b"it32", &legacy), (b"ic08", &png)]);
        assert_eq!(png_from_icns(&container), Some(png));
    }

    #[test]
    fn rejects_non_icns_data() {
        assert_eq!(png_from_icns(b"not an icns file"), None);
    }

    #[test]
    fn reads_the_icon_named_by_a_binary_info_plist() {
        let directory = tempfile::tempdir().expect("tempdir");
        let expected = fake_png(512, 20);
        let app = make_bundle(directory.path(), "Demo", &fake_png(128, 20), Some("Custom"));
        fs::write(
            app.join("Contents").join("Resources").join("Custom.icns"),
            icns(&[(b"ic09", &expected)]),
        )
        .expect("custom icon");
        fs::write(
            app.join("Contents").join("Resources").join("Other.icns"),
            icns(&[(b"ic10", &fake_png(1024, 20))]),
        )
        .expect("other icon");

        let data_url = app_icon_data_url(&app).expect("icon");
        assert_eq!(decode(&data_url), expected);
    }

    #[test]
    fn falls_back_to_the_bundle_named_icon() {
        let directory = tempfile::tempdir().expect("tempdir");
        let expected = fake_png(256, 20);
        let app = make_bundle(directory.path(), "Demo", &expected, None);
        fs::write(
            app.join("Contents").join("Resources").join("Other.icns"),
            icns(&[(b"ic10", &fake_png(1024, 20))]),
        )
        .expect("other icon");

        let data_url = app_icon_data_url(&app).expect("icon");
        assert_eq!(decode(&data_url), expected);
    }

    #[test]
    fn ignores_paths_that_are_not_application_bundles() {
        let directory = tempfile::tempdir().expect("tempdir");
        let folder = directory.path().join("Demo.app");
        fs::create_dir_all(&folder).expect("folder");
        assert!(is_app_bundle(&folder));
        assert_eq!(app_icon_data_url(&folder), None);

        let file = directory.path().join("Notes.txt");
        fs::write(&file, b"hello").expect("file");
        assert!(!is_app_bundle(&file));
        assert_eq!(app_icon_data_url(&file), None);
    }

    #[test]
    fn returns_none_when_no_icon_exists() {
        let directory = tempfile::tempdir().expect("tempdir");
        let app = directory.path().join("Empty.app");
        fs::create_dir_all(app.join("Contents").join("Resources")).expect("bundle");
        assert_eq!(app_icon_data_url(&app), None);
    }
}
