//! Phase 1 of the library/tracks bundle: `library.json`.
//!
//! The store holds one entry per watched title (or per episode, keyed
//! `tt<id>:<season>:<episode>`) with the position mpv last reported. It feeds
//! the board's Continue-watching row, the poster cards' progress bars and the
//! detail screen's Resume button, and it is the substrate Phase 2 writes the
//! per-title audio/subtitle choice into.
//!
//! Contract (docs/MEDIA_LIBRARY_TRACKS_SPEC.md):
//! - path: Tauri app-data dir `library.json`, versioned and forward-compatible
//!   (unknown keys survive a rewrite);
//! - writes are debounced and atomic (`library.json.tmp` → `fs::rename`), so a
//!   crash mid-write can never truncate the real file;
//! - a corrupt file is renamed `library.json.corrupt-<ts>` and an empty store is
//!   used (logged at WARN) instead of failing every playback;
//! - retention: the 500 most recent entries, and only entries between 2 % and
//!   95 % watched — a finished or barely-started title leaves the row.
//!
//! Everything a future failure needs to be root-caused is logged under
//! `media.library`: path + version + entry count on load, each write (debounced
//! or forced), retention drops, and corrupt-file recovery.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::logging;

const LOG_TARGET: &str = "media.library";

/// The schema this build writes. A newer file keeps its own version so an older
/// build never downgrades it.
pub const LIBRARY_VERSION: u32 = 1;
/// Entries kept after each write (most recent first).
pub const MAX_ENTRIES: usize = 500;
/// Below this fraction watched a title does not create an entry.
pub const MIN_RATIO: f64 = 0.02;
/// At or above this fraction the title counts as finished and leaves the row.
pub const MAX_RATIO: f64 = 0.95;
/// Writes wait this long after the last change so a 5 s progress tick does not
/// rewrite the whole file on every frame's `time-pos`.
const DEBOUNCE: Duration = Duration::from_millis(1500);

/// One library entry as stored in `library.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    /// Stremio type (`movie` / `series`), needed so a Continue-watching card can
    /// render without a catalog fetch.
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(default)]
    pub position_sec: f64,
    #[serde(default)]
    pub duration_sec: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode: Option<i64>,
    /// RFC-3339 UTC, e.g. `2026-11-21T13:40:00Z`.
    #[serde(default)]
    pub updated_at: String,
    /// Phase 2: the chosen audio track id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_id: Option<i64>,
    /// Phase 2: the chosen subtitle track id (`"off"` or a number).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subs_id: Option<Value>,
    /// Unknown keys are preserved on rewrite (forward compatibility).
    #[serde(flatten, default)]
    pub extra: Map<String, Value>,
}

impl Default for LibraryEntry {
    fn default() -> Self {
        Self {
            kind: None,
            name: None,
            poster: None,
            position_sec: 0.0,
            duration_sec: 0.0,
            season: None,
            episode: None,
            updated_at: String::new(),
            audio_id: None,
            subs_id: None,
            extra: Map::new(),
        }
    }
}

/// The whole file. `entries` is a map so the on-disk shape matches the spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub entries: BTreeMap<String, LibraryEntry>,
    #[serde(flatten, default)]
    pub extra: Map<String, Value>,
}

fn default_version() -> u32 {
    LIBRARY_VERSION
}

impl Default for LibraryFile {
    fn default() -> Self {
        Self {
            version: LIBRARY_VERSION,
            entries: BTreeMap::new(),
            extra: Map::new(),
        }
    }
}

/// What `media_library_get` returns.
#[derive(Debug, Clone, Serialize)]
pub struct LibrarySnapshot {
    pub version: u32,
    pub entries: BTreeMap<String, LibraryEntry>,
}

/// What `media_library_record` returns: the key the entry landed under (`metaId`
/// for a movie, `metaId:s:e` for an episode) and the stored entry, or `None`
/// when the position was outside the 2 %–95 % window and nothing was stored.
#[derive(Debug, Clone, Serialize)]
pub struct RecordOutcome {
    pub key: String,
    pub entry: Option<LibraryEntry>,
}

