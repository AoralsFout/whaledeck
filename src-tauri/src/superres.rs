//! 封面超分：按任务启动独立的 ncnn 辅助进程，结束即退出。
//!
//! 效率与质量档共享调度和取消流程，各自加载随包分发的模型。
//! 对应文档：docs/调研/封面超分方案.md、docs/后端实现.md「封面」。
//!
//! 设计约束（来自方案）：
//! - 进程只在处理期间存活，成功、失败、取消或应用退出都不留下工作进程；
//! - 原图与派生图分离，派生图写入独立的 `superres/` 目录；
//! - 缓存键包含原图内容哈希 + 预设 + 模型参数，原图换了就不会命中旧结果；
//! - 先写临时文件，成功后原子发布，避免读到半张图；
//! - 首版串行处理，一次只跑一个任务。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::file_memo::FileMemo;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// UI 预设与缓存版本分离，升级模型或缩放算法时不复用旧质量缓存。
pub const PRESET_EFFICIENT: &str = "efficient";
const EXE_NAME: &str = "realcugan-ncnn-vulkan.exe";
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Preset {
    Efficient,
    Quality,
}
impl Preset {
    fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or(PRESET_EFFICIENT) {
            "efficient" => Ok(Self::Efficient),
            "quality" => Ok(Self::Quality),
            _ => Err("未知的封面增强档位，请选择效率或质量".into()),
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::Efficient => "efficient",
            Self::Quality => "quality",
        }
    }
    fn cache_key(self) -> &'static str {
        match self {
            Self::Efficient => "efficient",
            Self::Quality => "quality-anime6b-2x-v1",
        }
    }
    fn exe(self) -> &'static str {
        match self {
            Self::Efficient => EXE_NAME,
            Self::Quality => "realesrgan-ncnn-vulkan.exe",
        }
    }
    fn models(self) -> &'static str {
        match self {
            Self::Efficient => "models-pro",
            Self::Quality => "models",
        }
    }
    fn model(self) -> &'static str {
        match self {
            Self::Efficient => "up2x-conservative",
            Self::Quality => "realesrgan-x4plus-anime",
        }
    }
    fn args(self) -> [&'static str; 8] {
        match self {
            Self::Efficient => ["-n", "-1", "-s", "2", "-m", "models-pro", "-f", "png"],
            Self::Quality => [
                "-n",
                "realesrgan-x4plus-anime",
                "-s",
                "4",
                "-m",
                "models",
                "-f",
                "png",
            ],
        }
    }
    fn validate(self, dir: &Path) -> Result<(), String> {
        if !dir.join(self.exe()).is_file() {
            return Err("找不到超分辅助程序，请确认安装包完整".into());
        }
        for ext in ["bin", "param"] {
            if !dir
                .join(self.models())
                .join(format!("{}.{}", self.model(), ext))
                .is_file()
            {
                return Err("超分模型缺失，请确认安装包完整".into());
            }
        }
        Ok(())
    }
}
const SIDECAR_SUBDIR: &str = "superres";
/// 最近一次子进程输出；排障时用户可以直接发这个文件。
const LOG_NAME: &str = "superres-last.log";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 一次任务的进度事件；没有可靠计数时只报阶段与已用时间。
#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub preset: String,
    /// processing | resizing | saving
    pub stage: String,
    #[serde(rename = "elapsedMs")]
    pub elapsed_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct DonePayload {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub preset: String,
    pub file: String,
    #[serde(rename = "elapsedMs")]
    pub elapsed_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct FailedPayload {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub preset: String,
    pub message: String,
}

/// 执行过程对外发出的信号；UI 层只消费这些，不接触子进程。
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Processing,
    Resizing,
    Saving,
    Done { file: String, elapsed: Duration },
}

/// 事件接收器；Tauri 版本写入 event emitter，测试里收集到 Vec。
pub type Sink = Arc<dyn Fn(Event) + Send + Sync>;

/// 任务结束原因；取消与失败要分开，界面提示不同。
#[derive(Debug, PartialEq)]
pub enum TaskError {
    Cancelled,
    Failed(String),
}

/// 正在运行的任务；用于拒绝并发与响应取消。
struct Slot {
    game_id: String,
    task_id: String,
    preset: Preset,
    stage: &'static str,
    started: Instant,
    cancel: Arc<AtomicBool>,
}

/// 超分调度器：同一时刻只允许一个任务。
#[derive(Default)]
pub struct SuperRes {
    inner: Arc<Mutex<Option<Slot>>>,
    stopping: AtomicBool,
    lookup: Arc<Mutex<LookupCache>>,
}

#[derive(Default)]
struct LookupCache {
    hashes: FileMemo<u64>,
    images: FileMemo<bool>,
}

impl LookupCache {
    /// 展示只定位候选文件，不做图片解码；原图哈希仍按文件属性复用。
    fn status(
        &mut self,
        cover: &Path,
        dir: &Path,
        id: &str,
        preset: Preset,
    ) -> Result<Option<String>, String> {
        let hash = self
            .hashes
            .get(cover, |path| {
                fs::read(path).map(|bytes| content_hash(&bytes))
            })
            .map_err(|e| format!("读取封面失败：{e}"))?;
        let name = cache_name(id, hash, preset.cache_key());
        let exists = fs::metadata(dir.join(&name))
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0);
        Ok(exists.then_some(name))
    }

    /// 只有生成命令需要判断是否可复用；前端已拒绝的图片直接重建。
    fn reusable(
        &mut self,
        cover: &Path,
        dir: &Path,
        id: &str,
        preset: Preset,
        force: bool,
    ) -> Result<Option<String>, String> {
        if force {
            return Ok(None);
        }
        let Some(name) = self.status(cover, dir, id, preset)? else {
            return Ok(None);
        };
        let valid = self
            .images
            .get(&dir.join(&name), |path| Ok(valid_cache(path)))
            .unwrap_or(false);
        Ok(valid.then_some(name))
    }
}

