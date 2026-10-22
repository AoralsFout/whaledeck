use crate::launcher;
use crate::meta;
use crate::models::{
    now_ms, Game, LaunchResult, MetaItem, SaveBackup, ScanEntry, Session, Settings, StoppedPayload,
};
use crate::savegame;
use crate::store::Store;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    pub store: Store,
    pub games: Mutex<Vec<Game>>,
    pub settings: Mutex<Settings>,
    pub sessions: Mutex<Vec<Session>>,
}

const SCAN_MAX_DEPTH: u32 = 6;
const SCAN_MAX_FILES: usize = 500;

fn lower_ext(src: &str) -> String {
    Path::new(src)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp"))
        .unwrap_or_else(|| "png".to_string())
}

fn remove_old_assets(dir: &Path, prefix: &str, keep: Option<&str>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(prefix) && Some(name.as_str()) != keep {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

fn find_game(state: &AppState, id: &str) -> Result<Game, String> {
    state
        .games
        .lock()
        .unwrap()
        .iter()
        .find(|g| g.id == id)
        .cloned()
        .ok_or_else(|| "游戏记录不存在".to_string())
}

// ---------- 游戏库 ----------

#[tauri::command]
pub fn list_games(state: State<'_, AppState>) -> Vec<Game> {
    state.games.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_game(state: State<'_, AppState>, mut game: Game) -> Result<Game, String> {
    if game.title.trim().is_empty() {
        return Err("名称不能为空".into());
    }
    if game.exe_path.trim().is_empty() {
        return Err("请选择要加入的程序、文件或文件夹".into());
    }
    if game.id.trim().is_empty() {
        game.id = uuid::Uuid::new_v4().to_string();
    }
    if game.added_at == 0 {
        game.added_at = now_ms();
    }
    game.save_paths = game
        .save_paths
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    let mut games = state.games.lock().unwrap();
    match games.iter_mut().find(|g| g.id == game.id) {
        Some(existing) => *existing = game.clone(),
        None => games.push(game.clone()),
    }
    state.store.save_games(&games)?;
    Ok(game)
}

#[tauri::command]
pub fn delete_game(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.iter().any(|s| s.game_id == id) {
            return Err("正在运行中，请先退出再删除记录".into());
        }
    }
    let mut games = state.games.lock().unwrap();
    let before = games.len();
    games.retain(|g| g.id != id);
    if games.len() == before {
        return Ok(false);
    }
    state.store.save_games(&games)?;
    Ok(true)
}

// ---------- 启动与计时 ----------

#[tauri::command]
pub fn launch_game(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<LaunchResult, String> {
    let game = find_game(&state, &id)?;
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.iter().any(|s| s.game_id == id) {
            return Err("这个项目已经在运行了".into());
        }
    }

    let pid = launcher::spawn_entry(&game).map_err(|message| {
        let _ = app.emit(
            "launch-failed",
            serde_json::json!({ "gameId": id, "message": message }),
        );
        message
    })?;

    let started_at = now_ms();
    if let Some(pid) = pid {
        let session = Session {
            game_id: id.clone(),
            pid,
            started_at,
            baseline_playtime: game.playtime_sec,
        };
        state.sessions.lock().unwrap().push(session.clone());
        let _ = state.store.write_pending(&session);
        monitor_process(app.clone(), session, game);
    }

    {
        let mut games = state.games.lock().unwrap();
        if let Some(g) = games.iter_mut().find(|g| g.id == id) {
            g.last_played_at = Some(started_at);
        }
        let _ = state.store.save_games(&games);
    }

    Ok(LaunchResult { pid, started_at })
}

fn monitor_process(app: AppHandle, session: Session, game: Game) {
    std::thread::spawn(move || {
        let mut misses = 0u8;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let tracked = {
                let state = app.state::<AppState>();
                let sessions = state.sessions.lock().unwrap();
                sessions
                    .iter()
                    .any(|s| s.game_id == session.game_id && s.pid == session.pid)
            };
            if !tracked {
                return;
            }
            if launcher::is_running(&session, &game) {
                misses = 0;
            } else {
                misses += 1;
                if misses >= 3 {
                    break;
                }
            }
        }

        let state = app.state::<AppState>();
        let session_sec = now_ms().saturating_sub(session.started_at) / 1000;
        let playtime_sec = {
            let mut games = state.games.lock().unwrap();
            let mut total = session.baseline_playtime.saturating_add(session_sec);
            if let Some(g) = games.iter_mut().find(|g| g.id == session.game_id) {
                g.playtime_sec = g.playtime_sec.saturating_add(session_sec);
                g.last_played_at = Some(session.started_at);
                total = g.playtime_sec;
            }
            let _ = state.store.save_games(&games);
            total
        };
        {
            let mut sessions = state.sessions.lock().unwrap();
            sessions.retain(|s| !(s.game_id == session.game_id && s.pid == session.pid));
        }
        state.store.clear_pending();
        let _ = app.emit(
            "game-stopped",
            StoppedPayload {
                game_id: session.game_id.clone(),
                session_sec,
                playtime_sec,
            },
        );
    });
}

#[tauri::command]
pub fn get_sessions(state: State<'_, AppState>) -> Vec<Session> {
    state.sessions.lock().unwrap().clone()
}

#[tauri::command]
pub fn reset_playtime(state: State<'_, AppState>, id: String, sec: u64) -> Result<Game, String> {
    let mut games = state.games.lock().unwrap();
    let game = games
        .iter_mut()
        .find(|g| g.id == id)
        .ok_or_else(|| "游戏记录不存在".to_string())?;
    game.playtime_sec = sec;
    let snapshot = game.clone();
    state.store.save_games(&games)?;
    Ok(snapshot)
}

// ---------- 文件选择 ----------

/// 选择任意文件（程序、快捷方式、文档、图片……）。
#[tauri::command]
pub fn pick_entry(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("选择要加入的程序或文件")
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn pick_folder(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("选择文件夹")
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn pick_image(app: AppHandle, kind: String) -> Option<String> {
    let title = if kind == "background" {
        "选择背景图片"
    } else {
        "选择封面图片"
    };
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

// ---------- 文件夹扫描 ----------

fn scan_walk(dir: &Path, depth: u32, out: &mut Vec<ScanEntry>) {
    if depth > SCAN_MAX_DEPTH || out.len() >= SCAN_MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut sub_dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            const SKIP: &[&str] = &[
                "node_modules",
                "$Recycle.Bin",
                "System Volume Information",
                "Windows",
                "AppData",
                "ProgramData",
            ];
            if SKIP.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
                continue;
            }
            sub_dirs.push(path);
        } else if path
            .extension()
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
        {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(ScanEntry {
                path: path.to_string_lossy().to_string(),
                name,
                size,
            });
        }
    }
    for sub in sub_dirs {
        scan_walk(&sub, depth + 1, out);
    }
}

#[tauri::command]
pub fn scan_folder(path: String) -> Result<Vec<ScanEntry>, String> {
    let root = PathBuf::from(path.trim());
    if !root.is_dir() {
        return Err("请选择一个有效的文件夹".into());
    }
    let mut out = Vec::new();
    scan_walk(&root, 0, &mut out);
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    out.truncate(SCAN_MAX_FILES);
    Ok(out)
}

// ---------- 资源 ----------

#[tauri::command]
pub fn import_cover(state: State<'_, AppState>, id: String, src: String) -> Result<String, String> {
    let ext = lower_ext(&src);
    let name = format!("{id}.{ext}");
    let dir = state.store.covers_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::copy(&src, dir.join(&name)).map_err(|e| format!("复制封面失败：{e}"))?;
    remove_old_assets(&dir, &format!("{id}."), Some(&name));
    Ok(name)
}

#[tauri::command]
pub fn import_background(state: State<'_, AppState>, src: String) -> Result<String, String> {
    let ext = lower_ext(&src);
    let name = format!("background.{ext}");
    let dir = state.store.backgrounds_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    remove_old_assets(&dir, "background.", None);
    std::fs::copy(&src, dir.join(&name)).map_err(|e| format!("复制背景失败：{e}"))?;

    let mut settings = state.settings.lock().unwrap();
    settings.theme.background_file = Some(name.clone());
    state.store.save_settings(&settings)?;
    Ok(name)
}

#[tauri::command]
pub fn asset_path(state: State<'_, AppState>, kind: String, file: String) -> String {
    let dir = if kind == "background" {
        state.store.backgrounds_dir()
    } else {
        state.store.covers_dir()
    };
    dir.join(file).to_string_lossy().to_string()
}

// ---------- 设置 ----------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    state.store.save_settings(&settings)?;
    *state.settings.lock().unwrap() = settings.clone();
    Ok(settings)
}