/// A progress update from the UI. Every field but the position/duration pair is
/// optional: an existing entry keeps what it already had.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPatch {
    pub meta_id: String,
    pub position_sec: f64,
    pub duration_sec: f64,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub poster: Option<String>,
    #[serde(default)]
    pub season: Option<i64>,
    #[serde(default)]
    pub episode: Option<i64>,
    #[serde(default)]
    pub audio_id: Option<i64>,
    #[serde(default)]
    pub subs_id: Option<Value>,
}

impl LibraryPatch {
    /// `tt1160419` for a movie, `tt1160419:2:3` for an episode.
    fn key(&self) -> String {
        match (self.season, self.episode) {
            (Some(season), Some(episode)) => {
                format!("{}:{season}:{episode}", self.meta_id)
            }
            _ => self.meta_id.clone(),
        }
    }
}

struct State {
    store: LibraryFile,
    dirty: bool,
    last_change: Option<Instant>,
    /// Writes performed since the process started (tests + the log line).
    writes: u64,
    /// Load diagnostics for the "created/corrupt/loaded" log line.
    loaded_entries: usize,
}

/// The process-wide library store. Cloning is cheap (`Arc` inside) but callers
/// normally hold the single static instance from [`shared`].
pub struct MediaLibrary {
    path: PathBuf,
    state: Arc<Mutex<State>>,
    debounce: Duration,
}

impl MediaLibrary {
    /// Opens (or creates) the library at `path` with the production debounce.
    pub fn open(path: PathBuf) -> Self {
        Self::open_with_debounce(path, DEBOUNCE)
    }