impl SuperRes {
    pub fn new() -> Self {
        Self::default()
    }

    /// 是否有任务在跑；仅供测试观察调度状态。
    #[cfg(test)]
    pub fn busy(&self) -> bool {
        self.inner.lock().map(|s| s.is_some()).unwrap_or(false)
    }

    /// 开始一个任务；已有任务在跑时返回错误。
    fn start_task(
        &self,
        game_id: &str,
        preset: Preset,
        task_id: &str,
    ) -> Result<Arc<AtomicBool>, String> {
        let mut slot = self
            .inner
            .lock()
            .map_err(|_| "任务状态不可用".to_string())?;
        if self.stopping.load(Ordering::SeqCst) {
            return Err("应用正在退出，请稍候".into());
        }
        if let Some(current) = slot.as_ref() {
            return Err(format!("「{}」的封面还在处理，请稍候", current.game_id));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *slot = Some(Slot {
            game_id: game_id.to_string(),
            task_id: task_id.into(),
            preset,
            stage: "processing",
            started: Instant::now(),
            cancel: Arc::clone(&cancel),
        });
        Ok(cancel)
    }

    #[cfg(test)]
    fn start(&self, game_id: &str) -> Result<Arc<AtomicBool>, String> {
        self.start_task(
            game_id,
            Preset::Efficient,
            &uuid::Uuid::new_v4().to_string(),
        )
    }

    #[cfg(test)]
    fn clear(&self, game_id: &str) {
        if let Some(task) = self.snapshot(game_id) {
            clear_slot(&self.inner, &task.task_id);
        }
    }

    /// 快照读取与阶段更新共享同一把锁，返回详情时无需等下一次阶段事件。
    fn snapshot(&self, game_id: &str) -> Option<ProgressPayload> {
        self.inner
            .lock()
            .ok()?
            .as_ref()
            .filter(|s| s.game_id == game_id)
            .map(|s| ProgressPayload {
                game_id: s.game_id.clone(),
                task_id: s.task_id.clone(),
                preset: s.preset.key().into(),
                stage: s.stage.into(),
                elapsed_ms: s.started.elapsed().as_millis() as u64,
            })
    }

    /// 退出必须等待辅助进程回收；工作线程不持有生命周期锁。
    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        loop {
            let running = self
                .inner
                .lock()
                .ok()
                .and_then(|s| s.as_ref().map(|slot| Arc::clone(&slot.cancel)));
            match running {
                Some(cancel) => {
                    cancel.store(true, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(25));
                }
                None => break,
            }
        }
    }

    /// 请求取消；返回是否命中当前任务。
    fn cancel(&self, game_id: &str, task_id: Option<&str>) -> bool {
        let slot = match self.inner.lock() {
            Ok(slot) => slot,
            Err(_) => return false,
        };
        match slot.as_ref() {
            Some(current)
                if current.game_id == game_id
                    && task_id.map_or(true, |id| current.task_id == id) =>
            {
                current.cancel.store(true, Ordering::SeqCst);
                true
            }
            _ => false,
        }
    }
}

/// 清掉指定任务的占用标记；只在任务确实还在跑时清空。
fn clear_slot(inner: &Mutex<Option<Slot>>, task_id: &str) {
    if let Ok(mut slot) = inner.lock() {
        if slot.as_ref().map(|s| s.task_id == task_id).unwrap_or(false) {
            *slot = None;
        }
    }
}

/// 原图内容哈希（FNV-1a 64）；只用于缓存键，不做安全用途。
pub fn content_hash(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
    hash
}

/// 派生图文件名：游戏 + 内容哈希 + 预设，原图一换就自动失效。
pub fn cache_name(game_id: &str, hash: u64, preset: &str) -> String {
    format!("{game_id}-{hash:016x}-{preset}.png")
}

/// 去掉 Windows verbatim 前缀（`\\?\`）。
///
/// Tauri 的 `resource_dir()` 会给出 `\\?\D:\...`；第三方辅助程序不认这种写法，
/// 会把它当成相对路径拼到 exe 目录后面，导致找不到模型并直接 abort。
fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// 定位随应用分发的辅助程序目录。
///
/// 优先使用打包后的资源目录，其次退回开发期的 `src-tauri/binaries/superres`。
pub fn sidecar_dir(resource_dir: Option<&Path>, preset: Preset) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = resource_dir {
        let dir = strip_verbatim(dir);
        candidates.push(dir.join("binaries").join(SIDECAR_SUBDIR));
        candidates.push(dir.join(SIDECAR_SUBDIR));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(SIDECAR_SUBDIR),
    );
    candidates
        .into_iter()
        .map(|dir| {
            if preset == Preset::Quality {
                dir.join("quality")
            } else {
                dir
            }
        })
        .find(|dir| dir.join(preset.exe()).is_file())
}

