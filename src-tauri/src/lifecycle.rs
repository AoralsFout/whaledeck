//! 程序托盘与关闭生命周期：统一窗口/托盘入口、确认状态和退出前结算。
//!
//! 对话框由前端展示；此处保存权威请求并在用户明确确认后退出，不结束外部进程。
//! 对应文档：docs/后端实现.md「模块与装配」、docs/界面与交互.md §6.1。
use crate::commands::AppState;
use crate::models::{now_ms, CloseAction, CloseBehavior, CloseRequest, CloseRequestKind, Settings};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Lifecycle {
    pub pending: Option<CloseRequest>,
    pub exiting: bool,
}

/// 恢复隐藏或最小化窗口，使托盘触发的确认对话框也能被看到。
fn show_main(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| format!("无法显示主窗口：{e}"))?;
        window
            .unminimize()
            .map_err(|e| format!("无法还原主窗口：{e}"))?;
        window
            .set_focus()
            .map_err(|e| format!("无法聚焦主窗口：{e}"))?;
    }
    Ok(())
}

/// 复用应用图标；菜单与左键入口在 Rust 装配，后台隐藏不销毁 WebView。
pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出 WhaleDeck", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &exit])?;
    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("WhaleDeck")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                let _ = show_main(app);
            }
            "exit" => request_close(app, true),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                let _ = show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// 只改关闭字段，保留其他最新设置；写失败时偏好与内存均不变。
fn persist_behavior(state: &AppState, behavior: CloseBehavior) -> Result<Settings, String> {
    let mut settings = state.settings.lock().unwrap();
    let mut next = settings.clone();
    next.close_behavior = Some(behavior);
    state.store.save_settings(&next)?;
    *settings = next.clone();
    Ok(next)
}

/// 设置页明确选择后才持久化，不接受非法关闭行为。
#[tauri::command]
pub fn set_close_behavior(
    state: State<'_, AppState>,
    behavior: CloseBehavior,
) -> Result<Settings, String> {
    persist_behavior(&state, behavior)
}

/// 订阅事件后读取快照，覆盖窗口尚未完成加载时发出的关闭请求。
#[tauri::command]
pub fn get_close_request(state: State<'_, AppState>) -> Option<CloseRequest> {
    state.lifecycle.lock().unwrap().pending.clone()
}

fn request(kind: CloseRequestKind, running_count: usize) -> CloseRequest {
    CloseRequest {
        kind,
        running_count,
        message: String::new(),
    }
}

/// 不在持锁期间等待前端；重复关闭只恢复窗口，不创建第二个请求。
pub fn request_close(app: &AppHandle, force_exit: bool) {
    let state = app.state::<AppState>();
    let mut lifecycle = state.lifecycle.lock().unwrap();
    if lifecycle.exiting {
        return;
    }
    if lifecycle.pending.is_some() {
        publish(app, &lifecycle);
        return;
    }
    let behavior = if force_exit {
        Some(CloseBehavior::Exit)
    } else {
        state.settings.lock().unwrap().close_behavior
    };
    let result = match behavior {
        None => {
            lifecycle.pending = Some(request(
                CloseRequestKind::Choose,
                state.sessions.lock().unwrap().len(),
            ));
            Ok(())
        }
        Some(CloseBehavior::Hide) => hide_main(app),
        Some(CloseBehavior::Exit) => prepare_exit(app, &state, &mut lifecycle),
    };
    if let Err(message) = result {
        lifecycle.pending = Some(CloseRequest {
            kind: CloseRequestKind::Error,
            running_count: 0,
            message,
        });
    }
    publish(app, &lifecycle);
}

fn hide_main(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("主窗口不存在，请重新打开 WhaleDeck")?;
    window
        .hide()
        .map_err(|e| format!("隐藏窗口失败，请重试：{e}"))
}

/// 仍在追踪的会话保守视为运行中，沿用监控线程的退出判定延迟。
fn prepare_exit(
    app: &AppHandle,
    state: &AppState,
    lifecycle: &mut Lifecycle,
) -> Result<(), String> {
    let count = state.sessions.lock().unwrap().len();
    if count > 0 {
        lifecycle.pending = Some(request(CloseRequestKind::ConfirmExit, count));
        Ok(())
    } else {
        finish_exit(app, state, lifecycle)
    }
}

