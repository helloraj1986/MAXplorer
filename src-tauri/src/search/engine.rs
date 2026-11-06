use crate::error::AppError;
use crate::search::extract;
use crate::search::live;
use crate::search::model::{
    DuplicateFile, DuplicateGroup, DuplicateRequest, DuplicateResponse, IndexError, IndexStatus,
    LocationCoverage, SearchHit, SearchMode, SearchRequest, SearchSuggestion, SortDirection,
    SortOrder,
};
use crate::types::Entry;
use rusqlite::{params, params_from_iter, Connection, OpenFlags, OptionalExtension};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const SCHEMA_VERSION: i64 = 2;
pub const DEFAULT_MAX_CONTENT_BYTES: u64 = 1_500_000;
/// Hard ceiling on rows pulled into memory for ranking. The previous value
/// (50 000) could allocate hundreds of megabytes per keystroke.
const CANDIDATE_LIMIT: usize = 12_000;
/// Guard for building the trigram name index: above this many rows the index is
/// built by the maintenance path after junk rows have been pruned, never on the
/// startup path.
const NAME_INDEX_MAX_ROWS: usize = 1_500_000;
/// How stale the materialised counters may get before the indexer refreshes them.
const COUNTS_TTL_MS: i64 = 5 * 60 * 1000;


fn db_error(error: rusqlite::Error) -> AppError {
    AppError::new("search_database", format!("Search index error: {error}"), None)
}

fn current_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn root_like_pattern(root: &str) -> String {
    let root = normalized_root(root);
    if root == "/" {
        "/%".to_string()
    } else if root.ends_with(':') {
        format!("{}\\%", escape_like(&root))
    } else {
        format!("{}/%", escape_like(&root))
    }
}

