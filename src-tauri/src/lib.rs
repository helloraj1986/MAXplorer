mod app_icons;
mod commands;
mod compare;
mod error;
mod listing;
mod metadata;
mod operations;
mod paths;
mod search;
mod transfer;
mod types;

#[cfg(test)]
mod tests;

use compare::CompareState;
use search::SearchService;
use transfer::TransferState;
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;

    // Replace Tauri's native About panel with the application's themed About
    // dialog. The default menu is otherwise preserved exactly.
    let app_menu = menu
        .items()?
        .into_iter()
        .find_map(|item| match item {
            MenuItemKind::Submenu(submenu) => Some(submenu),
            _ => None,
        });

    if let Some(app_menu) = app_menu {
        let about_position = app_menu.items()?.iter().position(|item| {
            matches!(
                item,
                MenuItemKind::Predefined(predefined)
                    if predefined
                        .text()
                        .map(|text| text.starts_with("About"))
                        .unwrap_or(false)
            )
        });

        if let Some(position) = about_position {
            let about = MenuItem::with_id(
                app,
                "maxplorer-about",
                "About MAXplorer",
                true,
                None::<&str>,
            )?;
            app_menu.remove_at(position)?;
            app_menu.insert(&about, position)?;
        }
    }

    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_app_menu);

    builder
        .setup(|app| {
            let data_directory = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("maxplorer"));
            let _ = std::fs::create_dir_all(&data_directory);
            let database = data_directory.join("search").join("index.sqlite3");
            let service = match SearchService::new(database.clone()) {
                Ok(service) => service,
                Err(error) => {
                    eprintln!("Search index could not be opened: {error}");
                    let fallback = std::env::temp_dir().join("maxplorer-search").join("index.sqlite3");
                    SearchService::new(fallback)?
                }
            };
            app.manage(service);
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "maxplorer-about" {
                let _ = app.emit("maxplorer://about", ());
            }
        })
        .manage(TransferState::default())
        .manage(CompareState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_platform_info,
            commands::get_sidebar_locations,
            commands::get_initial_path,
            commands::resolve_path,
            commands::path_exists,
            commands::list_directory,
            commands::search_files,
            commands::universal_search,
            commands::find_duplicates,
            commands::search_suggestions,
            commands::get_search_index_status,
            commands::add_search_location,
            commands::remove_search_location,
            commands::set_search_index_paused,
            commands::set_search_content_enabled,
            commands::set_search_content_limit,
            commands::rebuild_search_index,
            commands::clear_search_index,
            commands::retry_failed_extractions,
            commands::remove_search_path,
            commands::get_index_errors,
            commands::cancel_search,
            commands::create_folder,
            commands::create_text_file,
            commands::create_symlink,
            commands::rename_path,
            commands::copy_paths,
            commands::move_paths,
            commands::delete_paths,
            commands::duplicate_paths,
            commands::transfer_paths,
            commands::cancel_transfer,
            commands::pause_transfer,
            commands::compare_folders,
            commands::cancel_compare,
            commands::get_properties,
            commands::get_folder_stats,
            commands::read_text_preview,
            commands::list_applications,
            commands::read_app_icon,
            commands::open_path,
            commands::save_appearance_package,
            commands::reveal_path,
            commands::open_terminal,
            commands::open_with,
            commands::open_system_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Windows 11 Explorer replica");
}
