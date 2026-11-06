//! Index maintenance and benchmark harness.
//!
//! Runs the real search engine against an existing index so the repair path and
//! its timings can be verified without launching the interface.
//!
//! ```text
//! cargo run --release --manifest-path src-tauri/Cargo.toml \
//!   --example search_maintenance -- "<path to index.sqlite3>" resume
//! ```

use maxplorer_lib::search::engine::SearchEngine;
use maxplorer_lib::search::model::{
    MatchMode, SearchMode, SearchRequest, SortDirection, SortOrder,
};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

fn default_index_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.replica.win11explorer")
        .join("search")
        .join("index.sqlite3")
}

fn request(root: &str, term: &str) -> SearchRequest {
    SearchRequest {
        query_id: 1,
        text: term.to_string(),
        terms: vec![term.to_string()],
        name_terms: vec![],
        content_terms: vec![],
        exclude_terms: vec![],
        kinds: vec![],
        extensions: vec![],
        roots: if root.is_empty() { vec![] } else { vec![root.to_string()] },
        include_hidden: false,
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
        limit: 200,
        sort: SortOrder::Relevance,
        sort_direction: SortDirection::Desc,
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let db_path = args.next().map(PathBuf::from).unwrap_or_else(default_index_path);
    let term = args.next().unwrap_or_else(|| "resume".to_string());
    let root = args.next().unwrap_or_default();

    println!("index: {}", db_path.display());
    println!("term:  {term}");

    let open_started = Instant::now();
    let engine = match SearchEngine::open(db_path.clone()) {
        Ok(engine) => engine,
        Err(error) => {
            eprintln!("could not open index: {error:?}");
            std::process::exit(1);
        }
    };
    println!("open:                    {:?}", open_started.elapsed());

    let started = Instant::now();
    let status = engine.status("bench", None);
    println!(
        "status():                {:?}  ({} files, {} folders, {} with text, {:.1} MB)",
        started.elapsed(),
        status.indexed_files,
        status.indexed_folders,
        status.searchable_content,
        status.index_size_bytes as f64 / 1024.0 / 1024.0
    );

    let cancel = Arc::new(AtomicBool::new(false));
    let started = Instant::now();
    match engine.search(&request(&root, &term), &cancel, 200) {
        Ok((hits, total, _)) => {
            println!("search before repair:    {:?}  ({total} matches)", started.elapsed());
            for hit in hits.iter().take(5) {
                println!("  {} [{}]", hit.entry.path, hit.match_kind);
            }
        }
        Err(error) => println!("search before repair failed: {error:?}"),
    }

    let started = Instant::now();
    match engine.prune_excluded() {
        Ok(report) => println!(
            "prune:                   {:?}  ({} examined, {} removed)",
            started.elapsed(),
            report.examined,
            report.removed
        ),
        Err(error) => println!("prune failed: {error:?}"),
    }

    let started = Instant::now();
    match engine.rebuild_name_index() {
        Ok(built) => println!("name index rebuild:      {:?}  (built: {built})", started.elapsed()),
        Err(error) => println!("name index rebuild failed: {error:?}"),
    }

    let started = Instant::now();
    match engine.refresh_counts(true) {
        Ok(counts) => println!(
            "counters:                {:?}  ({} files, {} folders)",
            started.elapsed(),
            counts.files,
            counts.folders
        ),
        Err(error) => println!("counters failed: {error:?}"),
    }

    let started = Instant::now();
    let status = engine.status("bench", None);
    println!(
        "status() after:          {:?}  ({} files, {} with text, {:.1} MB)",
        started.elapsed(),
        status.indexed_files,
        status.searchable_content,
        status.index_size_bytes as f64 / 1024.0 / 1024.0
    );

    for (label, term) in [("name", term.as_str()), ("partial", "esum")] {
        let started = Instant::now();
        match engine.search(&request(&root, term), &cancel, 200) {
            Ok((hits, total, _)) => {
                println!("search after ({label:<7}):    {:?}  ({total} matches)", started.elapsed());
                for hit in hits.iter().take(5) {
                    println!("  {} [{}]", hit.entry.path, hit.match_kind);
                }
            }
            Err(error) => println!("search after failed: {error:?}"),
        }
    }

    if std::env::args().any(|value| value == "optimize") {
        let started = Instant::now();
        match engine.optimize() {
            Ok(size) => println!(
                "optimize + vacuum:       {:?}  ({:.1} MB)",
                started.elapsed(),
                size as f64 / 1024.0 / 1024.0
            ),
            Err(error) => println!("optimize failed: {error:?}"),
        }
    }
}
