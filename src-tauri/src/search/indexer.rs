use crate::listing::entry_from_path;
use crate::search::engine::{normalized_root, SearchEngine};
use crate::search::extract;
use crate::search::live::should_skip_directory;
use crate::types::Entry;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use walkdir::WalkDir;

const BATCH_SIZE: usize = 200;
const RECONCILE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// A watcher backlog can ask for a reconcile at any moment. Without a floor a
/// scan that takes minutes produces enough events (or enough of them arrive
/// while it runs) to request the next scan immediately, and the indexer never
/// stops rescanning. Rescans therefore never run closer together than this.
const RECONCILE_MIN_GAP: Duration = Duration::from_secs(20 * 60);
/// Backlog size that means "too many changes to replay one by one".
const EVENT_BACKLOG_LIMIT: usize = 4_000;
const DEBOUNCE: Duration = Duration::from_millis(450);
const WATCH_TICK: Duration = Duration::from_millis(250);
/// Hard ceiling on entries examined in one pass. A single pathological tree can
/// no longer own the whole index or run for hours.
const MAX_FILES_PER_SCAN: usize = 400_000;
/// Leave the launch path alone before starting the expensive first scan.
const STARTUP_GRACE: Duration = Duration::from_secs(20);
/// Give the window time to appear before installing recursive watchers.
const WATCH_START_DELAY: Duration = Duration::from_secs(8);
/// Content extraction is the most I/O-heavy background task.
const CONTENT_START_DELAY: Duration = Duration::from_secs(25);

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