pub fn normalized_root(root: &str) -> String {
    let trimmed = root.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Scope gate shared by index, live, and Spotlight providers. A non-recursive
/// scope means immediate children of the selected folder, never its descendants.
pub fn entry_in_roots(path: &str, roots: &[String], recursive: bool) -> bool {
    if roots.is_empty() {
        return true;
    }
    roots.iter().any(|root| {
        if recursive {
            path_under_root(path, root)
        } else {
            Path::new(path)
                .parent()
                .map(|parent| parent.to_string_lossy() == normalized_root(root))
                .unwrap_or(false)
        }
    })
}

pub fn path_under_root(path: &str, root: &str) -> bool {
    let root = normalized_root(root);
    if root == "/" {
        return path.starts_with('/');
    }
    if path == root {
        return true;
    }
    let separator = if root.contains('\\') || root.ends_with(':') { '\\' } else { '/' };
    path.starts_with(&format!("{root}{separator}"))
}

fn path_key(path: &str) -> String {
    #[cfg(target_os = "macos")]
    {
        path.to_lowercase()
    }
    #[cfg(not(target_os = "macos"))]
    {
        path.to_string()
    }
}

pub struct SearchEngine {
    pub db_path: PathBuf,
    fts_available: Arc<AtomicBool>,
    /// True only once the trigram name index exists *and* is fully populated.
    /// A half-built index would silently hide results, so the flag is shared
    /// with the indexer thread and flips on completion.
    name_index: Arc<AtomicBool>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct IndexCounts {
    pub files: u64,
    pub folders: u64,
    pub content: u64,
    pub pending: u64,
    pub failed: u64,
    pub skipped: u64,
    pub updated_at: i64,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct PruneReport {
    pub examined: u64,
    pub removed: u64,
}

impl SearchEngine {
    pub fn open(db_path: PathBuf) -> Result<Self, AppError> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "search_database",
                    format!("Could not create the search index folder: {error}"),
                    Some(parent.to_string_lossy().to_string()),
                )
            })?;
        }
        let mut engine = Self {
            db_path,
            fts_available: Arc::new(AtomicBool::new(false)),
            name_index: Arc::new(AtomicBool::new(false)),
        };
        engine.migrate()?;
        Ok(engine)
    }

    pub fn name_index(&self) -> Arc<AtomicBool> {
        self.name_index.clone()
    }

    pub fn fts_available(&self) -> bool {
        self.fts_available.load(Ordering::Relaxed)
    }

    fn write_conn(&self) -> Result<Connection, AppError> {
        let conn = Connection::open_with_flags(
            &self.db_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(db_error)?;
        conn.busy_timeout(Duration::from_secs(8)).map_err(db_error)?;
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "synchronous", "NORMAL").ok();
        Ok(conn)
    }

    fn read_conn(&self) -> Result<Connection, AppError> {
        let conn = Connection::open_with_flags(
            &self.db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(db_error)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(db_error)?;
        conn.pragma_update(None, "query_only", true).ok();
        Ok(conn)
    }

    fn migrate(&mut self) -> Result<(), AppError> {
        let conn = self.write_conn()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS locations (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                added_at INTEGER NOT NULL,
                last_indexed INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                root TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                path_lower TEXT NOT NULL,
                name TEXT NOT NULL,
                name_lower TEXT NOT NULL,
                parent TEXT NOT NULL,
                extension TEXT,
                kind TEXT NOT NULL,
                size INTEGER,
                created INTEGER,
                modified INTEGER,
                accessed INTEGER,
                is_dir INTEGER NOT NULL,
                is_hidden INTEGER NOT NULL,
                is_symlink INTEGER NOT NULL,
                content_state TEXT NOT NULL DEFAULT 'none',
                content_error TEXT,
                content_hash TEXT,
                content TEXT,
                seen_generation INTEGER NOT NULL DEFAULT 0,
                indexed_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_files_name_lower ON files(name_lower);
            CREATE INDEX IF NOT EXISTS idx_files_path_lower ON files(path_lower);
            CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent);
            CREATE INDEX IF NOT EXISTS idx_files_root ON files(root);
            CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified);
            CREATE INDEX IF NOT EXISTS idx_files_created ON files(created);
            CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
            CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
            CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
            CREATE INDEX IF NOT EXISTS idx_files_content_state ON files(content_state);
            CREATE TABLE IF NOT EXISTS location_counts (
                root TEXT PRIMARY KEY,
                files INTEGER NOT NULL DEFAULT 0,
                content INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )
        .map_err(db_error)?;

        let version: Option<i64> = conn
            .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |row| {
                Ok(row.get::<_, String>(0).ok().and_then(|value| value.parse().ok()))
            })
            .optional()
            .map_err(db_error)?
            .flatten();
        if version.unwrap_or(0) < SCHEMA_VERSION {
            conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?1)",
                params![SCHEMA_VERSION.to_string()],
            )
            .map_err(db_error)?;
        }

        // FTS5 is compiled into the bundled SQLite build. If a future platform
        // build omits it, searches transparently fall back to LIKE/instr scans.
        let fts_exists: Option<String> = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        if fts_exists.is_none() {
            match conn.execute_batch(
                r#"
                CREATE VIRTUAL TABLE files_fts USING fts5(name, content, tokenize='unicode61');
                "#,
            ) {
                Ok(()) => {
                    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('fts_available', '1')", [])
                        .ok();
                }
                Err(_) => {
                    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('fts_available', '0')", [])
                        .ok();
                }
            }
        }
        let fts_flag: Option<String> = conn
            .query_row("SELECT value FROM meta WHERE key = 'fts_available'", [], |row| row.get(0))
            .optional()
            .map_err(db_error)?;
        self.fts_available
            .store(fts_flag.as_deref() == Some("1"), Ordering::Relaxed);

        if self.fts_available.load(Ordering::Relaxed) {
            // Keep the FTS table in sync without rewriting it manually on every
            // update. Triggers are cheap and transactional with the row write.
            conn.execute_batch(
                r#"
                CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
                    INSERT INTO files_fts(rowid, name, content) VALUES (new.id, new.name, coalesce(new.content, ''));
                END;
                CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
                    DELETE FROM files_fts WHERE rowid = old.id;
                END;
                CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF name, content ON files BEGIN
                    DELETE FROM files_fts WHERE rowid = old.id;
                    INSERT INTO files_fts(rowid, name, content) VALUES (new.id, new.name, coalesce(new.content, ''));
                END;
                "#,
            )
            .map_err(db_error)?;
            let populated: Option<String> = conn
                .query_row("SELECT value FROM meta WHERE key = 'fts_populated'", [], |row| row.get(0))
                .optional()
                .map_err(db_error)?;
            if populated.as_deref() != Some("1") {
                conn.execute("INSERT INTO files_fts(rowid, name, content) SELECT id, name, coalesce(content, '') FROM files", [])
                    .ok();
                conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('fts_populated', '1')", [])
                    .ok();
            }
        }

        // Substring name/path search needs an index that a leading wildcard can
        // actually use. FTS5's trigram tokenizer answers `%term%` in milliseconds
        // where `LIKE '%term%'` needs a full table scan.
        let name_fts_exists: Option<String> = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='files_name_fts'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        if name_fts_exists.is_none() {
            match conn.execute_batch(
                "CREATE VIRTUAL TABLE files_name_fts USING fts5(name, path, tokenize='trigram');",
            ) {
                Ok(()) => {
                    conn.execute(
                        "INSERT OR REPLACE INTO meta(key, value) VALUES ('name_fts_available', '1')",
                        [],
                    )
                    .ok();
                }
                Err(_) => {
                    conn.execute(
                        "INSERT OR REPLACE INTO meta(key, value) VALUES ('name_fts_available', '0')",
                        [],
                    )
                    .ok();
                }
            }
        }
        let name_fts_flag: Option<String> = conn
            .query_row("SELECT value FROM meta WHERE key = 'name_fts_available'", [], |row| row.get(0))
            .optional()
            .map_err(db_error)?;
        if name_fts_flag.as_deref() == Some("1") {
            conn.execute_batch(
                r#"
                CREATE TRIGGER IF NOT EXISTS files_name_ai AFTER INSERT ON files BEGIN
                    INSERT INTO files_name_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
                END;
                CREATE TRIGGER IF NOT EXISTS files_name_ad AFTER DELETE ON files BEGIN
                    DELETE FROM files_name_fts WHERE rowid = old.id;
                END;
                CREATE TRIGGER IF NOT EXISTS files_name_au AFTER UPDATE OF name, path ON files BEGIN
                    DELETE FROM files_name_fts WHERE rowid = old.id;
                    INSERT INTO files_name_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
                END;
                "#,
            )
            .map_err(db_error)?;
            let populated: Option<String> = conn
                .query_row("SELECT value FROM meta WHERE key = 'name_fts_populated'", [], |row| row.get(0))
                .optional()
                .map_err(db_error)?;
            self.name_index
                .store(populated.as_deref() == Some("1"), Ordering::Relaxed);
        }
        Ok(())
    }

    /// Builds the trigram name index if it is missing. Called from the indexer
    /// thread, never from the startup path, so launch latency is unaffected.
    /// Returns true when the index is complete and safe to query.
    pub fn populate_name_index(&self) -> Result<bool, AppError> {
        if self.name_index.load(Ordering::Relaxed) {
            // Self-healing guard: a flag set against an empty index would make
            // every substring query return nothing, which is worse than slow.
            if self.cached_counts().files == 0 {
                return Ok(true);
            }
            if let Ok(conn) = self.read_conn() {
                let present = conn
                    .query_row("SELECT 1 FROM files_name_fts LIMIT 1", [], |row| row.get::<_, i64>(0))
                    .optional()
                    .ok()
                    .flatten()
                    .is_some();
                if !present {
                    return self.rebuild_name_index();
                }
            }
            return Ok(true);
        }
        if self.meta("name_fts_available").as_deref() != Some("1") {
            return Ok(false);
        }
        // Never build a trigram index over a bloated table: prune first.
        if self.cached_counts().files as usize > NAME_INDEX_MAX_ROWS {
            return Ok(false);
        }
        let mut conn = self.write_conn()?;
        let existing: i64 = conn
            .query_row("SELECT COUNT(*) FROM files_name_fts", [], |row| row.get(0))
            .unwrap_or(0);
        if existing == 0 {
            let tx = conn.transaction().map_err(db_error)?;
            tx.execute(
                "INSERT INTO files_name_fts(rowid, name, path)
                 SELECT id, name, path FROM files LIMIT ?1",
                params![NAME_INDEX_MAX_ROWS as i64],
            )
            .map_err(db_error)?;
            let inserted: i64 = tx
                .query_row("SELECT COUNT(*) FROM files_name_fts", [], |row| row.get(0))
                .unwrap_or(0);
            tx.commit().map_err(db_error)?;
            if (inserted as usize) >= NAME_INDEX_MAX_ROWS {
                // The index would be silently incomplete; leave the flag off and
                // let the maintenance path prune first.
                return Ok(false);
            }
        }
        self.set_meta("name_fts_populated", "1")?;
        self.name_index.store(true, Ordering::Relaxed);
        Ok(true)
    }

    pub fn meta(&self, key: &str) -> Option<String> {
        let conn = self.read_conn().ok()?;
        conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |row| row.get(0))
            .optional()
            .ok()
            .flatten()
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = self.write_conn()?;
        conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(db_error)?;
        Ok(())
    }

    pub fn paused(&self) -> bool {
        self.meta("index_paused").as_deref() == Some("1")
    }

    pub fn content_enabled(&self) -> bool {
        self.meta("content_enabled").as_deref() != Some("0")
    }

    pub fn max_content_bytes(&self) -> u64 {
        self.meta("max_content_bytes")
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_MAX_CONTENT_BYTES)
    }

    pub fn ensure_default_location(&self, path: &Path) -> Result<(), AppError> {
        let count: i64 = {
            let conn = self.read_conn()?;
            conn.query_row("SELECT COUNT(*) FROM locations", [], |row| row.get(0))
                .map_err(db_error)?
        };
        if count == 0 {
            self.add_location(&path.to_string_lossy())?;
        }
        Ok(())
    }

    pub fn add_location(&self, path: &str) -> Result<(), AppError> {
        let root = normalized_root(path);
        if root.is_empty() || !Path::new(&root).is_dir() {
            return Err(AppError::new(
                "not_a_directory",
                "Choose a folder that exists and can be indexed.",
                Some(root),
            ));
        }
        let name = Path::new(&root)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| root.clone());
        let conn = self.write_conn()?;
        conn.execute(
            "INSERT INTO locations(path, name, enabled, added_at, status)
             VALUES (?1, ?2, 1, ?3, 'pending')
             ON CONFLICT(path) DO UPDATE SET enabled = 1, status = 'pending'",
            params![root, name, current_ms()],
        )
        .map_err(db_error)?;
        conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('locations_changed', ?1)", params![current_ms().to_string()])
            .ok();
        Ok(())
    }

    pub fn remove_location(&self, path: &str) -> Result<(), AppError> {
        let root = normalized_root(path);
        let conn = self.write_conn()?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        tx.execute("DELETE FROM files WHERE root = ?1", params![root]).map_err(db_error)?;
        tx.execute("DELETE FROM locations WHERE path = ?1", params![root]).map_err(db_error)?;
        tx.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('locations_changed', ?1)", params![current_ms().to_string()])
            .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(())
    }

    pub fn enabled_roots(&self) -> Vec<String> {
        let conn = match self.read_conn() {
            Ok(conn) => conn,
            Err(_) => return Vec::new(),
        };
        let mut statement = match conn.prepare("SELECT path FROM locations WHERE enabled = 1 ORDER BY added_at") {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|row| row.ok()).collect())
            .unwrap_or_default()
    }

    pub fn locations_to_scan(&self) -> Vec<String> {
        let conn = match self.read_conn() {
            Ok(conn) => conn,
            Err(_) => return Vec::new(),
        };
        let mut statement = match conn.prepare(
            "SELECT path FROM locations WHERE enabled = 1
             AND (last_indexed IS NULL OR status IN ('pending','partial'))
             ORDER BY added_at",
        ) {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|row| row.ok()).collect())
            .unwrap_or_default()
    }

    pub fn mark_location(&self, root: &str, status: &str, error: Option<&str>) -> Result<(), AppError> {
        let conn = self.write_conn()?;
        conn.execute(
            "UPDATE locations SET status = ?2, error = ?3 WHERE path = ?1",
            params![normalized_root(root), status, error],
        )
        .map_err(db_error)?;
        Ok(())
    }

    pub fn take_rebuild_request(&self) -> bool {
        let requested = self
            .meta("rebuild_requested")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        if requested > 0 {
            let _ = self.set_meta("rebuild_requested", "0");
            true
        } else {
            false
        }
    }

    pub fn clear_index(&self) -> Result<(), AppError> {
        let conn = self.write_conn()?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        tx.execute("DELETE FROM files", []).map_err(db_error)?;
        tx.execute("UPDATE locations SET last_indexed = NULL, status = 'pending', error = NULL", [])
            .map_err(db_error)?;
        tx.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('locations_changed', ?1)", params![current_ms().to_string()])
            .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(())
    }

    pub fn rebuild(&self) -> Result<(), AppError> {
        self.clear_index()?;
        self.set_meta("rebuild_requested", &current_ms().to_string())
    }

    pub fn retry_failed(&self) -> Result<(), AppError> {
        let conn = self.write_conn()?;
        conn.execute(
            "UPDATE files SET content_state = 'pending', content_error = NULL WHERE content_state IN ('error','skipped','unsupported')",
            [],
        )
        .map_err(db_error)?;
        Ok(())
    }

    pub fn set_paused(&self, paused: bool) -> Result<(), AppError> {
        self.set_meta("index_paused", if paused { "1" } else { "0" })
    }

    pub fn set_content_enabled(&self, enabled: bool) -> Result<(), AppError> {
        self.set_meta("content_enabled", if enabled { "1" } else { "0" })
    }

    pub fn set_max_content_bytes(&self, bytes: u64) -> Result<(), AppError> {
        self.set_meta("max_content_bytes", &bytes.clamp(4096, 64 * 1024 * 1024).to_string())
    }

    pub fn status(&self, activity: &str, current_path: Option<String>) -> IndexStatus {
        let mut status = IndexStatus {
            paused: self.paused(),
            activity: activity.to_string(),
            current_path,
            fts_available: self.fts_available.load(Ordering::Relaxed),
            content_enabled: self.content_enabled(),
            max_content_bytes: self.max_content_bytes(),
            db_path: self.db_path.to_string_lossy().to_string(),
            ..Default::default()
        };
        status.index_size_bytes = db_size(&self.db_path);
        // Counters are materialised by the indexer. Counting six million rows on
        // every keystroke is what made the previous build appear to hang.
        let counts = self.cached_counts();
        status.indexed_files = counts.files;
        status.indexed_folders = counts.folders;
        status.searchable_content = counts.content;
        status.pending_content = counts.pending;
        status.failed_content = counts.failed;
        status.skipped_content = counts.skipped;
        let conn = match self.read_conn() {
            Ok(conn) => conn,
            Err(_) => return status,
        };
        status.last_reconciliation = conn
            .query_row("SELECT MAX(last_indexed) FROM locations", [], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .ok()
            .flatten();
        status.locations = self.location_coverage(&conn);
        status.errors = self.index_errors_with(&conn, 25);
        status
    }

    /// Reads the materialised counters. Six primary-key lookups, no table scans.
    pub fn cached_counts(&self) -> IndexCounts {
        let conn = match self.read_conn() {
            Ok(conn) => conn,
            Err(_) => return IndexCounts::default(),
        };
        let read = |key: &str| -> u64 {
            conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .ok()
            .flatten()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0)
        };
        let counts = IndexCounts {
            files: read("counts.files"),
            folders: read("counts.folders"),
            content: read("counts.content"),
            pending: read("counts.pending"),
            failed: read("counts.failed"),
            skipped: read("counts.skipped"),
            updated_at: read("counts.updated_at") as i64,
        };
        counts
    }

    /// Recomputes the materialised counters and per-location totals in a single
    /// grouped pass, then stores them. Runs on the indexer thread.
    pub fn refresh_counts(&self, force: bool) -> Result<IndexCounts, AppError> {
        let current = self.cached_counts();
        if !force && current.updated_at > 0 && current_ms() - current.updated_at < COUNTS_TTL_MS {
            return Ok(current);
        }
        let mut conn = self.write_conn()?;
        let tx = conn.transaction().map_err(db_error)?;
        let mut totals = IndexCounts { updated_at: current_ms(), ..Default::default() };
        let grouped: Vec<(String, i64, i64, i64, i64, i64, i64)> = {
            let mut statement = tx
                .prepare(
                    "SELECT root,
                            SUM(is_dir = 0), SUM(is_dir = 1),
                            SUM(content_state = 'indexed'), SUM(content_state = 'pending'),
                            SUM(content_state = 'error'), SUM(content_state = 'skipped')
                     FROM files GROUP BY root",
                )
                .map_err(db_error)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                })
                .map_err(db_error)?;
            rows.filter_map(|row| row.ok()).collect()
        };
        for (root, files, folders, content, pending, failed, skipped) in grouped {
            totals.files += files.max(0) as u64;
            totals.folders += folders.max(0) as u64;
            totals.content += content.max(0) as u64;
            totals.pending += pending.max(0) as u64;
            totals.failed += failed.max(0) as u64;
            totals.skipped += skipped.max(0) as u64;
            tx.execute(
                "INSERT INTO location_counts(root, files, content, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(root) DO UPDATE SET files = excluded.files,
                     content = excluded.content, updated_at = excluded.updated_at",
                params![root, files.max(0), content.max(0), totals.updated_at],
            )
            .map_err(db_error)?;
        }
        for (key, value) in [
            ("counts.files", totals.files),
            ("counts.folders", totals.folders),
            ("counts.content", totals.content),
            ("counts.pending", totals.pending),
            ("counts.failed", totals.failed),
            ("counts.skipped", totals.skipped),
            ("counts.updated_at", totals.updated_at as u64),
        ] {
            tx.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)",
                params![key, value.to_string()],
            )
            .map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;
        Ok(totals)
    }

    /// Removes rows that the current exclusion policy would never index.
    ///
    /// Maintenance drops the FTS triggers and the secondary indexes for the
    /// duration of the prune, then rebuilds both from the survivors. Keeping them
    /// in place makes every deleted row maintain ten B-tree entries and two FTS
    /// rows, which turns a six-million-row repair into an hour of work.
    pub fn prune_excluded(&self) -> Result<PruneReport, AppError> {
        const CHUNK: i64 = 20_000;
        const INDEXES: &[&str] = &[
            "idx_files_name_lower",
            "idx_files_path_lower",
            "idx_files_parent",
            "idx_files_root",
            "idx_files_modified",
            "idx_files_created",
            "idx_files_size",
            "idx_files_kind",
            "idx_files_extension",
            "idx_files_content_state",
        ];
        let read = self.read_conn()?;
        let mut report = PruneReport::default();
        let mut cursor = 0i64;
        let mut prepared = false;
        loop {
            let mut statement = read
                .prepare("SELECT id, root, path FROM files WHERE id > ?1 ORDER BY id LIMIT ?2")
                .map_err(db_error)?;
            let rows: Vec<(i64, String, String)> = statement
                .query_map(params![cursor, CHUNK], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(db_error)?
                .filter_map(|row| row.ok())
                .collect();
            drop(statement);
            if rows.is_empty() {
                break;
            }
            report.examined += rows.len() as u64;
            cursor = rows.last().map(|(id, _, _)| *id).unwrap_or(cursor);
            let doomed: Vec<i64> = rows
                .iter()
                .filter(|(_, root, path)| {
                    live::path_is_excluded(Path::new(path), Path::new(root))
                })
                .map(|(id, _, _)| *id)
                .collect();
            if doomed.is_empty() {
                continue;
            }
            let mut write = self.write_conn()?;
            if !prepared {
                prepared = true;
                let mut sql = String::from(
                    "DROP TRIGGER IF EXISTS files_ai;
                     DROP TRIGGER IF EXISTS files_ad;
                     DROP TRIGGER IF EXISTS files_au;
                     DROP TRIGGER IF EXISTS files_name_ai;
                     DROP TRIGGER IF EXISTS files_name_ad;
                     DROP TRIGGER IF EXISTS files_name_au;",
                );
                for index in INDEXES {
                    sql.push_str(&format!("DROP INDEX IF EXISTS {index};"));
                }
                write.execute_batch(&sql).map_err(db_error)?;
            }
            let tx = write.transaction().map_err(db_error)?;
            {
                let placeholders = vec!["?"; doomed.len()].join(",");
                let sql = format!("DELETE FROM files WHERE id IN ({placeholders})");
                let params: Vec<rusqlite::types::Value> = doomed
                    .iter()
                    .map(|id| rusqlite::types::Value::Integer(*id))
                    .collect();
                tx.execute(&sql, params_from_iter(params.iter()))
                    .map_err(db_error)?;
            }
            tx.commit().map_err(db_error)?;
            report.removed += doomed.len() as u64;
        }
        if prepared {
            self.restore_indexes()?;
            self.restore_triggers()?;
        }
        if report.removed > 0 {
            self.set_meta("name_fts_populated", "0")?;
            self.name_index.store(false, Ordering::Relaxed);
            self.rebuild_name_index()?;
            self.refresh_counts(true)?;
        }
        Ok(report)
    }

    /// Recreates the metadata indexes that a prune drops for speed.
    fn restore_indexes(&self) -> Result<(), AppError> {
        let conn = self.write_conn()?;
        conn.execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_files_name_lower ON files(name_lower);
            CREATE INDEX IF NOT EXISTS idx_files_path_lower ON files(path_lower);
            CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent);
            CREATE INDEX IF NOT EXISTS idx_files_root ON files(root);
            CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified);
            CREATE INDEX IF NOT EXISTS idx_files_created ON files(created);
            CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
            CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
            CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
            CREATE INDEX IF NOT EXISTS idx_files_content_state ON files(content_state);
            "#,
        )
        .map_err(db_error)
    }

    /// Reinstalls the FTS maintenance triggers after a maintenance operation.
    fn restore_triggers(&self) -> Result<(), AppError> {
        let conn = self.write_conn()?;
        if self.fts_available.load(Ordering::Relaxed) {
            conn.execute_batch(
                r#"
                CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
                    INSERT INTO files_fts(rowid, name, content) VALUES (new.id, new.name, coalesce(new.content, ''));
                END;
                CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
                    DELETE FROM files_fts WHERE rowid = old.id;
                END;
                CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF name, content ON files BEGIN
                    DELETE FROM files_fts WHERE rowid = old.id;
                    INSERT INTO files_fts(rowid, name, content) VALUES (new.id, new.name, coalesce(new.content, ''));
                END;
                "#,
            )
            .map_err(db_error)?;
        }
        if self.meta("name_fts_available").as_deref() == Some("1") {
            conn.execute_batch(
                r#"
                CREATE TRIGGER IF NOT EXISTS files_name_ai AFTER INSERT ON files BEGIN
                    INSERT INTO files_name_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
                END;
                CREATE TRIGGER IF NOT EXISTS files_name_ad AFTER DELETE ON files BEGIN
                    DELETE FROM files_name_fts WHERE rowid = old.id;
                END;
                CREATE TRIGGER IF NOT EXISTS files_name_au AFTER UPDATE OF name, path ON files BEGIN
                    DELETE FROM files_name_fts WHERE rowid = old.id;
                    INSERT INTO files_name_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
                END;
                "#,
            )
            .map_err(db_error)?;
        }
        Ok(())
    }

    /// Rebuilds the trigram name index from scratch after a prune.
    pub fn rebuild_name_index(&self) -> Result<bool, AppError> {
        if self.meta("name_fts_available").as_deref() != Some("1") {
            return Ok(false);
        }
        let mut conn = self.write_conn()?;
        {
            let tx = conn.transaction().map_err(db_error)?;
            tx.execute("DELETE FROM files_name_fts", []).map_err(db_error)?;
            tx.execute(
                "INSERT INTO files_name_fts(rowid, name, path) SELECT id, name, path FROM files",
                [],
            )
            .map_err(db_error)?;
            tx.commit().map_err(db_error)?;
        }
        self.set_meta("name_fts_populated", "1")?;
        self.name_index.store(true, Ordering::Relaxed);
        Ok(true)
    }

    /// Compacts the database after a large prune.
    ///
    /// Both FTS tables are rebuilt from the surviving rows rather than updated:
    /// dropping a virtual table is instant, and a rebuild also removes index rows
    /// that belong to files deleted before the exclusion policy existed. The
    /// triggers are recreated afterwards so incremental writes stay correct.
    /// Requires free disk space roughly equal to the live database size.
    pub fn optimize(&self) -> Result<u64, AppError> {
        let mut conn = self.write_conn()?;
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS files_ai;
             DROP TRIGGER IF EXISTS files_ad;
             DROP TRIGGER IF EXISTS files_au;
             DROP TRIGGER IF EXISTS files_name_ai;
             DROP TRIGGER IF EXISTS files_name_ad;
             DROP TRIGGER IF EXISTS files_name_au;",
        )
        .map_err(db_error)?;
        conn.execute_batch(
            "DROP TABLE IF EXISTS files_fts;
             DROP TABLE IF EXISTS files_name_fts;",
        )
        .map_err(db_error)?;
        conn.execute_batch(
            "CREATE VIRTUAL TABLE files_fts USING fts5(name, content, tokenize='unicode61');
             CREATE VIRTUAL TABLE files_name_fts USING fts5(name, path, tokenize='trigram');",
        )
        .map_err(db_error)?;
        {
            let tx = conn.transaction().map_err(db_error)?;
            tx.execute(
                "INSERT INTO files_fts(rowid, name, content) SELECT id, name, coalesce(content, '') FROM files",
                [],
            )
            .map_err(db_error)?;
            tx.execute(
                "INSERT INTO files_name_fts(rowid, name, path) SELECT id, name, path FROM files",
                [],
            )
            .map_err(db_error)?;
            tx.commit().map_err(db_error)?;
        }
        self.fts_available.store(true, Ordering::Relaxed);
        self.set_meta("fts_available", "1")?;
        self.set_meta("fts_populated", "1")?;
        self.set_meta("name_fts_available", "1")?;
        self.set_meta("name_fts_populated", "1")?;
        self.name_index.store(true, Ordering::Relaxed);
        self.restore_triggers()?;
        drop(conn);
        let vacuum = Connection::open_with_flags(
            &self.db_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE,
        )
        .map_err(db_error)?;
        vacuum.execute_batch("VACUUM;").map_err(db_error)?;
        Ok(db_size(&self.db_path))
    }

    fn location_coverage(&self, conn: &Connection) -> Vec<LocationCoverage> {
        let mut statement = match conn.prepare(
            "SELECT l.path, l.name, l.status, l.last_indexed, l.error,
                    coalesce(c.files, 0), coalesce(c.content, 0)
             FROM locations l LEFT JOIN location_counts c ON c.root = l.path
             ORDER BY l.added_at",
        ) {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        });
        let mut locations = Vec::new();
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (path, name, mut state, last_indexed, error, indexed_files, searchable_files) = row;
                let available = Path::new(&path).is_dir();
                if !available {
                    state = "unavailable".into();
                }
                locations.push(LocationCoverage {
                    path,
                    name,
                    status: state,
                    indexed_files: indexed_files.max(0) as u64,
                    searchable_files: searchable_files.max(0) as u64,
                    last_indexed,
                    error: if available { error } else { Some("This location is currently unavailable. Reconnect the drive or folder.".into()) },
                });
            }
        }
        locations
    }

    fn index_errors_with(&self, conn: &Connection, limit: usize) -> Vec<IndexError> {
        let mut statement = match conn.prepare(
            "SELECT path, content_error, content_state, indexed_at FROM files
             WHERE content_state IN ('error','skipped') AND content_error IS NOT NULL
             ORDER BY indexed_at DESC LIMIT ?1",
        ) {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        statement
            .query_map(params![limit as i64], |row| {
                Ok(IndexError {
                    path: row.get(0)?,
                    message: row.get(1)?,
                    kind: row.get(2)?,
                    occurred_at: row.get(3)?,
                })
            })
            .map(|rows| rows.filter_map(|row| row.ok()).collect())
            .unwrap_or_default()
    }

    pub fn index_errors(&self, limit: usize) -> Vec<IndexError> {
        match self.read_conn() {
            Ok(conn) => self.index_errors_with(&conn, limit),
            Err(_) => Vec::new(),
        }
    }

    pub fn suggestions(&self, prefix: &str, limit: usize) -> Vec<SearchSuggestion> {
        let conn = match self.read_conn() {
            Ok(conn) => conn,
            Err(_) => return Vec::new(),
        };
        let pattern = format!("%{}%", prefix.to_lowercase());
        let mut statement = match conn.prepare(
            "SELECT name, path, is_dir, kind FROM files
             WHERE name_lower LIKE ?1 ESCAPE '\\'
             ORDER BY CASE WHEN name_lower LIKE ?2 ESCAPE '\\' THEN 0 ELSE 1 END, modified DESC
             LIMIT ?3",
        ) {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        statement
            .query_map(params![pattern, format!("{}%", prefix.to_lowercase()), limit as i64], |row| {
                Ok(SearchSuggestion {
                    name: row.get(0)?,
                    path: row.get(1)?,
                    is_dir: row.get::<_, i64>(2)? == 1,
                    kind: row.get(3)?,
                })
            })
            .map(|rows| rows.filter_map(|row| row.ok()).collect())
            .unwrap_or_default()
    }

    /* --------------------------------------------------------------------- */
    /* Index writes                                                           */
    /* --------------------------------------------------------------------- */

    pub fn begin_scan(&self, root: &str) -> Result<i64, AppError> {
        let generation = current_ms();
        let conn = self.write_conn()?;
        conn.execute(
            "UPDATE locations SET status = 'indexing', error = NULL WHERE path = ?1",
            params![normalized_root(root)],
        )
        .map_err(db_error)?;
        Ok(generation)
    }

    pub fn write_batch(
        &self,
        root: &str,
        generation: i64,
        entries: &[Entry],
    ) -> Result<(), AppError> {
        if entries.is_empty() {
            return Ok(());
        }
        let root = normalized_root(root);
        let mut conn = self.write_conn()?;
        let tx = conn.transaction().map_err(db_error)?;
        for entry in entries {
            let name_lower = entry.name.to_lowercase();
            let kind = extract::kind_for(&entry.name, entry.is_dir);
            let extension = entry.extension.clone();
            let content_state = if entry.is_dir {
                "none"
            } else if entry.is_symlink {
                // Metadata is useful, but following a symlink's target for
                // content extraction could escape the configured scope.
                "skipped"
            } else if extension
                .as_deref()
                .map(extract::is_extractable)
                .unwrap_or(false)
            {
                "pending"
            } else {
                "unsupported"
            };
            tx.execute(
                r#"INSERT INTO files(
                    root, path, path_lower, name, name_lower, parent, extension, kind,
                    size, created, modified, accessed, is_dir, is_hidden, is_symlink,
                    content_state, seen_generation, indexed_at
                ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
                ON CONFLICT(path) DO UPDATE SET
                    root = excluded.root,
                    path_lower = excluded.path_lower,
                    name = excluded.name,
                    name_lower = excluded.name_lower,
                    parent = excluded.parent,
                    extension = excluded.extension,
                    kind = excluded.kind,
                    size = excluded.size,
                    created = excluded.created,
                    modified = excluded.modified,
                    accessed = excluded.accessed,
                    is_dir = excluded.is_dir,
                    is_hidden = excluded.is_hidden,
                    is_symlink = excluded.is_symlink,
                    seen_generation = excluded.seen_generation,
                    indexed_at = excluded.indexed_at,
                    content_state = CASE
                        WHEN files.content_state = 'indexed'
                             AND files.size = excluded.size
                             AND files.modified = excluded.modified THEN 'indexed'
                        WHEN excluded.content_state = 'pending' THEN 'pending'
                        ELSE excluded.content_state
                    END,
                    content = CASE
                        WHEN files.content_state = 'indexed'
                             AND files.size = excluded.size
                             AND files.modified = excluded.modified THEN files.content
                        ELSE NULL
                    END,
                    content_error = CASE
                        WHEN files.content_state = 'indexed'
                             AND files.size = excluded.size
                             AND files.modified = excluded.modified THEN files.content_error
                        ELSE NULL
                    END"#,
                params![
                    root,
                    entry.path,
                    entry.path.to_lowercase(),
                    entry.name,
                    name_lower,
                    Path::new(&entry.path)
                        .parent()
                        .map(|path| path.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    extension,
                    kind,
                    entry.size.map(|size| size as i64),
                    entry.created,
                    entry.modified,
                    entry.accessed,
                    if entry.is_dir { 1 } else { 0 },
                    if entry.is_hidden { 1 } else { 0 },
                    if entry.is_symlink { 1 } else { 0 },
                    content_state,
                    generation,
                    current_ms(),
                ],
            )
            .map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;
        Ok(())
    }

    pub fn finish_scan(
        &self,
        root: &str,
        generation: i64,
        complete: bool,
        error: Option<String>,
    ) -> Result<u64, AppError> {
        let root = normalized_root(root);
        let mut conn = self.write_conn()?;
        let tx = conn.transaction().map_err(db_error)?;
        let removed = if complete {
            tx.execute(
                "DELETE FROM files WHERE root = ?1 AND seen_generation <> ?2",
                params![root, generation],
            )
            .unwrap_or(0) as u64
        } else {
            0
        };
        tx.execute(
            "UPDATE locations SET last_indexed = ?2, status = ?3, error = ?4 WHERE path = ?1",
            params![
                root,
                current_ms(),
                if complete { "up_to_date" } else { "partial" },
                error
            ],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(removed)
    }

    pub fn index_single_path(&self, root: &str, path: &Path, generation: i64) -> Result<(), AppError> {
        if let Ok(entry) = crate::listing::entry_from_path(path) {
            self.write_batch(root, generation, &[entry])?;
        }
        Ok(())
    }

    pub fn remove_path(&self, path: &str) -> Result<(), AppError> {
        let conn = self.write_conn()?;
        let root = normalized_root(path);
        conn.execute(
            "DELETE FROM files WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            params![root, root_like_pattern(&root)],
        )
        .map_err(db_error)?;
        Ok(())
    }

    pub fn next_content_jobs(&self, limit: usize) -> Vec<(i64, String, String, Option<i64>, Option<i64>)> {
        let conn = match self.read_conn() {
            Ok(conn) => conn,
            Err(_) => return Vec::new(),
        };
        let mut statement = match conn.prepare(
            "SELECT id, path, coalesce(extension, ''), size, modified FROM files
             WHERE content_state = 'pending' AND is_dir = 0
             ORDER BY indexed_at DESC LIMIT ?1",
        ) {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        statement
            .query_map(params![limit as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })
            .map(|rows| rows.filter_map(|row| row.ok()).collect())
            .unwrap_or_default()
    }

    pub fn store_extraction(
        &self,
        id: i64,
        status: &str,
        text: Option<&str>,
        error: Option<&str>,
        hash: Option<&str>,
    ) -> Result<(), AppError> {
        let conn = self.write_conn()?;
        conn.execute(
            "UPDATE files SET content_state = ?2, content = ?3, content_error = ?4, content_hash = coalesce(?5, content_hash) WHERE id = ?1",
            params![id, status, text, error, hash],
        )
        .map_err(db_error)?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn content_lookup(&self, path: &str) -> Option<String> {
        let conn = self.read_conn().ok()?;
        conn.query_row("SELECT content FROM files WHERE path = ?1", params![path], |row| {
            row.get::<_, Option<String>>(0)
        })
        .optional()
        .ok()
        .flatten()
        .flatten()
    }

    /* --------------------------------------------------------------------- */
    /* Query execution                                                        */
    /* --------------------------------------------------------------------- */

    pub fn search(
        &self,
        request: &SearchRequest,
        cancel: &Arc<AtomicBool>,
        max_results: usize,
    ) -> Result<(Vec<SearchHit>, usize, u64), AppError> {
        let started = Instant::now();
        let _ = started;
        let conn = self.read_conn()?;
        // Statement-level cancellation: without this, superseding a query did
        // nothing until SQLite finished scanning.
        let token = cancel.clone();
        let _ = conn.progress_handler(20_000, Some(move || token.load(Ordering::Relaxed)));
        let mut candidates: HashMap<i64, CandidateRow> = HashMap::new();

        if matches!(request.mode, SearchMode::Name | SearchMode::Both) {
            for row in self.query_name_candidates(&conn, request)? {
                candidates.insert(row.id, row);
            }
        }
        if request.needs_content() && !cancel.load(Ordering::Relaxed) {
            for row in self.query_content_candidates(&conn, request)? {
                candidates.insert(row.id, row);
            }
        } else if request.all_terms().is_empty() && request.has_constraints() {
            // Filter-only query (for example "Kind: PDF, Modified: today").
            for row in self.query_metadata_candidates(&conn, request)? {
                candidates.insert(row.id, row);
            }
        }
        if request.all_terms().is_empty() && !request.has_constraints() {
            // An empty unfiltered query is not a search.
            return Ok((Vec::new(), 0, 0));
        }

        let mut hits = Vec::new();
        let terms = request.all_terms();
        let excluded = request.exclude_terms.clone();
        for row in candidates.into_values() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if !row_matches_filters(&row, request) {
                continue;
            }
            let matched_name = terms.is_empty() || terms_match_text(&row.name, &terms, request.match_mode, request.case_sensitive);
            let matched_path = terms_multi_match_text(&row.path, &terms, request.match_mode, request.case_sensitive);
            let matched_content = match row.content.as_deref() {
                Some(content) if request.needs_content() => {
                    terms_match_text(content, &terms, request.match_mode, request.case_sensitive)
                }
                _ => false,
            };
            if !terms.is_empty() && !matched_name && !matched_path && !matched_content {
                continue;
            }
            if excluded.iter().any(|term| text_contains(&row.path, term, request.case_sensitive)
                || row
                    .content
                    .as_deref()
                    .map(|content| text_contains(content, term, request.case_sensitive))
                    .unwrap_or(false))
            {
                continue;
            }
            let (score, kind, explanation) = score_row(&row, request, matched_name, matched_path, matched_content);
            let snippet = if matched_content {
                row.content
                    .as_deref()
                    .and_then(|content| snippet_for(content, &terms, request.case_sensitive))
            } else {
                None
            };
            let entry = row.to_entry();
            hits.push(SearchHit {
                entry,
                score,
                match_kind: kind.into(),
                snippet,
                source: "index".into(),
                indexed: true,
                explanation: Some(explanation),
            });
        }
        sort_hits(&mut hits, request);
        let total = hits.len();
        if hits.len() > max_results {
            hits.truncate(max_results);
        }
        Ok((hits, total, 0))
    }

    fn filter_sql(&self, request: &SearchRequest) -> (String, Vec<rusqlite::types::Value>) {
        use rusqlite::types::Value;
        let mut clauses: Vec<String> = Vec::new();
        let mut values: Vec<Value> = Vec::new();
        if !request.include_hidden {
            clauses.push("is_hidden = 0".into());
        }
        if !request.kinds.is_empty() {
            let placeholders = vec!["?"; request.kinds.len()].join(",");
            clauses.push(format!("kind IN ({placeholders})"));
            for kind in &request.kinds {
                values.push(Value::Text(kind.clone()));
            }
        }
        if !request.extensions.is_empty() {
            let placeholders = vec!["?"; request.extensions.len()].join(",");
            clauses.push(format!("extension IN ({placeholders})"));
            for extension in &request.extensions {
                values.push(Value::Text(extension.trim_start_matches('.').to_lowercase()));
            }
        }
        if let Some(min) = request.min_size {
            clauses.push("coalesce(size, 0) >= ?".into());
            values.push(Value::Integer(min as i64));
        }
        if let Some(max) = request.max_size {
            clauses.push("coalesce(size, 0) <= ?".into());
            values.push(Value::Integer(max as i64));
        }
        if let Some(after) = request.modified_after {
            clauses.push("modified >= ?".into());
            values.push(Value::Integer(after));
        }
        if let Some(before) = request.modified_before {
            clauses.push("modified <= ?".into());
            values.push(Value::Integer(before));
        }
        if let Some(after) = request.created_after {
            clauses.push("created >= ?".into());
            values.push(Value::Integer(after));
        }
        if let Some(before) = request.created_before {
            clauses.push("created <= ?".into());
            values.push(Value::Integer(before));
        }
        if let Some(after) = request.accessed_after {
            clauses.push("accessed >= ?".into());
            values.push(Value::Integer(after));
        }
        if let Some(before) = request.accessed_before {
            clauses.push("accessed <= ?".into());
            values.push(Value::Integer(before));
        }
        if request.no_extension {
            clauses.push("(extension IS NULL OR extension = '')".into());
        }
        if request.empty_folders {
            clauses.push("is_dir = 1 AND NOT EXISTS (SELECT 1 FROM files child WHERE child.parent = files.path)".into());
        }
        if !request.roots.is_empty() {
            let mut root_clauses = Vec::new();
            for root in &request.roots {
                let root = normalized_root(root);
                if request.recursive {
                    root_clauses.push("(path = ? OR path LIKE ? ESCAPE '\\')".to_string());
                    values.push(Value::Text(root.clone()));
                    values.push(Value::Text(root_like_pattern(&root)));
                } else {
                    root_clauses.push("parent = ?".to_string());
                    values.push(Value::Text(root.clone()));
                }
            }
            clauses.push(format!("({})", root_clauses.join(" OR ")));
        }
        let sql = if clauses.is_empty() {
            "1=1".to_string()
        } else {
            clauses.join(" AND ")
        };
        (sql, values)
    }

    fn query_name_candidates(
        &self,
        conn: &Connection,
        request: &SearchRequest,
    ) -> Result<Vec<CandidateRow>, AppError> {
        let (filter, mut values) = self.filter_sql(request);
        let mut clauses = vec![filter, "is_dir >= 0".to_string()];
        let terms = if request.name_terms.is_empty() {
            request.terms.clone()
        } else {
            request.name_terms
                .iter()
                .chain(request.terms.iter())
                .cloned()
                .collect()
        };
        if !terms.is_empty() {
            // Preferred path: trigram index, which answers `%term%` without a
            // table scan. Only usable for case-insensitive substring queries of
            // three or more characters.
            if let Some(fts_query) = build_name_fts_query(&terms, request) {
                if self.name_index.load(Ordering::Relaxed) {
                    let sql = format!(
                        "SELECT id, root, path, name, extension, kind, size, created, modified, accessed,
                                is_dir, is_hidden, is_symlink, NULL AS content
                         FROM files WHERE {} AND id IN (
                             SELECT rowid FROM files_name_fts WHERE files_name_fts MATCH ?
                         ) LIMIT {}",
                        clauses.join(" AND "),
                        CANDIDATE_LIMIT
                    );
                    let mut bound = values.clone();
                    bound.push(rusqlite::types::Value::Text(fts_query));
                    let trigram_rows: Vec<CandidateRow> = {
                        let mut statement = conn.prepare(&sql).map_err(db_error)?;
                        let rows = statement
                            .query_map(params_from_iter(bound.iter()), CandidateRow::from_row)
                            .map_err(db_error)?;
                        rows.filter_map(|row| row.ok()).collect()
                    };
                    if !trigram_rows.is_empty() {
                        return Ok(trigram_rows);
                    }
                    // An empty trigram result is never trusted on its own. A stale
                    // or partially built index would otherwise hide every match
                    // silently, so the scan below is the safety net.
                }
            }
            let mut term_clauses = Vec::new();
            for term in &terms {
                if request.case_sensitive {
                    term_clauses.push("(instr(name, ?) > 0 OR instr(path, ?) > 0)".to_string());
                    values.push(rusqlite::types::Value::Text(term.clone()));
                    values.push(rusqlite::types::Value::Text(term.clone()));
                } else {
                    term_clauses.push("(name_lower LIKE ? ESCAPE '\\' OR path_lower LIKE ? ESCAPE '\\')".to_string());
                    let pattern = format!("%{}%", escape_like(&term.to_lowercase()));
                    values.push(rusqlite::types::Value::Text(pattern.clone()));
                    values.push(rusqlite::types::Value::Text(pattern));
                }
            }
            let joiner = if request.match_mode == crate::search::model::MatchMode::Any {
                " OR "
            } else {
                " AND "
            };
            clauses.push(format!("({})", term_clauses.join(joiner)));
        }
        let sql = format!(
            "SELECT id, root, path, name, extension, kind, size, created, modified, accessed,
                    is_dir, is_hidden, is_symlink, NULL AS content
             FROM files WHERE {} LIMIT {}",
            clauses.join(" AND "),
            CANDIDATE_LIMIT
        );
        let mut statement = conn.prepare(&sql).map_err(db_error)?;
        let rows = statement
            .query_map(params_from_iter(values.iter()), CandidateRow::from_row)
            .map_err(db_error)?;
        Ok(rows.filter_map(|row| row.ok()).collect())
    }

    fn query_metadata_candidates(
        &self,
        conn: &Connection,
        request: &SearchRequest,
    ) -> Result<Vec<CandidateRow>, AppError> {
        let (filter, values) = self.filter_sql(request);
        let sql = format!(
            "SELECT id, root, path, name, extension, kind, size, created, modified, accessed,
                    is_dir, is_hidden, is_symlink, NULL AS content
             FROM files WHERE {} ORDER BY modified DESC LIMIT {}",
            filter, CANDIDATE_LIMIT
        );
        let mut statement = conn.prepare(&sql).map_err(db_error)?;
        let rows = statement
            .query_map(params_from_iter(values.iter()), CandidateRow::from_row)
            .map_err(db_error)?;
        Ok(rows.filter_map(|row| row.ok()).collect())
    }

    fn query_content_candidates(
        &self,
        conn: &Connection,
        request: &SearchRequest,
    ) -> Result<Vec<CandidateRow>, AppError> {
        let (filter, values) = self.filter_sql(request);
        if self.fts_available.load(Ordering::Relaxed) && !request.case_sensitive {
            if let Some(fts_query) = build_fts_query(request) {
                let sql = format!(
                    "SELECT f.id, f.root, f.path, f.name, f.extension, f.kind, f.size,
                            f.created, f.modified, f.accessed, f.is_dir, f.is_hidden, f.is_symlink,
                            f.content
                     FROM files f JOIN files_fts ON files_fts.rowid = f.id
                     WHERE files_fts MATCH ? AND {}
                     LIMIT {}",
                    filter, CANDIDATE_LIMIT
                );
                let mut statement = conn.prepare(&sql).map_err(db_error)?;
                let mut bound = vec![rusqlite::types::Value::Text(fts_query)];
                bound.extend(values);
                let rows = statement
                    .query_map(params_from_iter(bound.iter()), CandidateRow::from_row)
                    .map_err(db_error)?;
                return Ok(rows.filter_map(|row| row.ok()).collect());
            }
        }
        // Fallback / case-sensitive content search.
        let terms = if request.content_terms.is_empty() {
            request.terms.clone()
        } else {
            request.content_terms.clone()
        };
        let mut clauses = vec![filter, "content IS NOT NULL".to_string()];
        let mut bound = values;
        for term in &terms {
            if request.case_sensitive {
                clauses.push("instr(content, ?) > 0".into());
            } else {
                clauses.push("lower(content) LIKE ? ESCAPE '\\'".into());
            }
            let value = if request.case_sensitive {
                term.clone()
            } else {
                format!("%{}%", escape_like(&term.to_lowercase()))
            };
            bound.push(rusqlite::types::Value::Text(value));
        }
        let joiner = if request.match_mode == crate::search::model::MatchMode::Any {
            " OR "
        } else {
            " AND "
        };
        // Build content clauses separately so the joiner applies only to terms.
        let content_start = clauses.len() - terms.len();
        let content_clause = clauses.split_off(content_start);
        if !content_clause.is_empty() {
            clauses.push(format!("({})", content_clause.join(joiner)));
        }
        let sql = format!(
            "SELECT id, root, path, name, extension, kind, size, created, modified, accessed,
                    is_dir, is_hidden, is_symlink, content
             FROM files WHERE {} LIMIT {}",
            clauses.join(" AND "),
            CANDIDATE_LIMIT
        );
        let mut statement = conn.prepare(&sql).map_err(db_error)?;
        let rows = statement
            .query_map(params_from_iter(bound.iter()), CandidateRow::from_row)
            .map_err(db_error)?;
        Ok(rows.filter_map(|row| row.ok()).collect())
    }

    /* --------------------------------------------------------------------- */
    /* Duplicate detection                                                    */
    /* --------------------------------------------------------------------- */

    pub fn find_duplicates(
        &self,
        request: &DuplicateRequest,
        cancel: &Arc<AtomicBool>,
    ) -> Result<DuplicateResponse, AppError> {
        let started = Instant::now();
        let conn = self.read_conn()?;
        let (root_sql, root_values) = roots_sql(&request.roots);
        let min_size = request.min_size.max(1);
        let sql = format!(
            "SELECT path, name, size FROM files WHERE is_dir = 0 AND is_symlink = 0 AND coalesce(size, 0) >= ? AND {} 
             ORDER BY size DESC LIMIT 200000",
            root_sql
        );
        let mut bound = vec![rusqlite::types::Value::Integer(min_size as i64)];
        bound.extend(root_values);
        let mut statement = conn.prepare(&sql).map_err(db_error)?;
        let rows = statement
            .query_map(params_from_iter(bound.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            })
            .map_err(db_error)?;
        let mut by_size: HashMap<u64, Vec<String>> = HashMap::new();
        let mut scanned = 0u64;
        for row in rows.flatten() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            scanned += 1;
            let (path, size) = row;
            if let Some(size) = size {
                if size > 0 {
                    by_size.entry(size as u64).or_default().push(path);
                }
            }
        }
        let candidates: Vec<String> = by_size
            .values()
            .filter(|paths| paths.len() > 1)
            .flatten()
            .cloned()
            .collect();
        let candidate_files = candidates.len() as u64;

        // Stage 2: cheap fingerprint (first+last 64 KiB) narrows the set.
        let mut by_fingerprint: HashMap<String, Vec<String>> = HashMap::new();
        for path in &candidates {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if let Some(fingerprint) = quick_fingerprint(Path::new(path)) {
                by_fingerprint.entry(fingerprint).or_default().push(path.clone());
            }
        }

        // Stage 3: cryptographic hashes confirm byte identity.
        let mut groups = Vec::new();
        let mut hashed_files = 0u64;
        let mut recoverable_total = 0u64;
        let mut group_index = 0;
        for (fingerprint, paths) in by_fingerprint {
            if paths.len() < 2 {
                continue;
            }
            let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
            for path in paths {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                if let Ok(hash) = hash_file(Path::new(&path)) {
                    hashed_files += 1;
                    by_hash.entry(hash).or_default().push(path);
                }
            }
            for (hash, mut matches) in by_hash {
                if matches.len() < 2 {
                    continue;
                }
                matches.sort();
                let mut files = Vec::new();
                let mut size = 0u64;
                for path in &matches {
                    if let Ok(entry) = crate::listing::entry_from_path(Path::new(path)) {
                        size = entry.size.unwrap_or(0);
                        files.push(DuplicateFile { entry, hash: Some(hash.clone()) });
                    }
                }
                if files.len() < 2 {
                    continue;
                }
                group_index += 1;
                let recoverable = size.saturating_mul(files.len() as u64 - 1);
                recoverable_total += recoverable;
                groups.push(DuplicateGroup {
                    id: format!("dup-{}-{}", fingerprint.chars().take(8).collect::<String>(), group_index),
                    kind: "exact".into(),
                    files,
                    size,
                    recoverable_bytes: recoverable,
                    verified: true,
                    explanation: "Byte-identical files confirmed with SHA-256.".into(),
                });
            }
        }
        groups.sort_by(|a, b| b.recoverable_bytes.cmp(&a.recoverable_bytes));
        if groups.len() > request.limit.max(1) {
            groups.truncate(request.limit.max(1));
        }
        Ok(DuplicateResponse {
            query_id: request.query_id,
            groups,
            scanned_files: scanned,
            candidate_files,
            hashed_files,
            recoverable_bytes: recoverable_total,
            cancelled: cancel.load(Ordering::Relaxed),
            errors: 0,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }
}

fn roots_sql(roots: &[String]) -> (String, Vec<rusqlite::types::Value>) {
    use rusqlite::types::Value;
    if roots.is_empty() {
        return ("1=1".into(), Vec::new());
    }
    let mut clauses = Vec::new();
    let mut values = Vec::new();
    for root in roots {
        let root = normalized_root(root);
        let pattern = root_like_pattern(&root);
        clauses.push("(path = ? OR path LIKE ? ESCAPE '\\')".to_string());
        values.push(Value::Text(root));
        values.push(Value::Text(pattern));
    }
    (format!("({})", clauses.join(" OR ")), values)
}

fn db_size(path: &Path) -> u64 {
    let mut total = 0u64;
    for suffix in ["", "-wal", "-shm"] {
        let candidate = PathBuf::from(format!("{}{suffix}", path.to_string_lossy()));
        if let Ok(metadata) = fs::metadata(candidate) {
            total += metadata.len();
        }
    }
    total
}

#[derive(Debug, Clone)]
pub struct CandidateRow {
    pub id: i64,
    pub root: String,
    pub path: String,
    pub name: String,
    pub extension: Option<String>,
    pub kind: String,
    pub size: Option<i64>,
    pub created: Option<i64>,
    pub modified: Option<i64>,
    pub accessed: Option<i64>,
    pub is_dir: bool,
    pub is_hidden: bool,
    pub is_symlink: bool,
    pub content: Option<String>,
}

impl CandidateRow {
    fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            root: row.get(1)?,
            path: row.get(2)?,
            name: row.get(3)?,
            extension: row.get(4)?,
            kind: row.get(5)?,
            size: row.get(6)?,
            created: row.get(7)?,
            modified: row.get(8)?,
            accessed: row.get(9)?,
            is_dir: row.get::<_, i64>(10)? == 1,
            is_hidden: row.get::<_, i64>(11)? == 1,
            is_symlink: row.get::<_, i64>(12)? == 1,
            content: row.get(13)?,
        })
    }

    fn to_entry(&self) -> Entry {
        Entry {
            name: self.name.clone(),
            path: self.path.clone(),
            is_dir: self.is_dir,
            is_symlink: self.is_symlink,
            size: self.size.map(|size| size.max(0) as u64),
            modified: self.modified,
            created: self.created,
            accessed: self.accessed,
            extension: self.extension.clone(),
            is_hidden: self.is_hidden,
            is_read_only: false,
            target: None,
        }
    }
}

fn row_matches_filters(row: &CandidateRow, request: &SearchRequest) -> bool {
    if !request.include_hidden && row.is_hidden {
        return false;
    }
    if !request.kinds.is_empty() && !request.kinds.iter().any(|kind| kind == &row.kind) {
        return false;
    }
    if !request.extensions.is_empty() {
        let extension = row.extension.clone().unwrap_or_default();
        if !request
            .extensions
            .iter()
            .any(|candidate| candidate.trim_start_matches('.').eq_ignore_ascii_case(&extension))
        {
            return false;
        }
    }
    if let Some(min) = request.min_size {
        if row.size.unwrap_or(0) < min as i64 {
            return false;
        }
    }
    if let Some(max) = request.max_size {
        if row.size.unwrap_or(0) > max as i64 {
            return false;
        }
    }
    if let Some(after) = request.modified_after {
        if row.modified.unwrap_or(0) < after {
            return false;
        }
    }
    if let Some(before) = request.modified_before {
        if row.modified.unwrap_or(0) > before {
            return false;
        }
    }
    if let Some(after) = request.created_after {
        if row.created.unwrap_or(0) < after {
            return false;
        }
    }
    if let Some(before) = request.created_before {
        if row.created.unwrap_or(0) > before {
            return false;
        }
    }
    if request.no_extension && !row.extension.as_deref().unwrap_or("").is_empty() {
        return false;
    }
    if request.empty_folders && !row.is_dir {
        return false;
    }
    if !entry_in_roots(&row.path, &request.roots, request.recursive) {
        return false;
    }
    let _ = &row.root;
    true
}

/// Metadata/filter gate shared by the index, live filesystem and Spotlight
/// providers. A provider never gets to bypass a user constraint.
pub fn entry_matches_request(entry: &Entry, request: &SearchRequest) -> bool {
    if !request.include_hidden && entry.is_hidden {
        return false;
    }
    let kind = extract::kind_for(&entry.name, entry.is_dir);
    if !request.kinds.is_empty() && !request.kinds.iter().any(|candidate| candidate == &kind) {
        return false;
    }
    if !request.extensions.is_empty() {
        let extension = entry.extension.clone().unwrap_or_default();
        if !request
            .extensions
            .iter()
            .any(|candidate| candidate.trim_start_matches('.').eq_ignore_ascii_case(&extension))
        {
            return false;
        }
    }
    if let Some(min) = request.min_size {
        if entry.size.unwrap_or(0) < min {
            return false;
        }
    }
    if let Some(max) = request.max_size {
        if entry.size.unwrap_or(0) > max {
            return false;
        }
    }
    if let Some(after) = request.modified_after {
        if entry.modified.unwrap_or(0) < after {
            return false;
        }
    }
    if let Some(before) = request.modified_before {
        if entry.modified.unwrap_or(0) > before {
            return false;
        }
    }
    if let Some(after) = request.created_after {
        if entry.created.unwrap_or(0) < after {
            return false;
        }
    }
    if let Some(before) = request.created_before {
        if entry.created.unwrap_or(0) > before {
            return false;
        }
    }
    if request.no_extension && !entry.extension.as_deref().unwrap_or("").is_empty() {
        return false;
    }
    if request.empty_folders && !entry.is_dir {
        return false;
    }
    if !entry_in_roots(&entry.path, &request.roots, request.recursive) {
        return false;
    }
    true
}

pub fn text_contains(haystack: &str, needle: &str, case_sensitive: bool) -> bool {
    if needle.is_empty() {
        return true;
    }
    if case_sensitive {
        haystack.contains(needle)
    } else {
        haystack.to_lowercase().contains(&needle.to_lowercase())
    }
}

pub fn terms_match_text(
    text: &str,
    terms: &[String],
    mode: crate::search::model::MatchMode,
    case_sensitive: bool,
) -> bool {
    if terms.is_empty() {
        return true;
    }
    match mode {
        crate::search::model::MatchMode::Phrase => {
            let phrase = terms.join(" ");
            text_contains(text, &phrase, case_sensitive)
        }
        crate::search::model::MatchMode::Any => {
            terms.iter().any(|term| text_contains(text, term, case_sensitive))
        }
        crate::search::model::MatchMode::All => {
            terms.iter().all(|term| text_contains(text, term, case_sensitive))
        }
    }
}

fn terms_multi_match_text(
    text: &str,
    terms: &[String],
    mode: crate::search::model::MatchMode,
    case_sensitive: bool,
) -> bool {
    terms_match_text(text, terms, mode, case_sensitive)
}

pub fn score_entry(
    entry: &Entry,
    request: &SearchRequest,
    matched_name: bool,
    matched_path: bool,
    matched_content: bool,
) -> (f64, &'static str, String) {
    let terms = request.all_terms();
    let name_lower = entry.name.to_lowercase();
    let path_lower = entry.path.to_lowercase();
    let name_tokens = tokens(&entry.name);
    let parent = Path::new(&entry.path)
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let path_tokens = tokens(&parent);
    let mut score = 0.0f64;
    let mut explanation: Vec<String> = Vec::new();
    for term in &terms {
        let term_lower = term.to_lowercase();
        if name_lower == term_lower {
            score += 1000.0;
            explanation.push("Exact name match".into());
        } else if name_lower.starts_with(&term_lower) {
            score += 800.0;
            explanation.push("Name starts with the search term".into());
        } else if name_tokens.iter().any(|token| token == &term_lower) {
            score += 680.0;
            explanation.push("Name word match".into());
        } else if name_lower.contains(&term_lower) {
            score += 520.0;
            explanation.push("Name contains the search term".into());
        }
        if path_tokens.iter().any(|token| token == &term_lower) {
            score += 460.0;
            explanation.push("Folder name match".into());
        } else if path_lower.contains(&term_lower) {
            score += 300.0;
            explanation.push("Path match".into());
        }
    }
    if matched_content {
        score += 320.0;
        explanation.push("Content match".into());
    }
    if matched_name && terms.is_empty() {
        score += 100.0;
    }
    if let Some(modified) = entry.modified {
        let age = current_ms() - modified;
        if age >= 0 {
            if age < 7 * 24 * 60 * 60 * 1000 {
                score += 30.0;
            } else if age < 30 * 24 * 60 * 60 * 1000 {
                score += 15.0;
            }
        }
    }
    if matched_name && !terms.is_empty() {
        explanation.insert(0, "Name match".into());
    }
    if matched_path && !matched_name && !terms.is_empty() {
        explanation.insert(0, "Path match".into());
    }
    if matched_content && !matched_name && !matched_path && !terms.is_empty() {
        explanation.insert(0, "Content match".into());
    }
    explanation.dedup();
    let kind = if matched_name {
        "name"
    } else if matched_path {
        "path"
    } else if matched_content {
        "content"
    } else {
        "metadata"
    };
    (score, kind, explanation.join(" - "))
}

fn tokens(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| token.to_lowercase())
        .collect()
}

fn score_row(
    row: &CandidateRow,
    request: &SearchRequest,
    matched_name: bool,
    matched_path: bool,
    matched_content: bool,
) -> (f64, &'static str, String) {
    let entry = row.to_entry();
    score_entry(&entry, request, matched_name, matched_path, matched_content)
}


pub(crate) fn sort_hits(hits: &mut [SearchHit], request: &SearchRequest) {
    let descending = request.sort_direction == SortDirection::Desc;
    match request.sort {
        SortOrder::Relevance => hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.entry.modified.unwrap_or(0).cmp(&a.entry.modified.unwrap_or(0)))
        }),
        SortOrder::Name => hits.sort_by(|a, b| {
            let order = a.entry.name.to_lowercase().cmp(&b.entry.name.to_lowercase());
            if descending { order.reverse() } else { order }
        }),
        SortOrder::Modified => hits.sort_by(|a, b| {
            let order = a.entry.modified.unwrap_or(0).cmp(&b.entry.modified.unwrap_or(0));
            if descending { order.reverse() } else { order }
        }),
        SortOrder::Created => hits.sort_by(|a, b| {
            let order = a.entry.created.unwrap_or(0).cmp(&b.entry.created.unwrap_or(0));
            if descending { order.reverse() } else { order }
        }),
        SortOrder::Size => hits.sort_by(|a, b| {
            let order = a.entry.size.unwrap_or(0).cmp(&b.entry.size.unwrap_or(0));
            if descending { order.reverse() } else { order }
        }),
        SortOrder::Kind => hits.sort_by(|a, b| {
            let order = a.entry.extension.cmp(&b.entry.extension);
            if descending { order.reverse() } else { order }
        }),
    }
}