/// 成功写盘并移除恢复标记后才替换内存；调用者持有生命周期锁，监控不能重复结算。
fn settle_sessions(state: &AppState, stopped_at: u64) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let mut games = state.games.lock().unwrap();
    let mut next = games.clone();
    for session in sessions.iter() {
        if let Some(game) = next.iter_mut().find(|g| g.id == session.game_id) {
            game.playtime_sec = game
                .playtime_sec
                .saturating_add(stopped_at.saturating_sub(session.started_at) / 1000);
            game.last_played_at = Some(session.started_at);
        }
    }
    if !sessions.is_empty() {
        state.store.save_games(&next)?;
    }
    let pending_path = state.store.pending_path();
    match std::fs::remove_file(&pending_path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(format!(
                "无法清除会话恢复记录（{}）：{e}。请检查文件权限后重试。",
                pending_path.display()
            ))
        }
    }
    *games = next;
    sessions.clear();
    Ok(())
}

fn finish_exit(app: &AppHandle, state: &AppState, lifecycle: &mut Lifecycle) -> Result<(), String> {
    settle_sessions(state, now_ms())?;
    lifecycle.pending = None;
    lifecycle.exiting = true;
    app.exit(0);
    Ok(())
}

/// 请求始终留在后端；广播丢失时可由快照恢复。确认前先显示窗口。
fn publish(app: &AppHandle, lifecycle: &Lifecycle) {
    if lifecycle.pending.is_some() {
        let _ = show_main(app);
    }
    let _ = app.emit("close-requested", &lifecycle.pending);
}