fn mark_background_thread() {
    #[cfg(target_os = "macos")]
    {
        // Darwin background priority: indexing yields CPU, disk, and I/O to
        // foreground applications even when MAXplorer is in the background.
        unsafe {
            let _ = libc::setpriority(
                libc::PRIO_DARWIN_THREAD,
                0,
                libc::PRIO_DARWIN_BG,
            );
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn start(
    engine: Arc<SearchEngine>,
    activity: Arc<Mutex<IndexActivity>>,
    app_focused: Arc<AtomicBool>,
    force_index_until: Arc<AtomicU64>,
) -> IndexerHandle {
    crate::logging::info(
        "search.indexer",
        format!(
            "starting indexer threads; first scan begins after {}s and pauses while the window is focused",
            STARTUP_GRACE.as_secs()
        ),
    );
    let stop = Arc::new(AtomicBool::new(false));
    let mut joins = Vec::new();
    {
        let engine = engine.clone();
        let activity = activity.clone();
        let stop = stop.clone();
        let app_focused = app_focused.clone();
        let force_index_until = force_index_until.clone();
        if let Ok(join) = thread::Builder::new()
            .name("maxplorer-indexer".into())
            .spawn(move || {
                indexer_loop(engine, activity, stop, app_focused, force_index_until)
            })
        {
            joins.push(join);
        }
    }
    {
        let engine = engine.clone();
        let activity = activity.clone();
        let stop = stop.clone();
        let app_focused = app_focused.clone();
        let force_index_until = force_index_until.clone();
        if let Ok(join) = thread::Builder::new()
            .name("maxplorer-content-indexer".into())
            .spawn(move || {
                content_loop(engine, activity, stop, app_focused, force_index_until)
            })
        {
            joins.push(join);
        }
    }
    IndexerHandle { stop, joins: Mutex::new(joins) }
}

fn indexer_loop(
    engine: Arc<SearchEngine>,
    activity: Arc<Mutex<IndexActivity>>,
    stop: Arc<AtomicBool>,
    app_focused: Arc<AtomicBool>,
    force_index_until: Arc<AtomicU64>,
) {
    mark_background_thread();
    let (sender, receiver) = channel();
    let started_at = Instant::now();
    // A schema migration replaces the content index instead of rewriting it in
    // place. Building it here keeps launch instant; until it finishes, content
    // search falls back to a live scan.
    let mut content_rebuild_pending = engine.content_index_needs_rebuild();
    let mut last_rebuild_try = Instant::now() - Duration::from_secs(60);
    // Publish counters and the name index before the first query needs them.
    // Both are cheap once the index has been pruned, and a missing counter is
    // what previously forced a full table scan per keystroke.
    let _ = engine.refresh_counts(false);
    let _ = engine.populate_name_index();
    let mut last_counts = Instant::now();
    let mut _watcher_guard: Option<RecommendedWatcher> = None;
    let mut tracked_roots: Vec<String> = Vec::new();
    let mut pending: HashMap<PathBuf, Instant> = HashMap::new();
    let mut last_reconcile = Instant::now();
    let mut reconcile_requested = false;
    let mut last_config_check = Instant::now();
    let mut last_scan_check = Instant::now();
    let mut vacuum_checked = false;
    let mut last_vacuum_try = Instant::now() - Duration::from_secs(60);

    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        if content_rebuild_pending && last_rebuild_try.elapsed() > Duration::from_secs(60) {
            last_rebuild_try = Instant::now();
            let started = Instant::now();
            match engine.rebuild_content_index() {
                Ok(count) => {
                    content_rebuild_pending = false;
                    crate::logging::info(
                        "search.indexer",
                        format!(
                            "content index rebuilt for {} documents in {} s",
                            count,
                            started.elapsed().as_secs()
                        ),
                    );
                }
                Err(error) => crate::logging::info(
                    "search.indexer",
                    format!("content index rebuild deferred: {}", error.message),
                ),
            }
        }
        let paused = engine.paused();
        let roots = engine.enabled_roots();
        let user_is_using_app =
            app_focused.load(Ordering::Relaxed) && now_ms() >= force_index_until.load(Ordering::Relaxed);

        if !user_is_using_app
            && started_at.elapsed() > WATCH_START_DELAY
            && last_config_check.elapsed() > Duration::from_secs(1)
        {
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
            drain_events(
                &receiver,
                &mut pending,
                &mut reconcile_requested,
                false,
                &roots,
                &engine.db_path,
            );
            thread::sleep(WATCH_TICK);
            continue;
        }

        if user_is_using_app {
            // Keep collecting changes from the watcher, but do not scan or write
            // the index while the user is interacting with the window. Work
            // resumes automatically when the app loses focus.
            set_activity(&activity, "waiting", None);
            drain_events(
                &receiver,
                &mut pending,
                &mut reconcile_requested,
                true,
                &roots,
                &engine.db_path,
            );
            thread::sleep(WATCH_TICK);
            continue;
        }

        // Initial indexing and repairs requested from the indexing dashboard.
        if started_at.elapsed() > STARTUP_GRACE && last_scan_check.elapsed() > Duration::from_secs(2) {
            last_scan_check = Instant::now();
            // A rebuild requested from the dashboard clears the index and marks
            // every location pending, so the scan below repopulates it.
            let _ = engine.take_rebuild_request();
            let to_scan = engine.locations_to_scan();
            if !to_scan.is_empty() {
                // Changes queued before the scan are covered by the walk itself;
                // replaying them afterwards would only duplicate work.
                drain_events(
                    &receiver,
                    &mut pending,
                    &mut reconcile_requested,
                    false,
                    &roots,
                    &engine.db_path,
                );
                pending.clear();
            }
            for root in to_scan {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                scan_root(
                    &engine,
                    &activity,
                    &root,
                    &stop,
                    &app_focused,
                    &force_index_until,
                );
            }
        }
        let reconcile_due = last_reconcile.elapsed() > RECONCILE_INTERVAL
            || (reconcile_requested && last_reconcile.elapsed() >= RECONCILE_MIN_GAP);
        if reconcile_due {
            reconcile_requested = false;
            last_reconcile = Instant::now();
            // Discard whatever the watcher collected while the previous scan was
            // running: those paths were just walked, and replaying them is what
            // turned one scan into an endless series of scans.
            drain_events(
                &receiver,
                &mut pending,
                &mut reconcile_requested,
                false,
                &roots,
                &engine.db_path,
            );
            pending.clear();
            reconcile_requested = false;
            for root in engine.enabled_roots() {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                scan_root(
                    &engine,
                    &activity,
                    &root,
                    &stop,
                    &app_focused,
                    &force_index_until,
                );
            }
            drain_events(
                &receiver,
                &mut pending,
                &mut reconcile_requested,
                false,
                &roots,
                &engine.db_path,
            );
            pending.clear();
            reconcile_requested = false;
        }

        if !vacuum_checked && last_vacuum_try.elapsed() > Duration::from_secs(60) {
            if started_at.elapsed() > CONTENT_START_DELAY {
                last_vacuum_try = Instant::now();
                if engine.take_vacuum_request() {
                    let before = engine.database_size();
                    match engine.vacuum() {
                        Ok(after) => {
                            vacuum_checked = true;
                            crate::logging::info(
                                "search.indexer",
                                format!(
                                    "compacted the index from {} MB to {} MB",
                                    before / (1024 * 1024),
                                    after / (1024 * 1024)
                                ),
                            );
                        }
                        Err(error) => {
                            // Another writer held the database; try again later.
                            engine.request_vacuum();
                            crate::logging::info(
                                "search.indexer",
                                format!("index compaction is deferred: {}", error.message),
                            );
                        }
                    }
                } else {
                    vacuum_checked = true;
                }
            }
        }

        drain_events(
            &receiver,
            &mut pending,
            &mut reconcile_requested,
            true,
            &roots,
            &engine.db_path,
        );
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
            apply_event(
                &engine,
                &activity,
                &path,
                &stop,
                &roots,
                &app_focused,
                &force_index_until,
            );
        }

        if activity.lock().map(|value| value.activity.is_empty()).unwrap_or(false) {
            set_activity(&activity, "watching", None);
        }
        if last_counts.elapsed() > Duration::from_secs(300) {
            last_counts = Instant::now();
            let _ = engine.refresh_counts(false);
            let _ = engine.populate_name_index();
        }
        thread::sleep(WATCH_TICK);
    }
    set_activity(&activity, "stopped", None);
}

/// Reject events that come from ignored folders or from the index's own
/// SQLite files. Without this, writing the index generates watch events for
/// the index itself, which triggers another write and creates a feedback loop.
fn path_is_ignored(path: &Path, roots: &[String], db_path: &Path) -> bool {
    if let Some(directory) = db_path.parent() {
        if path.starts_with(directory) {
            return true;
        }
    }
    let path_string = path.to_string_lossy();
    let relative = roots
        .iter()
        .find(|root| crate::search::engine::path_under_root(&path_string, root))
        .and_then(|root| path.strip_prefix(root).ok())
        .unwrap_or(path);
    relative.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        should_skip_directory(&name, 1)
    })
}