/// Builds a trigram FTS5 query for substring name/path matching.
///
/// Returns `None` when the query cannot be answered by the trigram index: terms
/// shorter than three characters produce no trigrams, and case-sensitive
/// searches need `instr`, which the tokenizer cannot provide.
fn build_name_fts_query(terms: &[String], request: &SearchRequest) -> Option<String> {
    if request.case_sensitive || terms.is_empty() {
        return None;
    }
    let mut parts = Vec::with_capacity(terms.len());
    for term in terms {
        if term.chars().count() < 3 {
            return None;
        }
        // Trigram tokenizers treat the phrase as a literal substring.
        let escaped = term.replace('"', "\"\"");
        parts.push(format!("{{name path}} : \"{escaped}\""));
    }
    Some(parts.join(if request.match_mode == crate::search::model::MatchMode::Any {
        " OR "
    } else {
        " AND "
    }))
}

fn build_fts_query(request: &SearchRequest) -> Option<String> {
    let terms = if request.content_terms.is_empty() {
        request.terms.clone()
    } else {
        request.content_terms.clone()
    };
    if terms.is_empty() {
        return None;
    }
    let quoted: Vec<String> = terms
        .iter()
        .map(|term| {
            let cleaned = term.replace('"', " ");
            if request.match_mode == crate::search::model::MatchMode::Phrase {
                format!("\"{}\"", cleaned.trim())
            } else {
                format!("\"{}\"*", cleaned.trim())
            }
        })
        .filter(|term| term.len() > 2)
        .collect();
    if quoted.is_empty() {
        return None;
    }
    let joiner = if request.match_mode == crate::search::model::MatchMode::Any {
        " OR "
    } else {
        " AND "
    };
    Some(quoted.join(joiner))
}