    /// Opens with an explicit debounce window — tests use a few milliseconds so
    /// they do not sleep for seconds.
    pub fn open_with_debounce(path: PathBuf, debounce: Duration) -> Self {
        let (store, loaded_entries) = load_store(&path);
        let state = Arc::new(Mutex::new(State {
            store,
            dirty: false,
            last_change: None,
            writes: 0,
            loaded_entries,
        }));
        spawn_debounce_writer(path.clone(), Arc::downgrade(&state), debounce);
        Self {
            path,
            state,
            debounce,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn snapshot(&self) -> LibrarySnapshot {
        let state = self.state.lock().unwrap();
        LibrarySnapshot {
            version: state.store.version,
            entries: state.store.entries.clone(),
        }
    }

    /// Records a position. Outside the 2 %–95 % window the entry is removed (a
    /// finished title must leave the row) and `entry: None` is returned.
    pub fn record(&self, patch: LibraryPatch) -> Result<RecordOutcome, String> {
        if !patch.position_sec.is_finite()
            || !patch.duration_sec.is_finite()
            || patch.duration_sec <= 0.0
            || patch.position_sec < 0.0
        {
            return Err(format!(
                "nonsensical progress: position {}s / duration {}s",
                patch.position_sec, patch.duration_sec
            ));
        }
        let key = patch.key();
        let mut state = self.state.lock().unwrap();
        let position_sec = patch.position_sec.min(patch.duration_sec);

        if !in_window(position_sec, patch.duration_sec) {
            let removed = state.store.entries.remove(&key).is_some();
            if removed {
                mark_dirty(&mut state);
                logging::debug(
                    LOG_TARGET,
                    format!(
                        "dropped {key} at {:.1}% (outside the 2–95% window)",
                        position_sec / patch.duration_sec * 100.0
                    ),
                );
            }
            return Ok(RecordOutcome { key, entry: None });
        }

        let existing = state.store.entries.get(&key).cloned();
        let mut entry = existing.clone().unwrap_or_default();
        // Patch semantics: only the fields the caller sent change; everything
        // else (including unknown forwarded keys) survives.
        if patch.kind.is_some() {
            entry.kind = patch.kind.clone();
        }
        if patch.name.is_some() {
            entry.name = patch.name.clone();
        }
        if patch.poster.is_some() {
            entry.poster = patch.poster.clone();
        }
        if patch.season.is_some() {
            entry.season = patch.season;
        }
        if patch.episode.is_some() {
            entry.episode = patch.episode;
        }
        if patch.audio_id.is_some() {
            entry.audio_id = patch.audio_id;
        }
        if patch.subs_id.is_some() {
            entry.subs_id = patch.subs_id.clone();
        }
        entry.position_sec = position_sec;
        entry.duration_sec = patch.duration_sec;
        entry.updated_at = now_iso();

        state.store.entries.insert(key.clone(), entry.clone());
        mark_dirty(&mut state);
        let ratio = position_sec / patch.duration_sec * 100.0;
        logging::debug(
            LOG_TARGET,
            format!(
                "recorded {key} at {position_sec:.1}s / {:.0}s ({ratio:.1}%)",
                patch.duration_sec
            ),
        );

        Ok(RecordOutcome {
            key,
            entry: Some(entry),
        })
    }

    /// Removes one entry and writes immediately: a removal is user-visible (the
    /// card disappears), so it must not wait for the debounce window — nor be
    /// resurrected by a quit before the next tick.
    pub fn remove(&self, key: &str) -> bool {
        let removed = {
            let mut state = self.state.lock().unwrap();
            let removed = state.store.entries.remove(key).is_some();
            if removed {
                mark_dirty(&mut state);
            }
            removed
        };
        if removed {
            logging::info(LOG_TARGET, format!("removed {key}"));
            if let Err(error) = self.flush() {
                logging::error(LOG_TARGET, format!("write after remove failed: {error}"));
            }
        }
        removed
    }

    /// Writes immediately if there is anything pending. Called on app exit, by
    /// `media_library_remove`, and by tests.
    pub fn flush(&self) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if !state.dirty {
            return Ok(());
        }
        write_store(&self.path, &mut state)
    }

    /// Number of disk writes performed (debounced or forced).
    pub fn writes(&self) -> u64 {
        self.state.lock().unwrap().writes
    }

    pub fn debounce(&self) -> Duration {
        self.debounce
    }
}

impl Drop for MediaLibrary {
    fn drop(&mut self) {
        if let Err(error) = self.flush() {
            logging::error(LOG_TARGET, format!("final flush failed: {error}"));
        }
    }
}

fn mark_dirty(state: &mut State) {
    state.dirty = true;
    state.last_change = Some(Instant::now());
}

/// Background debouncer: flushes once nothing has changed for `debounce`. Holds
/// only a `Weak`, so it stops when the library is dropped.
fn spawn_debounce_writer(path: PathBuf, state: Weak<Mutex<State>>, debounce: Duration) {
    let tick = debounce.min(Duration::from_millis(100)).max(Duration::from_millis(5));
    std::thread::Builder::new()
        .name("media-library-writer".into())
        .spawn(move || loop {
            std::thread::sleep(tick);
            let Some(state) = state.upgrade() else { break };
            let mut guard = match state.lock() {
                Ok(guard) => guard,
                Err(_) => break,
            };
            if !guard.dirty {
                continue;
            }
            let quiet = guard
                .last_change
                .map(|at| at.elapsed() >= debounce)
                .unwrap_or(true);
            if !quiet {
                continue;
            }
            if let Err(error) = write_store(&path, &mut guard) {
                logging::error(LOG_TARGET, format!("write failed: {error}"));
                // Back off so a persistently unwritable path does not spin.
                guard.last_change = Some(Instant::now());
            }
        })
        .expect("spawn library writer thread");
}

/// 2 %–95 % watched, exclusive on both ends (spec: `< 2 %` and `> 95 %` drop).
fn in_window(position_sec: f64, duration_sec: f64) -> bool {
    if !(duration_sec > 0.0) || !(position_sec > 0.0) {
        return false;
    }
    let ratio = position_sec / duration_sec;
    ratio.is_finite() && ratio > MIN_RATIO && ratio < MAX_RATIO
}

/// Retention: drop out-of-window entries, then keep the 500 most recent by
/// `updatedAt`. Returns the dropped keys so the caller can log them.
fn sanitize(store: &mut LibraryFile) -> Vec<String> {
    let mut dropped: Vec<String> = Vec::new();
    store.entries.retain(|key, entry| {
        if in_window(entry.position_sec, entry.duration_sec) {
            return true;
        }
        dropped.push(key.clone());
        false
    });

    if store.entries.len() > MAX_ENTRIES {
        let mut keys: Vec<String> = store.entries.keys().cloned().collect();
        keys.sort_by_key(|key| {
            std::cmp::Reverse(parse_iso_ms(&store.entries[key].updated_at).unwrap_or(0))
        });
        for key in keys.into_iter().skip(MAX_ENTRIES) {
            store.entries.remove(&key);
            dropped.push(key);
        }
    }
    dropped
}

fn write_store(path: &Path, state: &mut State) -> Result<(), String> {
    let dropped = sanitize(&mut state.store);
    if !dropped.is_empty() {
        logging::info(
            LOG_TARGET,
            format!(
                "retention dropped {} entr{} ({} kept): {}",
                dropped.len(),
                if dropped.len() == 1 { "y" } else { "ies" },
                state.store.entries.len(),
                dropped
                    .iter()
                    .take(6)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        );
    }

    let json = serde_json::to_string_pretty(&state.store)
        .map_err(|error| format!("serialize library: {error}"))?;
    let tmp = tmp_path(path);
    // Write + fsync the temp file, then rename over the real one: the replace is
    // atomic on the same filesystem, so a crash leaves either the old file or
    // the new one, never a half-written one.
    {
        let mut file = File::create(&tmp)
            .map_err(|error| format!("create {}: {error}", tmp.display()))?;
        file.write_all(json.as_bytes())
            .map_err(|error| format!("write {}: {error}", tmp.display()))?;
        file.write_all(b"\n")
            .map_err(|error| format!("write {}: {error}", tmp.display()))?;
        file.sync_all()
            .map_err(|error| format!("sync {}: {error}", tmp.display()))?;
    }
    fs::rename(&tmp, path).map_err(|error| {
        format!(
            "rename {} -> {}: {error}",
            tmp.display(),
            path.display()
        )
    })?;

    state.writes += 1;
    state.dirty = false;
    state.last_change = None;
    logging::info(
        LOG_TARGET,
        format!(
            "wrote {} ({} entries, version {}, write #{})",
            path.display(),
            state.store.entries.len(),
            state.store.version,
            state.writes
        ),
    );
    Ok(())
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    PathBuf::from(tmp)
}

fn corrupt_path(path: &Path) -> PathBuf {
    let mut backup = path.as_os_str().to_owned();
    backup.push(format!(".corrupt-{}", now_ms()));
    PathBuf::from(backup)
}

fn load_store(path: &Path) -> (LibraryFile, usize) {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            logging::info(
                LOG_TARGET,
                format!("{} does not exist yet; starting empty", path.display()),
            );
            return (LibraryFile::default(), 0);
        }
        Err(error) => {
            logging::warn(
                LOG_TARGET,
                format!("could not read {} ({error}); starting empty", path.display()),
            );
            return (LibraryFile::default(), 0);
        }
    };

