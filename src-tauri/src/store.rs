use crate::models::{now_ms, Game, Session, Settings};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const BACKUP_KEEP: usize = 5;

/// 数据仓库：负责 JSON 读写、原子写入与备份回退。
pub struct Store {
    pub root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn data_dir(&self) -> PathBuf {
        self.root.join("data")
    }

    pub fn backup_dir(&self) -> PathBuf {
        self.data_dir().join("backup")
    }

    pub fn covers_dir(&self) -> PathBuf {
        self.root.join("covers")
    }

    pub fn icons_dir(&self) -> PathBuf {
        self.root.join("icons")
    }

    pub fn backgrounds_dir(&self) -> PathBuf {
        self.root.join("backgrounds")
    }

    /// 每个游戏的存档备份：backups/<gameId>/
    pub fn game_backups_dir(&self, game_id: &str) -> PathBuf {
        self.root.join("backups").join(game_id)
    }

    pub fn games_path(&self) -> PathBuf {
        self.data_dir().join("games.json")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir().join("settings.json")
    }

    pub fn pending_path(&self) -> PathBuf {
        self.data_dir().join("pending_session.json")
    }

    pub fn ensure_dirs(&self) -> Result<(), String> {
        for dir in [
            self.data_dir(),
            self.backup_dir(),
            self.covers_dir(),
            self.icons_dir(),
            self.backgrounds_dir(),
        ] {
            fs::create_dir_all(&dir)
                .map_err(|e| format!("创建目录失败 {}：{e}", dir.display()))?;
        }
        Ok(())
    }

    /// 读取游戏库；主文件损坏时自动回退到最近一份备份。
    pub fn load_games(&self) -> Vec<Game> {
        let primary = self.games_path();
        if let Some(games) = self.read_games_file(&primary) {
            return games;
        }
        if primary.exists() {
            // 主文件存在但解析失败：保留现场便于排查
            let broken = primary.with_file_name(format!(
                "games.corrupt.{}",
                now_ms()
            ));
            let _ = fs::rename(&primary, &broken);
        }
        if let Some(latest) = self.latest_backup() {
            if let Some(games) = self.read_games_file(&latest) {
                return games;
            }
        }
        Vec::new()
    }

    fn read_games_file(&self, path: &Path) -> Option<Vec<Game>> {
        let text = fs::read_to_string(path).ok()?;
        let value: serde_json::Value = serde_json::from_str(&text).ok()?;
        // 兼容两种形态：裸数组，或 { schemaVersion, games }
        let arr = if value.is_array() {
            value
        } else {
            value.get("games")?.clone()
        };
        serde_json::from_value::<Vec<Game>>(arr).ok()
    }

    pub fn save_games(&self, games: &[Game]) -> Result<(), String> {
        self.ensure_dirs()?;
        let path = self.games_path();
        if path.exists() {
            let _ = self.backup(&path);
        }
        let payload = serde_json::json!({
            "schemaVersion": crate::models::SCHEMA_VERSION,
            "games": games,
        });
        let json = serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?;
        atomic_write(&path, &json)
    }

    pub fn load_settings(&self) -> Settings {
        fs::read_to_string(self.settings_path())
            .ok()
            .and_then(|t| serde_json::from_str::<Settings>(&t).ok())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        self.ensure_dirs()?;
        let path = self.settings_path();
        if path.exists() {
            let _ = self.backup(&path);
        }
        let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
        atomic_write(&path, &bytes)
    }

    pub fn write_pending(&self, session: &Session) -> Result<(), String> {
        self.ensure_dirs()?;
        let bytes = serde_json::to_vec_pretty(session).map_err(|e| e.to_string())?;
        atomic_write(&self.pending_path(), &bytes)
    }