/// 真正执行一次超分：调用辅助进程、轮询、保存并发布。
///
/// 不依赖 Tauri 运行时，便于用真实进程做端到端测试。
pub fn execute(
    sink: &Sink,
    dir: &Path,
    game_id: &str,
    cover: &Path,
    sidecar: &Path,
    cancel: &AtomicBool,
    preset: Preset,
) -> Result<String, TaskError> {
    let result = execute_inner(sink, dir, game_id, cover, sidecar, cancel, preset);
    if result == Err(TaskError::Cancelled) {
        let _ = fs::remove_file(dir.join(LOG_NAME));
    }
    result
}

fn execute_inner(
    sink: &Sink,
    dir: &Path,
    game_id: &str,
    cover: &Path,
    sidecar: &Path,
    cancel: &AtomicBool,
    preset: Preset,
) -> Result<String, TaskError> {
    let started = Instant::now();
    check_cancel(cancel)?;
    sink(Event::Processing);

    let bytes = fs::read(cover).map_err(|e| TaskError::Failed(format!("读取封面失败：{e}")))?;
    let name = cache_name(game_id, content_hash(&bytes), preset.cache_key());
    fs::create_dir_all(dir).map_err(|e| TaskError::Failed(format!("创建超分目录失败：{e}")))?;
    let target = dir.join(&name);
    let tmp = target.with_extension("tmp.png");
    let resized = target.with_extension("resize.tmp.png");
    let _cleanup = TempFiles(vec![tmp.clone(), resized.clone()]);
    preset.validate(sidecar).map_err(TaskError::Failed)?;
    check_cancel(cancel)?;

    let mut command = Command::new(sidecar.join(preset.exe()));
    // 保留一份子进程输出：崩溃时没有它就只能干瞪眼（历史上就是这样）。
    let log_path = dir.join(LOG_NAME);
    let log_sink = fs::File::create(&log_path).ok().map(Stdio::from);
    command
        .arg("-i")
        .arg(cover)
        .arg("-o")
        .arg(&tmp)
        .args(preset.args())
        .current_dir(sidecar)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log_sink.unwrap_or_else(Stdio::null));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child: Child = command
        .spawn()
        .map_err(|e| TaskError::Failed(format!("启动超分程序失败：{e}")))?;
    let mut last_report = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(status)) => {
                let _ = fs::remove_file(&tmp);
                return Err(TaskError::Failed(describe_failure(
                    &log_path,
                    &format!("超分进程异常退出（{status}）"),
                )));
            }
            Ok(None) => {
                if cancel.load(Ordering::SeqCst) {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = fs::remove_file(&tmp);
                    // 取消是用户意图，不需要留排障日志。
                    let _ = fs::remove_file(&log_path);
                    return Err(TaskError::Cancelled);
                }
                // 没有可靠计数，至少每 500 ms 报一次，让界面能显示真实已用时间。
                if last_report.elapsed() >= Duration::from_millis(500) {
                    sink(Event::Processing);
                    last_report = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&tmp);
                return Err(TaskError::Failed(format!("等待超分进程失败：{e}")));
            }
        }
    }

    check_cancel(cancel)?;
    // 仅解码工具输出的 PNG，不引入额外输入格式解码链路。
    let image = image::ImageReader::open(&tmp)
        .map_err(|e| {
            TaskError::Failed(describe_failure(
                &log_path,
                &format!("读取增强图片失败：{e}"),
            ))
        })?
        .decode()
        .map_err(|e| TaskError::Failed(format!("增强图片无效：{e}")))?;
    let publish_source = if preset == Preset::Quality {
        sink(Event::Resizing);
        resize_quality(image, &resized, cancel)?;
        &resized
    } else {
        &tmp
    };
    sink(Event::Saving);
    check_cancel(cancel)?;
    let current =
        fs::read(cover).map_err(|e| TaskError::Failed(format!("重新读取封面失败：{e}")))?;
    if content_hash(&current) != content_hash(&bytes) {
        return Err(TaskError::Failed("封面已更换，请为当前封面重新生成".into()));
    }
    check_cancel(cancel)?;
    publish(publish_source, &target).map_err(TaskError::Failed)?;
    let _ = fs::remove_file(&log_path);

    sink(Event::Done {
        file: name.clone(),
        elapsed: started.elapsed(),
    });
    Ok(name)
}

struct Request {
    game_id: String,
    preset: Preset,
    task_id: String,
    force: bool,
}