fn drain_events(
    receiver: &Receiver<notify::Event>,
    pending: &mut HashMap<PathBuf, Instant>,
    reconcile_requested: &mut bool,
    active: bool,
    roots: &[String],
    db_path: &Path,
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
            if path_is_ignored(&path, roots, db_path) {
                continue;
            }
            // Directory-level events are covered by the reconciliation scan.
            pending.entry(path).or_insert_with(Instant::now);
        }
        if pending.len() > EVENT_BACKLOG_LIMIT {
            // Too many to replay. Ask for a reconcile instead of backdating the
            // clock: the request is throttled by RECONCILE_MIN_GAP so a busy
            // machine cannot keep the indexer in a permanent full-scan loop.
            pending.clear();
            if !*reconcile_requested {
                *reconcile_requested = true;
                crate::logging::info(
                    "search.indexer",
                    format!(
                        "change backlog exceeded {EVENT_BACKLOG_LIMIT} paths; a reconcile is queued"
                    ),
                );
            }
        }
    }
}

fn apply_event(
    engine: &SearchEngine,
    activity: &Arc<Mutex<IndexActivity>>,
    path: &Path,
    stop: &AtomicBool,
    roots: &[String],
    app_focused: &AtomicBool,
    force_index_until: &AtomicU64,
) {
    if path_is_ignored(path, roots, &engine.db_path) {
        return;
    }
    if !path.exists() {
        let _ = engine.remove_path(&path.to_string_lossy());
        return;
    }
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return;
    };
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
        scan_subtree(
            engine,
            activity,
            &root,
            stop,
            10_000,
            app_focused,
            force_index_until,
        );
    } else {
        set_activity(activity, "indexing", Some(path.to_string_lossy().to_string()));
        let _ = engine.index_single_path(&root, path, 0);
        set_activity(activity, "watching", None);
    }
}

