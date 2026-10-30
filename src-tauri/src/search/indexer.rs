use crate::listing::entry_from_path;
use crate::search::engine::{normalized_root, SearchEngine};
use crate::search::extract;
use crate::search::live::should_skip_directory;
use crate::types::Entry;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use walkdir::WalkDir;

const BATCH_SIZE: usize = 200;
const RECONCILE_INTERVAL: Duration = Duration::from_secs(30 * 60);
const DEBOUNCE: Duration = Duration::from_millis(450);
const WATCH_TICK: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Default)]
pub struct IndexActivity {
    pub activity: String,
    pub current_path: Option<String>,
}

pub struct IndexerHandle {
    stop: Arc<AtomicBool>,
    joins: Mutex<Vec<thread::JoinHandle<()>>>,
}

impl IndexerHandle {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    pub fn stop_and_join(&self) {
        self.stop();
        if let Ok(mut joins) = self.joins.lock() {
            for join in joins.drain(..) {
                let _ = join.join();
            }
        }
    }
}

impl Drop for IndexerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn start(engine: Arc<SearchEngine>, activity: Arc<Mutex<IndexActivity>>) -> IndexerHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let mut joins = Vec::new();
    {
        let engine = engine.clone();
        let activity = activity.clone();
        let stop = stop.clone();
        if let Ok(join) = thread::Builder::new()
            .name("maxplorer-indexer".into())
            .spawn(move || indexer_loop(engine, activity, stop))
        {
            joins.push(join);
        }
    }
    {
        let engine = engine.clone();
        let activity = activity.clone();
        let stop = stop.clone();
        if let Ok(join) = thread::Builder::new()
            .name("maxplorer-content-indexer".into())
            .spawn(move || content_loop(engine, activity, stop))
        {
            joins.push(join);
        }
    }
    IndexerHandle { stop, joins: Mutex::new(joins) }
}

fn indexer_loop(engine: Arc<SearchEngine>, activity: Arc<Mutex<IndexActivity>>, stop: Arc<AtomicBool>) {
    let (sender, receiver) = channel();
    let mut _watcher_guard: Option<RecommendedWatcher> = None;
    let mut tracked_roots: Vec<String> = Vec::new();    let mut pending: HashMap<PathBuf, Instant> = HashMap::new();
    let mut last_reconcile = Instant::now();
    let mut last_config_check = Instant::now();
    let mut last_scan_check = Instant::now();

    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let paused = engine.paused();
        let roots = engine.enabled_roots();

        if last_config_check.elapsed() > Duration::from_secs(1) {
            last_config_check = Instant::now();
            if roots != tracked_roots {
                _watcher_guard = None;
                tracked_roots = roots.clone();
                let event_sender = sender.clone();
                match notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                    if let Ok(event) = result {
                        let _ = event_sender.send(event);
                    }
                }) {
                    Ok(mut created) => {
                        for root in &tracked_roots {
                            let _ = created.watch(Path::new(root), RecursiveMode::Recursive);
                        }
                        _watcher_guard = Some(created);
                    }
                    Err(_) => {
                        _watcher_guard = None;
                    }
                }
            }
        }

        if paused {
            set_activity(&activity, "paused", None);
            drain_events(&receiver, &mut pending, &mut last_reconcile, false);
            thread::sleep(WATCH_TICK);
            continue;
        }

        // Initial indexing and repairs requested from the indexing dashboard.
        if last_scan_check.elapsed() > Duration::from_secs(2) {
            last_scan_check = Instant::now();
            let to_scan = engine.locations_to_scan();
            for root in to_scan {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                scan_root(&engine, &activity, &root, &stop);
            }
        }
        if last_reconcile.elapsed() > RECONCILE_INTERVAL || engine.take_rebuild_request() {
            last_reconcile = Instant::now();
            for root in engine.enabled_roots() {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                scan_root(&engine, &activity, &root, &stop);
            }
        }

        drain_events(&receiver, &mut pending, &mut last_reconcile, true);
        let due: Vec<PathBuf> = pending
            .iter()
            .filter(|(_, seen)| seen.elapsed() >= DEBOUNCE)
            .map(|(path, _)| path.clone())
            .collect();
        for path in due {
            pending.remove(&path);
            if stop.load(Ordering::Relaxed) || engine.paused() {
                break;
            }
            apply_event(&engine, &activity, &path, &stop);
        }

        if activity.lock().map(|value| value.activity.is_empty()).unwrap_or(false) {
            set_activity(&activity, "watching", None);
        }
        thread::sleep(WATCH_TICK);
    }
    set_activity(&activity, "stopped", None);
}

