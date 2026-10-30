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
        use crate::storage::scan_storage_index;
        let cancel = AtomicBool::new(false);
        let root = tempdir().unwrap();
        for index in 0..1_600 {
            fs::write(root.path().join(format!("file-{index}.bin")), b"x").unwrap();
        }
        let result = scan_storage_index(root.path(), 22, 20_000, &cancel, &|progress| {
            if progress.scanned_entries >= 1_500 {
                cancel.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        })
        .unwrap();
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