#[tauri::command]
pub fn open_data_dir(state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.store.root.clone();
    std::process::Command::new("explorer")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开目录失败：{e}"))
}

// ---------- 存档备份 ----------

#[tauri::command]
pub fn backup_saves(state: State<'_, AppState>, id: String) -> Result<SaveBackup, String> {
    let game = find_game(&state, &id)?;
    savegame::backup(&state.store, &game)
}

#[tauri::command]
pub fn list_save_backups(state: State<'_, AppState>, id: String) -> Vec<SaveBackup> {
    savegame::list(&state.store, &id)
}

#[tauri::command]
pub fn restore_save_backup(
    state: State<'_, AppState>,
    id: String,
    file: String,
) -> Result<usize, String> {
    let game = find_game(&state, &id)?;
    savegame::restore(&state.store, &game, &file)
}

#[tauri::command]
pub fn open_backups_dir(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let dir = state.store.game_backups_dir(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开目录失败：{e}"))
}

// ---------- 整库备份与恢复 ----------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    #[serde(default)]
    schema_version: u32,
    games: Vec<Game>,
    settings: Settings,
}

fn covers_sibling(backup_path: &Path) -> PathBuf {
    let stem = backup_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("whaledeck-backup");
    backup_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{stem}.covers"))
}

fn copy_dir_files(from: &Path, to: &Path) {
    if !from.is_dir() {
        return;
    }
    let _ = std::fs::create_dir_all(to);
    if let Ok(entries) = std::fs::read_dir(from) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    let _ = std::fs::copy(&path, to.join(name));
                }
            }
        }
    }
}

