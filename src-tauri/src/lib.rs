mod commands;
mod models;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(commands::fs_ops::FsOpState::default())
        .invoke_handler(tauri::generate_handler![
            commands::compare::compare_folders,
            commands::diff::diff_text,
            commands::files::read_file_text,
            commands::files::file_version,
            commands::merge::save_document,
            commands::fs_ops::resolve_paths,
            commands::fs_ops::is_directory,
            commands::fs_ops::plan_fs_batch,
            commands::fs_ops::execute_fs_item,
            commands::fs_ops::delete_paths,
            commands::fs_ops::start_fs_op,
            commands::fs_ops::cancel_fs_op,
            commands::fs_ops::end_fs_op,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