fn scan_root(
    engine: &SearchEngine,
    activity: &Arc<Mutex<IndexActivity>>,
    root: &str,
    stop: &AtomicBool,
    app_focused: &AtomicBool,
    force_index_until: &AtomicU64,
) {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        let _ = engine.mark_location(root, "unavailable", Some("This location is currently unavailable."));
        return;
    }
    let generation = match engine.begin_scan(root) {
        Ok(generation) => generation,
        Err(_) => return,
    };
    let started = Instant::now();
    crate::logging::info("search.indexer", format!("index scan started for {root}"));
    set_activity(activity, "indexing", Some(root.to_string()));
    let outcome = scan_entries(
        engine,
        activity,
        root,
        generation,
        stop,
        MAX_FILES_PER_SCAN,
        Some(app_focused),
        Some(force_index_until),
    );
    let _ = engine.finish_scan(
        root,
        generation,
        outcome.complete,
        outcome.error.clone(),
        Some(&outcome.vanished),
    );
    let _ = engine.refresh_counts(false);
    crate::logging::info(
        "search.indexer",
        format!(
            "index scan {} for {} in {} ms ({} written, {} removed){}",
            if outcome.complete { "completed" } else { "paused" },
            root,
            started.elapsed().as_millis(),
            outcome.written,
            outcome.vanished.len(),
            outcome
                .error
                .as_deref()
                .map(|message| format!(" ({message})"))
                .unwrap_or_default()
        ),
    );
    if outcome.complete {
        set_activity(activity, "watching", None);
    }
}

fn scan_subtree(
    engine: &SearchEngine,
    activity: &Arc<Mutex<IndexActivity>>,
    root: &str,
    stop: &AtomicBool,
    max_entries: usize,
    app_focused: &AtomicBool,
    force_index_until: &AtomicU64,
) {
    let _ = scan_entries(
        engine,
        activity,
        root,
        0,
        stop,
        max_entries,
        Some(app_focused),
        Some(force_index_until),
    );
    set_activity(activity, "watching", None);
}

/// Result of one walk over a root.
struct ScanOutcome {
    complete: bool,
    error: Option<String>,
    /// Rows the index held before the walk that the walk did not see.
    vanished: Vec<String>,
    /// Rows that were new or changed and therefore written.
    written: usize,
}