#[tauri::command]
pub fn export_library(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    let Some(target) = app
        .dialog()
        .file()
        .set_title("导出游戏库")
        .set_file_name("whaledeck-backup.json")
        .add_filter("WhaleDeck 备份", &["json"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(false);
    };

    let backup = BackupFile {
        schema_version: crate::models::SCHEMA_VERSION,
        games: state.games.lock().unwrap().clone(),
        settings: state.settings.lock().unwrap().clone(),
    };
    let json = serde_json::to_vec_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&target, json).map_err(|e| format!("写入备份失败：{e}"))?;
    copy_dir_files(&state.store.covers_dir(), &covers_sibling(&target));
    Ok(true)
}

#[tauri::command]
pub fn import_library(app: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let Some(source) = app
        .dialog()
        .file()
        .set_title("导入游戏库")
        .add_filter("WhaleDeck 备份", &["json"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(0);
    };

    let text = std::fs::read_to_string(&source).map_err(|e| format!("读取备份失败：{e}"))?;
    let backup: BackupFile =
        serde_json::from_str(&text).map_err(|e| format!("备份格式不正确，无法解析：{e}"))?;
    let count = backup.games.len();

    let mut games = state.games.lock().unwrap();
    *games = backup.games;
    state.store.save_games(&games)?;
    let mut settings = state.settings.lock().unwrap();
    *settings = backup.settings;
    state.store.save_settings(&settings)?;

    copy_dir_files(&covers_sibling(&source), &state.store.covers_dir());
    Ok(count)
}

// ---------- 联网元数据 ----------

#[tauri::command]
pub async fn search_meta(source: String, keyword: String) -> Result<Vec<MetaItem>, String> {
    meta::search(&source, &keyword).await
}

#[tauri::command]
pub async fn apply_meta(
    state: State<'_, AppState>,
    game_id: String,
    item: MetaItem,
) -> Result<Game, String> {
    let mut cover_file = None;
    if let Some(url) = item.cover_url.as_deref() {
        if !url.is_empty() {
            let (bytes, ext) = meta::download_image(url).await?;
            let name = format!("{game_id}.{ext}");
            let dir = state.store.covers_dir();
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            std::fs::write(dir.join(&name), bytes)
                .map_err(|e| format!("保存封面失败：{e}"))?;
            remove_old_assets(&dir, &format!("{game_id}."), Some(&name));
            cover_file = Some(name);
        }
    }

    let mut games = state.games.lock().unwrap();
    let game = games
        .iter_mut()
        .find(|g| g.id == game_id)
        .ok_or_else(|| "游戏记录不存在".to_string())?;
    if let Some(cover) = cover_file {
        game.cover_file = Some(cover);
    }
    if !item.summary.trim().is_empty() {
        game.summary = item.summary.trim().to_string();
    }
    if !item.developer.trim().is_empty() {
        game.developer = item.developer.trim().to_string();
    }
    if !item.release_date.trim().is_empty() {
        game.release_date = item.release_date.trim().to_string();
    }
    game.source = item.source.clone();
    game.source_id = item.id.clone();
    let snapshot = game.clone();
    state.store.save_games(&games)?;
    Ok(snapshot)
}