    pub fn read_pending(&self) -> Option<Session> {
        let text = fs::read_to_string(self.pending_path()).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn clear_pending(&self) {
        let _ = fs::remove_file(self.pending_path());
    }

    fn backup(&self, path: &Path) -> Result<(), String> {
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("data");
        let dest = self.backup_dir().join(format!("{stem}.{}.json", now_ms()));
        fs::copy(path, &dest).map_err(|e| e.to_string())?;
        self.prune_backups(stem, BACKUP_KEEP);
        Ok(())
    }

    fn prune_backups(&self, stem: &str, keep: usize) {
        let mut backups = self.list_backups_for(stem);
        while backups.len() > keep {
            if let Some(old) = backups.first() {
                let _ = fs::remove_file(old);
                backups.remove(0);
            } else {
                break;
            }
        }
    }

    fn list_backups_for(&self, stem: &str) -> Vec<PathBuf> {
        let prefix = format!("{stem}.");
        let mut files: Vec<(u64, PathBuf)> = fs::read_dir(self.backup_dir())
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                let name = path.file_name()?.to_str()?.to_string();
                if !name.starts_with(&prefix) || !name.ends_with(".json") {
                    return None;
                }
                let ts = name
                    .trim_start_matches(&prefix)
                    .trim_end_matches(".json")
                    .parse::<u64>()
                    .unwrap_or(0);
                Some((ts, path))
            })
            .collect();
        files.sort_by_key(|(ts, _)| *ts);
        files.into_iter().map(|(_, p)| p).collect()
    }

    fn latest_backup(&self) -> Option<PathBuf> {
        let mut all = Vec::new();
        if let Ok(entries) = fs::read_dir(self.backup_dir()) {
            for entry in entries.flatten() {
                let path = entry.path();
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    all.push((modified, path));
                }
            }
        }
        all.sort_by_key(|(m, _)| *m);
        all.pop().map(|(_, p)| p)
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_file_name(format!(
        "{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("data.json")
    ));
    {
        let mut file = fs::File::create(&tmp)
            .map_err(|e| format!("创建临时文件失败 {}：{e}", tmp.display()))?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_game(id: &str, title: &str) -> Game {
        Game {
            id: id.into(),
            title: title.into(),
            exe_path: "C:\\Games\\a.exe".into(),
            work_dir: "C:\\Games".into(),
            args: String::new(),
            extra_process_names: vec![],
            cover_file: None,
            icon_file: None,
            category: "动作".into(),
            tags: vec!["测试".into()],
            note: String::new(),
            favorite: false,
            hidden: false,
            playtime_sec: 42,
            last_played_at: None,
            added_at: 1,
            save_paths: vec![],
            source: String::new(),
            source_id: String::new(),
            developer: String::new(),
            release_date: String::new(),
            summary: String::new(),
        }
    }

    #[test]
    fn saves_and_loads_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.ensure_dirs().unwrap();
        let games = vec![sample_game("1", "星露谷"), sample_game("2", "泰拉瑞亚")];
        store.save_games(&games).unwrap();
        let loaded = store.load_games();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].title, "星露谷");
        assert_eq!(loaded[1].playtime_sec, 42);
    }

    #[test]
    fn creates_backup_on_second_save() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.ensure_dirs().unwrap();
        store.save_games(&[sample_game("1", "A")]).unwrap();
        store.save_games(&[sample_game("1", "B")]).unwrap();
        let backups = store.list_backups_for("games");
        assert_eq!(backups.len(), 1);
        let text = fs::read_to_string(&backups[0]).unwrap();
        assert!(text.contains("\"A\""));
    }

    #[test]
    fn falls_back_to_backup_when_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.ensure_dirs().unwrap();
        store.save_games(&[sample_game("1", "A")]).unwrap();
        store.save_games(&[sample_game("1", "B")]).unwrap();
        fs::write(store.games_path(), b"{ not json").unwrap();
        let loaded = store.load_games();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "A");
        assert!(!store.games_path().exists());
    }

    #[test]
    fn keeps_only_five_backups() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.ensure_dirs().unwrap();
        for i in 0..9 {
            store
                .save_games(&[sample_game("1", &format!("v{i}"))])
                .unwrap();
        }
        assert!(store.list_backups_for("games").len() <= BACKUP_KEEP);
    }

    #[test]
    fn settings_default_and_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.ensure_dirs().unwrap();
        let default = store.load_settings();
        assert_eq!(default.theme.preset, "whale");
        assert_eq!(default.sort, "recent");

        let mut s = default.clone();
        s.theme.primary = "#ff0000".into();
        s.categories = vec!["独立".into()];
        store.save_settings(&s).unwrap();
        let loaded = store.load_settings();
        assert_eq!(loaded.theme.primary, "#ff0000");
        assert_eq!(loaded.categories, vec!["独立".to_string()]);
    }

    #[test]
    fn accepts_legacy_bare_array() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.ensure_dirs().unwrap();
        let games = vec![sample_game("1", "旧格式")];
        fs::write(store.games_path(), serde_json::to_string(&games).unwrap()).unwrap();
        assert_eq!(store.load_games()[0].title, "旧格式");
    }

    #[test]
    fn pending_session_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.ensure_dirs().unwrap();
        let s = Session {
            game_id: "g1".into(),
            pid: 1234,
            started_at: 999,
            baseline_playtime: 10,
        };
        store.write_pending(&s).unwrap();
        let back = store.read_pending().unwrap();
        assert_eq!(back.pid, 1234);
        store.clear_pending();
        assert!(store.read_pending().is_none());
    }
}
