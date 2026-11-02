mod app_icons;
mod commands;
mod compare;
mod error;
mod listing;
mod logging;
mod metadata;
mod network_discovery;
mod network_mount;
mod operations;
mod paths;
mod search;
mod storage;
mod storage_cache;
mod storage_maintenance;
mod transfer;
mod types;

#[cfg(test)]
mod tests;

use compare::CompareState;
use search::SearchService;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use storage::StorageState;
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
    logging::install_panic_hook();
    let app_focused = Arc::new(AtomicBool::new(true));
    let focus_for_events = app_focused.clone();
    let builder = tauri::Builder::default().on_window_event(move |_window, event| {
        if let tauri::WindowEvent::Focused(focused) = event {
            focus_for_events.store(*focused, Ordering::Relaxed);
        }
    });

    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_app_menu);

    builder
        .setup(move |app| {
            let search_focus = app_focused.clone();
            let data_directory = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("maxplorer"));
            let setup_started = std::time::Instant::now();
            let _ = std::fs::create_dir_all(&data_directory);
            logging::init(&data_directory);
            logging::info("app", "Tauri setup started");
            let identifier = app.config().identifier.clone();
            logging::info(
                "app",
                format!(
                    "canonical data root: {} ({identifier})",
                    data_directory.display()
                ),
            );
            let migrated = storage_maintenance::migrate_legacy_app_data(
                &data_directory,
                &identifier,
            );
            if !migrated.is_empty() {
                logging::info(
                    "storage.migrate",
                    format!("reused {} legacy storage path(s)", migrated.len()),
                );
            }
            if storage_maintenance::has_legacy_storage(&identifier) {
                logging::info(
                    "storage.audit",
                    "legacy storage detected; open Settings > Advanced > Application storage to review and clean it",
                );
            }
            let search_started = std::time::Instant::now();
            let database = data_directory.join("search").join("index.sqlite3");
            let service = match SearchService::new(database.clone(), search_focus.clone()) {
                Ok(service) => service,
                Err(error) => {
                    logging::error(
                        "search",
                        format!("Search index could not be opened: {error}"),
                    );
                    let fallback = std::env::temp_dir().join("maxplorer-search").join("index.sqlite3");
                    SearchService::new(fallback, search_focus.clone())?
                }
            };
            logging::info(
                "app",
                format!(
                    "search service ready in {} ms",
                    search_started.elapsed().as_millis()
                ),
            );
            app.manage(service);
            let storage_started = std::time::Instant::now();
            let storage_cache = data_directory.join("storage").join("cache.sqlite3");
            app.manage(StorageState::new(storage_cache));
            logging::info(
                "app",
                format!(
                    "storage state ready in {} ms",
                    storage_started.elapsed().as_millis()
                ),
            );
            logging::info(
                "app",
                format!(
                    "Tauri setup completed in {} ms",
                    setup_started.elapsed().as_millis()
                ),
            );
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
            commands::eject_volume,
            commands::connect_network_location,
            commands::discover_network_computers,
            commands::list_network_shares,
            commands::get_storage_audit,
            commands::cleanup_legacy_storage,
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
            storage::get_storage_volumes,
            storage::scan_storage,
            storage::cancel_storage_scan,
            storage::get_storage_scan_result,
            storage::get_storage_cached_scan,
            storage::get_storage_children,
            storage::query_storage_files,
            storage::find_storage_duplicates,
            storage::cancel_storage_duplicates,
            storage::delete_storage_paths,
            storage::cancel_storage_delete,
            storage::clear_storage_index,
            logging::log_frontend_event,
            logging::get_log_path,
            logging::log_storage_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Windows 11 Explorer replica");
}
