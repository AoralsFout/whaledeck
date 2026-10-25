//! 序列化模型：与前端 camelCase 对齐的实体与传输结构。
//!
//! 新增字段必须带 `#[serde(default)]` 以兼容旧数据；字段语义见 docs/数据模型.md。
//! 对应文档：docs/数据模型.md「实体」。
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
    pub cover_framing: Option<CoverFraming>,
    /// 程序图标（小的，用于列表缩略图），与封面分开存。
    #[serde(default)]
    pub icon_file: Option<String>,
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
    /// 元数据来源（bangumi / vndb / ymgal），空表示手动填写。
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_id: String,
    #[serde(default)]
    pub developer: String,
    #[serde(default)]
    pub release_date: String,
    #[serde(default)]
    pub summary: String,
}

/// 绑定原封面文件的显示参数；更换封面后旧取景不会误用于新图。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverFraming {
    pub file: String,
    pub position_x: f64,
    pub position_y: f64,
    pub zoom: f64,
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
    #[serde(default = "default_sidebar_auto_hide")]
    pub sidebar_auto_hide: bool,
    #[serde(default)]
    pub sidebar_glass: bool,
    #[serde(default = "default_sidebar_blur")]
    pub sidebar_blur: u8,
    #[serde(default)]
    pub sidebar_clear_glass: bool,
    #[serde(default)]
    pub sidebar_background_file: Option<String>,
    #[serde(default = "default_sidebar_transparency")]
    pub sidebar_transparency: f32,
    #[serde(default)]
    pub sidebar_background_fit: SidebarBackgroundFit,
    #[serde(default)]
    pub detail_background_transition: DetailBackgroundTransition,
    #[serde(default)]
    pub detail_text_transition: DetailTextTransition,
}

/// 未知动效回退默认方案，防止未来版本的偏好导致整份设置失效。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DetailBackgroundTransition {
    None,
    Crossfade,
    SlideRight,
    SlideLeft,
    SlideDown,
    SlideUp,
    #[default]
    #[serde(other)]
    Blur,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DetailTextTransition {
    None,
    Stagger,
    Scramble,
    #[default]
    #[serde(other)]
    Fade,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundFitMode {
    #[default]
    Contain,
    Cover,
    Stretch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SidebarBackgroundFit {
    // 保留历史字段；前端始终适配，新配置与缺省配置均开启。
    pub enabled: bool,
    pub mode: BackgroundFitMode,
    pub position_x: u8,
    pub position_y: u8,
}

impl Default for SidebarBackgroundFit {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: BackgroundFitMode::Contain,
            position_x: 50,
            position_y: 50,
        }
    }
}

fn default_sidebar_transparency() -> f32 {
    0.52
}

fn default_sidebar_blur() -> u8 {
    24
}

fn default_sidebar_auto_hide() -> bool {
    true
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
            sidebar_auto_hide: default_sidebar_auto_hide(),
            sidebar_glass: false,
            sidebar_blur: default_sidebar_blur(),
            sidebar_clear_glass: false,
            sidebar_background_file: None,
            sidebar_transparency: default_sidebar_transparency(),
            sidebar_background_fit: SidebarBackgroundFit::default(),
            detail_background_transition: DetailBackgroundTransition::default(),
            detail_text_transition: DetailTextTransition::default(),
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
    #[serde(default)]
    pub close_behavior: Option<CloseBehavior>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseBehavior {
    Exit,
    Hide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseRequestKind {
    Choose,
    ConfirmExit,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseRequest {
    pub kind: CloseRequestKind,
    pub running_count: usize,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseAction {
    Hide,
    Exit,
    Cancel,
    ConfirmExit,
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
            close_behavior: None,
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

/// 一个元数据搜索结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaItem {
    pub source: String,
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub release_date: String,
    #[serde(default)]
    pub developer: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub rating: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoppedPayload {
    pub game_id: String,
    pub session_sec: u64,
    pub playtime_sec: u64,
}

/// 当前 Unix 毫秒；系统时间异常时返回 0，调用方需容忍该退化值。
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidebar_blur_preserves_legacy_settings_and_saved_preference() {
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy["theme"]
            .as_object_mut()
            .unwrap()
            .remove("sidebarBlur");
        legacy["categories"] = serde_json::json!(["保留分类"]);
        let restored: Settings = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(restored.theme.sidebar_blur, 24);
        assert_eq!(restored.categories, vec!["保留分类"]);
        for blur in [0, 24, 48] {
            legacy["theme"]["sidebarBlur"] = serde_json::json!(blur);
            legacy["theme"]["sidebarGlass"] = serde_json::json!(false);
            let restored: Settings = serde_json::from_value(legacy.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(restored).unwrap()["theme"]["sidebarBlur"],
                blur
            );
        }
    }

    #[test]
    fn transition_preferences_accept_legacy_unknown_and_every_choice() {
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy["theme"]
            .as_object_mut()
            .unwrap()
            .remove("detailBackgroundTransition");
        legacy["theme"]
            .as_object_mut()
            .unwrap()
            .remove("detailTextTransition");
        legacy["categories"] = serde_json::json!(["保留分类"]);
        let restored: Settings = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(
            restored.theme.detail_background_transition,
            DetailBackgroundTransition::Blur
        );
        assert_eq!(
            restored.theme.detail_text_transition,
            DetailTextTransition::Fade
        );
        for background in [
            "none",
            "blur",
            "crossfade",
            "slideRight",
            "slideLeft",
            "slideDown",
            "slideUp",
        ] {
            for text in ["none", "fade", "stagger", "scramble"] {
                legacy["theme"]["detailBackgroundTransition"] = serde_json::json!(background);
                legacy["theme"]["detailTextTransition"] = serde_json::json!(text);
                let restored: Settings = serde_json::from_value(legacy.clone()).unwrap();
                let saved = serde_json::to_value(restored).unwrap();
                assert_eq!(saved["theme"]["detailBackgroundTransition"], background);
                assert_eq!(saved["theme"]["detailTextTransition"], text);
            }
        }
        legacy["theme"]["detailBackgroundTransition"] = serde_json::json!("futureBackground");
        legacy["theme"]["detailTextTransition"] = serde_json::json!("futureText");
        let restored: Settings = serde_json::from_value(legacy).unwrap();
        assert_eq!(
            restored.theme.detail_background_transition,
            DetailBackgroundTransition::Blur
        );
        assert_eq!(
            restored.theme.detail_text_transition,
            DetailTextTransition::Fade
        );
        assert_eq!(restored.categories, vec!["保留分类"]);
    }
}
