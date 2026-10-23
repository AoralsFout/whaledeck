//! 应用装配层：初始化数据目录、恢复异常会话、注册 Tauri 命令。
//!
//! 这里只负责「把各模块接起来」，不实现具体业务算法。
//! 对应文档：docs/系统架构.md、docs/后端实现.md「模块与装配」。
mod commands;
mod cover;
mod launcher;
mod lifecycle;
mod meta;
mod models;
mod program;
mod savegame;
mod store;
mod superres;

use commands::AppState;
use store::Store;
use tauri::Manager;

/// 初始化数据目录、载入库与设置、补算异常会话，并注册共享状态。
///
/// pending 补算限制 12 小时，避免把误写的超长会话累加进时长。
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
        lifecycle: std::sync::Mutex::new(lifecycle::Lifecycle::default()),
        superres: superres::SuperRes::new(),
    });
    Ok(())
}

/// 构建 Tauri 应用并注册全部命令；窗口配置与插件在 `tauri.conf.json` / 此处装配。
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            init_app(app)?;
            lifecycle::setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    lifecycle::request_close(window.app_handle(), false);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            lifecycle::get_close_request,
            lifecycle::resolve_close_request,
            lifecycle::set_close_behavior,
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
            commands::import_icon,
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
            commands::search_meta,
            commands::apply_meta,
            commands::autofill,
            superres::superres_status,
            superres::superres_task,
            superres::superres_generate,
            superres::superres_cancel,
            superres::superres_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
