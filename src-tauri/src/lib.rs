mod commands;
mod error;
mod listing;
mod metadata;
mod operations;
mod paths;
mod search;
mod types;

#[cfg(test)]
mod tests;

use search::SearchState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SearchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_platform_info,
            commands::get_sidebar_locations,
            commands::get_initial_path,
            commands::resolve_path,
            commands::path_exists,
            commands::list_directory,
            commands::search_files,
            commands::cancel_search,
            commands::create_folder,
            commands::create_text_file,
            commands::create_symlink,
            commands::rename_path,
            commands::copy_paths,
            commands::move_paths,
            commands::delete_paths,
            commands::duplicate_paths,
            commands::get_properties,
            commands::get_folder_stats,
            commands::read_text_preview,
            commands::list_applications,
            commands::open_path,
            commands::reveal_path,
            commands::open_terminal,
            commands::open_with,
            commands::open_system_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Windows 11 Explorer replica");
}
