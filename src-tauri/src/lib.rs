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
use search::SearchState;
use transfer::TransferState;
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::Emitter;

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
        .on_menu_event(|app, event| {
            if event.id() == "maxplorer-about" {
                let _ = app.emit("maxplorer://about", ());
            }
        })
        .manage(SearchState::default())
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
            commands::reveal_path,
            commands::open_terminal,
            commands::open_with,
            commands::open_system_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Windows 11 Explorer replica");
}