fn drain_events(
    receiver: &Receiver<notify::Event>,
    pending: &mut HashMap<PathBuf, Instant>,
    last_reconcile: &mut Instant,
    active: bool,
) {
    while let Ok(event) = receiver.try_recv() {
        use notify::EventKind;
        if matches!(event.kind, EventKind::Access(_)) {
            continue;
        }
        // Some platforms coalesce a large change into a rescan hint. Treat that
        // as a reconciliation request rather than trying to replay every event.
        if !active {
            continue;
        }
        for path in event.paths {
            // Directory-level events are covered by the reconciliation scan.
            pending.entry(path).or_insert_with(Instant::now);
        }
        if pending.len() > 4_000 {
            pending.clear();
            *last_reconcile = Instant::now() - RECONCILE_INTERVAL;
        }
    }
}

fn apply_event(engine: &SearchEngine, activity: &Arc<Mutex<IndexActivity>>, path: &Path, stop: &AtomicBool) {
    if !path.exists() {
        let _ = engine.remove_path(&path.to_string_lossy());
        return;
    }
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return;
    };
    let roots = engine.enabled_roots();
    let root = roots
        .iter()
        .find(|root| crate::search::engine::path_under_root(&path.to_string_lossy(), root))
        .cloned()
        .or_else(|| {
            path.parent()
                .map(|parent| parent.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    if metadata.is_dir() {
        scan_subtree(engine, activity, &root, stop, 10_000);
    } else {
        set_activity(activity, "indexing", Some(path.to_string_lossy().to_string()));
        let _ = engine.index_single_path(&root, path, 0);
        set_activity(activity, "watching", None);
    }
}

fn scan_root(engine: &SearchEngine, activity: &Arc<Mutex<IndexActivity>>, root: &str, stop: &AtomicBool) {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        let _ = engine.mark_location(root, "unavailable", Some("This location is currently unavailable."));
        return;
    }
    let generation = match engine.begin_scan(root) {
        Ok(generation) => generation,
        Err(_) => return,
    };
    set_activity(activity, "indexing", Some(root.to_string()));
    let (complete, error) = scan_entries(engine, activity, root, generation, stop, usize::MAX);
    let _ = engine.finish_scan(root, generation, complete, error.clone());
    if complete {
        set_activity(activity, "watching", None);
    }
}

fn scan_subtree(
    engine: &SearchEngine,
    activity: &Arc<Mutex<IndexActivity>>,
    root: &str,
    stop: &AtomicBool,
    max_entries: usize,
) {
    let _ = scan_entries(engine, activity, root, 0, stop, max_entries);
    set_activity(activity, "watching", None);
}

fn scan_entries(
    engine: &SearchEngine,
    activity: &Arc<Mutex<IndexActivity>>,
    root: &str,
    generation: i64,
    stop: &AtomicBool,
    max_entries: usize,
) -> (bool, Option<String>) {
    let root = normalized_root(root);
    let root_path = PathBuf::from(&root);
    let mut batch: Vec<Entry> = Vec::with_capacity(BATCH_SIZE);
    let mut scanned = 0usize;
    let mut errors = 0u64;
    let mut complete = true;
    let mut fse_errors = 0u64;

    let walker = WalkDir::new(&root_path)
        .follow_links(false)
        .max_depth(64)
        .into_iter()
        .filter_entry(|item| {
            if item.depth() == 0 {
                return true;
            }
            if item.file_type().is_dir() {
                let name = item.file_name().to_string_lossy();
                return !should_skip_directory(&name, item.depth());
            }
            true
        });

    for item in walker {
        if stop.load(Ordering::Relaxed) || engine.paused() || scanned >= max_entries {
            complete = false;
            break;
        }
        let item = match item {
            Ok(item) => item,
            Err(_) => {
                errors += 1;
                continue;
            }
        };
        // Symlinked directories are listed but never traversed (walkdir's
        // follow_links=false guarantees this); this prevents loops and scope
        // escapes.
        match entry_from_path(item.path()) {
            Ok(entry) => batch.push(entry),
            Err(_) => {
                errors += 1;
                continue;
            }
        }
        scanned += 1;
        if scanned % 512 == 0 {
            set_activity(activity, "indexing", Some(item.path().to_string_lossy().to_string()));
        }
        if batch.len() >= BATCH_SIZE {
            if engine.write_batch(&root, generation, &batch).is_err() {
                fse_errors += 1;
            }
            batch.clear();
        }
    }
    if !batch.is_empty() {
        if engine.write_batch(&root, generation, &batch).is_err() {
            fse_errors += 1;
        }
    }
    let error = if fse_errors > 0 {
        Some(format!(
            "{fse_errors} index writes failed. The index needs reconciliation."
        ))
    } else if errors > 0 {
        Some(format!(
            "{errors} files or folders could not be read because of permissions or filesystem errors."
        ))
    } else {
        None
    };
    (complete, error)
}

fn content_loop(engine: Arc<SearchEngine>, activity: Arc<Mutex<IndexActivity>>, stop: Arc<AtomicBool>) {
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        if engine.paused() || !engine.content_enabled() {
            thread::sleep(Duration::from_millis(900));
            continue;
        }
        let jobs = engine.next_content_jobs(6);
        if jobs.is_empty() {
            thread::sleep(Duration::from_millis(500));
            continue;
        }
        let max_bytes = engine.max_content_bytes();
        for (id, path, extension, size, modified) in jobs {
            if stop.load(Ordering::Relaxed) || engine.paused() {
                break;
            }
            set_activity(&activity, "content", Some(path.clone()));
            let before = std::fs::metadata(&path).ok();
            let extraction = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                extract::extract(Path::new(&path), &extension, max_bytes)
            })) {
                Ok(extraction) => extraction,
                Err(_) => {
                    crate::logging::error(
                        "search.extract",
                        format!(
                            "content extraction panicked for {path}; the file was recorded as an error and indexing continued"
                        ),
                    );
                    extract::Extraction::failed(
                        "Content extraction failed internally. The rest of the index continued."
                            .into(),
                    )
                }
            };
            let after = std::fs::metadata(&path).ok();
            let changed = match (before, after) {
                (Some(before), Some(after)) => {
                    before.len() != after.len()
                        || crate::paths::system_time_ms(before.modified()) != modified
                        || size != Some(before.len() as i64)
                }
                _ => true,
            };
            if changed {
                let _ = engine.store_extraction(
                    id,
                    extract::STATE_SKIPPED,
                    None,
                    Some("The file changed while it was being indexed. It will be retried after the next change."),
                    None,
                );
                continue;
            }
            let _ = engine.store_extraction(
                id,
                &extraction.status,
                extraction.text.as_deref(),
                extraction.error.as_deref(),
                None,
            );
        }
        set_activity(&activity, "watching", None);
        // Yield between batches so interactive searches and foreground file
        // operations retain priority over background extraction.
        thread::sleep(Duration::from_millis(60));
    }
}

