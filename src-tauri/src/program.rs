use std::collections::HashMap;

use windows_sys::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};

fn to_wide(text: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(text)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[derive(Debug, Clone, Default)]
pub struct ProgramInfo {
    pub product: String,
    pub description: String,
    pub company: String,
    pub version: String,
}

impl ProgramInfo {
    pub fn is_empty(&self) -> bool {
        self.product.is_empty()
            && self.description.is_empty()
            && self.company.is_empty()
            && self.version.is_empty()
    }
}

fn query_string(
    block: &[u8],
    language: u16,
    codepage: u16,
    key: &str,
) -> Option<String> {
    let sub = to_wide(&format!(
        "\\StringFileInfo\\{language:04x}{codepage:04x}\\{key}"
    ));
    let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
    let mut len: u32 = 0;
    let ok = unsafe {
        VerQueryValueW(
            block.as_ptr() as *const _,
            sub.as_ptr(),
            &mut ptr,
            &mut len,
        )
    };
    if ok == 0 || ptr.is_null() || len == 0 {
        return None;
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr as *const u16, len as usize) };
    let text = String::from_utf16_lossy(slice)
        .trim_end_matches('\0')
        .trim()
        .to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// 读取 exe 的版本资源（产品名、描述、公司、版本号）。
pub fn read_version_info(path: &str) -> Result<ProgramInfo, String> {
    let wide = to_wide(path);
    let size = unsafe { GetFileVersionInfoSizeW(wide.as_ptr(), std::ptr::null_mut()) };
    if size == 0 {
        return Err("这个程序没有可读取的版本信息".into());
    }

    let mut block = vec![0u8; size as usize];
    let ok = unsafe {
        GetFileVersionInfoW(wide.as_ptr(), 0, size, block.as_mut_ptr() as *mut _)
    };
    if ok == 0 {
        return Err("读取版本信息失败".into());
    }

    // 先尝试从 Translation 表拿语言/代码页，失败则用常见组合兜底
    let mut combos: Vec<(u16, u16)> = Vec::new();
    let sub = to_wide("\\VarFileInfo\\Translation");
    let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
    let mut len: u32 = 0;
    let found = unsafe {
        VerQueryValueW(
            block.as_ptr() as *const _,
            sub.as_ptr(),
            &mut ptr,
            &mut len,
        )
    };
    if found != 0 && !ptr.is_null() && len >= 4 {
        let data = unsafe { std::slice::from_raw_parts(ptr as *const u16, 2) };
        combos.push((data[0], data[1]));
    }
    combos.extend([
        (0x0804, 0x04B0), // 简体中文, Unicode
        (0x0409, 0x04B0), // 英文, Unicode
        (0x0409, 0x04E4), // 英文, Windows 1252
        (0x0804, 0x03A8), // 简体中文, GBK
    ]);
    combos.dedup();

    let keys = [
        "ProductName",
        "FileDescription",
        "CompanyName",
        "FileVersion",
    ];
    let mut map: HashMap<&str, String> = HashMap::new();
    for (lang, cp) in combos {
        for key in keys {
            if map.contains_key(key) {
                continue;
            }
            if let Some(value) = query_string(&block, lang, cp, key) {
                map.insert(key, value);
            }
        }
        if map.len() == keys.len() {
            break;
        }
    }

    Ok(ProgramInfo {
        product: map.remove("ProductName").unwrap_or_default(),
        description: map.remove("FileDescription").unwrap_or_default(),
        company: map.remove("CompanyName").unwrap_or_default(),
        version: map.remove("FileVersion").unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_version_info_from_system_exe() {
        // 系统记事本通常带版本资源；精简系统可能没有，失败不 panic
        if let Ok(info) = read_version_info("C:\\Windows\\System32\\notepad.exe") {
            assert!(
                !info.is_empty(),
                "记事本的版本信息不应全为空"
            );
        }
    }

    #[test]
    fn missing_file_errors() {
        assert!(read_version_info("C:\\definitely\\missing\\nope.exe").is_err());
    }
}