    match serde_json::from_str::<LibraryFile>(&raw) {
        Ok(mut store) => {
            // A newer build's file keeps its version and its unknown keys; an
            // older one is upgraded in place.
            if store.version < LIBRARY_VERSION {
                store.version = LIBRARY_VERSION;
            }
            let before = store.entries.len();
            let dropped = sanitize(&mut store);
            if !dropped.is_empty() {
                logging::info(
                    LOG_TARGET,
                    format!(
                        "load dropped {} stale entr{} ({} kept)",
                        dropped.len(),
                        if dropped.len() == 1 { "y" } else { "ies" },
                        store.entries.len()
                    ),
                );
            }
            logging::info(
                LOG_TARGET,
                format!(
                    "loaded {} (version {}, {} entries{})",
                    path.display(),
                    store.version,
                    store.entries.len(),
                    if before != store.entries.len() {
                        format!(", {before} before retention")
                    } else {
                        String::new()
                    }
                ),
            );
            let count = store.entries.len();
            (store, count)
        }
        Err(error) => {
            let backup = corrupt_path(path);
            let moved = fs::rename(path, &backup);
            logging::warn(
                LOG_TARGET,
                match moved {
                    Ok(()) => format!(
                        "corrupt library.json ({error}); moved to {} and starting empty",
                        backup.display()
                    ),
                    Err(rename_error) => format!(
                        "corrupt library.json ({error}); could not move it to {} \
                         ({rename_error}); starting empty",
                        backup.display()
                    ),
                },
            );
            (LibraryFile::default(), 0)
        }
    }
}

