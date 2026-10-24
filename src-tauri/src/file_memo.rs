//! 按文件属性记忆只读计算结果，不持久化，也不代替首次完整校验。
//!
//! 对应文档：docs/后端实现.md §8.5「缓存」。
use std::collections::VecDeque;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const MAX_ENTRIES: usize = 128;

#[derive(PartialEq, Eq)]
struct Stamp {
    len: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
}

impl Stamp {
    fn read(path: &Path) -> io::Result<Self> {
        let metadata = fs::metadata(path)?;
        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified()?,
            created: metadata.created().ok(),
        })
    }
}

#[derive(Default)]
pub struct FileMemo<T> {
    entries: VecDeque<(PathBuf, Stamp, T)>,
}

impl<T: Clone> FileMemo<T> {
    /// 调用方以独立锁串行访问；读取期间变化的文件结果不写入缓存。
    pub fn get(&mut self, path: &Path, load: impl FnOnce(&Path) -> io::Result<T>) -> io::Result<T> {
        let stamp = match Stamp::read(path) {
            Ok(stamp) => stamp,
            Err(error) => {
                self.entries.retain(|entry| entry.0 != path);
                return Err(error);
            }
        };
        if let Some(index) = self.entries.iter().position(|entry| entry.0 == path) {
            let entry = self.entries.remove(index).unwrap();
            if entry.1 == stamp {
                let value = entry.2.clone();
                self.entries.push_back(entry);
                return Ok(value);
            }
        }
        let value = load(path)?;
        if Stamp::read(path).ok().as_ref() == Some(&stamp) {
            self.entries
                .push_back((path.to_owned(), stamp, value.clone()));
            if self.entries.len() > MAX_ENTRIES {
                self.entries.pop_front();
            }
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::time::Duration;

    #[test]
    fn unchanged_file_runs_expensive_computation_only_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("image.png");
        fs::write(&path, b"first").unwrap();
        let mut memo = FileMemo::<usize>::default();
        let calls = Cell::new(0);
        for _ in 0..3 {
            assert_eq!(
                memo.get(&path, |_| {
                    calls.set(calls.get() + 1);
                    Ok(5)
                })
                .unwrap(),
                5
            );
        }
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn same_length_rewrite_removal_and_recreation_invalidate_results() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cover.png");
        fs::write(&path, b"valid").unwrap();
        let mut memo = FileMemo::<Vec<u8>>::default();
        assert_eq!(memo.get(&path, |path| fs::read(path)).unwrap(), b"valid");
        fs::write(&path, b"other").unwrap();
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(100))
            .unwrap();
        assert_eq!(memo.get(&path, |path| fs::read(path)).unwrap(), b"other");
        fs::remove_file(&path).unwrap();
        assert!(memo.get(&path, |path| fs::read(path)).is_err());
        fs::write(&path, b"valid").unwrap();
        assert_eq!(memo.get(&path, |path| fs::read(path)).unwrap(), b"valid");
    }

    #[test]
    fn modification_during_read_and_errors_are_not_memoized() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("image.png");
        fs::write(&path, b"before").unwrap();
        let mut memo = FileMemo::<usize>::default();
        memo.get(&path, |path| {
            fs::write(path, b"after")?;
            Ok(6)
        })
        .unwrap();
        assert_eq!(memo.get(&path, |_| Ok(5)).unwrap(), 5);
        let missing = dir.path().join("missing");
        assert!(memo.get(&missing, |_| Ok(0)).is_err());
        fs::write(&missing, b"created").unwrap();
        assert_eq!(memo.get(&missing, |_| Ok(7)).unwrap(), 7);
    }

    #[test]
    fn least_recently_used_entries_are_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let mut memo = FileMemo::<usize>::default();
        for i in 0..MAX_ENTRIES {
            let path = dir.path().join(i.to_string());
            fs::write(&path, b"image").unwrap();
            memo.get(&path, |_| Ok(i)).unwrap();
        }
        memo.get(&dir.path().join("0"), |_| panic!("应复用最近命中"))
            .unwrap();
        let extra = dir.path().join("extra");
        fs::write(&extra, b"image").unwrap();
        memo.get(&extra, |_| Ok(999)).unwrap();
        assert_eq!(memo.entries.len(), MAX_ENTRIES);
        assert_eq!(memo.get(&dir.path().join("1"), |_| Ok(1001)).unwrap(), 1001);
    }
}
