#[cfg(test)]
mod tests {
    use crate::listing::list_directory;
    use crate::commands::safe_package_file_name;
    use crate::operations::{
        copy_paths, create_folder, create_text_file, delete_paths, duplicate_paths, move_paths,
        rename_path,
    };
    use crate::paths::{unique_destination, validate_name};
    use crate::search::legacy_search_files;
    use crate::types::ConflictPolicy;
    use std::fs;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tempfile::tempdir;

    #[test]
    fn lists_real_metadata_and_filters_hidden_items() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("visible.txt"), b"hello").unwrap();
        fs::write(root.path().join(".hidden.txt"), b"secret").unwrap();
        fs::create_dir(root.path().join("Folder")).unwrap();
        let visible = list_directory(root.path(), false).unwrap();
        assert_eq!(visible.entries.len(), 2);
        assert!(visible
            .entries
            .iter()
            .any(|entry| entry.name == "visible.txt"));
        assert!(visible
            .entries
            .iter()
            .any(|entry| entry.name == "Folder" && entry.is_dir));
        let all = list_directory(root.path(), true).unwrap();
        assert_eq!(all.entries.len(), 3);
        assert!(all
            .entries
            .iter()
            .any(|entry| entry.name == ".hidden.txt" && entry.is_hidden));
    }

    #[test]
    fn creates_renames_and_deletes_real_files_in_safe_temp_directory() {
        let root = tempdir().unwrap();
        let folder = create_folder(root.path(), "New folder").unwrap();
        assert!(folder.is_dir);
        let file = create_text_file(root.path(), "New Text Document.txt", "content").unwrap();
        assert_eq!(file.size, Some(7));
        let renamed = rename_path(std::path::Path::new(&file.path), "notes.txt").unwrap();
        assert!(renamed.ends_with("notes.txt"));
        assert!(!std::path::Path::new(&file.path).exists());
        let results = delete_paths(&[std::path::PathBuf::from(&folder.path)], true);
        assert_eq!(results[0].status, "completed");
        assert!(!std::path::Path::new(&folder.path).exists());
    }

    #[test]
    fn copies_moves_and_duplicates_without_overwriting_user_data() {
        let root = tempdir().unwrap();
        let source = root.path().join("source");
        let destination = root.path().join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(source.join("a.txt"), b"a").unwrap();
        fs::create_dir(source.join("nested")).unwrap();
        fs::write(source.join("nested").join("b.txt"), b"b").unwrap();

        let copied = copy_paths(&[source.clone()], &destination, ConflictPolicy::Error);
        assert_eq!(copied[0].status, "completed");
        assert!(destination
            .join("source")
            .join("nested")
            .join("b.txt")
            .exists());

        let renamed_copy = copy_paths(&[source.clone()], &destination, ConflictPolicy::Rename);
        assert_eq!(renamed_copy[0].status, "completed");
        assert!(destination.join("source (2)").exists());

        let moved_target = root.path().join("moved");
        fs::create_dir(&moved_target).unwrap();
        let moved = move_paths(
            &[source.join("a.txt")],
            &moved_target,
            ConflictPolicy::Error,
        );
        assert_eq!(moved[0].status, "completed");
        assert!(!source.join("a.txt").exists());
        assert!(moved_target.join("a.txt").exists());

        let duplicated = duplicate_paths(&[moved_target.join("a.txt")]);
        assert_eq!(duplicated[0].status, "completed");
        assert!(moved_target.join("a - Copy.txt").exists());
    }

    #[test]
    fn rejects_invalid_names_and_suggests_unique_names() {
        assert!(validate_name("").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name("a/b").is_err());
        let root = tempdir().unwrap();
        fs::write(root.path().join("report.txt"), b"").unwrap();
        let unique = unique_destination(root.path(), "report.txt");
        assert_eq!(unique.file_name().unwrap(), "report (2).txt");
    }

    #[test]
    fn searches_nested_files_and_respects_hidden_filter() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("one").join("two")).unwrap();
        fs::write(root.path().join("one").join("two").join("match.txt"), b"").unwrap();
        fs::write(root.path().join("visible.txt"), b"").unwrap();
        fs::write(root.path().join(".hidden.txt"), b"").unwrap();
        let result = legacy_search_files(
            root.path(),
            "txt",
            false,
            20,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert!(result.entries.iter().any(|entry| entry.name == "match.txt"));
        assert!(!result
            .entries
            .iter()
            .any(|entry| entry.name == ".hidden.txt"));
        assert!(!result.cancelled);
    }

    #[test]
    fn refuses_to_copy_an_item_onto_itself() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("keep.txt"), b"safe").unwrap();
        let source = root.path().join("keep.txt");
        let results = copy_paths(&[source.clone()], root.path(), ConflictPolicy::Replace);
        assert_eq!(results[0].status, "failed");
        assert!(source.exists());
        assert_eq!(fs::read(&source).unwrap(), b"safe");
    }

    #[test]
    fn previews_text_and_marks_binary_content() {
        let root = tempdir().unwrap();
        let text_path = root.path().join("note.txt");
        fs::write(&text_path, b"hello world").unwrap();
        let preview = crate::metadata::read_text_preview(&text_path, 1024).unwrap();
        assert_eq!(preview.text, "hello world");
        assert!(!preview.binary);
        let binary_path = root.path().join("blob.bin");
        fs::write(&binary_path, [0, 1, 2, 3]).unwrap();
        let binary = crate::metadata::read_text_preview(&binary_path, 1024).unwrap();
        assert!(binary.binary);
    }

    #[test]
    fn computes_folder_stats_from_real_entries() {
        let root = tempdir().unwrap();
        fs::create_dir(root.path().join("nested")).unwrap();
        fs::write(root.path().join("a.txt"), b"12345").unwrap();
        fs::write(root.path().join("nested").join("b.txt"), b"123").unwrap();
        let stats = crate::metadata::get_folder_stats(root.path()).unwrap();
        assert_eq!(stats.files, 2);
        assert_eq!(stats.folders, 1);
        assert_eq!(stats.total_size, 8);
        assert!(!stats.truncated);
    }

    #[test]
    fn reports_not_found_for_missing_directories() {
        let root = tempdir().unwrap();
        let missing = root.path().join("missing");
        let error = list_directory(&missing, false).unwrap_err();
        assert_eq!(error.code, "not_found");
    }

    #[test]
    fn storage_scan_aggregates_nested_folders_and_categories_once() {
        use crate::storage::scan_storage_index;
        let root = tempdir().unwrap();
        fs::create_dir(root.path().join("docs")).unwrap();
        fs::create_dir(root.path().join("media")).unwrap();
        fs::create_dir(root.path().join("media").join("nested")).unwrap();
        fs::write(root.path().join("docs").join("note.txt"), vec![b'a'; 1000]).unwrap();
        fs::write(root.path().join("media").join("photo.jpg"), vec![b'b'; 2000]).unwrap();
        fs::write(
            root.path().join("media").join("nested").join("clip.mp4"),
            vec![b'c'; 3000],
        )
        .unwrap();
        let cancel = AtomicBool::new(false);
        let index = scan_storage_index(root.path(), 7, 20_000, &cancel, &|_| {}).unwrap();
        assert_eq!(index.scan.scan_id, 7);
        assert_eq!(index.scan.total_logical_bytes, 6000);
        assert_eq!(index.scan.scanned_files, 3);
        assert_eq!(index.scan.scanned_directories, 3);
        let category_total: u64 = index.scan.categories.iter().map(|item| item.bytes).sum();
        assert_eq!(category_total, 6000);
        // Temp directories live under /var/folders on macOS, so location
        // categories intentionally win over extension categories.
        assert!(index
            .scan
            .categories
            .iter()
            .any(|item| item.id == "caches" && item.bytes == 6000));
        assert_eq!(
            crate::storage::category_for(
                std::path::Path::new("/Users/example/Documents/note.txt"),
                Some("txt")
            ),
            "documents"
        );
        assert_eq!(
            crate::storage::category_for(
                std::path::Path::new("/Applications/Sample.app/Contents/Resources/pic.png"),
                Some("png")
            ),
            "applications"
        );
        assert_eq!(
            crate::storage::file_type_for(
                std::path::Path::new("/Users/example/Movies/clip.mp4"),
                Some("mp4"),
                "videos"
            ),
            "videos"
        );
        for extension in ["vob", "rm", "rmvb", "3gp", "mts", "m2ts", "ogv"] {
            assert_eq!(
                crate::storage::file_type_for(
                    std::path::Path::new(&format!("/Users/example/Movies/clip.{extension}")),
                    Some(extension),
                    "videos"
                ),
                "videos",
                "extension {extension} should be a video"
            );
            assert_eq!(
                crate::storage::category_for(
                    std::path::Path::new(&format!("/Users/example/Movies/clip.{extension}")),
                    Some(extension)
                ),
                "videos",
                "extension {extension} should be categorized as video"
            );
        }
        let children = crate::storage::children_core(&index, &index.scan.root, 100).unwrap();
        assert_eq!(children.total_size, 6000);
        assert_eq!(children.directories.len(), 2);
        assert_eq!(children.directories.iter().map(|item| item.size).sum::<u64>(), 6000);
        let page = crate::storage::query_files_core(
            &index,
            &crate::storage::StorageFileQuery {
                scan_id: 7,
                directory: Some(root.path().to_string_lossy().to_string()),
                recursive: true,
                min_size: Some(1500),
                sort: "size".into(),
                direction: "desc".into(),
                limit: 10,
                offset: 0,
                category: None,
                file_type: None,
                name: None,
                extension: None,
                max_size: None,
                modified_after: None,
                modified_before: None,
                created_after: None,
                created_before: None,
                hidden: None,
                symlinks: None,
            },
        );
        assert_eq!(page.files.len(), 2);
        assert_eq!(page.total_bytes, 5000);
    }

    #[test]
    fn storage_scan_auto_budget_exceeds_the_old_entry_ceiling() {
        use crate::storage::resolve_scan_budget;
        let auto = resolve_scan_budget(0);
        assert!(
            auto.max_entries > 5_000_000,
            "auto deep scan must not inherit the old 5,000,000 ceiling"
        );
        assert!(auto.max_index_bytes >= 192 * 1024 * 1024);
        assert_eq!(resolve_scan_budget(20_000).max_entries, 20_000);
        assert_eq!(
            resolve_scan_budget(usize::MAX).max_entries,
            50_000_000,
            "explicit requests clamp to the absolute ceiling"
        );
    }

    #[cfg(unix)]
    #[test]
    fn storage_parallel_walk_counts_hard_links_and_nested_totals_once() {
        use crate::storage::scan_storage_index;
        let root = tempdir().unwrap();
        let inner = root.path().join("a").join("b");
        fs::create_dir_all(&inner).unwrap();
        fs::write(root.path().join("a").join("one.txt"), vec![b'a'; 1_000]).unwrap();
        fs::write(inner.join("two.txt"), vec![b'b'; 2_000]).unwrap();
        fs::hard_link(
            root.path().join("a").join("one.txt"),
            root.path().join("linked.txt"),
        )
        .unwrap();
        let index = scan_storage_index(root.path(), 71, 20_000, &AtomicBool::new(false), &|_| {})
            .unwrap();
        assert_eq!(index.scan.scanned_files, 3);
        assert_eq!(index.scan.scanned_directories, 2);
        assert_eq!(index.scan.hard_links, 1);
        assert_eq!(index.scan.total_logical_bytes, 3_000);
        assert_eq!(index.scan.total_allocated_bytes >= 3_000, true);
        // Walk order decides which of the two links is the "additional" one.
        let flagged = index.files.iter().filter(|file| file.hard_link).count();
        assert_eq!(flagged, 1, "exactly one hard link is flagged as uncounted");
        assert!(index
            .files
            .iter()
            .any(|file| file.name == "linked.txt"));
        let child = crate::storage::children_core(&index, &index.scan.root, 100).unwrap();
        assert_eq!(child.total_size, 3_000);
    }

    #[test]
    fn storage_parallel_walk_visits_every_directory_in_a_wide_tree() {
        use crate::storage::scan_storage_index;
        let root = tempdir().unwrap();
        for directory in 0..40 {
            let path = root.path().join(format!("dir-{directory:02}"));
            fs::create_dir(&path).unwrap();
            for file in 0..15 {
                fs::write(path.join(format!("file-{file:02}.bin")), vec![b'x'; 32]).unwrap();
            }
        }
        let index = scan_storage_index(root.path(), 72, 50_000, &AtomicBool::new(false), &|_| {})
            .unwrap();
        assert_eq!(index.scan.scanned_directories, 40);
        assert_eq!(index.scan.scanned_files, 600);
        assert_eq!(index.scan.total_logical_bytes, 600 * 32);
        assert_eq!(index.files.len(), 600);
        assert_eq!(index.directories.len(), 41);
        // Every file must be attributed to its parent directory exactly once.
        let accounted: u64 = index
            .directories
            .values()
            .map(|directory| directory.direct_files)
            .sum();
        assert_eq!(accounted, 600);
        let folders: u64 = index
            .directories
            .values()
            .map(|directory| directory.direct_folders)
            .sum();
        assert_eq!(folders, 40);
    }

    #[test]
    fn storage_persisted_index_serves_children_and_pages_from_sqlite() {
        use crate::storage::{
            children_core, children_for, query_files_core, query_files_for, scan_storage_index,
            PersistedIndex, ScanIndex, StorageFileQuery,
        };
        use crate::storage_cache::StorageCache;
        let root = tempdir().unwrap();
        let cache_root = tempdir().unwrap();
        fs::create_dir(root.path().join("videos")).unwrap();
        fs::write(root.path().join("videos").join("clip.mp4"), vec![b'v'; 8_192]).unwrap();
        fs::write(root.path().join("notes.txt"), vec![b'n'; 512]).unwrap();
        fs::write(root.path().join("tiny.bin"), vec![b't'; 16]).unwrap();
        let index = scan_storage_index(root.path(), 61, 20_000, &AtomicBool::new(false), &|_| {})
            .unwrap();
        let cache = StorageCache::new(cache_root.path().join("cache.sqlite3")).unwrap();
        let directories = index.directories.values().cloned().collect::<Vec<_>>();
        cache.store(&index.scan, &index.files, &directories).unwrap();
        let slim = ScanIndex {
            scan: index.scan.clone(),
            files: Vec::new(),
            directories: index.directories.clone(),
            persisted: Some(PersistedIndex {
                cache: cache.clone(),
                scan_id: index.scan.scan_id,
            }),
        };

        let from_memory = children_core(&index, &index.scan.root, 100).unwrap();
        let from_sql = children_for(&slim, &index.scan.root, 100).unwrap();
        assert_eq!(from_sql.total_size, from_memory.total_size);
        assert_eq!(from_sql.total_files, from_memory.total_files);
        assert_eq!(
            from_sql.files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
            from_memory.files.iter().map(|file| file.path.clone()).collect::<Vec<_>>()
        );
        assert_eq!(from_sql.directories.len(), from_memory.directories.len());

        let make = |min_size: Option<u64>, offset: usize| StorageFileQuery {
            scan_id: 61,
            directory: Some(index.scan.root.clone()),
            category: None,
            file_type: None,
            name: None,
            extension: None,
            min_size,
            max_size: None,
            modified_after: None,
            modified_before: None,
            created_after: None,
            created_before: None,
            hidden: None,
            symlinks: None,
            recursive: true,
            sort: "size".into(),
            direction: "desc".into(),
            limit: 2,
            offset,
        };
        let memory_page = query_files_core(&index, &make(None, 0));
        let sql_page = query_files_for(&slim, &make(None, 0)).unwrap();
        assert_eq!(sql_page.total, memory_page.total);
        assert_eq!(sql_page.total_bytes, memory_page.total_bytes);
        assert_eq!(
            sql_page.files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
            memory_page.files.iter().map(|file| file.path.clone()).collect::<Vec<_>>()
        );
        assert!(sql_page.has_more, "three files, page of two");
        let filtered = query_files_for(&slim, &make(Some(1_000), 0)).unwrap();
        assert_eq!(filtered.total, 1);
        assert_eq!(filtered.files[0].name, "clip.mp4");
        assert!(cache.has_path(61, &filtered.files[0].path).unwrap());
        assert!(!cache.has_path(61, "/definitely/not/scanned").unwrap());
    }

    #[test]
    fn storage_delete_accepts_paths_from_the_persisted_index() {
        use crate::storage::{
            delete_core, scan_storage_index, PersistedIndex, ScanIndex, StorageDeleteItem,
            StorageDeleteRequest,
        };
        use crate::storage_cache::StorageCache;
        let root = tempdir().unwrap();
        let cache_root = tempdir().unwrap();
        let path = root.path().join("obsolete.log");
        fs::write(&path, vec![b'o'; 4_096]).unwrap();
        let index = scan_storage_index(root.path(), 62, 20_000, &AtomicBool::new(false), &|_| {})
            .unwrap();
        let file = index.files[0].clone();
        let cache = StorageCache::new(cache_root.path().join("cache.sqlite3")).unwrap();
        let directories = index.directories.values().cloned().collect::<Vec<_>>();
        cache.store(&index.scan, &index.files, &directories).unwrap();
        let slim = ScanIndex {
            scan: index.scan.clone(),
            files: Vec::new(),
            directories: index.directories.clone(),
            persisted: Some(PersistedIndex {
                cache,
                scan_id: index.scan.scan_id,
            }),
        };
        let outcome = delete_core(
            &slim,
            &StorageDeleteRequest {
                operation_id: 4,
                scan_id: 62,
                items: vec![StorageDeleteItem {
                    path: file.path.clone(),
                    expected_size: Some(file.size),
                    expected_modified: file.modified,
                    is_directory: false,
                }],
                permanent: true,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(outcome.results[0].status, "completed");
        assert!(!path.exists());
    }

    #[test]
    fn storage_state_releases_the_file_index_once_persisted() {
        use crate::storage::{children_for, scan_storage_index, StorageState};
        let root = tempdir().unwrap();
        let data = tempdir().unwrap();
        fs::create_dir(root.path().join("videos")).unwrap();
        fs::write(root.path().join("videos").join("clip.mp4"), vec![b'v'; 4_096]).unwrap();
        fs::write(root.path().join("notes.txt"), b"hello").unwrap();
        let index =
            scan_storage_index(root.path(), 81, 20_000, &AtomicBool::new(false), &|_| {}).unwrap();
        let state = StorageState::new(data.path().join("storage/cache.sqlite3"));
        let index = state.store(index);
        state.persist_async(index);
        let mut current = None;
        for _ in 0..400 {
            current = state.current();
            if current
                .as_ref()
                .map(|scan| scan.persisted.is_some())
                .unwrap_or(false)
            {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        let current = current.expect("the scan stays current");
        assert!(
            current.persisted.is_some(),
            "a successful persist swaps in the sqlite-backed index"
        );
        assert!(
            current.files.is_empty(),
            "file records are released once the rows are durable"
        );
        let children = children_for(&current, &current.scan.root, 100).unwrap();
        assert_eq!(children.files.len(), 1);
        assert_eq!(children.total_size, 4_101);
        assert_eq!(children.directories.len(), 1);
    }

    #[test]
    fn storage_path_containment_requires_a_component_boundary() {
        use crate::storage::path_within;
        assert!(path_within("/Users/rajeevk/Documents/report.pdf", "/Users/rajeevk"));
        assert!(path_within("/Users/rajeevk/", "/Users/rajeevk"));
        assert!(path_within("/Users/rajeevk", "/Users/rajeevk"));
        assert!(!path_within("/Users/rajeevk2/report.pdf", "/Users/rajeevk"));
        assert!(!path_within("/Users/rajeevk", "/Users/rajeevk/Documents"));
        assert!(path_within("/tmp/anything", ""));
        assert!(!path_within("relative/path", ""));
    }

    #[test]
    fn storage_category_matching_is_case_insensitive_without_copying_the_path() {
        use crate::storage::{category_for, file_type_for};
        use std::path::Path;
        assert_eq!(
            category_for(Path::new("/Users/example/Library/Caches/com.acme/blob.bin"), Some("bin")),
            "caches"
        );
        assert_eq!(
            category_for(Path::new("/Users/example/Library/Developer/Xcode/DerivedData/a.o"), Some("o")),
            "developer"
        );
        assert_eq!(
            category_for(Path::new("/Users/example/Code/app/NODE_MODULES/pkg/index.js"), Some("js")),
            "developer"
        );
        assert_eq!(
            category_for(Path::new("/Users/example/Downloads/Trip/IMG_0042.JPG"), Some("jpg")),
            "downloads"
        );
        assert_eq!(
            category_for(Path::new("/Users/example/.Trash/old.zip"), Some("zip")),
            "trash"
        );
        assert_eq!(
            file_type_for(Path::new("/Applications/Sample.APP/Contents/Resources/pic.png"), Some("png"), "applications"),
            "applications"
        );
    }

    #[test]
    fn storage_query_paging_matches_a_full_sort_and_filters_case_insensitively() {
        use crate::storage::{query_files_core, scan_storage_index, StorageFileQuery};
        let root = tempdir().unwrap();
        let folder = root.path().join("frames");
        fs::create_dir(&folder).unwrap();
        for index in 0..20 {
            fs::write(
                folder.join(format!("frame-{index:02}.mp4")),
                vec![b'x'; 100 + index * 10],
            )
            .unwrap();
        }
        // Three identical sizes ensure the ordering is decided by the path tiebreak.
        for name in ["dup-a.txt", "dup-b.txt", "dup-c.txt"] {
            fs::write(folder.join(name), vec![b'x'; 9_000]).unwrap();
        }
        let index = scan_storage_index(
            root.path(),
            42,
            20_000,
            &AtomicBool::new(false),
            &|_| {},
        )
        .unwrap();
        let make = |limit: usize, offset: usize, name: Option<&str>| StorageFileQuery {
            scan_id: 42,
            directory: Some(root.path().to_string_lossy().to_string()),
            category: None,
            file_type: None,
            name: name.map(|value| value.to_string()),
            extension: None,
            min_size: None,
            max_size: None,
            modified_after: None,
            modified_before: None,
            created_after: None,
            created_before: None,
            hidden: None,
            symlinks: None,
            recursive: true,
            sort: "size".into(),
            direction: "desc".into(),
            limit,
            offset,
        };
        let all = query_files_core(&index, &make(5_000, 0, None));
        let page = query_files_core(&index, &make(10, 5, None));
        let expected: Vec<&str> = all
            .files
            .iter()
            .skip(5)
            .take(10)
            .map(|file| file.path.as_str())
            .collect();
        let actual: Vec<&str> = page.files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(actual, expected);
        assert_eq!(page.total, all.total);
        assert!(page.has_more);
        let repeated = query_files_core(&index, &make(10, 5, None));
        assert_eq!(
            repeated.files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(),
            actual,
            "paging must be deterministic across identical queries"
        );
        let named = query_files_core(&index, &make(500, 0, Some("FRAME-07")));
        assert_eq!(named.total, 1);
        assert!(named.files[0].name.ends_with("frame-07.mp4"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn storage_scan_reads_real_available_memory() {
        use crate::storage::{available_memory_bytes, resolve_scan_budget};
        let available = available_memory_bytes().expect("macOS VM counters should be readable");
        assert!(
            available > 1024 * 1024 * 1024,
            "implausible available memory: {available}"
        );
        let budget = resolve_scan_budget(0);
        println!(
            "available={} MiB index_budget={} MiB",
            available / (1024 * 1024),
            budget.max_index_bytes / (1024 * 1024)
        );
    }

    #[test]
    fn storage_scan_stops_at_the_memory_budget_and_reports_it() {
        use crate::storage::{scan_storage_index_with_budget, ScanBudget};
        let root = tempdir().unwrap();
        let media = root.path().join("media");
        fs::create_dir(&media).unwrap();
        for index in 0..400 {
            fs::write(media.join(format!("clip-{index:04}.mp4")), vec![b'x'; 64]).unwrap();
        }
        let budget = ScanBudget::with_bytes(usize::MAX, 12_000);
        let scan = scan_storage_index_with_budget(
            root.path(),
            31,
            budget,
            &AtomicBool::new(false),
            &|_| {},
        )
        .unwrap();
        assert!(scan.scan.truncated);
        assert!(scan.scan.scanned_entries < 401);
        let reason = scan.scan.truncation_reason.clone().unwrap_or_default();
        assert!(
            reason.contains("memory budget"),
            "unexpected truncation reason: {reason}"
        );
        assert!(scan
            .scan
            .notes
            .iter()
            .any(|note| note.contains("memory budget")));
    }

    #[cfg(unix)]
    #[test]
    fn storage_scan_lists_symlinks_without_following_them() {
        use crate::storage::scan_storage_index;
        let root = tempdir().unwrap();
        let target = root.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("payload.bin"), vec![b'x'; 4096]).unwrap();
        std::os::unix::fs::symlink(&target, root.path().join("link")).unwrap();
        let index = scan_storage_index(
            root.path(),
            1,
            20_000,
            &AtomicBool::new(false),
            &|_| {},
        )
        .unwrap();
        assert_eq!(index.scan.symbolic_links, 1);
        assert!(index.scan.total_logical_bytes < 4200);
        assert!(!index
            .scan
            .largest_files
            .iter()
            .any(|file| file.path.contains("/link/payload.bin")));
    }

    #[test]
    fn storage_cache_restores_summaries_children_and_queries() {
        use crate::storage::{scan_storage_index, StorageFileQuery};
        use crate::storage_cache::StorageCache;
        let scan_root = tempdir().unwrap();
        let cache_root = tempdir().unwrap();
        fs::create_dir(scan_root.path().join("videos")).unwrap();
        fs::write(scan_root.path().join("videos").join("clip.mp4"), vec![b'v'; 2048]).unwrap();
        fs::write(scan_root.path().join("notes.txt"), vec![b'n'; 10]).unwrap();
        let index = scan_storage_index(
            scan_root.path(),
            55,
            20_000,
            &AtomicBool::new(false),
            &|_| {},
        )
        .unwrap();
        let cache = StorageCache::new(cache_root.path().join("cache.sqlite3")).unwrap();
        cache
            .store(
                &index.scan,
                &index.files,
                &index.directories.values().cloned().collect::<Vec<_>>(),
            )
            .unwrap();
        let root_text = scan_root.path().to_string_lossy().to_string();
        let restored = cache.latest(Some(&root_text)).unwrap().expect("cached scan");
        assert_eq!(restored.scan.scan_id, 55);
        assert_eq!(restored.scan.total_logical_bytes, 2058);
        assert_eq!(restored.scan.scanned_files, 2);
        let children = cache.children(55, &root_text, 100).unwrap();
        assert_eq!(children.total_size, 2058);
        assert_eq!(children.directories.len(), 1);
        assert_eq!(children.directories[0].name, "videos");
        let page = cache
            .query_files(&StorageFileQuery {
                scan_id: 55,
                directory: Some(root_text),
                recursive: true,
                min_size: Some(2000),
                sort: "size".into(),
                direction: "desc".into(),
                limit: 10,
                offset: 0,
                category: None,
                file_type: Some("videos".into()),
                name: None,
                extension: None,
                max_size: None,
                modified_after: None,
                modified_before: None,
                created_after: None,
                created_before: None,
                hidden: None,
                symlinks: None,
            })
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.files[0].name, "clip.mp4");
        cache.clear().unwrap();
        assert!(cache.latest(None).unwrap().is_none());
    }

    #[test]
    fn storage_scan_handles_a_large_synthetic_tree() {
        use crate::storage::scan_storage_index;
        let root = tempdir().unwrap();
        for folder in 0..40 {
            let directory = root.path().join(format!("folder-{folder}"));
            fs::create_dir(&directory).unwrap();
            for file in 0..30 {
                fs::write(directory.join(format!("file-{file}.txt")), vec![b'x'; 64]).unwrap();
            }
        }
        let index = scan_storage_index(
            root.path(),
            21,
            20_000,
            &AtomicBool::new(false),
            &|_| {},
        )
        .unwrap();
        assert_eq!(index.scan.scanned_files, 1_200);
        assert_eq!(index.scan.scanned_directories, 40);
        assert!(!index.scan.truncated);
        assert_eq!(index.scan.total_logical_bytes, 1_200 * 64);
        assert_eq!(index.files.len(), 1_200);
    }

    #[test]
    fn storage_scan_can_be_cancelled_from_progress() {
        // The analyzer's Cancel button sets the same flag this callback does. The
        // scan reports progress before the walk starts, so cancelling from the
        // first report deterministically stops the walk.
        use crate::storage::scan_storage_index;
        let cancel = AtomicBool::new(false);
        let root = tempdir().unwrap();
        for index in 0..1_600 {
            fs::write(root.path().join(format!("file-{index}.bin")), b"x").unwrap();
        }
        let reports = std::sync::atomic::AtomicU32::new(0);
        let result = scan_storage_index(root.path(), 22, 20_000, &cancel, &|_| {
            reports.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        })
        .unwrap();
        assert!(
            reports.load(std::sync::atomic::Ordering::Relaxed) >= 1,
            "the scan must report progress"
        );
        assert!(result.scan.cancelled);
        assert!(result.scan.scanned_files < 1_600);
    }

    #[test]
    fn storage_scan_can_be_cancelled_before_work_starts() {
        use crate::storage::scan_storage_index;
        let root = tempdir().unwrap();
        fs::write(root.path().join("a.txt"), b"hello").unwrap();
        let cancel = AtomicBool::new(true);
        let index = scan_storage_index(root.path(), 2, 20_000, &cancel, &|_| {}).unwrap();
        assert!(index.scan.cancelled);
        assert_eq!(index.scan.total_logical_bytes, 0);
    }

    #[cfg(unix)]
    #[test]
    fn storage_scan_reports_unreadable_directories_without_aborting() {
        use crate::storage::scan_storage_index;
        use std::os::unix::fs::PermissionsExt;
        let root = tempdir().unwrap();
        let blocked = root.path().join("blocked");
        fs::create_dir(&blocked).unwrap();
        fs::write(blocked.join("secret.bin"), b"hidden").unwrap();
        fs::write(root.path().join("visible.txt"), b"visible").unwrap();
        let mut permissions = fs::metadata(&blocked).unwrap().permissions();
        permissions.set_mode(0o000);
        fs::set_permissions(&blocked, permissions).unwrap();
        let index = scan_storage_index(
            root.path(),
            3,
            20_000,
            &AtomicBool::new(false),
            &|_| {},
        )
        .unwrap();
        assert!(index.scan.permission_errors > 0 || index.scan.read_errors > 0);
        let mut restore = fs::metadata(&blocked).unwrap().permissions();
        restore.set_mode(0o700);
        fs::set_permissions(&blocked, restore).unwrap();
    }

    #[test]
    fn duplicate_detection_confirms_content_and_ignores_same_size_files() {
        use crate::search::engine::quick_fingerprint;
        use crate::storage::{find_duplicates_core, StorageDuplicateRequest};
        let root = tempdir().unwrap();
        let bytes = vec![b'q'; 8192];
        fs::write(root.path().join("one.bin"), &bytes).unwrap();
        fs::write(root.path().join("two.bin"), &bytes).unwrap();
        let mut different = bytes.clone();
        different[0] = b'z';
        fs::write(root.path().join("different.bin"), &different).unwrap();
        let response = find_duplicates_core(
            &StorageDuplicateRequest {
                request_id: 9,
                roots: vec![root.path().to_string_lossy().to_string()],
                min_size: 1,
                limit: 50,
                include_hidden: true,
                max_candidates: 1000,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(response.groups.len(), 1);
        assert_eq!(response.groups[0].files.len(), 2);
        assert!(response.groups[0].verified);
        assert_eq!(response.groups[0].recoverable_bytes, 8192);
        assert_eq!(response.changed_files, 0);
        assert!(quick_fingerprint(&root.path().join("one.bin")).is_some());
    }

    #[test]
    fn cleanup_recommendations_are_deduplicated_and_explain_risk() {
        use crate::storage::{build_cleanup, StorageDirectory, StorageFile};
        let home = crate::paths::home_dir();
        let caches = home.join("Library").join("Caches");
        let now = crate::paths::system_time_ms(Ok(std::time::SystemTime::now())).unwrap_or(0);
        let directories = vec![StorageDirectory {
            path: caches.to_string_lossy().to_string(),
            name: "Caches".into(),
            parent: home.to_string_lossy().to_string(),
            size: 2 * 1024 * 1024 * 1024,
            allocated: 2 * 1024 * 1024 * 1024,
            files: 10,
            folders: 1,
            direct_files: 10,
            direct_folders: 1,
            largest_file_size: 1024 * 1024 * 1024,
            largest_file_path: Some(caches.join("big.bin").to_string_lossy().to_string()),
            modified: Some(now),
            depth: 3,
            is_package: false,
            is_protected: false,
            is_read_only: false,
        }];
        let files = vec![
            StorageFile {
                path: caches.join("big.bin").to_string_lossy().to_string(),
                name: "big.bin".into(),
                parent: caches.to_string_lossy().to_string(),
                extension: Some("bin".into()),
                is_symlink: false,
                size: 1024 * 1024 * 1024,
                allocated: 1024 * 1024 * 1024,
                modified: Some(now),
                created: Some(now),
                accessed: Some(now),
                is_hidden: false,
                is_package: false,
                hard_link: false,
                cloud_placeholder: false,
                is_protected: false,
                is_read_only: false,
                category: "caches".into(),
                file_type: "other".into(),
            },
            StorageFile {
                path: home
                    .join("Downloads")
                    .join("old-installer.dmg")
                    .to_string_lossy()
                    .to_string(),
                name: "old-installer.dmg".into(),
                parent: home.join("Downloads").to_string_lossy().to_string(),
                extension: Some("dmg".into()),
                is_symlink: false,
                size: 300 * 1024 * 1024,
                allocated: 300 * 1024 * 1024,
                modified: Some(now),
                created: Some(now),
                accessed: Some(now),
                is_hidden: false,
                is_package: false,
                hard_link: false,
                cloud_placeholder: false,
                is_protected: false,
                is_read_only: false,
                category: "downloads".into(),
                file_type: "diskImages".into(),
            },
        ];
        let cleanup = build_cleanup(&files, &directories, &home);
        assert!(cleanup.iter().any(|item| item.kind == "applicationCaches"));
        assert!(cleanup.iter().any(|item| item.kind == "largeDownload"));
        assert!(!cleanup.iter().any(|item| item.path.ends_with("big.bin")));
        assert!(cleanup.iter().all(|item| {
            matches!(item.risk.as_str(), "low" | "review" | "high") && !item.reason.is_empty()
        }));
    }

    #[test]
    fn cleanup_revalidates_file_identity_before_deleting() {
        use crate::storage::{
            delete_core, scan_storage_index, StorageDeleteItem, StorageDeleteRequest,
        };
        let root = tempdir().unwrap();
        let path = root.path().join("notes.txt");
        fs::write(&path, b"original").unwrap();
        let cancel = AtomicBool::new(false);
        let index = scan_storage_index(root.path(), 11, 20_000, &cancel, &|_| {}).unwrap();
        let file = index
            .files
            .iter()
            .find(|file| file.path == path.to_string_lossy())
            .unwrap()
            .clone();
        fs::write(&path, b"original plus new content").unwrap();
        let changed = delete_core(
            &index,
            &StorageDeleteRequest {
                operation_id: 1,
                scan_id: 11,
                items: vec![StorageDeleteItem {
                    path: file.path.clone(),
                    expected_size: Some(file.size),
                    expected_modified: file.modified,
                    is_directory: false,
                }],
                permanent: true,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(changed.results[0].status, "failed");
        assert_eq!(changed.changed.len(), 1);
        assert!(path.exists());

        let metadata = fs::metadata(&path).unwrap();
        let fresh = delete_core(
            &index,
            &StorageDeleteRequest {
                operation_id: 2,
                scan_id: 11,
                items: vec![StorageDeleteItem {
                    path: file.path.clone(),
                    expected_size: Some(metadata.len()),
                    expected_modified: crate::paths::system_time_ms(metadata.modified()),
                    is_directory: false,
                }],
                permanent: true,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(fresh.results[0].status, "completed");
        assert!(!path.exists());
    }

    #[test]
    fn storage_delete_deduplicates_overlapping_selections() {
        use crate::storage::{
            delete_core, scan_storage_index, StorageDeleteItem, StorageDeleteRequest,
        };
        let root = tempdir().unwrap();
        let folder = root.path().join("folder");
        fs::create_dir(&folder).unwrap();
        let file = folder.join("inside.txt");
        fs::write(&file, b"inside").unwrap();
        let index = scan_storage_index(
            root.path(),
            12,
            20_000,
            &AtomicBool::new(false),
            &|_| {},
        )
        .unwrap();
        let folder_node = index.directories.get(&folder.to_string_lossy().to_string()).unwrap().clone();
        let file_node = index
            .files
            .iter()
            .find(|item| item.path == file.to_string_lossy())
            .unwrap()
            .clone();
        let outcome = delete_core(
            &index,
            &StorageDeleteRequest {
                operation_id: 3,
                scan_id: 12,
                items: vec![
                    StorageDeleteItem {
                        path: file_node.path.clone(),
                        expected_size: Some(file_node.size),
                        expected_modified: file_node.modified,
                        is_directory: false,
                    },
                    StorageDeleteItem {
                        path: folder_node.path.clone(),
                        expected_size: Some(folder_node.size),
                        expected_modified: folder_node.modified,
                        is_directory: true,
                    },
                ],
                permanent: true,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(outcome.skipped_overlaps.len(), 1);
        assert_eq!(outcome.results[0].status, "completed");
        assert!(!folder.exists());
    }

    #[cfg(unix)]
    #[test]
    fn storage_delete_refuses_a_symlink_that_resolves_outside_the_scan_root() {
        use crate::storage::{
            delete_core, scan_storage_index, StorageDeleteItem, StorageDeleteRequest,
        };
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let outside_file = outside.path().join("do-not-touch.txt");
        fs::write(&outside_file, b"safe").unwrap();
        let link = root.path().join("outside-link");
        std::os::unix::fs::symlink(&outside_file, &link).unwrap();
        let index = scan_storage_index(
            root.path(),
            30,
            20_000,
            &AtomicBool::new(false),
            &|_| {},
        )
        .unwrap();
        let node = index
            .files
            .iter()
            .find(|file| file.path == link.to_string_lossy())
            .unwrap()
            .clone();
        let outcome = delete_core(
            &index,
            &StorageDeleteRequest {
                operation_id: 30,
                scan_id: 30,
                items: vec![StorageDeleteItem {
                    path: node.path,
                    expected_size: Some(node.size),
                    expected_modified: node.modified,
                    is_directory: false,
                }],
                permanent: true,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(outcome.results[0].status, "failed");
        assert!(outside_file.exists());
        assert!(fs::symlink_metadata(&link).is_ok());
    }

    #[test]
    fn storage_delete_guards_system_locations() {
        assert!(crate::storage::system_protected_path("/System/Library/CoreServices"));
        assert!(crate::storage::system_protected_path("/usr/bin/ssh"));
        assert!(crate::storage::system_protected_path("/private/var/db"));
        assert!(!crate::storage::system_protected_path("/Users/example/Downloads/file.dmg"));
        assert!(!crate::storage::system_protected_path("/private/tmp/cache.bin"));
    }

    #[cfg(unix)]
    #[test]
    fn volume_capacity_is_real_and_consistent() {
        let volumes = crate::storage::discover_volumes();
        assert!(!volumes.is_empty());
        let root = volumes
            .iter()
            .find(|volume| volume.mount_point == "/")
            .expect("root volume");
        assert!(root.total_bytes > 0);
        assert!(root.used_bytes <= root.total_bytes);
        assert!(root.available_bytes <= root.total_bytes);
        assert!(root.usage_percent >= 0.0 && root.usage_percent <= 100.0);
    }

    #[test]
    fn sanitizes_appearance_package_names_and_extensions() {
        assert_eq!(
            safe_package_file_name("Midnight Blue.maxTheme").unwrap(),
            "Midnight Blue.maxTheme"
        );
        assert_eq!(
            safe_package_file_name("../../Some Theme.MAXTHEME").unwrap(),
            "Some Theme.maxTheme"
        );
        assert_eq!(
            safe_package_file_name("Packs/My Icons.maxIcons").unwrap(),
            "Packs-My Icons.maxIcons"
        );
        assert_eq!(
            safe_package_file_name("bad.exe").unwrap_err().code,
            "invalid_request"
        );
        assert_eq!(
            safe_package_file_name("   ").unwrap_err().code,
            "invalid_request"
        );
    }
}