/// 生成派生图；返回 `Ok(Some(name))` 表示命中缓存，`Ok(None)` 表示已开始后台任务。
fn generate(
    app: AppHandle,
    superres: &SuperRes,
    dir: PathBuf,
    cover: PathBuf,
    resource_dir: Option<PathBuf>,
    request: Request,
) -> Result<Option<String>, String> {
    let Request {
        game_id,
        preset,
        task_id,
        force,
    } = request;
    let cached = superres
        .lookup
        .lock()
        .map_err(|_| "封面缓存状态不可用".to_string())?
        .reusable(&cover, &dir, &game_id, preset, force)?;
    if let Some(name) = cached {
        return Ok(Some(name));
    }

    let sidecar = sidecar_dir(resource_dir.as_deref(), preset)
        .ok_or_else(|| "找不到超分辅助程序，请确认安装包完整".to_string())?;
    preset.validate(&sidecar)?;

    let cancel = superres.start_task(&game_id, preset, &task_id)?;
    let inner = Arc::clone(&superres.inner);

    let sink: Sink = {
        let app = app.clone();
        let game_id = game_id.clone();
        let task_id = task_id.clone();
        let inner = Arc::clone(&inner);
        Arc::new(move |event: Event| {
            let stage = match event {
                Event::Processing => "processing",
                Event::Resizing => "resizing",
                Event::Saving => "saving",
                Event::Done { .. } => return,
            };
            let progress = inner.lock().ok().and_then(|mut slot| {
                let task = slot.as_mut().filter(|task| task.task_id == task_id)?;
                task.stage = stage;
                Some(ProgressPayload {
                    game_id: game_id.clone(),
                    task_id: task_id.clone(),
                    preset: preset.key().into(),
                    stage: stage.into(),
                    elapsed_ms: task.started.elapsed().as_millis() as u64,
                })
            });
            if let Some(progress) = progress {
                let _ = app.emit("superres-progress", progress);
            }
        })
    };

    std::thread::spawn(move || {
        let started = Instant::now();
        let result = execute(&sink, &dir, &game_id, &cover, &sidecar, &cancel, preset);
        clear_slot(&inner, &task_id);
        match result {
            Ok(file) => {
                let _ = app.emit(
                    "superres-done",
                    DonePayload {
                        game_id,
                        task_id,
                        preset: preset.key().into(),
                        file,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                    },
                );
            }
            Err(error) => {
                let (event, message) = match error {
                    TaskError::Cancelled => ("superres-cancelled", "已取消".into()),
                    TaskError::Failed(message) => ("superres-failed", message),
                };
                let _ = app.emit(
                    event,
                    FailedPayload {
                        game_id,
                        task_id,
                        preset: preset.key().into(),
                        message,
                    },
                );
            }
        }
    });

    Ok(None)
}

/// 仅有效 PNG 才能作为缓存复用；空文件、截断文件不应锁死生成入口。
fn valid_cache(path: &Path) -> bool {
    image::ImageReader::open(path)
        .and_then(|reader| reader.with_guessed_format())
        .ok()
        .filter(|reader| reader.format() == Some(image::ImageFormat::Png))
        .is_some_and(|reader| reader.decode().is_ok())
}

/// 导入库可能带外部 ID；避免缓存文件名逃出派生图目录。
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("项目标识无效，请重新添加该项目".into());
    }
    Ok(())
}
fn valid_asset_name(file: &str) -> bool {
    !file.is_empty() && file != "." && file != ".." && !file.contains(['/', '\\', ':'])
}

/// 临时文件无论在哪个阶段失败都清理，不包含已发布缓存和失败日志。
struct TempFiles(Vec<PathBuf>);
impl Drop for TempFiles {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = fs::remove_file(path);
        }
    }
}
fn check_cancel(cancel: &AtomicBool) -> Result<(), TaskError> {
    if cancel.load(Ordering::SeqCst) {
        Err(TaskError::Cancelled)
    } else {
        Ok(())
    }
}
/// anime6B 原生 4×，固定缩为 2×；不让网络输出倍率冒充最终展示倍率。
fn resize_quality(
    image: image::DynamicImage,
    target: &Path,
    cancel: &AtomicBool,
) -> Result<(), TaskError> {
    let (w, h) = (image.width(), image.height());
    if w == 0 || h == 0 || w % 4 != 0 || h % 4 != 0 {
        return Err(TaskError::Failed("质量档输出尺寸异常，请重试".into()));
    }
    check_cancel(cancel)?;
    let result = image.resize_exact(w / 2, h / 2, image::imageops::FilterType::Lanczos3);
    check_cancel(cancel)?;
    result
        .save_with_format(target, image::ImageFormat::Png)
        .map_err(|e| TaskError::Failed(format!("保存质量封面失败：{e}")))?;
    check_cancel(cancel)
}

/// 从子进程日志里摘一段可展示的失败原因；没有日志时退回通用提示。
fn describe_failure(log: &Path, fallback: &str) -> String {
    let text = fs::read_to_string(log).unwrap_or_default();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    let chars: Vec<char> = trimmed.chars().collect();
    let start = chars.len().saturating_sub(300);
    format!("{fallback}：{}", chars[start..].iter().collect::<String>())
}

/// 原子发布：先在同目录写临时文件，再替换目标。
fn publish(tmp: &Path, target: &Path) -> Result<(), String> {
    fs::rename(tmp, target).map_err(|e| format!("发布结果失败：{e}"))
}