fn scan_entries(
    engine: &SearchEngine,
    activity: &Arc<Mutex<IndexActivity>>,
    root: &str,
    generation: i64,
    stop: &AtomicBool,
    max_entries: usize,
    app_focused: Option<&AtomicBool>,
    force_index_until: Option<&AtomicU64>,
) -> ScanOutcome {
    let root = normalized_root(root);
    let root_path = PathBuf::from(&root);
    // One read of what the index already knows. Comparing against it is what
    // keeps a rescan of an unchanged tree from rewriting (and re-indexing into
    // FTS) every row it just walked.
    let known = engine.known_entries(&root).unwrap_or_default();
    let mut seen: HashSet<String> = HashSet::with_capacity(known.len());
    let mut batch: Vec<Entry> = Vec::with_capacity(BATCH_SIZE);
    let mut scanned = 0usize;
    let mut written = 0usize;
    let mut errors = 0u64;
    let mut complete = true;
    let mut fse_errors = 0u64;
    let mut first_write_error: Option<String> = None;

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
        let interrupted_by_focus = app_focused
            .map(|focused| {
                focused.load(Ordering::Relaxed)
                    && force_index_until
                        .map(|until| now_ms() >= until.load(Ordering::Relaxed))
                        .unwrap_or(true)
            })
            .unwrap_or(false);
        if stop.load(Ordering::Relaxed)
            || engine.paused()
            || scanned >= max_entries
            || interrupted_by_focus
        {
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
            Ok(entry) => {
                scanned += 1;
                let size = entry.size.map(|value| value as i64);
                let unchanged = known
                    .get(&entry.path)
                    .map(|(known_size, known_modified, content_state)| {
                        *known_size == size
                            && *known_modified == entry.modified
                            && content_state != "error"
                    })
                    .unwrap_or(false);
                seen.insert(entry.path.clone());
                if unchanged {
                    if scanned % 512 == 0 {
                        set_activity(
                            activity,
                            "indexing",
                            Some(item.path().to_string_lossy().to_string()),
                        );
                    }
                    continue;
                }
                batch.push(entry);
                written += 1;
            }
            Err(_) => {
                errors += 1;
                continue;
            }
        }
        if scanned % 512 == 0 {
            set_activity(activity, "indexing", Some(item.path().to_string_lossy().to_string()));
        }
        if batch.len() >= BATCH_SIZE {
            if let Err(error) = engine.write_batch(&root, generation, &batch) {
                fse_errors += 1;
                if first_write_error.is_none() {
                    first_write_error = Some(error.message.clone());
                }
            }
            batch.clear();
        }
    }
    if !batch.is_empty() {
        if let Err(error) = engine.write_batch(&root, generation, &batch) {
            fse_errors += 1;
            if first_write_error.is_none() {
                first_write_error = Some(error.message.clone());
            }
        }
    }
    let vanished = if complete {
        known
            .keys()
            .filter(|path| !seen.contains(*path))
            .cloned()
            .collect()
    } else {
        Vec::new()
    };
    let error = if fse_errors > 0 {
        Some(format!(
            "{fse_errors} index writes failed ({}). The index needs reconciliation.",
            first_write_error.unwrap_or_else(|| "no detail".into())
        ))
    } else if errors > 0 {
        Some(format!(
            "{errors} files or folders could not be read because of permissions or filesystem errors."
        ))
    } else {
        None
    };
    ScanOutcome { complete, error, vanished, written }
}