/// The one store this process uses, created on the first command call.
static LIBRARY: OnceLock<MediaLibrary> = OnceLock::new();

fn library(app: &tauri::AppHandle) -> Result<&'static MediaLibrary, crate::error::AppError> {
    if let Some(library) = LIBRARY.get() {
        return Ok(library);
    }
    use tauri::Manager;
    let directory = app.path().app_data_dir().map_err(|error| {
        crate::error::AppError::new(
            "library_path",
            format!("Could not resolve the app data directory: {error}"),
            None,
        )
    })?;
    fs::create_dir_all(&directory).map_err(|error| {
        crate::error::AppError::new(
            "library_path",
            format!("Could not create {}: {error}", directory.display()),
            Some(directory.display().to_string()),
        )
    })?;
    Ok(LIBRARY.get_or_init(|| MediaLibrary::open(directory.join("library.json"))))
}

#[tauri::command]
pub fn media_library_get(app: tauri::AppHandle) -> Result<LibrarySnapshot, crate::error::AppError> {
    Ok(library(&app)?.snapshot())
}

/// Flushes the process-wide store if any command opened it. Called when the
/// window closes so a quit inside the debounce window cannot lose progress.
pub fn flush_global() {
    if let Some(library) = LIBRARY.get() {
        if let Err(error) = library.flush() {
            logging::error(LOG_TARGET, format!("shutdown flush failed: {error}"));
        }
    }
}

#[tauri::command]
pub fn media_library_record(
    app: tauri::AppHandle,
    patch: LibraryPatch,
) -> Result<RecordOutcome, crate::error::AppError> {
    library(&app)?
        .record(patch.clone())
        .map_err(|error| crate::error::AppError::new("library_record", error, None))
}

#[tauri::command]
pub fn media_library_remove(
    app: tauri::AppHandle,
    meta_id: String,
) -> Result<bool, crate::error::AppError> {
    let library = library(&app)?;
    let removed = library.remove(&meta_id);
    // A removal is user-visible (the card disappears): do not let a debounce
    // window resurrect it if the app quits next.
    library
        .flush()
        .map_err(|error| crate::error::AppError::new("library_write", error, None))?;
    Ok(removed)
}

// ── timestamps ───────────────────────────────────────────────────────────────
// ISO-8601 UTC without pulling in `chrono`: the store only needs whole seconds
// in, whole seconds out.

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn now_iso() -> String {
    iso_from_ms(now_ms())
}

