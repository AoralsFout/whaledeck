use crate::models::{now_ms, Game, SaveBackup};
use crate::store::Store;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    version: u32,
    sources: Vec<String>,
}

fn options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
}

/// 递归把目录内容写进 zip，前缀形如 `0/Saves/xxx`。
fn add_dir(
    writer: &mut ZipWriter<File>,
    dir: &Path,
    prefix: &str,
    out_count: &mut usize,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取 {} 失败：{e}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().replace('\\', "/");
        let inner = format!("{prefix}/{name}");
        if path.is_dir() {
            add_dir(writer, &path, &inner, out_count)?;
        } else if path.is_file() {
            let mut file = File::open(&path)
                .map_err(|e| format!("读取文件 {} 失败：{e}", path.display()))?;
            writer
                .start_file(inner, options())
                .map_err(|e| format!("写入压缩包失败：{e}"))?;
            std::io::copy(&mut file, writer).map_err(|e| format!("写入压缩包失败：{e}"))?;
            *out_count += 1;
        }
    }
    Ok(())
}

/// 把游戏配置的存档目录打包成 zip，返回备份信息。
pub fn backup(store: &Store, game: &Game) -> Result<SaveBackup, String> {
    let sources: Vec<String> = game
        .save_paths
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if sources.is_empty() {
        return Err("还没有设置存档目录，先在「编辑」里添加".into());
    }

    let dir = store.game_backups_dir(&game.id);
    fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败：{e}"))?;

    let created_at = now_ms();
    let file_name = format!("{created_at}.zip");
    let zip_path = dir.join(&file_name);

    let file = File::create(&zip_path).map_err(|e| format!("创建备份文件失败：{e}"))?;
    let mut writer = ZipWriter::new(file);
    let mut file_count = 0usize;

    let manifest = Manifest {
        version: 1,
        sources: sources.clone(),
    };
    writer
        .start_file("manifest.json", options())
        .map_err(|e| e.to_string())?;
    writer
        .write_all(serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?.as_slice())
        .map_err(|e| e.to_string())?;

    for (index, source) in sources.iter().enumerate() {
        let path = Path::new(source);
        if !path.is_dir() {
            let _ = fs::remove_file(&zip_path);
            return Err(format!("存档目录不存在：{source}"));
        }
        add_dir(&mut writer, path, &index.to_string(), &mut file_count)?;
    }

    writer.finish().map_err(|e| e.to_string())?;
    if file_count == 0 {
        let _ = fs::remove_file(&zip_path);
        return Err("存档目录是空的，没有可备份的文件".into());
    }

    let size = fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
    Ok(SaveBackup {
        file: file_name,
        created_at,
        size,
    })
}