fn content_loop(
    engine: Arc<SearchEngine>,
    activity: Arc<Mutex<IndexActivity>>,
    stop: Arc<AtomicBool>,
    app_focused: Arc<AtomicBool>,
    force_index_until: Arc<AtomicU64>,
) {
    mark_background_thread();
    let started_at = Instant::now();
    let mut announced = false;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        if started_at.elapsed() < CONTENT_START_DELAY {
            thread::sleep(Duration::from_millis(750));
            continue;
        }
        if !announced {
            announced = true;
            crate::logging::info("search.indexer", "content extraction started");
        }
        let user_is_using_app =
            app_focused.load(Ordering::Relaxed) && now_ms() >= force_index_until.load(Ordering::Relaxed);
        if user_is_using_app {
            thread::sleep(Duration::from_millis(900));
            continue;
        }
        if engine.paused() || !engine.content_enabled() || engine.content_index_needs_rebuild() {
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
    let outcome = scan_entries(
        engine, &activity, root, generation, &stop, usize::MAX, None, None,
    );
    engine
        .finish_scan(
            root,
            generation,
            outcome.complete,
            outcome.error,
            Some(&outcome.vanished),
        )
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
        let (hits, total, _) = engine.search(&request, &Arc::new(AtomicBool::new(false)), 20).unwrap();
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
            .search(&phrase_request, &Arc::new(AtomicBool::new(false)), 20)
            .unwrap();
        assert_eq!(phrase_total, 1);
        assert_eq!(phrase_hits[0].entry.name, "readme.md");
    }

    #[test]
    fn ignores_index_database_and_skipped_directories() {
        let roots = vec!["/Users/test".to_string()];
        let db_path = Path::new("/Users/test/Library/Application Support/app/search/index.sqlite3");
        assert!(path_is_ignored(
            Path::new("/Users/test/Library/Application Support/app/search/index.sqlite3"),
            &roots,
            db_path,
        ));
        assert!(path_is_ignored(
            Path::new("/Users/test/Library/Caches/example.bin"),
            &roots,
            db_path,
        ));
        assert!(path_is_ignored(
            Path::new("/Users/test/Projects/build/output.o"),
            &roots,
            db_path,
        ));
        assert!(!path_is_ignored(
            Path::new("/Users/test/Projects/src/main.rs"),
            &roots,
            db_path,
        ));
        assert!(!path_is_ignored(Path::new("/Users/test"), &roots, db_path));
    }

    #[test]
    fn a_failed_extraction_is_retried_by_the_next_scan() {
        let (directory, engine) = test_engine();
        let root = directory.path().join("workspace");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("broken.md");
        fs::write(&file, b"# Heading").unwrap();
        engine.add_location(&root.to_string_lossy()).unwrap();
        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();
        let jobs = engine.next_content_jobs(10);
        let (id, _, _, _, _) = &jobs[0];
        engine
            .store_extraction(*id, extract::STATE_ERROR, None, Some("unreadable"), None)
            .unwrap();

        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();

        let conn = rusqlite::Connection::open(&engine.db_path).unwrap();
        let state: String = conn
            .query_row(
                "SELECT content_state FROM files WHERE path = ?1",
                rusqlite::params![file.to_string_lossy()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "pending", "a failed file must be queued again");
    }

    fn indexed_at(engine: &SearchEngine, path: &str) -> i64 {
        let conn = rusqlite::Connection::open(&engine.db_path).unwrap();
        conn.query_row(
            "SELECT indexed_at FROM files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn event(path: &str) -> notify::Event {
        notify::Event {
            kind: notify::EventKind::Create(notify::event::CreateKind::Any),
            paths: vec![PathBuf::from(path)],
            attrs: Default::default(),
        }
    }

    #[test]
    fn rescanning_an_unchanged_tree_writes_no_rows() {
        let (directory, engine) = test_engine();
        let root = directory.path().join("workspace");
        fs::create_dir_all(root.join("src")).unwrap();
        let file = root.join("src").join("main.rs");
        fs::write(&file, b"fn main() {}").unwrap();
        engine.add_location(&root.to_string_lossy()).unwrap();
        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();
        let first = indexed_at(&engine, &file.to_string_lossy());
        std::thread::sleep(Duration::from_millis(20));

        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();

        assert_eq!(
            indexed_at(&engine, &file.to_string_lossy()),
            first,
            "a rescan that finds no changes must not rewrite the row (or its FTS entry)"
        );
        assert_eq!(count(&engine, &root.to_string_lossy()) > 0, true);
    }

    #[test]
    fn rescanning_writes_a_changed_file_once() {
        let (directory, engine) = test_engine();
        let root = directory.path().join("workspace");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("notes.txt");
        fs::write(&file, b"short").unwrap();
        engine.add_location(&root.to_string_lossy()).unwrap();
        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();
        let first = indexed_at(&engine, &file.to_string_lossy());
        std::thread::sleep(Duration::from_millis(20));

        fs::write(&file, b"a longer body").unwrap();
        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();

        assert_ne!(indexed_at(&engine, &file.to_string_lossy()), first);
        let conn = rusqlite::Connection::open(&engine.db_path).unwrap();
        let size: i64 = conn
            .query_row(
                "SELECT size FROM files WHERE path = ?1",
                rusqlite::params![file.to_string_lossy()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(size, 13);
    }

    #[test]
    fn a_change_backlog_requests_a_reconcile_before_it_is_replayed() {
        let (sender, receiver) = channel();
        for index in 0..(EVENT_BACKLOG_LIMIT + 5) {
            sender
                .send(event(&format!("/Users/test/file-{index}")))
                .unwrap();
        }
        let mut pending = HashMap::new();
        let mut requested = false;
        drain_events(
            &receiver,
            &mut pending,
            &mut requested,
            true,
            &["/Users/test".to_string()],
            Path::new("/tmp/index.sqlite3"),
        );
        assert!(requested, "an overflow must ask for a reconcile");
        assert!(
            pending.len() < EVENT_BACKLOG_LIMIT,
            "the backlog itself must be dropped instead of replayed path by path"
        );
    }

    #[test]
    fn a_backlog_arriving_while_idle_is_discarded_silently() {
        let (sender, receiver) = channel();
        for index in 0..(EVENT_BACKLOG_LIMIT + 5) {
            sender
                .send(event(&format!("/Users/test/file-{index}")))
                .unwrap();
        }
        let mut pending = HashMap::new();
        let mut requested = false;
        drain_events(
            &receiver,
            &mut pending,
            &mut requested,
            false,
            &["/Users/test".to_string()],
            Path::new("/tmp/index.sqlite3"),
        );
        assert!(!requested);
        assert!(pending.is_empty());
    }

    #[test]
    fn schema_two_index_is_migrated_to_an_external_content_fts_table() {
        let (directory, engine) = test_engine();
        let root = directory.path().join("workspace");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("notes.md");
        fs::write(&file, b"the API_KEY belongs in the environment").unwrap();
        engine.add_location(&root.to_string_lossy()).unwrap();
        index_folder_sync(&engine, &root.to_string_lossy()).unwrap();
        let jobs = engine.next_content_jobs(10);
        let (id, path, extension, _, _) = &jobs[0];
        let extraction = extract::extract(std::path::Path::new(path), extension, 1024 * 1024);
        engine
            .store_extraction(*id, &extraction.status, extraction.text.as_deref(), None, None)
            .unwrap();
        let db_path = engine.db_path.clone();
        drop(engine);

        // Put the database back into the shipped v2 shape: an FTS table that
        // stores its own copy of every document.
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                r#"
                DROP TRIGGER IF EXISTS files_ai;
                DROP TRIGGER IF EXISTS files_ad;
                DROP TRIGGER IF EXISTS files_au;
                DROP TABLE files_fts;
                CREATE VIRTUAL TABLE files_fts USING fts5(name, content, tokenize='unicode61');
                INSERT INTO files_fts(rowid, name, content)
                    SELECT id, name, coalesce(content, '') FROM files;
                INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '2');
                INSERT OR REPLACE INTO meta(key, value) VALUES ('fts_populated', '1');
                "#,
            )
            .unwrap();
        }

        let engine = SearchEngine::open(db_path.clone()).unwrap();
        assert!(
            engine.content_index_needs_rebuild(),
            "the rebuild must be deferred to the indexer thread, not launch"
        );
        engine.rebuild_content_index().unwrap();
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let shadow: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'files_fts_content'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(shadow, 0, "the content copy must be gone");
        let version: String = conn
            .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, "3");
        drop(conn);

        let request = SearchRequest {
            content_terms: vec!["API_KEY".into()],
            mode: crate::search::model::SearchMode::Content,
            ..base_search_request(&root)
        };
        let (hits, total, _) = engine
            .search(&request, &Arc::new(AtomicBool::new(false)), 20)
            .unwrap();
        assert_eq!(total, 1, "content search must survive the migration");
        assert_eq!(hits[0].entry.name, "notes.md");
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
