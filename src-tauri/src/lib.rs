mod commands;
mod launcher;
mod models;
mod savegame;
mod store;

use commands::AppState;
use store::Store;
use tauri::Manager;

fn init_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let root = app.path().app_data_dir()?;
    let store = Store::new(root);
    store.ensure_dirs().map_err(std::io::Error::other)?;

    let mut games = store.load_games();

    // 上次异常退出留下的会话：按时间差补算（上限 12 小时，避免离谱数字）
    if let Some(pending) = store.read_pending() {
        let elapsed = models::now_ms().saturating_sub(pending.started_at);
        if elapsed > 0 && elapsed < 12 * 3600 * 1000 {
            if let Some(game) = games.iter_mut().find(|g| g.id == pending.game_id) {
                game.playtime_sec = game.playtime_sec.saturating_add(elapsed / 1000);
                let _ = store.save_games(&games);
            }
        }
        store.clear_pending();
    }

    let settings = store.load_settings();
    app.manage(AppState {
        store,
        games: std::sync::Mutex::new(games),
        settings: std::sync::Mutex::new(settings),
        sessions: std::sync::Mutex::new(Vec::new()),
    });
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            init_app(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_games,
            commands::save_game,
            commands::delete_game,
            commands::launch_game,
            commands::get_sessions,
            commands::reset_playtime,
            commands::pick_entry,
            commands::pick_folder,
            commands::pick_image,
            commands::scan_folder,
            commands::import_cover,
            commands::import_background,
            commands::asset_path,
            commands::get_settings,
            commands::save_settings,
            commands::open_data_dir,
            commands::backup_saves,
            commands::list_save_backups,
            commands::restore_save_backup,
            commands::open_backups_dir,
            commands::export_library,
            commands::import_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