/// 仅接受当前阶段允许的动作；取消不保存设置，任何失败都保留待确认状态。
#[tauri::command]
pub fn resolve_close_request(
    app: AppHandle,
    state: State<'_, AppState>,
    action: CloseAction,
) -> Result<Option<CloseRequest>, String> {
    let mut lifecycle = state.lifecycle.lock().unwrap();
    let Some(current) = lifecycle.pending.as_ref() else {
        return Ok(None);
    };
    match (current.kind, action) {
        (_, CloseAction::Cancel) => lifecycle.pending = None,
        (CloseRequestKind::Choose, CloseAction::Hide | CloseAction::Exit) => {
            let behavior = if matches!(action, CloseAction::Hide) {
                CloseBehavior::Hide
            } else {
                CloseBehavior::Exit
            };
            let settings = persist_behavior(&state, behavior)?;
            let _ = app.emit("settings-changed", &settings);
            if behavior == CloseBehavior::Hide {
                hide_main(&app)?;
                lifecycle.pending = None;
            } else {
                prepare_exit(&app, &state, &mut lifecycle)?;
            }
        }
        (CloseRequestKind::ConfirmExit, CloseAction::ConfirmExit) => {
            finish_exit(&app, &state, &mut lifecycle)?
        }
        _ => return Err("关闭状态已变化，请根据当前提示重新选择".into()),
    }
    publish(&app, &lifecycle);
    Ok(lifecycle.pending.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Game, Session};
    use crate::store::Store;
    use std::sync::Mutex;

    fn state(root: &std::path::Path) -> AppState {
        let games: Vec<Game> = ["a", "b"]
            .into_iter()
            .map(|id| {
                serde_json::from_value(serde_json::json!({
                    "id": id, "title": id, "exePath": "C:\\game.exe", "playtimeSec": 60
                }))
                .unwrap()
            })
            .collect();
        let sessions = games
            .iter()
            .enumerate()
            .map(|(i, game)| Session {
                game_id: game.id.clone(),
                pid: i as u32,
                started_at: 1000,
                baseline_playtime: 60,
            })
            .collect();
        AppState {
            store: Store::new(root.to_path_buf()),
            games: Mutex::new(games),
            settings: Mutex::new(Settings::default()),
            sessions: Mutex::new(sessions),
            lifecycle: Mutex::new(Lifecycle::default()),
        }
    }

    #[test]
    fn old_settings_require_first_close_choice_and_roundtrip_both_preferences() {
        let old: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(old.close_behavior, None);
        for behavior in [CloseBehavior::Hide, CloseBehavior::Exit] {
            let settings = Settings {
                close_behavior: Some(behavior),
                ..old.clone()
            };
            let json = serde_json::to_string(&settings).unwrap();
            let loaded: Settings = serde_json::from_str(&json).unwrap();
            assert_eq!(loaded.close_behavior, Some(behavior));
        }
        assert!(serde_json::from_str::<Settings>(r#"{"closeBehavior":"unknown"}"#).is_err());
    }

    #[test]
    fn preference_preserves_latest_settings_and_failed_write_keeps_old_choice() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(dir.path());
        state
            .settings
            .lock()
            .unwrap()
            .categories
            .push("软件".into());
        persist_behavior(&state, CloseBehavior::Hide).unwrap();
        assert_eq!(state.store.load_settings().categories, vec!["软件"]);
        std::fs::create_dir(state.store.settings_path().with_extension("json.tmp")).unwrap();
        assert!(persist_behavior(&state, CloseBehavior::Exit).is_err());
        assert_eq!(
            state.settings.lock().unwrap().close_behavior,
            Some(CloseBehavior::Hide)
        );
        assert_eq!(
            state.store.load_settings().close_behavior,
            Some(CloseBehavior::Hide)
        );
    }

    #[test]
    fn exit_settles_every_session_once_and_prevents_offline_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(dir.path());
        state
            .store
            .write_pending(&state.sessions.lock().unwrap()[1])
            .unwrap();
        settle_sessions(&state, 11000).unwrap();
        assert!(state.sessions.lock().unwrap().is_empty());
        assert!(state.store.read_pending().is_none());
        assert!(state
            .store
            .load_games()
            .iter()
            .all(|g| g.playtime_sec == 70));
        settle_sessions(&state, 21000).unwrap();
        assert!(state
            .games
            .lock()
            .unwrap()
            .iter()
            .all(|g| g.playtime_sec == 70));
    }

    #[test]
    fn failed_exit_write_preserves_tracking_and_can_retry_without_double_counting() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(dir.path());
        state
            .store
            .write_pending(&state.sessions.lock().unwrap()[0])
            .unwrap();
        let blocked = state.store.games_path().with_extension("json.tmp");
        std::fs::create_dir(&blocked).unwrap();
        assert!(settle_sessions(&state, 11000).is_err());
        assert_eq!(state.sessions.lock().unwrap().len(), 2);
        assert!(state
            .games
            .lock()
            .unwrap()
            .iter()
            .all(|g| g.playtime_sec == 60));
        assert!(state.store.read_pending().is_some());
        std::fs::remove_dir(blocked).unwrap();
        settle_sessions(&state, 21000).unwrap();
        assert!(state
            .store
            .load_games()
            .iter()
            .all(|g| g.playtime_sec == 80));
    }

    #[test]
    fn failed_pending_cleanup_preserves_sessions_and_retry_does_not_add_twice() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(dir.path());
        state.store.ensure_dirs().unwrap();
        std::fs::create_dir(state.store.pending_path()).unwrap();
        assert!(settle_sessions(&state, 11000).is_err());
        assert_eq!(state.sessions.lock().unwrap().len(), 2);
        assert!(state
            .games
            .lock()
            .unwrap()
            .iter()
            .all(|g| g.playtime_sec == 60));
        std::fs::remove_dir(state.store.pending_path()).unwrap();
        settle_sessions(&state, 21000).unwrap();
        assert!(state
            .store
            .load_games()
            .iter()
            .all(|g| g.playtime_sec == 80));
    }

    #[test]
    fn backwards_clock_does_not_underflow_playtime() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(dir.path());
        settle_sessions(&state, 0).unwrap();
        assert!(state
            .store
            .load_games()
            .iter()
            .all(|g| g.playtime_sec == 60));
    }
}