fn set_activity(activity: &Arc<Mutex<IndexActivity>>, name: &str, path: Option<String>) {
    if let Ok(mut value) = activity.lock() {
        value.activity = name.into();
        value.current_path = path;
    }
}

/// Public helper used by the engine tests and the indexing dashboard. It scans a
/// folder synchronously into the index without starting filesystem watchers.
#[allow(dead_code)]
pub fn index_folder_sync(engine: &SearchEngine, root: &str) -> Result<usize, String> {
    let before = {
        let conn = rusqlite::Connection::open(&engine.db_path).map_err(|error| error.to_string())?;
        conn.query_row(
            "SELECT COUNT(*) FROM files WHERE root = ?1",
            rusqlite::params![normalized_root(root)],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
    };
    let generation = engine.begin_scan(root).map_err(|error| error.to_string())?;
    let activity = Arc::new(Mutex::new(IndexActivity::default()));
    let stop = AtomicBool::new(false);
    let (complete, error) = scan_entries(engine, &activity, root, generation, &stop, usize::MAX);
    engine
        .finish_scan(root, generation, complete, error)
        .map_err(|error| error.to_string())?;
    let after = {
        let conn = rusqlite::Connection::open(&engine.db_path).map_err(|error| error.to_string())?;
        conn.query_row(
            "SELECT COUNT(*) FROM files WHERE root = ?1",
            rusqlite::params![normalized_root(root)],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
    };
    Ok((after - before).max(0) as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::model::SearchRequest;
    use std::fs;

    fn test_engine() -> (tempfile::TempDir, SearchEngine) {
        let directory = tempfile::tempdir().unwrap();
        let engine = SearchEngine::open(directory.path().join("index.sqlite3")).unwrap();
        (directory, engine)
    }

    fn count(engine: &SearchEngine, root: &str) -> u64 {
        let conn = rusqlite::Connection::open(&engine.db_path).unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM files WHERE root = ?1",
            rusqlite::params![normalized_root(root)],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as u64
    }

    #[test]
    fn initial_index_walks_nested_folders_and_ignores_heavy_directories() {
        let (directory, engine) = test_engine();
        let root = directory.path().join("workspace");
        fs::create_dir_all(root.join("src").join("nested")).unwrap();
        fs::create_dir_all(root.join("node_modules").join("package")).unwrap();
        fs::write(root.join("src").join("main.rs"), b"fn main() {}").unwrap();
        fs::write(root.join("src").join("nested").join("notes.md"), b"# Notes").unwrap();
        fs::write(root.join("node_modules").join("package").join("index.js"), b"module").unwrap();
        engine.add_location(&root.to_string_lossy()).unwrap();
        let added = index_folder_sync(&engine, &root.to_string_lossy()).unwrap();
        assert_eq!(added, 5); // workspace, src, nested, main.rs, notes.md
        assert_eq!(count(&engine, &root.to_string_lossy()), 5);
    }

    #[test]
    fn reindex_removes_deleted_files_and_adds_new_ones() {
        let (directory, engine) = test_engine();
        let root = directory.path().join("workspace");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("old.txt"), b"old").unwrap();
        engine.add_location(&root.to_string_lossy()).unwrap();
        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();
        fs::remove_file(root.join("old.txt")).unwrap();
        fs::write(root.join("new.txt"), b"new").unwrap();
        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();
        let conn = rusqlite::Connection::open(&engine.db_path).unwrap();
        let names: Vec<String> = conn
            .prepare("SELECT name FROM files WHERE root = ?1 ORDER BY name")
            .unwrap()
            .query_map(rusqlite::params![normalized_root(&root.to_string_lossy())], |row| row.get(0))
            .unwrap()
            .filter_map(|row| row.ok())
            .collect();
        assert!(names.contains(&"new.txt".to_string()));
        assert!(!names.contains(&"old.txt".to_string()));
    }

    #[test]
    fn content_jobs_are_queued_and_extracted_text_is_searchable() {
        let (directory, engine) = test_engine();
        let root = directory.path().join("workspace");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("readme.md"), b"the API_KEY belongs in the environment").unwrap();
        engine.add_location(&root.to_string_lossy()).unwrap();
        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();
        let jobs = engine.next_content_jobs(10);
        assert_eq!(jobs.len(), 1);
        let (id, path, extension, _, _) = &jobs[0];
        let extraction = extract::extract(std::path::Path::new(path), extension, 1024 * 1024);
        assert_eq!(extraction.status, extract::STATE_INDEXED);
        engine
            .store_extraction(*id, &extraction.status, extraction.text.as_deref(), None, None)
            .unwrap();
        let request = SearchRequest {
            query_id: 1,
            content_terms: vec!["API_KEY".into()],
            roots: vec![root.to_string_lossy().to_string()],
            mode: crate::search::model::SearchMode::Content,
            limit: 20,
            ..base_search_request(&root)
        };
        let (hits, total, _) = engine.search(&request, &AtomicBool::new(false), 20).unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].entry.name, "readme.md");

        let phrase_request = SearchRequest {
            query_id: 2,
            content_terms: vec!["API_KEY belongs".into()],
            roots: vec![root.to_string_lossy().to_string()],
            mode: crate::search::model::SearchMode::Content,
            match_mode: crate::search::model::MatchMode::Phrase,
            limit: 20,
            ..base_search_request(&root)
        };
        let (phrase_hits, phrase_total, _) = engine
            .search(&phrase_request, &AtomicBool::new(false), 20)
            .unwrap();
        assert_eq!(phrase_total, 1);
        assert_eq!(phrase_hits[0].entry.name, "readme.md");
    }

    fn base_search_request(root: &Path) -> SearchRequest {
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
            mode: crate::search::model::SearchMode::Both,
            match_mode: crate::search::model::MatchMode::All,
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
            limit: 20,
            sort: crate::search::model::SortOrder::Relevance,
            sort_direction: crate::search::model::SortDirection::Desc,
        }
    }
}