fn snippet_for(content: &str, terms: &[String], case_sensitive: bool) -> Option<String> {
    let haystack = if case_sensitive { content.to_string() } else { content.to_lowercase() };
    let mut positions: Vec<usize> = Vec::new();
    for term in terms {
        let needle = if case_sensitive { term.clone() } else { term.to_lowercase() };
        if needle.is_empty() {
            continue;
        }
        if let Some(position) = haystack.find(&needle) {
            positions.push(position);
        }
    }
    let position = positions.into_iter().min()?;
    let start = content[..position]
        .char_indices()
        .rev()
        .nth(48)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let end = content[position..]
        .char_indices()
        .nth(160)
        .map(|(index, _)| position + index)
        .unwrap_or(content.len());
    let mut snippet = content[start..end].replace(['\n', '\r', '\t'], " ");
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < content.len() {
        snippet.push_str("...");
    }
    Some(snippet.trim().to_string())
}

pub fn quick_fingerprint(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    let length = metadata.len();
    let mut hasher = Sha256::new();
    hasher.update(length.to_le_bytes());
    let mut buffer = vec![0u8; 64 * 1024];
    let head = file.read(&mut buffer).ok()?;
    hasher.update(&buffer[..head]);
    if length > 128 * 1024 {
        use std::io::{Seek, SeekFrom};
        file.seek(SeekFrom::End(-(64 * 1024))).ok()?;
        let tail = file.read(&mut buffer).ok()?;
        hasher.update(&buffer[..tail]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

pub fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Deduplicates hits by canonical path while preserving the strongest match.
pub fn dedupe_hits(hits: Vec<SearchHit>) -> Vec<SearchHit> {
    let mut by_path: HashMap<String, SearchHit> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for hit in hits {
        let key = path_key(&hit.entry.path);
        match by_path.get(&key) {
            Some(existing) if existing.score >= hit.score => {}
            Some(_) => {
                by_path.insert(key, hit);
            }
            None => {
                order.push(key.clone());
                by_path.insert(key, hit);
            }
        }
    }
    order.into_iter().filter_map(|key| by_path.remove(&key)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::model::MatchMode;

    fn engine() -> (tempfile::TempDir, SearchEngine) {
        let directory = tempfile::tempdir().unwrap();
        let engine = SearchEngine::open(directory.path().join("index.sqlite3")).unwrap();
        (directory, engine)
    }

    fn entry(path: &Path) -> Entry {
        crate::listing::entry_from_path(path).unwrap()
    }

    #[test]
    fn schema_and_fts_are_available() {
        let (_directory, engine) = engine();
        assert!(engine.fts_available());
        let status = engine.status("idle", None);
        assert!(status.fts_available);
        assert_eq!(status.indexed_files, 0);
    }

    #[test]
    fn search_matches_names_paths_and_content() {
        let (directory, engine) = engine();
        let root = directory.path();
        fs::write(root.join("invoice-march.pdf"), b"not a real pdf").unwrap();
        fs::write(root.join("notes.txt"), b"the API_KEY is in this document").unwrap();
        let generation = 1;
        engine
            .write_batch(
                &root.to_string_lossy(),
                generation,
                &[entry(&root.join("invoice-march.pdf")), entry(&root.join("notes.txt"))],
            )
            .unwrap();
        let content = engine
            .content_lookup(&root.join("notes.txt").to_string_lossy())
            .unwrap_or_default();
        assert!(content.is_empty());
        let id: i64 = {
            let conn = engine.read_conn().unwrap();
            conn.query_row("SELECT id FROM files WHERE name = 'notes.txt'", [], |row| row.get(0)).unwrap()
        };
        engine
            .store_extraction(id, extract::STATE_INDEXED, Some("the API_KEY is in this document"), None, None)
            .unwrap();

        let request = SearchRequest {
            query_id: 1,
            terms: vec!["invoice".into()],
            ..base_request(&root)
        };
        let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 50).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "invoice-march.pdf");
        assert_eq!(hits[0].match_kind, "name");

        let request = SearchRequest {
            query_id: 2,
            content_terms: vec!["API_KEY".into()],
            mode: SearchMode::Content,
            ..base_request(&root)
        };
        let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 50).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "notes.txt");
        assert_eq!(hits[0].match_kind, "content");
        assert!(hits[0].snippet.as_deref().unwrap_or("").contains("API_KEY"));

        // A plain query term must search contents too, not only names.
        let plain_request = SearchRequest {
            query_id: 3,
            terms: vec!["document".into()],
            ..base_request(root)
        };
        let (plain_hits, plain_total, _) = engine
            .search(&plain_request, &Arc::new(AtomicBool::new(false)), 50)
            .unwrap();
        assert_eq!(plain_total, 1);
        assert_eq!(plain_hits[0].entry.name, "notes.txt");
        assert_eq!(plain_hits[0].match_kind, "content");
    }

    #[test]
    fn filters_are_real_constraints() {
        let (directory, engine) = engine();
        let root = directory.path();
        fs::write(root.join("small.txt"), b"abc").unwrap();
        fs::write(root.join("large.txt"), vec![b'a'; 2048]).unwrap();
        engine
            .write_batch(
                &root.to_string_lossy(),
                1,
                &[entry(&root.join("small.txt")), entry(&root.join("large.txt"))],
            )
            .unwrap();
        let request = SearchRequest {
            query_id: 1,
            min_size: Some(1024),
            ..base_request(&root)
        };
        let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 50).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "large.txt");
    }

    #[test]
    fn duplicate_detection_requires_full_content_identity() {
        let (directory, engine) = engine();
        let root = directory.path();
        fs::write(root.join("a.txt"), b"same contents").unwrap();
        fs::write(root.join("b.txt"), b"same contents").unwrap();
        fs::write(root.join("c.txt"), b"different").unwrap();
        engine
            .write_batch(
                &root.to_string_lossy(),
                1,
                &[entry(&root.join("a.txt")), entry(&root.join("b.txt")), entry(&root.join("c.txt"))],
            )
            .unwrap();
        let response = engine
            .find_duplicates(
                &DuplicateRequest {
                    query_id: 1,
                    roots: vec![root.to_string_lossy().to_string()],
                    min_size: 1,
                    include_similar_names: false,
                    limit: 20,
                },
                &Arc::new(AtomicBool::new(false)),
            )
            .unwrap();
        assert_eq!(response.groups.len(), 1);
        assert_eq!(response.groups[0].files.len(), 2);
        assert!(response.groups[0].verified);
    }

    #[test]
    fn root_like_patterns_handle_the_filesystem_root() {
        assert_eq!(root_like_pattern("/"), "/%");
        assert_eq!(root_like_pattern("/Users/test/"), "/Users/test/%");
    }

    #[test]
    fn dedupe_keeps_the_best_hit_per_path() {
        let hit = |score: f64| SearchHit {
            entry: Entry {
                name: "a.txt".into(),
                path: "/tmp/a.txt".into(),
                is_dir: false,
                is_symlink: false,
                size: Some(1),
                modified: None,
                created: None,
                accessed: None,
                extension: Some("txt".into()),
                is_hidden: false,
                is_read_only: false,
                target: None,
            },
            score,
            match_kind: "name".into(),
            snippet: None,
            source: "index".into(),
            indexed: true,
            explanation: None,
        };
        let hits = dedupe_hits(vec![hit(1.0), hit(5.0)]);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].score, 5.0);
    }

    #[test]
    fn searches_unicode_names_case_sensitively_and_without_extensions() {
        let (directory, engine) = engine();
        let root = directory.path();
        fs::write(root.join("Résumé-Überblick.txt"), b"x").unwrap();
        fs::write(root.join("README"), b"x").unwrap();
        fs::write(root.join("readme.txt"), b"x").unwrap();
        engine
            .write_batch(
                &root.to_string_lossy(),
                1,
                &[
                    entry(&root.join("Résumé-Überblick.txt")),
                    entry(&root.join("README")),
                    entry(&root.join("readme.txt")),
                ],
            )
            .unwrap();

        let request = SearchRequest {
            query_id: 1,
            terms: vec!["Überblick".into()],
            ..base_request(root)
        };
        let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 20).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "Résumé-Überblick.txt");

        let request = SearchRequest {
            query_id: 2,
            terms: vec!["README".into()],
            case_sensitive: true,
            ..base_request(root)
        };
        let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 20).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "README");

        let request = SearchRequest {
            query_id: 3,
            no_extension: true,
            ..base_request(root)
        };
        let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 20).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "README");
    }

    #[test]
    fn empty_folder_filter_never_returns_files() {
        let (directory, engine) = engine();
        let root = directory.path();
        fs::create_dir(root.join("Empty")).unwrap();
        fs::create_dir(root.join("Full")).unwrap();
        fs::write(root.join("Full").join("inside.txt"), b"x").unwrap();
        engine
            .write_batch(
                &root.to_string_lossy(),
                1,
                &[entry(&root.join("Empty")), entry(&root.join("Full")), entry(&root.join("Full").join("inside.txt"))],
            )
            .unwrap();
        let request = SearchRequest {
            query_id: 1,
            empty_folders: true,
            ..base_request(root)
        };
        let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 20).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "Empty");
        assert!(hits[0].entry.is_dir);
    }

    #[test]
    fn index_survives_reopening_and_schema_migration() {
        let directory = tempfile::tempdir().unwrap();
        let db = directory.path().join("index.sqlite3");
        let root = directory.path().join("root");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("persisted.txt"), b"x").unwrap();
        {
            let engine = SearchEngine::open(db.clone()).unwrap();
            engine
                .write_batch(&root.to_string_lossy(), 1, &[entry(&root.join("persisted.txt"))])
                .unwrap();
        }
        let reopened = SearchEngine::open(db).unwrap();
        let request = SearchRequest {
            query_id: 1,
            terms: vec!["persisted".into()],
            ..base_request(&root)
        };
        let (hits, total, _) = reopened.search(&request, &Arc::new(AtomicBool::new(false)), 20).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "persisted.txt");
    }

    #[test]
    fn cancelled_search_returns_without_waiting_for_every_candidate() {
        let (directory, engine) = engine();
        let root = directory.path();
        let mut entries = Vec::new();
        for index in 0..50 {
            let path = root.join(format!("match-{index}.txt"));
            fs::write(&path, b"x").unwrap();
            entries.push(entry(&path));
        }
        engine
            .write_batch(&root.to_string_lossy(), 1, &entries)
            .unwrap();
        let cancel = Arc::new(AtomicBool::new(true));
        let request = SearchRequest {
            query_id: 1,
            terms: vec!["match".into()],
            ..base_request(root)
        };
        let (hits, total, _) = engine.search(&request, &cancel, 20).unwrap();
        assert_eq!(hits.len(), 0);
        assert_eq!(total, 0);
    }

    #[test]
    fn non_recursive_scope_only_returns_immediate_children() {
        let (directory, engine) = engine();
        let root = directory.path();
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("match-root.txt"), b"x").unwrap();
        fs::write(root.join("nested").join("match-nested.txt"), b"x").unwrap();
        engine
            .write_batch(
                &root.to_string_lossy(),
                1,
                &[
                    entry(&root.join("match-root.txt")),
                    entry(&root.join("nested")),
                    entry(&root.join("nested").join("match-nested.txt")),
                ],
            )
            .unwrap();
        let request = SearchRequest {
            query_id: 1,
            terms: vec!["match".into()],
            recursive: false,
            ..base_request(root)
        };
        let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 20).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "match-root.txt");
    }

    #[test]
    fn benchmark_indexed_name_query_on_five_thousand_files() {
        let (directory, engine) = engine();
        let root = directory.path();
        let mut entries = Vec::new();
        for index in 0..5_000 {
            let name = if index % 17 == 0 {
                format!("quarterly-report-{index}.pdf")
            } else {
                format!("file-{index}.txt")
            };
            entries.push(Entry {
                name: name.clone(),
                path: root.join(&name).to_string_lossy().to_string(),
                is_dir: false,
                is_symlink: false,
                size: Some(index as u64 * 17),
                modified: Some(current_ms() - (index as i64 * 60_000)),
                created: Some(current_ms()),
                accessed: Some(current_ms()),
                extension: Some(name.rsplit('.').next().unwrap_or("txt").to_string()),
                is_hidden: false,
                is_read_only: false,
                target: None,
            });
        }
        engine
            .write_batch(&root.to_string_lossy(), 1, &entries)
            .unwrap();
        let request = SearchRequest {
            query_id: 1,
            terms: vec!["report".into()],
            ..base_request(root)
        };
        let mut samples = Vec::new();
        for _ in 0..20 {
            let started = Instant::now();
            let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 50).unwrap();
            samples.push(started.elapsed().as_millis());
            assert!(total >= hits.len());
            assert!(!hits.is_empty());
        }
        samples.sort_unstable();
        eprintln!(
            "indexed name query: median={}ms p95={}ms max={}ms",
            samples[samples.len() / 2],
            samples[(samples.len() * 95) / 100],
            samples[samples.len() - 1]
        );
    }

    fn base_request(root: &Path) -> SearchRequest {
        SearchRequest {
            query_id: 0,
            text: String::new(),
            terms: vec![],
            name_terms: vec![],
            content_terms: vec![],
            exclude_terms: vec![],
            kinds: vec![],
            extensions: vec![],
            roots: vec![root.to_string_lossy().to_string()],
            include_hidden: true,
            include_indexed: true,
            recursive: true,
            include_live: false,
            include_spotlight: false,
            mode: SearchMode::Both,
            match_mode: MatchMode::All,
            case_sensitive: false,
            exact_phrase: false,
            min_size: None,
            max_size: None,
            modified_after: None,
            modified_before: None,
            created_after: None,
            created_before: None,
            accessed_after: None,
            accessed_before: None,
            no_extension: false,
            empty_folders: false,
            limit: 50,
            sort: SortOrder::Relevance,
            sort_direction: SortDirection::Desc,
        }
    }

    fn write_files(engine: &SearchEngine, root: &Path, names: &[&str]) -> Vec<Entry> {
        let mut entries = Vec::new();
        for name in names {
            let path = root.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&path, b"x").unwrap();
            entries.push(entry(&path));
        }
        engine
            .write_batch(&root.to_string_lossy(), 1, &entries)
            .unwrap();
        entries
    }

    #[test]
    fn trigram_name_index_answers_partial_and_mid_word_queries() {
        let (directory, engine) = engine();
        let root = directory.path();
        write_files(
            &engine,
            root,
            &["my-resume-2026.pdf", "resume.docx", "annual-report.pdf"],
        );
        engine.refresh_counts(true).unwrap();
        assert!(engine.populate_name_index().unwrap());
        assert!(engine.name_index().load(Ordering::Relaxed));

        let request = SearchRequest {
            query_id: 1,
            terms: vec!["resume".into()],
            ..base_request(root)
        };
        let (hits, total, _) =
            engine.search(&request, &Arc::new(AtomicBool::new(false)), 50).unwrap();
        let names: Vec<&str> = hits.iter().map(|hit| hit.entry.name.as_str()).collect();
        assert_eq!(total, 2);
        assert!(names.contains(&"my-resume-2026.pdf"));
        assert!(names.contains(&"resume.docx"));

        // Mid-word substring: `%esum%` must still match, which is what the
        // trigram tokenizer buys over the previous unicode61 FTS table.
        let request = SearchRequest {
            query_id: 2,
            terms: vec!["esum".into()],
            ..base_request(root)
        };
        let (hits, total, _) =
            engine.search(&request, &Arc::new(AtomicBool::new(false)), 50).unwrap();
        assert_eq!(total, 2, "mid-word substring must match through trigram");

        // Path-only matches must survive the join.
        let nested = root.join("projects");
        write_files(&engine, root, &["projects/resume-builder/main.ts"]);
        engine.refresh_counts(true).unwrap();
        engine.rebuild_name_index().unwrap();
        let request = SearchRequest {
            query_id: 3,
            terms: vec!["resume-builder".into()],
            ..base_request(root)
        };
        let (hits, total, _) =
            engine.search(&request, &Arc::new(AtomicBool::new(false)), 50).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "main.ts");
        let _ = nested;
    }

    #[test]
    fn prune_removes_rows_the_exclusion_policy_rejects() {
        let (directory, engine) = engine();
        let root = directory.path();
        write_files(
            &engine,
            root,
            &[
                "Documents/tax.pdf",
                ".local/share/tool/blob.bin",
                ".lmstudio/models/weight.gguf",
                "projects/app/node_modules/left-pad/index.js",
                "projects/app/src/main.ts",
            ],
        );
        let before = engine.refresh_counts(true).unwrap();
        assert_eq!(before.files, 5);

        let report = engine.prune_excluded().unwrap();
        assert_eq!(report.removed, 3, "junk trees must be removed");

        let after = engine.refresh_counts(true).unwrap();
        assert_eq!(after.files, 2);
        let request = SearchRequest {
            query_id: 9,
            terms: vec!["tax".into()],
            ..base_request(root)
        };
        let (hits, total, _) =
            engine.search(&request, &Arc::new(AtomicBool::new(false)), 50).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "tax.pdf");
    }

    #[test]
    fn counters_are_materialised_instead_of_counted_per_query() {
        let (directory, engine) = engine();
        let root = directory.path();
        write_files(&engine, root, &["a.txt", "b.txt", "folder/c.txt"]);
        engine
            .write_batch(
                &root.to_string_lossy(),
                1,
                &[entry(&root.join("folder"))],
            )
            .unwrap();
        let counts = engine.refresh_counts(true).unwrap();
        assert_eq!(counts.files, 3);
        assert_eq!(counts.folders, 1);

        let status = engine.status("idle", None);
        assert_eq!(status.indexed_files, 3);
        assert_eq!(status.indexed_folders, 1);
        // Reading status must not recompute anything.
        let cached = engine.cached_counts();
        assert_eq!(cached.files, 3);
        assert!(cached.updated_at > 0);
    }

    #[test]
    fn status_reports_a_location_without_scanning_files() {
        let (directory, engine) = engine();
        let root = directory.path();
        engine.add_location(&root.to_string_lossy()).unwrap();
        write_files(&engine, root, &["a.txt", "b.txt"]);
        engine.refresh_counts(true).unwrap();
        let status = engine.status("idle", None);
        assert_eq!(status.locations.len(), 1);
        assert_eq!(status.locations[0].indexed_files, 2);
    }

    #[test]
    fn an_empty_trigram_index_falls_back_instead_of_hiding_matches() {
        let (directory, engine) = engine();
        let root = directory.path();
        write_files(&engine, root, &["resume.pdf", "notes.txt"]);
        engine.refresh_counts(true).unwrap();
        assert!(engine.populate_name_index().unwrap());

        // Simulate a stale or partially built name index.
        {
            let conn = engine.write_conn().unwrap();
            conn.execute("DELETE FROM files_name_fts", []).unwrap();
        }

        let request = SearchRequest {
            query_id: 1,
            terms: vec!["resume".into()],
            ..base_request(root)
        };
        let (hits, total, _) =
            engine.search(&request, &Arc::new(AtomicBool::new(false)), 50).unwrap();
        assert_eq!(total, 1, "the scan fallback must still find the file");
        assert_eq!(hits[0].entry.name, "resume.pdf");
    }
}
