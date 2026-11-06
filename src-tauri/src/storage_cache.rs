//! Versioned SQLite cache for completed storage scans.
//!
//! The analyzer keeps the live index in memory while the app runs. This cache
//! preserves that index across restarts and reinstalls (app-data is not removed
//! by replacing the app bundle), so the overview and drill-down views can be
//! restored without forcing a full volume scan. Cached results are read-only
//! until the user explicitly rescans.

use crate::error::AppError;
use crate::logging;
use crate::storage::{
    StorageChildren, StorageDirectory, StorageFile, StorageFilePage, StorageFileQuery,
    StorageScanResult,
};
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

const CACHE_VERSION: i64 = 1;
const MAX_CACHED_SCANS: i64 = 8;

#[derive(Clone)]
pub struct StorageCache {
    path: PathBuf,
    write_lock: std::sync::Arc<std::sync::Mutex<()>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedStorageScan {
    pub scan: StorageScanResult,
    pub cached_at: i64,
}

impl StorageCache {
    pub fn new(path: PathBuf) -> Result<Self, AppError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let cache = Self {
            path,
            write_lock: std::sync::Arc::new(std::sync::Mutex::new(())),
        };
        cache.initialise()?;
        Ok(cache)
    }

    fn connect(&self) -> Result<Connection, AppError> {
        let connection = Connection::open(&self.path)?;
        connection.busy_timeout(std::time::Duration::from_secs(10))?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;",
        )?;
        Ok(connection)
    }

    fn initialise(&self) -> Result<(), AppError> {
        let connection = self.connect()?;
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version != CACHE_VERSION {
            connection.execute_batch(
                "DROP TABLE IF EXISTS files;
                 DROP TABLE IF EXISTS directories;
                 DROP TABLE IF EXISTS scans;
                 PRAGMA user_version = 1;",
            )?;
        }
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS scans (
                scan_id INTEGER PRIMARY KEY,
                root TEXT NOT NULL,
                finished_at INTEGER NOT NULL,
                result_json TEXT NOT NULL,
                files INTEGER NOT NULL,
                directories INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS scans_root_time ON scans(root, finished_at DESC);
             CREATE INDEX IF NOT EXISTS scans_time ON scans(finished_at DESC);
             CREATE TABLE IF NOT EXISTS files (
                scan_id INTEGER NOT NULL,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                parent TEXT NOT NULL,
                extension TEXT,
                is_symlink INTEGER NOT NULL,
                size INTEGER NOT NULL,
                allocated INTEGER NOT NULL,
                modified INTEGER,
                created INTEGER,
                accessed INTEGER,
                is_hidden INTEGER NOT NULL,
                is_package INTEGER NOT NULL,
                hard_link INTEGER NOT NULL,
                cloud_placeholder INTEGER NOT NULL,
                is_protected INTEGER NOT NULL,
                is_read_only INTEGER NOT NULL,
                category TEXT NOT NULL,
                file_type TEXT NOT NULL,
                PRIMARY KEY(scan_id, path)
             );
             CREATE INDEX IF NOT EXISTS files_parent ON files(scan_id, parent);
             CREATE INDEX IF NOT EXISTS files_size ON files(scan_id, size DESC);
             CREATE INDEX IF NOT EXISTS files_type ON files(scan_id, file_type);
             CREATE INDEX IF NOT EXISTS files_category ON files(scan_id, category);
             CREATE TABLE IF NOT EXISTS directories (
                scan_id INTEGER NOT NULL,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                parent TEXT NOT NULL,
                size INTEGER NOT NULL,
                allocated INTEGER NOT NULL,
                files INTEGER NOT NULL,
                folders INTEGER NOT NULL,
                direct_files INTEGER NOT NULL,
                direct_folders INTEGER NOT NULL,
                largest_file_size INTEGER NOT NULL,
                largest_file_path TEXT,
                modified INTEGER,
                depth INTEGER NOT NULL,
                is_package INTEGER NOT NULL,
                is_protected INTEGER NOT NULL,
                is_read_only INTEGER NOT NULL,
                PRIMARY KEY(scan_id, path)
             );
             CREATE INDEX IF NOT EXISTS directories_parent ON directories(scan_id, parent);
             CREATE INDEX IF NOT EXISTS directories_size ON directories(scan_id, size DESC);",
        )?;
        Ok(())
    }

    pub fn store(
        &self,
        scan: &StorageScanResult,
        files: &[StorageFile],
        directories: &[StorageDirectory],
    ) -> Result<(), AppError> {
        let _write_guard = self
            .write_lock
            .lock()
            .map_err(|_| AppError::new("cache_error", "Storage cache lock was poisoned.", None))?;
        let started = Instant::now();
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let scan_id = scan.scan_id as i64;
        let root = scan.root.as_str();
        let existing: Option<i64> = transaction
            .query_row(
                "SELECT max(finished_at) FROM scans WHERE root = ?1",
                params![root],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        if existing
            .map(|value| value >= scan.finished_at)
            .unwrap_or(false)
        {
            logging::info(
                "storage.cache",
                format!(
                    "skipping older scan {} for {} because a newer cache entry exists",
                    scan.scan_id, root
                ),
            );
            return Ok(());
        }
        transaction.execute(
            "DELETE FROM files WHERE scan_id IN (SELECT scan_id FROM scans WHERE root = ?1)",
            params![root],
        )?;
        transaction.execute(
            "DELETE FROM directories WHERE scan_id IN (SELECT scan_id FROM scans WHERE root = ?1)",
            params![root],
        )?;
        transaction.execute("DELETE FROM scans WHERE root = ?1", params![root])?;
        let result_json = serde_json::to_string(scan)
            .map_err(|error| AppError::new("cache_error", error.to_string(), None))?;
        transaction.execute(
            "INSERT INTO scans (scan_id, root, finished_at, result_json, files, directories)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                scan_id,
                root,
                scan.finished_at,
                result_json,
                files.len() as i64,
                directories.len() as i64
            ],
        )?;
        {
            let mut statement = transaction.prepare(
                "INSERT OR REPLACE INTO files
                 (scan_id, path, name, parent, extension, is_symlink, size, allocated,
                  modified, created, accessed, is_hidden, is_package, hard_link,
                  cloud_placeholder, is_protected, is_read_only, category, file_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                         ?14, ?15, ?16, ?17, ?18, ?19)",
            )?;
            for file in files {
                statement.execute(params![
                    scan_id,
                    file.path,
                    file.name,
                    file.parent,
                    file.extension,
                    file.is_symlink as i64,
                    file.size as i64,
                    file.allocated as i64,
                    file.modified,
                    file.created,
                    file.accessed,
                    file.is_hidden as i64,
                    file.is_package as i64,
                    file.hard_link as i64,
                    file.cloud_placeholder as i64,
                    file.is_protected as i64,
                    file.is_read_only as i64,
                    file.category,
                    file.file_type
                ])?;
            }
        }
        {
            let mut statement = transaction.prepare(
                "INSERT OR REPLACE INTO directories
                 (scan_id, path, name, parent, size, allocated, files, folders,
                  direct_files, direct_folders, largest_file_size, largest_file_path,
                  modified, depth, is_package, is_protected, is_read_only)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                         ?14, ?15, ?16, ?17)",
            )?;
            for directory in directories {
                statement.execute(params![
                    scan_id,
                    directory.path,
                    directory.name,
                    directory.parent,
                    directory.size as i64,
                    directory.allocated as i64,
                    directory.files as i64,
                    directory.folders as i64,
                    directory.direct_files as i64,
                    directory.direct_folders as i64,
                    directory.largest_file_size as i64,
                    directory.largest_file_path,
                    directory.modified,
                    directory.depth as i64,
                    directory.is_package as i64,
                    directory.is_protected as i64,
                    directory.is_read_only as i64
                ])?;
            }
        }
        // Keep a small rolling history so a newer scan can never be overwritten
        // by an older background write.
        transaction.execute(
            "DELETE FROM files WHERE scan_id NOT IN
                (SELECT scan_id FROM scans ORDER BY finished_at DESC LIMIT ?1)",
            params![MAX_CACHED_SCANS],
        )?;
        transaction.execute(
            "DELETE FROM directories WHERE scan_id NOT IN
                (SELECT scan_id FROM scans ORDER BY finished_at DESC LIMIT ?1)",
            params![MAX_CACHED_SCANS],
        )?;
        transaction.execute(
            "DELETE FROM scans WHERE scan_id NOT IN
                (SELECT scan_id FROM scans ORDER BY finished_at DESC LIMIT ?1)",
            params![MAX_CACHED_SCANS],
        )?;
        transaction.commit()?;
        logging::info(
            "storage.cache",
            format!(
                "stored scan {} ({} files, {} dirs) in {} ms at {}",
                scan.scan_id,
                files.len(),
                directories.len(),
                started.elapsed().as_millis(),
                self.path.display()
            ),
        );
        Ok(())
    }

    pub fn latest(&self, root: Option<&str>) -> Result<Option<CachedStorageScan>, AppError> {
        let connection = self.connect()?;
        match root {
            Some(root) => {
                let mut statement = connection.prepare(
                    "SELECT result_json, finished_at FROM scans
                     ORDER BY finished_at DESC LIMIT 32",
                )?;
                let rows = statement.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })?;
                for row in rows.flatten() {
                    let scan: StorageScanResult = match serde_json::from_str(&row.0) {
                        Ok(scan) => scan,
                        Err(error) => {
                            logging::warn(
                                "storage.cache",
                                format!("ignoring corrupt cached scan: {error}"),
                            );
                            continue;
                        }
                    };
                    let belongs = scan.root == root
                        || scan
                            .volume
                            .as_ref()
                            .map(|volume| volume.mount_point == root)
                            .unwrap_or(false);
                    if belongs {
                        return Ok(Some(CachedStorageScan {
                            scan,
                            cached_at: row.1,
                        }));
                    }
                }
                Ok(None)
            }
            None => {
                let row: Option<(String, i64)> = connection
                    .query_row(
                        "SELECT result_json, finished_at FROM scans
                         ORDER BY finished_at DESC LIMIT 1",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()?;
                let Some((json, cached_at)) = row else {
                    return Ok(None);
                };
                let scan: StorageScanResult = serde_json::from_str(&json)
                    .map_err(|error| AppError::new("cache_error", error.to_string(), None))?;
                Ok(Some(CachedStorageScan { scan, cached_at }))
            }
        }
    }

    pub fn children(
        &self,
        scan_id: u64,
        path: &str,
        limit: usize,
    ) -> Result<StorageChildren, AppError> {
        let connection = self.connect()?;
        let directory = connection
            .query_row(
                &format!(
                    "SELECT {DIRECTORY_COLUMNS} FROM directories WHERE scan_id = ?1 AND path = ?2"
                ),
                params![scan_id as i64, path],
                directory_from_row,
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new(
                    "not_in_scan",
                    "This folder is not part of the cached scan. Run a fresh scan to inspect it.",
                    Some(path.to_string()),
                )
            })?;
        let limit = limit.clamp(1, 10_000) as i64;
        let direct_directories: i64 = connection.query_row(
            "SELECT count(*) FROM directories WHERE scan_id = ?1 AND parent = ?2 AND path <> ?2",
            params![scan_id as i64, path],
            |row| row.get(0),
        )?;
        let direct_files: i64 = connection.query_row(
            "SELECT count(*) FROM files WHERE scan_id = ?1 AND parent = ?2",
            params![scan_id as i64, path],
            |row| row.get(0),
        )?;
        let mut directory_statement = connection.prepare(&format!(
            "SELECT {DIRECTORY_COLUMNS} FROM directories
             WHERE scan_id = ?1 AND parent = ?2 AND path <> ?2
             ORDER BY size DESC LIMIT ?3"
        ))?;
        let directories = directory_statement
            .query_map(params![scan_id as i64, path, limit], directory_from_row)?
            .filter_map(|row| row.ok())
            .collect::<Vec<_>>();
        let mut file_statement = connection.prepare(&format!(
            "SELECT {FILE_COLUMNS} FROM files
             WHERE scan_id = ?1 AND parent = ?2
             ORDER BY size DESC LIMIT ?3"
        ))?;
        let files = file_statement
            .query_map(params![scan_id as i64, path, limit], file_from_row)?
            .filter_map(|row| row.ok())
            .collect::<Vec<_>>();
        Ok(StorageChildren {
            path: path.to_string(),
            total_size: directory.size,
            total_files: directory.files,
            total_folders: directory.folders,
            directory,
            directories,
            files,
            truncated: direct_directories > limit || direct_files > limit,
        })
    }

    pub fn query_files(&self, query: &StorageFileQuery) -> Result<StorageFilePage, AppError> {
        let connection = self.connect()?;
        let mut clauses = vec!["scan_id = ?".to_string()];
        let mut values: Vec<Value> = vec![Value::Integer(query.scan_id as i64)];
        if let Some(directory) = query.directory.as_deref() {
            if query.recursive {
                let prefix = format!("{directory}/");
                clauses.push("(path = ? OR substr(path, 1, length(?)) = ?)".into());
                values.push(Value::Text(directory.to_string()));
                values.push(Value::Text(prefix.clone()));
                values.push(Value::Text(prefix));
            } else {
                clauses.push("parent = ?".into());
                values.push(Value::Text(directory.to_string()));
            }
        }
        if let Some(category) = query.category.as_deref() {
            clauses.push("category = ?".into());
            values.push(Value::Text(category.to_string()));
        }
        if let Some(file_type) = query.file_type.as_deref() {
            clauses.push("file_type = ?".into());
            values.push(Value::Text(file_type.to_string()));
        }
        if let Some(name) = query.name.as_deref() {
            clauses.push("instr(lower(name), lower(?)) > 0".into());
            values.push(Value::Text(name.to_string()));
        }
        if let Some(extension) = query.extension.as_deref() {
            clauses.push("extension = ?".into());
            values.push(Value::Text(extension.to_lowercase()));
        }
        if let Some(minimum) = query.min_size {
            clauses.push("size >= ?".into());
            values.push(Value::Integer(minimum as i64));
        }
        if let Some(maximum) = query.max_size {
            clauses.push("size <= ?".into());
            values.push(Value::Integer(maximum as i64));
        }
        if let Some(after) = query.modified_after {
            clauses.push("modified IS NOT NULL AND modified >= ?".into());
            values.push(Value::Integer(after));
        }
        if let Some(before) = query.modified_before {
            clauses.push("modified IS NOT NULL AND modified <= ?".into());
            values.push(Value::Integer(before));
        }
        if let Some(after) = query.created_after {
            clauses.push("created IS NOT NULL AND created >= ?".into());
            values.push(Value::Integer(after));
        }
        if let Some(before) = query.created_before {
            clauses.push("created IS NOT NULL AND created <= ?".into());
            values.push(Value::Integer(before));
        }
        if let Some(hidden) = query.hidden {
            clauses.push("is_hidden = ?".into());
            values.push(Value::Integer(hidden as i64));
        }
        if let Some(symlinks) = query.symlinks {
            clauses.push("is_symlink = ?".into());
            values.push(Value::Integer(symlinks as i64));
        }
        let where_clause = clauses.join(" AND ");
        let (total, total_bytes): (i64, i64) = connection.query_row(
            &format!("SELECT count(*), coalesce(sum(size), 0) FROM files WHERE {where_clause}"),
            params_from_iter(values.iter()),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let sort = match query.sort.as_str() {
            "name" => "name COLLATE NOCASE",
            "modified" => "modified",
            "created" => "created",
            "type" => "file_type, name COLLATE NOCASE",
            "path" => "path",
            _ => "size",
        };
        let direction = if query.direction.eq_ignore_ascii_case("asc") {
            "ASC"
        } else {
            "DESC"
        };
        let limit = query.limit.clamp(1, 5_000) as i64;
        let offset = query.offset as i64;
        let mut page_values = values;
        page_values.push(Value::Integer(limit));
        page_values.push(Value::Integer(offset));
        let mut statement = connection.prepare(&format!(
            "SELECT {FILE_COLUMNS} FROM files WHERE {where_clause}
             ORDER BY {sort} {direction}, path ASC LIMIT ? OFFSET ?"
        ))?;
        let files = statement
            .query_map(params_from_iter(page_values.iter()), file_from_row)?
            .filter_map(|row| row.ok())
            .collect::<Vec<_>>();
        Ok(StorageFilePage {
            files,
            total: total.max(0) as u64,
            total_bytes: total_bytes.max(0) as u64,
            offset: query.offset as u64,
            limit: limit as u64,
            has_more: total > offset.saturating_add(limit),
        })
    }

    /// Membership check used by the delete path once the in-memory index has been
    /// released: a path may be removed only if the verified scan recorded it.
    pub fn has_path(&self, scan_id: u64, path: &str) -> Result<bool, AppError> {
        let connection = self.connect()?;
        let found: Option<i64> = connection
            .query_row(
                "SELECT 1 FROM files WHERE scan_id = ?1 AND path = ?2
                 UNION ALL
                 SELECT 1 FROM directories WHERE scan_id = ?1 AND path = ?2
                 LIMIT 1",
                params![scan_id as i64, path],
                |row| row.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }

    pub fn clear(&self) -> Result<(), AppError> {
        let connection = self.connect()?;
        connection.execute_batch(
            "DELETE FROM files;
             DELETE FROM directories;
             DELETE FROM scans;",
        )?;
        logging::info("storage.cache", "cleared cached storage scans");
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

const DIRECTORY_COLUMNS: &str = "path, name, parent, size, allocated, files, folders,
    direct_files, direct_folders, largest_file_size, largest_file_path, modified, depth,
    is_package, is_protected, is_read_only";

const FILE_COLUMNS: &str = "path, name, parent, extension, is_symlink, size, allocated,
    modified, created, accessed, is_hidden, is_package, hard_link, cloud_placeholder,
    is_protected, is_read_only, category, file_type";

fn directory_from_row(row: &Row<'_>) -> rusqlite::Result<StorageDirectory> {
    Ok(StorageDirectory {
        path: row.get(0)?,
        name: row.get(1)?,
        parent: row.get(2)?,
        size: row.get::<_, i64>(3)?.max(0) as u64,
        allocated: row.get::<_, i64>(4)?.max(0) as u64,
        files: row.get::<_, i64>(5)?.max(0) as u64,
        folders: row.get::<_, i64>(6)?.max(0) as u64,
        direct_files: row.get::<_, i64>(7)?.max(0) as u64,
        direct_folders: row.get::<_, i64>(8)?.max(0) as u64,
        largest_file_size: row.get::<_, i64>(9)?.max(0) as u64,
        largest_file_path: row.get(10)?,
        modified: row.get(11)?,
        depth: row.get::<_, i64>(12)?.max(0) as u32,
        is_package: row.get::<_, i64>(13)? != 0,
        is_protected: row.get::<_, i64>(14)? != 0,
        is_read_only: row.get::<_, i64>(15)? != 0,
    })
}

fn file_from_row(row: &Row<'_>) -> rusqlite::Result<StorageFile> {
    Ok(StorageFile {
        path: row.get(0)?,
        name: row.get(1)?,
        parent: row.get(2)?,
        extension: row.get(3)?,
        is_symlink: row.get::<_, i64>(4)? != 0,
        size: row.get::<_, i64>(5)?.max(0) as u64,
        allocated: row.get::<_, i64>(6)?.max(0) as u64,
        modified: row.get(7)?,
        created: row.get(8)?,
        accessed: row.get(9)?,
        is_hidden: row.get::<_, i64>(10)? != 0,
        is_package: row.get::<_, i64>(11)? != 0,
        hard_link: row.get::<_, i64>(12)? != 0,
        cloud_placeholder: row.get::<_, i64>(13)? != 0,
        is_protected: row.get::<_, i64>(14)? != 0,
        is_read_only: row.get::<_, i64>(15)? != 0,
        category: row.get(16)?,
        file_type: row.get(17)?,
    })
}
