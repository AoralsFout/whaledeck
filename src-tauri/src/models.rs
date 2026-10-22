use serde::{Deserialize, Serialize};

/// 数据文件 schema 版本，用于将来迁移。
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub title: String,
    pub exe_path: String,
    #[serde(default)]
    pub work_dir: String,
    #[serde(default)]
    pub args: String,
    #[serde(default)]
    pub extra_process_names: Vec<String>,
    #[serde(default)]
    pub cover_file: Option<String>,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub playtime_sec: u64,
    #[serde(default)]
    pub last_played_at: Option<u64>,
    #[serde(default)]
    pub added_at: u64,
    /// 需要备份的存档目录，可以多个。
    #[serde(default)]
    pub save_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub preset: String,
    pub mode: String,
    pub primary: String,
    pub accent: String,
    pub background_file: Option<String>,
    pub background_dim: f32,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            preset: "whale".into(),
            mode: "dark".into(),
            primary: "#4fd6e8".into(),
            accent: "#ff9ec7".into(),
            background_file: None,
            background_dim: 0.55,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub theme: Theme,
    #[serde(default = "default_sort")]
    pub sort: String,
    #[serde(default)]
    pub categories: Vec<String>,
}

fn default_sort() -> String {
    "recent".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            sort: default_sort(),
            categories: Vec::new(),
        }
    }
}

/// 一次运行中的会话，同时用于 pending_session.json 的持久化。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub game_id: String,
    pub pid: u32,
    pub started_at: u64,
    pub baseline_playtime: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    /// 以进程方式启动时的 PID；用系统默认方式打开时为 None。
    pub pid: Option<u32>,
    pub started_at: u64,
}

/// 扫描目录后返回的候选程序。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
}

/// 一次存档备份的元信息。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackup {
    pub file: String,
    pub created_at: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoppedPayload {
    pub game_id: String,
    pub session_sec: u64,
    pub playtime_sec: u64,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
