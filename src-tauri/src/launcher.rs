use crate::models::{Game, Session};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// CREATE_NEW_PROCESS_GROUP：让游戏独立于本程序的进程组，避免一并被结束。
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// 按 Windows 习惯拆分命令行参数：支持双引号包裹的参数。
pub fn split_args(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in input.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// 这些扩展名按「进程启动」处理，可以监控与计时。
pub fn is_process_target(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    matches!(ext.as_str(), "exe" | "bat" | "cmd" | "com")
}

fn resolve_work_dir(game: &Game) -> PathBuf {
    if game.work_dir.trim().is_empty() {
        Path::new(&game.exe_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    } else {
        PathBuf::from(game.work_dir.trim())
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 用 Windows 默认关联程序 / 资源管理器打开任意文件或文件夹。
pub fn shell_open(path: &str) -> Result<(), String> {
    let operation = wide("open");
    let file = wide(path);
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result as isize) <= 32 {
        Err(format!(
            "系统无法打开：{path}（可能没有关联程序，或文件已被移动）"
        ))
    } else {
        Ok(())
    }
}

/// 启动库里的目标：
/// - 文件夹 / 非可执行文件 → Shell 打开，返回 None（不参与计时）
/// - exe / bat / cmd / com → 子进程启动，返回 Some(pid)
pub fn spawn_entry(game: &Game) -> Result<Option<u32>, String> {
    let target = Path::new(&game.exe_path);
    if !target.exists() {
        return Err(format!("路径不存在：{}", game.exe_path));
    }

    if target.is_dir() {
        return shell_open(&game.exe_path).map(|_| None);
    }

    if !is_process_target(&game.exe_path) {
        return shell_open(&game.exe_path).map(|_| None);
    }

    let work_dir = resolve_work_dir(game);
    if !work_dir.is_dir() {
        return Err(format!("工作目录不存在：{}", work_dir.display()));
    }

    let mut cmd = Command::new(target);
    cmd.current_dir(&work_dir);
    for arg in split_args(&game.args) {
        cmd.arg(arg);
    }
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);

    match cmd.spawn() {
        Ok(child) => Ok(Some(child.id())),
        Err(err) => Err(format!(
            "启动失败（{}）：{err}。可能是文件损坏、缺少运行库或权限不足。",
            target.display()
        )),
    }
}

/// 判断游戏是否仍在运行：PID 存活、exe 路径匹配、或进程名（含额外进程名）匹配。
pub fn is_running(session: &Session, game: &Game) -> bool {
    use sysinfo::{Pid, ProcessesToUpdate, System};

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    if sys.process(Pid::from_u32(session.pid)).is_some() {
        return true;
    }

    let target_exe = game.exe_path.to_lowercase();
    let exe_name = Path::new(&game.exe_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let extras: Vec<String> = game
        .extra_process_names
        .iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    for proc_info in sys.processes().values() {
        if let Some(path) = proc_info.exe() {
            if path.to_string_lossy().to_lowercase() == target_exe {
                return true;
            }
        }
        let name = proc_info.name().to_string_lossy().to_lowercase();
        if !exe_name.is_empty() && name == exe_name {
            return true;
        }
        if extras.iter().any(|e| *e == name) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_plain_args() {
        assert_eq!(split_args("--windowed -dx11"), vec!["--windowed", "-dx11"]);
    }

    #[test]
    fn splits_quoted_args() {
        assert_eq!(
            split_args("-path \"C:\\My Games\\save\" -fullscreen"),
            vec!["-path", "C:\\My Games\\save", "-fullscreen"]
        );
    }

    #[test]
    fn empty_args() {
        assert!(split_args("   ").is_empty());
    }

    #[test]
    fn detects_process_targets() {
        assert!(is_process_target("C:\\Games\\a.exe"));
        assert!(is_process_target("C:\\Tools\\run.BAT"));
        assert!(is_process_target("C:\\Tools\\x.cmd"));
        assert!(!is_process_target("C:\\Docs\\note.pdf"));
        assert!(!is_process_target("C:\\Games\\readme"));
    }

    #[test]
    fn missing_target_errors() {
        let game = Game {
            id: "x".into(),
            title: "t".into(),
            exe_path: "C:\\definitely\\missing\\file.exe".into(),
            work_dir: String::new(),
            args: String::new(),
            extra_process_names: vec![],
            cover_file: None,
            category: String::new(),
            tags: vec![],
            note: String::new(),
            favorite: false,
            hidden: false,
            playtime_sec: 0,
            last_played_at: None,
            added_at: 0,
            save_paths: vec![],
        };
        assert!(spawn_entry(&game).is_err());
    }
}
