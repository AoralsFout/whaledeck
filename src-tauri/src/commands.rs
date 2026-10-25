//! Tauri 命令层：游戏库、启动与监控、扫描、资源、设置、存档备份、迁移与自动补全。
//!
//! 命令只做参数校验与编排，具体算法委托给 launcher / store / cover / meta / savegame。
//! 对应文档：docs/接口契约.md（签名）、docs/后端实现.md（实现与限制）。
use crate::cover;
use crate::launcher;
use crate::lifecycle::Lifecycle;
use crate::meta;
use crate::models::{
    now_ms, CoverFraming, Game, LaunchResult, MetaItem, SaveBackup, ScanEntry, Session, Settings,
    StoppedPayload,
};
use crate::savegame;
use crate::store::Store;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// 应用共享状态：数据各自加锁；生命周期锁协调启动、关闭与结算，写盘统一走 `store`。
pub struct AppState {
    pub store: Store,
    pub games: Mutex<Vec<Game>>,
    pub settings: Mutex<Settings>,
    pub sessions: Mutex<Vec<Session>>,
    pub lifecycle: Mutex<Lifecycle>,
    pub superres: crate::superres::SuperRes,
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

/// 按 id 克隆记录；找不到时返回可直接展示的错误，不暴露锁内部状态。
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
pub fn save_game(state: State<'_, AppState>, game: Game) -> Result<Game, String> {
    save_game_record(state.inner(), game)
}

/// 校验并写入一条游戏记录：先写盘成功，再替换内存，失败时内存保持旧值。
fn save_game_record(state: &AppState, mut game: Game) -> Result<Game, String> {
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
    let mut next = games.clone();
    match next.iter_mut().find(|g| g.id == game.id) {
        Some(existing) => *existing = game.clone(),
        None => next.push(game.clone()),
    }
    state.store.save_games(&next)?;
    *games = next;
    Ok(game)
}

/// 仅保存当前封面的显示取景，不用前端的整条快照覆盖并发更新。
#[tauri::command]
pub fn save_cover_framing(
    state: State<'_, AppState>,
    id: String,
    framing: CoverFraming,
) -> Result<Game, String> {
    save_cover_framing_record(state.inner(), &id, framing)
}

fn save_cover_framing_record(
    state: &AppState,
    id: &str,
    framing: CoverFraming,
) -> Result<Game, String> {
    if !framing.position_x.is_finite()
        || !framing.position_y.is_finite()
        || !framing.zoom.is_finite()
        || !(0.0..=100.0).contains(&framing.position_x)
        || !(0.0..=100.0).contains(&framing.position_y)
        || !(1.0..=3.0).contains(&framing.zoom)
    {
        return Err("封面取景参数无效，请重新调整后保存".into());
    }
    let mut games = state.games.lock().unwrap();
    let mut next = games.clone();
    let game = next
        .iter_mut()
        .find(|g| g.id == id)
        .ok_or("游戏记录不存在")?;
    if framing.file.is_empty() || game.cover_file.as_deref() != Some(framing.file.as_str()) {
        return Err("封面已更换，请重新打开取景设置".into());
    }
    game.cover_framing = Some(framing);
    let saved = game.clone();
    state.store.save_games(&next)?;
    *games = next;
    Ok(saved)
}

/// 删除记录；运行中的游戏必须先退出，避免计时线程写回已删除的记录。
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

/// 启动目标：进程目标创建会话、写 pending 并启动监控；其余交给 Shell 打开。
#[tauri::command]
pub fn launch_game(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<LaunchResult, String> {
    // 与关闭检查互斥；确认期间不允许加入尚未获用户确认的新会话。
    let lifecycle = state.lifecycle.lock().unwrap();
    if lifecycle.pending.is_some() || lifecycle.exiting {
        return Err("正在确认关闭，请先取消关闭再启动程序".into());
    }
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

/// 每个会话一个采样线程：2 秒一次，连续 3 次未命中判定退出并结算。
///
/// 线程发现会话被移除（例如记录被其他路径清理）时直接退出，避免重复结算。
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
        // 采样后会话可能已由退出流程结算，必须在生命周期锁内再次检查。
        let _lifecycle = state.lifecycle.lock().unwrap();
        if !state
            .sessions
            .lock()
            .unwrap()
            .iter()
            .any(|s| s.game_id == session.game_id && s.pid == session.pid)
        {
            return;
        }
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

/// 手动修正累计时长（秒）；直接覆盖，不做增量。
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

/// 按用途设置对话框标题与格式过滤，取消时不修改任何资源。
#[tauri::command]
pub fn pick_image(app: AppHandle, kind: String) -> Option<String> {
    let title = match kind.as_str() {
        "background" => "选择背景图片",
        "icon" => "选择图标图片",
        _ => "选择封面图片",
    };
    let mut extensions = vec!["png", "jpg", "jpeg", "webp", "gif", "bmp"];
    if kind == "icon" {
        extensions.push("ico");
    }
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("图片", &extensions)
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

// ---------- 文件夹扫描 ----------

/// 递归收集 exe：限制深度与数量，跳过隐藏项、系统目录与依赖目录。
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

/// 扫描入口：校验目录、收集候选、按路径排序并截断到上限。
#[tauri::command]
pub fn scan_folder(path: String) -> Result<Vec<ScanEntry>, String> {
    let root = PathBuf::from(path.trim());
    if !root.is_dir() {
        return Err("请选择一个有效的文件夹".into());
    }
    let mut out = Vec::new();
    scan_walk(&root, 0, &mut out);
    out.sort_by_key(|a| a.path.to_lowercase());
    out.truncate(SCAN_MAX_FILES);
    Ok(out)
}

// ---------- 资源 ----------

/// 仅导入独立草稿封面；确认表单后才由 save_game 保存引用。
#[tauri::command]
pub fn import_cover(state: State<'_, AppState>, id: String, src: String) -> Result<String, String> {
    state.store.import_cover(&id, Path::new(&src))
}

/// 仅导入草稿资源；由 save_game 统一持久化图标引用。
#[tauri::command]
pub fn import_icon(state: State<'_, AppState>, id: String, src: String) -> Result<String, String> {
    state.store.import_icon(&id, Path::new(&src))
}

/// 背景用途隔离；先复制到唯一文件，再写设置，最后清理对应用途旧图。
fn import_background_record(
    state: &AppState,
    src: &str,
    target: Option<&str>,
) -> Result<String, String> {
    let prefix = match target.unwrap_or("main") {
        "main" => "background.",
        "sidebar" => "sidebar-background.",
        _ => return Err("未知的背景用途，请重新打开设置".into()),
    };
    let ext = lower_ext(src);
    let name = format!("{prefix}{}.{ext}", uuid::Uuid::new_v4());
    let dir = state.store.backgrounds_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&name);
    if let Err(e) = std::fs::copy(src, &dest) {
        let _ = std::fs::remove_file(&dest);
        return Err(format!("复制背景失败 {}：{e}", dest.display()));
    }

    let mut settings = state.settings.lock().unwrap();
    let mut next = settings.clone();
    if target == Some("sidebar") {
        next.theme.sidebar_background_file = Some(name.clone());
    } else {
        next.theme.background_file = Some(name.clone());
    }
    if let Err(e) = state.store.save_settings(&next) {
        let _ = std::fs::remove_file(&dest);
        return Err(e);
    }
    *settings = next;
    remove_old_assets(&dir, prefix, Some(&name));
    Ok(name)
}

/// 保存对应背景引用；不传用途时兼容原来的应用背景调用。
#[tauri::command]
pub fn import_background(
    state: State<'_, AppState>,
    src: String,
    target: Option<String>,
) -> Result<String, String> {
    import_background_record(&state, &src, target.as_deref())
}

#[tauri::command]
pub fn asset_path(state: State<'_, AppState>, kind: String, file: String) -> String {
    let dir = match kind.as_str() {
        "background" => state.store.backgrounds_dir(),
        "icon" => state.store.icons_dir(),
        "superres" => state.store.superres_dir(),
        "backgroundFit" => state.store.root.join("background-fit"),
        _ => state.store.covers_dir(),
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
    let mut current = state.settings.lock().unwrap();
    state.store.save_settings(&settings)?;
    *current = settings.clone();
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

/// 打包该游戏配置的存档目录；空目录/不存在会在 savegame 内报错。
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

/// 导出整库：JSON 含游戏与设置；封面顶层文件复制到同级 `<stem>.covers/`。
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

/// 导入整库：整体替换游戏与设置并复制封面；不合并、不清理旧资源。
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

/// 下载封面并合并元数据：只覆盖非空字段，来源与来源 ID 总是写入。
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
            // 每次联网封面采用独立文件，避免相同 URL 缓存与旧取景误用于新图。
            let name = format!("{game_id}.{}.{ext}", uuid::Uuid::new_v4());
            let dir = state.store.covers_dir();
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            std::fs::write(dir.join(&name), bytes).map_err(|e| format!("保存封面失败：{e}"))?;
            cover_file = Some(name);
        }
    }

    let mut games = state.games.lock().unwrap();
    let mut next = games.clone();
    let game = next
        .iter_mut()
        .find(|g| g.id == game_id)
        .ok_or_else(|| "游戏记录不存在".to_string())?;
    if let Some(cover) = cover_file {
        game.cover_file = Some(cover);
        game.cover_framing = None;
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
    state.store.save_games(&next)?;
    *games = next;
    Ok(snapshot)
}

// ---------- 自动封面 / 信息补全 ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutofillResult {
    pub game: Game,
    /// 是否写入了新图标
    pub icon: bool,
    /// 是否找到了本地封面
    pub cover: bool,
    pub cover_detail: String,
    /// 从版本资源补到的字段
    pub filled: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AutofillField {
    Title,
    Developer,
    Note,
    IconFile,
    CoverFile,
}

/// 只生成候选草稿；写游戏库必须由用户确认后单独调用 save_game。
#[tauri::command]
pub fn autofill(
    state: State<'_, AppState>,
    game: Game,
    field: Option<AutofillField>,
) -> Result<AutofillResult, String> {
    preview_autofill(&state.store, game, field)
}

/// 不访问库内记录，允许基于尚未保存的新项目或已修改路径获取候选。
fn preview_autofill(
    store: &Store,
    mut game: Game,
    field: Option<AutofillField>,
) -> Result<AutofillResult, String> {
    let path = game.exe_path.trim().to_string();
    if path.is_empty() || !Path::new(&path).exists() {
        return Err("目标路径不存在，请选择有效的程序、文件或文件夹后重试".into());
    }
    let requested = |candidate| field.is_none() || field == Some(candidate);
    let mut filled = Vec::new();
    if requested(AutofillField::Title)
        || requested(AutofillField::Developer)
        || requested(AutofillField::Note)
    {
        if let Ok(info) = crate::program::read_version_info(&path) {
            filled = apply_program_info(&mut game, &info, field);
        }
    }

    let mut icon = false;
    if requested(AutofillField::IconFile) {
        if let Ok((png, _, _)) = cover::icon_png(&path) {
            let dir = store.icons_dir();
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("创建图标目录失败 {}：{e}，请重试", dir.display()))?;
            let name = format!("{}.png", uuid::Uuid::new_v4());
            std::fs::write(dir.join(&name), png)
                .map_err(|e| format!("保存候选图标失败 {}：{e}，请重试", dir.display()))?;
            game.icon_file = Some(name);
            icon = true;
        }
    }

    let mut cover = false;
    let mut cover_detail = String::new();
    if requested(AutofillField::CoverFile) {
        if let Some(local) = cover::find_local_cover(&path) {
            game.cover_file = Some(store.import_cover(&game.id, &local)?);
            cover_detail = local
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            cover = true;
        }
    }
    Ok(AutofillResult {
        game,
        icon,
        cover,
        cover_detail,
        filled,
    })
}

/// 非空版本字段才产生候选；用户已有内容由表单快照保留以支持逐项恢复。
fn apply_program_info(
    game: &mut Game,
    info: &crate::program::ProgramInfo,
    field: Option<AutofillField>,
) -> Vec<String> {
    let title = if info.product.trim().is_empty() {
        &info.description
    } else {
        &info.product
    };
    let note = [
        info.description.trim().to_string(),
        if info.version.trim().is_empty() {
            String::new()
        } else {
            format!("v{}", info.version.trim())
        },
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" · ");
    let mut filled = Vec::new();
    for (candidate, label, value, target) in [
        (AutofillField::Title, "名称", title.trim(), &mut game.title),
        (
            AutofillField::Developer,
            "开发商",
            info.company.trim(),
            &mut game.developer,
        ),
        (AutofillField::Note, "备注", note.as_str(), &mut game.note),
    ] {
        if (field.is_none() || field == Some(candidate)) && !value.is_empty() {
            *target = value.to_string();
            filled.push(label.to_string());
        }
    }
    filled
}

#[cfg(test)]
mod game_write_tests {
    use super::*;

    fn game(id: &str, title: &str) -> Game {
        serde_json::from_value(serde_json::json!({
            "id": id, "title": title, "exePath": format!("C:\\Games\\{id}.exe"),
        }))
        .unwrap()
    }

    fn state(root: PathBuf, games: Vec<Game>) -> AppState {
        AppState {
            store: Store::new(root),
            games: Mutex::new(games),
            settings: Mutex::new(Settings::default()),
            sessions: Mutex::new(vec![]),
            lifecycle: Mutex::new(Lifecycle::default()),
            superres: crate::superres::SuperRes::new(),
        }
    }

    #[test]
    fn legacy_theme_gets_sidebar_defaults_without_changing_background() {
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "theme": {
                "preset": "whale", "mode": "dark", "primary": "#4fd6e8", "accent": "#ff9ec7",
                "backgroundFile": "background.jpg", "backgroundDim": 0.7
            }
        }))
        .unwrap();
        assert_eq!(
            settings.theme.background_file.as_deref(),
            Some("background.jpg")
        );
        assert!(settings.theme.sidebar_background_file.is_none());
        assert_eq!(settings.theme.sidebar_transparency, 0.52);
        assert!(settings.theme.sidebar_auto_hide);
        assert!(!settings.theme.sidebar_glass);
        assert!(!settings.theme.sidebar_clear_glass);
        assert!(settings.theme.sidebar_background_fit.enabled);
        assert_eq!(
            settings.theme.sidebar_background_fit.mode,
            crate::models::BackgroundFitMode::Contain
        );
        assert_eq!(settings.theme.sidebar_background_fit.position_x, 50);
        assert_eq!(settings.theme.sidebar_background_fit.position_y, 50);
        let mut changed = settings;
        changed.theme.sidebar_auto_hide = false;
        changed.theme.sidebar_glass = true;
        changed.theme.sidebar_clear_glass = true;
        changed.theme.sidebar_transparency = 1.0;
        changed.theme.sidebar_background_file = Some("sidebar-background.png".into());
        changed.theme.sidebar_background_fit.enabled = true;
        changed.theme.sidebar_background_fit.mode = crate::models::BackgroundFitMode::Cover;
        changed.theme.sidebar_background_fit.position_x = 72;
        let restored: Settings =
            serde_json::from_slice(&serde_json::to_vec(&changed).unwrap()).unwrap();
        assert_eq!(restored.theme.sidebar_transparency, 1.0);
        assert!(!restored.theme.sidebar_auto_hide);
        assert!(restored.theme.sidebar_glass);
        assert!(restored.theme.sidebar_clear_glass);
        assert!(restored.theme.sidebar_background_fit.enabled);
        assert_eq!(
            restored.theme.sidebar_background_fit.mode,
            crate::models::BackgroundFitMode::Cover
        );
        assert_eq!(restored.theme.sidebar_background_fit.position_x, 72);
        assert_eq!(
            restored.theme.sidebar_background_file,
            changed.theme.sidebar_background_file
        );
    }

    #[test]
    fn cover_framing_roundtrip_preserves_latest_game_fields() {
        let dir = tempfile::tempdir().unwrap();
        let mut current = game("a", "新元数据名称");
        assert!(current.cover_framing.is_none());
        current.cover_file = Some("a.jpg".into());
        current.playtime_sec = 12345;
        let state = state(dir.path().to_path_buf(), vec![current]);
        let framing = CoverFraming {
            file: "a.jpg".into(),
            position_x: 15.5,
            position_y: 82.0,
            zoom: 1.7,
        };
        let saved = save_cover_framing_record(&state, "a", framing.clone()).unwrap();
        assert_eq!(saved.title, "新元数据名称");
        assert_eq!(saved.playtime_sec, 12345);
        assert_eq!(saved.cover_framing, Some(framing.clone()));
        assert_eq!(state.store.load_games()[0].cover_framing, Some(framing));
    }

    #[test]
    fn cover_framing_rejects_stale_file_missing_game_and_invalid_values() {
        let dir = tempfile::tempdir().unwrap();
        let mut current = game("a", "游戏");
        current.cover_file = Some("new.jpg".into());
        let state = state(dir.path().to_path_buf(), vec![current]);
        let valid = CoverFraming {
            file: "new.jpg".into(),
            position_x: 50.0,
            position_y: 50.0,
            zoom: 1.0,
        };
        assert!(save_cover_framing_record(&state, "missing", valid.clone()).is_err());
        assert!(save_cover_framing_record(
            &state,
            "a",
            CoverFraming {
                file: "old.jpg".into(),
                ..valid.clone()
            }
        )
        .is_err());
        for (x, y, zoom) in [
            (f64::NAN, 50.0, 1.0),
            (50.0, f64::INFINITY, 1.0),
            (-1.0, 50.0, 1.0),
            (50.0, 101.0, 1.0),
            (50.0, 50.0, 0.9),
            (50.0, 50.0, 3.1),
        ] {
            assert!(save_cover_framing_record(
                &state,
                "a",
                CoverFraming {
                    position_x: x,
                    position_y: y,
                    zoom,
                    ..valid.clone()
                }
            )
            .is_err());
        }
        assert!(state.games.lock().unwrap()[0].cover_framing.is_none());
        assert!(!state.store.games_path().exists());
    }

    #[test]
    fn failed_cover_framing_save_preserves_original_memory_and_disk() {
        let dir = tempfile::tempdir().unwrap();
        let mut current = game("a", "游戏");
        current.cover_file = Some("a.jpg".into());
        let state = state(dir.path().to_path_buf(), vec![current]);
        state
            .store
            .save_games(&state.games.lock().unwrap())
            .unwrap();
        std::fs::create_dir(state.store.games_path().with_extension("json.tmp")).unwrap();
        assert!(save_cover_framing_record(
            &state,
            "a",
            CoverFraming {
                file: "a.jpg".into(),
                position_x: 0.0,
                position_y: 100.0,
                zoom: 3.0
            }
        )
        .is_err());
        assert!(state.games.lock().unwrap()[0].cover_framing.is_none());
        assert!(state.store.load_games()[0].cover_framing.is_none());
    }

    #[test]
    fn background_targets_are_independent_and_failures_preserve_saved_images() {
        let temp = tempfile::tempdir().unwrap();
        let state = state(temp.path().join("library"), vec![]);
        state.store.ensure_dirs().unwrap();
        let src = temp.path().join("image.png");
        std::fs::write(&src, b"image contents").unwrap();
        let src = src.to_str().unwrap();
        let main = import_background_record(&state, src, None).unwrap();
        let sidebar = import_background_record(&state, src, Some("sidebar")).unwrap();
        let dir = state.store.backgrounds_dir();
        assert!(dir.join(&main).is_file());
        assert!(dir.join(&sidebar).is_file());
        let replacement = import_background_record(&state, src, Some("sidebar")).unwrap();
        assert_ne!(replacement, sidebar);
        assert!(!dir.join(&sidebar).exists());
        assert!(dir.join(&main).is_file());
        let saved = state.store.load_settings();
        assert_eq!(saved.theme.background_file.as_deref(), Some(main.as_str()));
        assert_eq!(
            saved.theme.sidebar_background_file.as_deref(),
            Some(replacement.as_str())
        );
        assert!(import_background_record(&state, "missing.png", Some("sidebar")).is_err());
        assert!(import_background_record(&state, src, Some("invalid")).is_err());

        let blocked = state.store.settings_path().with_extension("json.tmp");
        std::fs::create_dir(&blocked).unwrap();
        assert!(import_background_record(&state, src, Some("main")).is_err());
        assert!(import_background_record(&state, src, Some("sidebar")).is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
        assert!(dir.join(&main).is_file());
        assert!(dir.join(&replacement).is_file());
        let memory = state.settings.lock().unwrap();
        assert_eq!(memory.theme.background_file, saved.theme.background_file);
        assert_eq!(
            memory.theme.sidebar_background_file,
            saved.theme.sidebar_background_file
        );
    }

    #[test]
    fn program_candidates_replace_only_requested_nonempty_fields() {
        let mut draft = game("a", "用户名称");
        draft.developer = "原公司".into();
        draft.note = "原备注".into();
        let info = crate::program::ProgramInfo {
            product: " 产品名称 ".into(),
            company: " 程序公司 ".into(),
            description: " 程序描述 ".into(),
            version: " 1.2 ".into(),
        };
        assert_eq!(
            apply_program_info(&mut draft, &info, Some(AutofillField::Developer)),
            vec!["开发商"]
        );
        assert_eq!(draft.title, "用户名称");
        assert_eq!(draft.note, "原备注");
        assert_eq!(draft.developer, "程序公司");
        assert_eq!(apply_program_info(&mut draft, &info, None).len(), 3);
        assert_eq!(draft.title, "产品名称");
        assert_eq!(draft.note, "程序描述 · v1.2");
        let empty = crate::program::ProgramInfo::default();
        assert!(apply_program_info(&mut draft, &empty, None).is_empty());
        assert_eq!(draft.title, "产品名称");
        let fallback = crate::program::ProgramInfo {
            description: "仅描述".into(),
            ..empty
        };
        apply_program_info(&mut draft, &fallback, None);
        assert_eq!(draft.title, "仅描述");
        assert_eq!(draft.note, "仅描述");
        assert_eq!(draft.developer, "程序公司");
    }

    #[test]
    fn preview_and_repeated_cover_import_preserve_saved_record_and_images() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("library"));
        store.ensure_dirs().unwrap();
        let target_dir = dir.path().join("target");
        std::fs::create_dir(&target_dir).unwrap();
        let exe = target_dir.join("game.exe");
        std::fs::write(&exe, b"program").unwrap();
        let source = target_dir.join("cover.jpg");
        std::fs::write(&source, vec![1u8; 20_000]).unwrap();
        let mut original = game("a", "原名称");
        original.exe_path = exe.to_string_lossy().to_string();
        original.cover_file = Some("a.jpg".into());
        original.icon_file = Some("a.png".into());
        std::fs::write(store.covers_dir().join("a.jpg"), b"saved cover").unwrap();
        std::fs::write(store.icons_dir().join("a.png"), b"saved icon").unwrap();
        store.save_games(&[original.clone()]).unwrap();
        let saved = std::fs::read(store.games_path()).unwrap();

        let first =
            preview_autofill(&store, original.clone(), Some(AutofillField::CoverFile)).unwrap();
        assert!(first.cover);
        assert!(!first.icon);
        assert_eq!(first.game.title, original.title);
        assert_eq!(first.game.icon_file, original.icon_file);
        assert_ne!(first.game.cover_file, original.cover_file);
        let second = store.import_cover("a", &source).unwrap();
        assert_ne!(first.game.cover_file.as_deref(), Some(second.as_str()));
        assert_eq!(std::fs::read(store.games_path()).unwrap(), saved);
        assert_eq!(
            std::fs::read(store.covers_dir().join("a.jpg")).unwrap(),
            b"saved cover"
        );
        assert_eq!(
            std::fs::read(store.icons_dir().join("a.png")).unwrap(),
            b"saved icon"
        );
        assert_eq!(
            std::fs::read(store.covers_dir().join(first.game.cover_file.unwrap())).unwrap(),
            vec![1u8; 20_000]
        );
        assert_eq!(store.load_games()[0].cover_file, original.cover_file);
    }

    #[test]
    fn preview_accepts_unsaved_draft_and_reports_missing_target_or_write_failure() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("library"));
        let mut draft = game("new", "新增草稿");
        assert!(preview_autofill(&store, draft.clone(), None)
            .unwrap_err()
            .contains("目标路径不存在"));
        let target_dir = dir.path().join("target");
        std::fs::create_dir(&target_dir).unwrap();
        draft.exe_path = target_dir.to_string_lossy().to_string();
        draft.cover_file = Some("原封面.jpg".into());
        let no_cover =
            preview_autofill(&store, draft.clone(), Some(AutofillField::CoverFile)).unwrap();
        assert!(!no_cover.cover);
        assert_eq!(no_cover.game.cover_file, draft.cover_file);
        assert!(!store.games_path().exists());
        std::fs::write(target_dir.join("cover.jpg"), vec![1u8; 20_000]).unwrap();
        store.ensure_dirs().unwrap();
        let result =
            preview_autofill(&store, draft.clone(), Some(AutofillField::CoverFile)).unwrap();
        assert!(result.cover);
        assert!(!store.games_path().exists());
        let blocked = Store::new(dir.path().join("blocked"));
        std::fs::write(&blocked.root, b"not a directory").unwrap();
        assert!(
            preview_autofill(&blocked, draft, Some(AutofillField::CoverFile))
                .unwrap_err()
                .contains("创建封面目录失败")
        );
    }

    #[test]
    fn failed_insert_does_not_change_memory_and_can_retry() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(dir.path().to_path_buf(), vec![game("a", "已有游戏")]);
        state
            .store
            .save_games(&state.games.lock().unwrap())
            .unwrap();
        let blocked = state.store.games_path().with_extension("json.tmp");
        std::fs::create_dir(&blocked).unwrap();

        assert!(save_game_record(&state, game("b", "待加入游戏")).is_err());
        assert_eq!(state.games.lock().unwrap().len(), 1);
        assert_eq!(state.store.load_games().len(), 1);

        std::fs::remove_dir(&blocked).unwrap();
        save_game_record(&state, game("b", "待加入游戏")).unwrap();
        assert_eq!(state.games.lock().unwrap().len(), 2);
        assert_eq!(state.store.load_games().len(), 2);
    }

    #[test]
    fn failed_update_preserves_original_memory_and_disk() {
        let dir = tempfile::tempdir().unwrap();
        let state = state(dir.path().to_path_buf(), vec![game("a", "原名称")]);
        state
            .store
            .save_games(&state.games.lock().unwrap())
            .unwrap();
        let blocked = state.store.games_path().with_extension("json.tmp");
        std::fs::create_dir(&blocked).unwrap();

        assert!(save_game_record(&state, game("a", "新名称")).is_err());
        assert_eq!(state.games.lock().unwrap()[0].title, "原名称");
        assert_eq!(state.store.load_games()[0].title, "原名称");
    }
}