/// 删除某个游戏的全部派生图，并返回是否删掉了东西。
pub fn remove_all(dir: &Path, game_id: &str) -> Result<bool, String> {
    let prefix = format!("{game_id}-");
    let mut removed = false;
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(false),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let owned = name
            .strip_prefix(&prefix)
            .and_then(|rest| rest.split_once('-'))
            .is_some_and(|(hash, suffix)| {
                hash.len() == 16
                    && hash.bytes().all(|c| c.is_ascii_hexdigit())
                    && ["efficient", "quality-anime6b-2x-v1"].iter().any(|preset| {
                        [
                            format!("{preset}.png"),
                            format!("{preset}.tmp.png"),
                            format!("{preset}.resize.tmp.png"),
                        ]
                        .contains(&suffix.to_string())
                    })
            });
        if owned && entry.path().is_file() {
            fs::remove_file(entry.path()).map_err(|e| format!("删除派生图失败：{e}"))?;
            removed = true;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_status_returns_existing_candidate_without_decoding_it() {
        let dir = tempfile::tempdir().unwrap();
        let cover = dir.path().join("original.png");
        fs::write(&cover, b"original").unwrap();
        let name = cache_name(
            "g",
            content_hash(b"original"),
            Preset::Efficient.cache_key(),
        );
        fs::write(dir.path().join(&name), b"not a decodable PNG").unwrap();
        let mut lookup = LookupCache::default();
        assert_eq!(
            lookup
                .status(&cover, dir.path(), "g", Preset::Efficient)
                .unwrap(),
            Some(name)
        );
    }

    #[test]
    fn view_status_skips_missing_empty_and_directory_candidates() {
        let dir = tempfile::tempdir().unwrap();
        let cover = dir.path().join("original.png");
        fs::write(&cover, b"original").unwrap();
        let path = dir.path().join(cache_name(
            "g",
            content_hash(b"original"),
            Preset::Efficient.cache_key(),
        ));
        let mut lookup = LookupCache::default();
        assert_eq!(
            lookup
                .status(&cover, dir.path(), "g", Preset::Efficient)
                .unwrap(),
            None
        );
        fs::write(&path, b"").unwrap();
        assert_eq!(
            lookup
                .status(&cover, dir.path(), "g", Preset::Efficient)
                .unwrap(),
            None
        );
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(
            lookup
                .status(&cover, dir.path(), "g", Preset::Efficient)
                .unwrap(),
            None
        );
    }

    #[test]
    fn forced_generation_bypasses_even_valid_cache_and_preserves_files() {
        let dir = tempfile::tempdir().unwrap();
        let cover = dir.path().join("original.png");
        fs::write(&cover, b"original").unwrap();
        let name = cache_name(
            "g",
            content_hash(b"original"),
            Preset::Efficient.cache_key(),
        );
        let path = dir.path().join(&name);
        image::DynamicImage::new_rgb8(12, 8).save(&path).unwrap();
        let before = fs::read(&path).unwrap();
        let mut lookup = LookupCache::default();
        assert_eq!(
            lookup
                .reusable(&cover, dir.path(), "g", Preset::Efficient, false)
                .unwrap(),
            Some(name)
        );
        assert_eq!(
            lookup
                .reusable(&cover, dir.path(), "g", Preset::Efficient, true)
                .unwrap(),
            None
        );
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    #[ignore = "需指定本机原封面、派生图目录和游戏标识，仅作只读性能测量"]
    fn cached_status_timings() {
        let cover =
            PathBuf::from(std::env::var_os("WHALEDECK_BENCH_COVER").expect("设置原封面路径"));
        let dir = PathBuf::from(std::env::var_os("WHALEDECK_BENCH_DIR").expect("设置派生图目录"));
        let id = std::env::var("WHALEDECK_BENCH_ID").expect("设置游戏标识");
        for preset in [Preset::Efficient, Preset::Quality] {
            let mut lookup = LookupCache::default();
            let start = Instant::now();
            let file = lookup
                .status(&cover, &dir, &id, preset)
                .unwrap()
                .expect("需要已有增强图");
            let cold_ms = start.elapsed().as_secs_f64() * 1000.0;
            let start = Instant::now();
            for _ in 0..50 {
                assert_eq!(
                    lookup.status(&cover, &dir, &id, preset).unwrap().as_deref(),
                    Some(file.as_str())
                );
            }
            let warm_ms = start.elapsed().as_secs_f64() * 1000.0 / 50.0;
            println!(
                "{} status: cold={cold_ms:.3}ms, cached_mean={warm_ms:.3}ms (50 reads)",
                preset.key()
            );
        }
    }

    #[test]
    fn generation_reuse_rechecks_corrupt_deleted_and_replaced_files() {
        let dir = tempfile::tempdir().unwrap();
        let cover = dir.path().join("original.png");
        fs::write(&cover, b"original").unwrap();
        let name = cache_name(
            "g",
            content_hash(b"original"),
            Preset::Efficient.cache_key(),
        );
        let target = dir.path().join(&name);
        image::DynamicImage::new_rgb8(12, 8).save(&target).unwrap();
        let mut lookup = LookupCache::default();
        for _ in 0..3 {
            assert_eq!(
                lookup
                    .reusable(&cover, dir.path(), "g", Preset::Efficient, false)
                    .unwrap(),
                Some(name.clone())
            );
        }
        let len = fs::metadata(&target).unwrap().len() as usize;
        fs::write(&target, vec![0; len]).unwrap();
        fs::File::options()
            .write(true)
            .open(&target)
            .unwrap()
            .set_modified(std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(100))
            .unwrap();
        assert_eq!(
            lookup
                .reusable(&cover, dir.path(), "g", Preset::Efficient, false)
                .unwrap(),
            None
        );
        image::DynamicImage::new_rgb8(12, 8).save(&target).unwrap();
        assert_eq!(
            lookup
                .reusable(&cover, dir.path(), "g", Preset::Efficient, false)
                .unwrap(),
            Some(name)
        );
        fs::remove_file(&target).unwrap();
        assert_eq!(
            lookup
                .reusable(&cover, dir.path(), "g", Preset::Efficient, false)
                .unwrap(),
            None
        );
        fs::write(&cover, b"new original content").unwrap();
        assert_eq!(
            lookup
                .reusable(&cover, dir.path(), "g", Preset::Efficient, false)
                .unwrap(),
            None
        );
        let next = cache_name(
            "g",
            content_hash(b"new original content"),
            Preset::Efficient.cache_key(),
        );
        image::DynamicImage::new_rgb8(16, 8)
            .save(dir.path().join(&next))
            .unwrap();
        assert_eq!(
            lookup
                .reusable(&cover, dir.path(), "g", Preset::Efficient, false)
                .unwrap(),
            Some(next)
        );
    }

    #[test]
    fn snapshot_tracks_stage_and_cancel_targets_only_requested_task() {
        let sr = SuperRes::new();
        let cancel = sr.start_task("g", Preset::Quality, "first").unwrap();
        sr.inner.lock().unwrap().as_mut().unwrap().stage = "resizing";
        let snapshot = sr.snapshot("g").unwrap();
        assert_eq!(snapshot.task_id, "first");
        assert_eq!(snapshot.preset, "quality");
        assert_eq!(snapshot.stage, "resizing");
        assert!(sr.snapshot("other").is_none());
        assert!(!sr.cancel("g", Some("previous")));
        assert!(!cancel.load(Ordering::SeqCst));
        assert!(sr.cancel("g", Some("first")));
        sr.clear("g");
        let next = sr.start_task("g", Preset::Efficient, "next").unwrap();
        clear_slot(&sr.inner, "first");
        assert!(sr.busy());
        assert!(!sr.cancel("g", Some("first")));
        assert!(!next.load(Ordering::SeqCst));
    }

    #[test]
    fn corrupt_cache_is_rebuildable_and_publish_preserves_old_file_on_error() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("cache.png");
        fs::write(&target, b"corrupt").unwrap();
        assert!(!valid_cache(&target));
        let tmp = dir.path().join("new.tmp.png");
        image::DynamicImage::new_rgb8(12, 8).save(&tmp).unwrap();
        publish(&tmp, &target).unwrap();
        assert!(valid_cache(&target));
        let bytes = fs::read(&target).unwrap();
        assert!(publish(&tmp, &target).is_err());
        assert_eq!(fs::read(&target).unwrap(), bytes);
        fs::write(&target, &bytes[..bytes.len() / 2]).unwrap();
        assert!(!valid_cache(&target));
    }

    #[test]
    fn cache_cleanup_does_not_remove_another_game_with_shared_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let other = cache_name("game-1-extra", 0x1234, Preset::Quality.cache_key());
        let own = cache_name("game-1", 0x1234, Preset::Efficient.cache_key());
        fs::write(dir.path().join(&other), b"other").unwrap();
        fs::write(dir.path().join(&own), b"own").unwrap();
        assert!(remove_all(dir.path(), "game-1").unwrap());
        assert!(dir.path().join(other).exists());
        assert!(!dir.path().join(own).exists());
    }

    #[test]
    fn rejects_paths_in_game_ids_and_cover_references() {
        for id in ["", "../game", r"..\game", r"C:\game", "game/name"] {
            assert!(validate_id(id).is_err());
        }
        assert!(validate_id("game-1_uuid").is_ok());
        for file in [
            "",
            ".",
            "..",
            "../cover.png",
            r"..\cover.png",
            r"C:\cover.png",
        ] {
            assert!(!valid_asset_name(file));
        }
        assert!(valid_asset_name("封面.1.png"));
    }

    #[test]
    fn presets_validate_and_isolate_cache_versions() {
        assert_eq!(Preset::parse(None), Ok(Preset::Efficient));
        assert_eq!(Preset::parse(Some("quality")), Ok(Preset::Quality));
        assert!(Preset::parse(Some("other")).is_err());
        let hash = content_hash(b"cover");
        assert_ne!(
            cache_name("g", hash, Preset::Quality.cache_key()),
            cache_name("g", hash, Preset::Efficient.cache_key())
        );
        for preset in [Preset::Efficient, Preset::Quality] {
            preset
                .validate(&sidecar_dir(None, preset).unwrap())
                .unwrap();
        }
    }

    #[test]
    fn quality_resizes_native_4x_to_2x_and_respects_cancel() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("quality.png");
        let cancel = AtomicBool::new(false);
        let image = image::DynamicImage::new_rgb8(36, 20);
        resize_quality(image, &out, &cancel).unwrap();
        assert_eq!(image::image_dimensions(&out).unwrap(), (18, 10));
        fs::remove_file(&out).unwrap();
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(
            resize_quality(image::DynamicImage::new_rgb8(36, 20), &out, &cancel),
            Err(TaskError::Cancelled)
        );
        assert!(!out.exists());
        assert!(resize_quality(
            image::DynamicImage::new_rgb8(35, 20),
            &out,
            &AtomicBool::new(false)
        )
        .is_err());
    }

    #[test]
    fn shutdown_cancels_and_waits_for_worker_cleanup() {
        let sr = SuperRes::new();
        let cancel = sr.start("g").unwrap();
        let inner = Arc::clone(&sr.inner);
        let worker = std::thread::spawn(move || {
            while !cancel.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(5));
            }
            let task_id = inner.lock().unwrap().as_ref().unwrap().task_id.clone();
            clear_slot(&inner, &task_id);
        });
        sr.shutdown();
        worker.join().unwrap();
        assert!(!sr.busy());
        assert!(sr.start("g").is_err());
    }

    /// 两档串行真跑同一素材；可指定本机样本 PNG，默认缩小演示图以缩短测试。
    #[test]
    #[ignore = "需要 Vulkan 设备与随包分发的两档模型"]
    fn real_sidecar_both_presets_and_cancel() {
        let dir = tempfile::tempdir().unwrap();
        let cover = if let Some(path) = std::env::var_os("WHALEDECK_SR_TEST_COVER") {
            PathBuf::from(path)
        } else {
            let path = dir.path().join("input.png");
            image::open(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets/demo-cover.png"))
                .unwrap()
                .resize_exact(240, 136, image::imageops::FilterType::Lanczos3)
                .save(&path)
                .unwrap();
            path
        };
        let (w, h) = image::image_dimensions(&cover).unwrap();
        for preset in [Preset::Efficient, Preset::Quality] {
            let sidecar = sidecar_dir(None, preset).unwrap();
            let cancel = AtomicBool::new(false);
            let events = Arc::new(Mutex::new(Vec::new()));
            let sink: Sink = {
                let events = Arc::clone(&events);
                Arc::new(move |e| events.lock().unwrap().push(e))
            };
            let started = Instant::now();
            let file = execute(&sink, dir.path(), "g", &cover, &sidecar, &cancel, preset).unwrap();
            assert_eq!(
                image::image_dimensions(dir.path().join(&file)).unwrap(),
                (w * 2, h * 2)
            );
            if let Some(output) = std::env::var_os("WHALEDECK_SR_TEST_OUTPUT") {
                let output = PathBuf::from(output);
                fs::create_dir_all(&output).unwrap();
                fs::copy(
                    dir.path().join(&file),
                    output.join(format!("{}.png", preset.key())),
                )
                .unwrap();
            }
            println!("{}: {:?}, {}", preset.key(), started.elapsed(), file);
            assert_eq!(
                events.lock().unwrap().contains(&Event::Resizing),
                preset == Preset::Quality
            );
            assert!(matches!(
                events.lock().unwrap().last(),
                Some(Event::Done { .. })
            ));
            // 等到轮询进度再次到达时才取消，确保覆盖真实运行中的子进程。
            let cancel = Arc::new(AtomicBool::new(false));
            let trigger = Arc::clone(&cancel);
            let reports = std::sync::atomic::AtomicUsize::new(0);
            let sink: Sink = Arc::new(move |e| {
                if e == Event::Processing && reports.fetch_add(1, Ordering::SeqCst) > 0 {
                    trigger.store(true, Ordering::SeqCst);
                }
            });
            assert_eq!(
                execute(
                    &sink,
                    dir.path(),
                    "cancel",
                    &cover,
                    &sidecar,
                    &cancel,
                    preset
                ),
                Err(TaskError::Cancelled)
            );
            assert!(!fs::read_dir(dir.path()).unwrap().flatten().any(|e| e
                .file_name()
                .to_string_lossy()
                .contains("tmp")
                || e.file_name().to_string_lossy().starts_with("cancel-")));
        }
    }

    #[test]
    fn hash_is_stable_and_content_sensitive() {
        assert_eq!(content_hash(b"cover-a"), content_hash(b"cover-a"));
        assert_ne!(content_hash(b"cover-a"), content_hash(b"cover-b"));
    }

    #[test]
    fn cache_name_carries_game_hash_and_preset() {
        let a = cache_name("game-1", 0x1234, PRESET_EFFICIENT);
        assert_eq!(a, "game-1-0000000000001234-efficient.png");
        assert_ne!(a, cache_name("game-1", 0x1235, PRESET_EFFICIENT));
        assert_ne!(a, cache_name("game-1", 0x1234, "quality"));
    }

    #[test]
    fn remove_all_only_touches_this_game() {
        let dir = std::env::temp_dir().join(format!("whaledeck-sr-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("game-1-00000000000000aa-efficient.png"), b"x").unwrap();
        fs::write(dir.join("game-1-00000000000000bb-efficient.png"), b"x").unwrap();
        fs::write(dir.join("game-2-00000000000000aa-efficient.png"), b"x").unwrap();
        assert!(remove_all(&dir, "game-1").unwrap());
        assert!(dir.join("game-2-00000000000000aa-efficient.png").is_file());
        assert!(!remove_all(&dir, "game-1").unwrap());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sidecar_dir_finds_dev_layout() {
        let dir = sidecar_dir(None, Preset::Efficient);
        assert!(dir.is_some(), "开发期应能找到 src-tauri/binaries/superres");
        assert!(dir.unwrap().join(EXE_NAME).is_file());
    }

    #[test]
    fn busy_rejects_second_task() {
        let sr = SuperRes::new();
        let first = sr.start("a").expect("首个任务应可启动");
        assert!(sr.busy());
        assert!(sr.start("b").is_err());
        assert!(!sr.cancel("b", None), "取消不存在的任务应返回 false");
        first.store(true, Ordering::SeqCst);
        sr.clear("a");
        assert!(!sr.busy());
    }

    /// 取消后不得留下临时文件或结果文件。
    #[test]
    fn cancelled_task_leaves_no_output() {
        let dir = std::env::temp_dir().join(format!("whaledeck-sr-c-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let cover = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("assets")
            .join("demo-cover.png");
        let sidecar = sidecar_dir(None, Preset::Efficient).expect("缺少 sidecar");
        let cancel = AtomicBool::new(true); // 一开始就取消
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink: Sink = {
            let events = Arc::clone(&events);
            Arc::new(move |event| events.lock().unwrap().push(event))
        };
        let result = execute(
            &sink,
            &dir,
            "g1",
            &cover,
            &sidecar,
            &cancel,
            Preset::Efficient,
        );
        assert_eq!(result, Err(TaskError::Cancelled));
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().flatten().collect();
        assert!(leftovers.is_empty(), "取消后不应留下任何文件");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn strips_windows_verbatim_prefix() {
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\D:\a\b")),
            PathBuf::from(r"D:\a\b")
        );
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\UNC\srv\share")),
            PathBuf::from(r"\\srv\share")
        );
        assert_eq!(strip_verbatim(Path::new(r"D:\a")), PathBuf::from(r"D:\a"));
    }

    #[test]
    fn describe_failure_falls_back_when_log_missing() {
        let missing = std::env::temp_dir().join("whaledeck-no-such-log.txt");
        assert_eq!(
            describe_failure(&missing, "超分进程异常退出"),
            "超分进程异常退出"
        );
    }

    /// 真跑一次辅助进程；需要 Vulkan 设备，默认忽略，用 `--ignored` 手动执行。
    #[test]
    #[ignore = "需要 Vulkan 设备与随包分发的模型"]
    fn real_sidecar_produces_2x_image() {
        let dir = std::env::temp_dir().join(format!("whaledeck-sr-e2e-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let cover = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("assets")
            .join("demo-cover.png");
        let sidecar = sidecar_dir(None, Preset::Efficient).expect("缺少 sidecar");
        let cancel = AtomicBool::new(false);
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink: Sink = {
            let events = Arc::clone(&events);
            Arc::new(move |event| events.lock().unwrap().push(event))
        };
        let file = execute(
            &sink,
            &dir,
            "g1",
            &cover,
            &sidecar,
            &cancel,
            Preset::Efficient,
        )
        .expect("应生成增强图");
        let out = dir.join(&file);
        assert!(out.is_file());
        assert!(fs::metadata(&out).unwrap().len() > 10_000);
        let seen = events.lock().unwrap().clone();
        assert!(seen.contains(&Event::Processing));
        assert!(matches!(seen.last(), Some(Event::Done { .. })));
        fs::remove_dir_all(&dir).ok();
    }
}

// ---------- Tauri 命令 ----------

use crate::commands::AppState;
use tauri::{Manager, State};

/// 读取某项目的原封面路径；封面缺失时给出可读的错误。
fn cover_path(state: &AppState, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    let games = state
        .games
        .lock()
        .map_err(|_| "游戏库状态不可用".to_string())?;
    let game = games
        .iter()
        .find(|game| game.id == id)
        .ok_or_else(|| "找不到这个项目".to_string())?;
    let file = game
        .cover_file
        .clone()
        .ok_or_else(|| "这个项目还没有封面，先设置封面再增强".to_string())?;
    if !valid_asset_name(&file) {
        return Err("封面文件名无效，请重新设置封面".into());
    }
    let path = state.store.covers_dir().join(file);
    if !path.is_file() {
        return Err("封面文件已丢失，请重新设置封面".into());
    }
    Ok(path)
}

/// 查询已有的派生图；没有则返回 null，前端据此决定显示原图还是增强图。
#[tauri::command]
pub async fn superres_status(
    state: State<'_, AppState>,
    id: String,
    preset: Option<String>,
) -> Result<Option<String>, String> {
    validate_id(&id)?;
    let preset = Preset::parse(preset.as_deref())?;
    let cover = match cover_path(&state, &id) {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };
    let dir = state.store.superres_dir();
    let lookup = Arc::clone(&state.superres.lookup);
    // 冷查询仍需完整校验；在阻塞线程池运行，且不持有游戏库或任务锁。
    tauri::async_runtime::spawn_blocking(move || {
        lookup
            .lock()
            .map_err(|_| "封面缓存状态不可用".to_string())?
            .status(&cover, &dir, &id, preset)
    })
    .await
    .map_err(|e| format!("查询封面缓存失败：{e}"))?
}

/// 生成增强图：命中缓存直接返回文件名，否则在后台启动辅助进程并立即返回 null。
#[tauri::command]
pub fn superres_generate(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    preset: Option<String>,
    task_id: Option<String>,
    force: Option<bool>,
) -> Result<Option<String>, String> {
    let task_id = match task_id {
        Some(id) => uuid::Uuid::parse_str(&id)
            .map_err(|_| "增强任务标识无效，请重试".to_string())?
            .to_string(),
        None => uuid::Uuid::new_v4().to_string(),
    };
    let preset = Preset::parse(preset.as_deref())?;
    let cover = cover_path(&state, &id)?;
    let dir = state.store.superres_dir();
    let resource = app.path().resource_dir().ok();
    generate(
        app.clone(),
        &state.superres,
        dir,
        cover,
        resource,
        Request {
            game_id: id,
            preset,
            task_id,
            force: force.unwrap_or(false),
        },
    )
}

/// 订阅事件后读取当前任务，覆盖返回详情时错过的阶段事件。
#[tauri::command]
pub fn superres_task(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ProgressPayload>, String> {
    validate_id(&id)?;
    Ok(state.superres.snapshot(&id))
}

/// 请求取消当前任务；真正终止由工作线程执行，界面不应只关掉进度就算数。
#[tauri::command]
pub fn superres_cancel(state: State<'_, AppState>, id: String, task_id: Option<String>) -> bool {
    state.superres.cancel(&id, task_id.as_deref())
}

/// 删除该项目的全部派生图，恢复显示原图。
#[tauri::command]
pub fn superres_remove(state: State<'_, AppState>, id: String) -> Result<(), String> {
    validate_id(&id)?;
    let slot = state
        .superres
        .inner
        .lock()
        .map_err(|_| "任务状态不可用".to_string())?;
    if slot.as_ref().is_some_and(|task| task.game_id == id) {
        return Err("封面正在处理，请先取消后再删除".into());
    }
    remove_all(&state.store.superres_dir(), &id).map(|_| ())
}