/// 列出某游戏的全部备份，按时间倒序。
pub fn list(store: &Store, game_id: &str) -> Vec<SaveBackup> {
    let dir = store.game_backups_dir(game_id);
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("zip") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let Ok(created_at) = stem.parse::<u64>() else {
                continue;
            };
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(SaveBackup {
                file: path.file_name().unwrap().to_string_lossy().to_string(),
                created_at,
                size,
            });
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

fn safe_relative(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.contains("..")
        && !rel.contains(':')
        && !rel.starts_with('/')
        && !rel.starts_with('\\')
}

/// 把备份解压回备份时记录的原始目录，返回写入的文件数。
pub fn restore(store: &Store, game: &Game, file: &str) -> Result<usize, String> {
    if file.contains('/') || file.contains('\\') || file.contains("..") {
        return Err("非法的备份文件名".into());
    }
    let zip_path: PathBuf = store.game_backups_dir(&game.id).join(file);
    if !zip_path.is_file() {
        return Err("备份文件不存在".into());
    }

    let archive_file = File::open(&zip_path).map_err(|e| format!("打开备份失败：{e}"))?;
    let mut archive = ZipArchive::new(archive_file).map_err(|e| format!("读取备份失败：{e}"))?;

    let manifest: Manifest = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| "备份缺少 manifest.json，可能已损坏".to_string())?;
        let mut text = String::new();
        entry
            .read_to_string(&mut text)
            .map_err(|e| format!("读取 manifest 失败：{e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("manifest 格式错误：{e}"))?
    };

    let mut written = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取备份条目失败：{e}"))?;
        let name = entry.name().to_string();
        if name == "manifest.json" || name.ends_with('/') {
            continue;
        }
        let Some((index_str, rel)) = name.split_once('/') else {
            continue;
        };
        let Ok(source_index) = index_str.parse::<usize>() else {
            continue;
        };
        let Some(source) = manifest.sources.get(source_index) else {
            continue;
        };
        if !safe_relative(rel) {
            continue;
        }
        let dest = Path::new(source).join(rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
        let mut out = File::create(&dest)
            .map_err(|e| format!("写入 {} 失败：{e}", dest.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("写入失败：{e}"))?;
        written += 1;
    }

    if written == 0 {
        return Err("这个备份里没有可还原的文件".into());
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_game(id: &str, save_paths: Vec<String>) -> Game {
        Game {
            id: id.into(),
            title: "测试".into(),
            exe_path: "C:\\g.exe".into(),
            work_dir: String::new(),
            args: String::new(),
            extra_process_names: vec![],
            cover_file: None,
            icon_file: None,
            category: String::new(),
            tags: vec![],
            note: String::new(),
            favorite: false,
            hidden: false,
            playtime_sec: 0,
            last_played_at: None,
            added_at: 0,
            save_paths,
            source: String::new(),
            source_id: String::new(),
            developer: String::new(),
            release_date: String::new(),
            summary: String::new(),
        }
    }

    #[test]
    fn backup_and_restore_roundtrip() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().join("app"));
        store.ensure_dirs().unwrap();

        let save_dir = root.path().join("Saves");
        fs::create_dir_all(save_dir.join("slot1")).unwrap();
        fs::write(save_dir.join("slot1").join("data.sav"), b"hello").unwrap();
        fs::write(save_dir.join("config.ini"), b"cfg").unwrap();

        let game = sample_game("g1", vec![save_dir.to_string_lossy().to_string()]);
        let backup = backup(&store, &game).unwrap();
        assert!(backup.size > 0);
        assert!(store.game_backups_dir("g1").join(&backup.file).is_file());

        // 破坏存档，再还原
        fs::write(save_dir.join("slot1").join("data.sav"), b"broken").unwrap();
        fs::remove_file(save_dir.join("config.ini")).unwrap();
        let written = restore(&store, &game, &backup.file).unwrap();
        assert_eq!(written, 2);
        assert_eq!(
            fs::read_to_string(save_dir.join("slot1").join("data.sav")).unwrap(),
            "hello"
        );
        assert!(save_dir.join("config.ini").is_file());
    }

    #[test]
    fn backup_without_paths_fails() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().to_path_buf());
        store.ensure_dirs().unwrap();
        let game = sample_game("g2", vec![]);
        assert!(backup(&store, &game).is_err());
    }

    #[test]
    fn restore_rejects_traversal() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().to_path_buf());
        store.ensure_dirs().unwrap();
        let game = sample_game("g3", vec![]);
        assert!(restore(&store, &game, "../evil.zip").is_err());
    }

    #[test]
    fn list_returns_newest_first() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().join("app"));
        store.ensure_dirs().unwrap();
        let save_dir = root.path().join("S");
        fs::create_dir_all(&save_dir).unwrap();
        fs::write(save_dir.join("a.txt"), b"a").unwrap();
        let game = sample_game("g4", vec![save_dir.to_string_lossy().to_string()]);

        let first = backup(&store, &game).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = backup(&store, &game).unwrap();
        let list = list(&store, "g4");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].created_at, second.created_at);
        assert!(list.iter().any(|b| b.file == first.file));
    }
}
