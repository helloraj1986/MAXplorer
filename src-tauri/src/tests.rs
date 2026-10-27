#[cfg(test)]
mod tests {
    use crate::listing::list_directory;
    use crate::operations::{
        copy_paths, create_folder, create_text_file, delete_paths, duplicate_paths, move_paths,
        rename_path,
    };
    use crate::paths::{unique_destination, validate_name};
    use crate::search::{search_files, SearchState};
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
        let result = search_files(
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
        let state = SearchState::default();
        assert!(state.cancels.lock().unwrap().is_empty());
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
}