pub fn iso_from_ms(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Parses `YYYY-MM-DDTHH:MM:SS[.fff]Z` (and a bare epoch-milliseconds number,
/// which an external writer may use). Returns epoch milliseconds.
pub fn parse_iso_ms(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(ms) = raw.parse::<i64>() {
        return Some(ms);
    }
    let bytes = raw.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year: i64 = raw.get(0..4)?.parse().ok()?;
    let month: u32 = raw.get(5..7)?.parse().ok()?;
    let day: u32 = raw.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let hour: i64 = raw.get(11..13)?.parse().ok()?;
    let minute: i64 = raw.get(14..16)?.parse().ok()?;
    let second: i64 = raw.get(17..19)?.parse().ok()?;
    let days = days_from_civil(year, month, day);
    Some((days * 86_400 + hour * 3600 + minute * 60 + second) * 1000)
}

/// Howard Hinnant's `civil_from_days` (days since 1970-01-01 → y/m/d).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe as i64 + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Inverse of [`civil_from_days`].
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = (year - era * 400) as u64; // [0, 399]
    let month = month as u64;
    let day = day as u64;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(position: f64, duration: f64, updated_at: &str) -> LibraryEntry {
        LibraryEntry {
            position_sec: position,
            duration_sec: duration,
            updated_at: updated_at.to_string(),
            ..LibraryEntry::default()
        }
    }

    fn patch(meta: &str, position: f64, duration: f64) -> LibraryPatch {
        LibraryPatch {
            meta_id: meta.to_string(),
            position_sec: position,
            duration_sec: duration,
            kind: Some("movie".into()),
            name: Some("Dune".into()),
            poster: Some("https://images.metahub.space/poster/large/dune/img".into()),
            season: None,
            episode: None,
            audio_id: None,
            subs_id: None,
        }
    }

    fn read_file(path: &Path) -> LibraryFile {
        let raw = fs::read_to_string(path).expect("library.json readable after flush");
        serde_json::from_str(&raw).expect("library.json parses")
    }

    #[test]
    fn iso_round_trips() {
        for raw in [
            "1970-01-01T00:00:00Z",
            "2026-11-21T13:40:00Z",
            "1999-12-31T23:59:59Z",
        ] {
            let ms = parse_iso_ms(raw).expect("parses");
            assert_eq!(iso_from_ms(ms), raw, "round trip for {raw}");
        }
        let now = now_iso();
        assert_eq!(now.len(), 20, "second-precision UTC: {now}");
        assert!(now.ends_with('Z'));
    }

    #[test]
    fn record_persists_through_flush() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let library = MediaLibrary::open_with_debounce(path.clone(), Duration::from_millis(5));

        let outcome = library.record(patch("tt1160419", 812.4, 9330.0)).unwrap();
        assert_eq!(outcome.key, "tt1160419");
        let stored = outcome.entry.expect("stored inside the window");
        assert_eq!(stored.position_sec, 812.4);
        assert_eq!(stored.kind.as_deref(), Some("movie"));
        assert_eq!(stored.name.as_deref(), Some("Dune"));

        library.flush().unwrap();
        let file = read_file(&path);
        assert_eq!(file.version, LIBRARY_VERSION);
        assert_eq!(file.entries.len(), 1);
        assert_eq!(file.entries["tt1160419"].position_sec, 812.4);
        assert!(
            !tmp_path(&path).exists(),
            "the temp file must be renamed away, not left behind"
        );
    }

    #[test]
    fn debounced_writes_coalesce() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let library = MediaLibrary::open_with_debounce(path, Duration::from_millis(200));
        for step in 1..=8 {
            library.record(patch("tt1", 10.0 * step as f64, 1000.0)).unwrap();
        }
        // Nothing is written while the caller keeps updating progress.
        assert_eq!(library.writes(), 0, "no write before the debounce window");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(library.writes(), 1, "one write for eight rapid updates");
        assert_eq!(library.snapshot().entries["tt1"].position_sec, 80.0);
    }

    #[test]
    fn out_of_window_positions_never_create_an_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let library = MediaLibrary::open_with_debounce(path.clone(), Duration::from_millis(5));

        // 1 % and 96 % are both outside the spec's > 2 %, < 95 % window.
        assert!(library.record(patch("tt-low", 10.0, 1000.0)).unwrap().entry.is_none());
        assert!(library.record(patch("tt-high", 960.0, 1000.0)).unwrap().entry.is_none());
        assert!(library.snapshot().entries.is_empty());

        // Watching past 95 % removes an existing entry.
        library.record(patch("tt-mid", 500.0, 1000.0)).unwrap();
        assert_eq!(library.snapshot().entries.len(), 1);
        assert!(library.record(patch("tt-mid", 951.0, 1000.0)).unwrap().entry.is_none());
        assert!(library.snapshot().entries.is_empty(), "finished title leaves the row");
    }

    #[test]
    fn retention_keeps_the_five_hundred_most_recent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let mut store = LibraryFile::default();
        for index in 0..505 {
            let updated = iso_from_ms(1_700_000_000_000 + index as i64 * 60_000);
            store
                .entries
                .insert(format!("tt{index}"), entry(500.0, 1000.0, &updated));
        }
        fs::write(&path, serde_json::to_string(&store).unwrap()).unwrap();

        let library = MediaLibrary::open_with_debounce(path.clone(), Duration::from_millis(5));
        assert_eq!(library.snapshot().entries.len(), MAX_ENTRIES);
        // The oldest five are the ones that went.
        assert!(!library.snapshot().entries.contains_key("tt0"));
        assert!(!library.snapshot().entries.contains_key("tt4"));
        assert!(library.snapshot().entries.contains_key("tt5"));
        assert!(library.snapshot().entries.contains_key("tt504"));
    }

    #[test]
    fn corrupt_file_is_moved_aside_and_starting_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        fs::write(&path, "{ this is not json").unwrap();

        let library = MediaLibrary::open_with_debounce(path.clone(), Duration::from_millis(5));
        assert!(library.snapshot().entries.is_empty());
        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("library.json.corrupt-"))
            .collect();
        assert_eq!(backups.len(), 1, "corrupt file kept as a backup: {backups:?}");

        // The store still works after recovery.
        library.record(patch("tt7", 100.0, 1000.0)).unwrap();
        library.flush().unwrap();
        assert_eq!(read_file(&path).entries.len(), 1);
    }

    #[test]
    fn truncated_main_file_never_loses_the_last_good_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let good = LibraryFile::default();
        fs::write(&path, serde_json::to_string(&good).unwrap()).unwrap();
        // A crash between `create` and `rename` leaves a half-written temp file;
        // the real file must still parse and the stale temp must not be read.
        fs::write(tmp_path(&path), "{\"version\": 1, \"entr").unwrap();

        let library = MediaLibrary::open_with_debounce(path.clone(), Duration::from_millis(5));
        assert!(library.snapshot().entries.is_empty());
        library.record(patch("tt9", 400.0, 1000.0)).unwrap();
        library.flush().unwrap();
        let file = read_file(&path);
        assert_eq!(file.entries.len(), 1);
    }

    #[test]
    fn unknown_keys_survive_a_rewrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        fs::write(
            &path,
            r#"{
              "version": 1,
              "theme": "violet",
              "entries": {
                "tt1": {
                  "type": "movie",
                  "positionSec": 500,
                  "durationSec": 1000,
                  "updatedAt": "2026-11-21T13:40:00Z",
                  "watchCount": 3
                }
              }
            }"#,
        )
        .unwrap();

        let library = MediaLibrary::open_with_debounce(path.clone(), Duration::from_millis(5));
        library.record(patch("tt1", 600.0, 1000.0)).unwrap();
        library.flush().unwrap();

        let raw: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["theme"], serde_json::json!("violet"), "top-level key kept");
        assert_eq!(raw["entries"]["tt1"]["watchCount"], serde_json::json!(3));
        assert_eq!(raw["entries"]["tt1"]["positionSec"], serde_json::json!(600.0));
        assert_eq!(raw["entries"]["tt1"]["name"], serde_json::json!("Dune"));
    }

    #[test]
    fn episodes_keep_per_episode_positions() {
        let dir = tempfile::tempdir().unwrap();
        let library = MediaLibrary::open_with_debounce(
            dir.path().join("library.json"),
            Duration::from_millis(5),
        );
        let mut first = patch("tt0903747", 900.0, 3000.0);
        first.season = Some(1);
        first.episode = Some(1);
        let mut second = patch("tt0903747", 300.0, 3000.0);
        second.season = Some(1);
        second.episode = Some(2);

        assert_eq!(library.record(first).unwrap().key, "tt0903747:1:1");
        assert_eq!(library.record(second).unwrap().key, "tt0903747:1:2");

        let entries = library.snapshot().entries;
        assert_eq!(entries["tt0903747:1:1"].position_sec, 900.0);
        assert_eq!(entries["tt0903747:1:2"].position_sec, 300.0);
    }

    #[test]
    fn remove_deletes_and_flushes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let library = MediaLibrary::open_with_debounce(path.clone(), Duration::from_millis(5000));
        library.record(patch("tt1", 500.0, 1000.0)).unwrap();
        // The long debounce means the file is only on disk because remove forces it.
        assert!(library.remove("tt1"));
        assert!(!library.remove("tt1"));
        assert_eq!(library.writes(), 1);
        assert!(read_file(&path).entries.is_empty());
    }

    #[test]
    fn nonsensical_progress_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let library = MediaLibrary::open_with_debounce(
            dir.path().join("library.json"),
            Duration::from_millis(5),
        );
        assert!(library.record(patch("tt1", f64::NAN, 1000.0)).is_err());
        assert!(library.record(patch("tt1", 1.0, 0.0)).is_err());
        assert!(library.snapshot().entries.is_empty());
    }
}