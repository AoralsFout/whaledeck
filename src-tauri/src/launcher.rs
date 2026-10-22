use crate::models::{Game, Session};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

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

/// 启动游戏，返回子进程 PID。失败时返回可直接展示给用户的中文原因。
pub fn spawn_game(game: &Game) -> Result<u32, String> {
    let exe = Path::new(&game.exe_path);
    if !exe.is_file() {
        return Err(format!("找不到游戏程序：{}", game.exe_path));
    }
    let work_dir = resolve_work_dir(game);
    if !work_dir.is_dir() {
        return Err(format!("工作目录不存在：{}", work_dir.display()));
    }

    let mut cmd = Command::new(exe);
    cmd.current_dir(&work_dir);
    for arg in split_args(&game.args) {
        cmd.arg(arg);
    }
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);

    match cmd.spawn() {
        Ok(child) => Ok(child.id()),
        Err(err) => Err(format!(
            "启动失败（{}）：{err}。可能是文件损坏、缺少运行库或权限不足。",
            exe.display()
        )),
    }
}

/// 判断游戏是否仍在运行：PID 存活、exe 路径匹配、或进程名（含额外进程名）匹配。
pub fn is_running(_session: &Session, game: &Game) -> bool {
    use sysinfo::{Pid, ProcessesToUpdate, System};

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    if sys.process(Pid::from_u32(_session.pid)).is_some() {
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
}
