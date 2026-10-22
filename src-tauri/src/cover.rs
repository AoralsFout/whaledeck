use std::path::{Path, PathBuf};

use windows_sys::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS,
};
use windows_sys::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];

const STRONG_NAMES: &[&str] = &[
    "cover", "header", "capsule", "poster", "banner", "artwork", "keyart", "key_art", "boxart",
    "box_art", "封面", "封面图",
];
const WEAK_NAMES: &[&str] = &["logo", "icon", "title", "tile"];
const BAD_NAMES: &[&str] = &["screenshot", "screen", "thumb", "preview", "capture"];

fn ext_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
}

fn is_image(path: &Path) -> bool {
    ext_of(path)
        .map(|e| IMAGE_EXTS.contains(&e.as_str()))
        .unwrap_or(false)
}

fn stem_lower(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

/// 按文件名判断这张图「有多像封面」。
pub fn name_score(path: &Path) -> i32 {
    let stem = stem_lower(path);
    let mut score = 0i32;
    for (index, name) in STRONG_NAMES.iter().enumerate() {
        if stem == *name {
            score = score.max(100 - index as i32);
        } else if stem.contains(name) {
            score = score.max(60 - index as i32);
        }
    }
    for (index, name) in WEAK_NAMES.iter().enumerate() {
        if stem == *name {
            score = score.max(40 - index as i32);
        } else if stem.contains(name) {
            score = score.max(25 - index as i32);
        }
    }
    for name in BAD_NAMES {
        if stem.contains(name) {
            score -= 25;
        }
    }
    score
}

fn push_image_subdirs(dirs: &mut Vec<(PathBuf, u32)>, base: &Path, depth: u32) {
    for sub in ["images", "img", "art", "artwork", "cover", "covers"] {
        let dir = base.join(sub);
        if dir.is_dir() {
            dirs.push((dir, depth));
        }
    }
}

/// 常见的中间目录：游戏本体可能藏在 bin/x64 之类的位置。
fn is_middle_dir(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "bin" | "x64" | "win64" | "x86" | "win32" | "game" | "games" | "build"
    )
}

/// 在游戏目录附近找一张最像封面的图片（不联网）。
pub fn find_local_cover(target: &str) -> Option<PathBuf> {
    let path = Path::new(target);
    let base = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()?.to_path_buf()
    };

    let mut dirs: Vec<(PathBuf, u32)> = vec![(base.clone(), 0)];
    push_image_subdirs(&mut dirs, &base, 1);

    // 只有当前目录像 bin/x64 这种中间目录时，才向上找游戏根目录，
    // 避免把父目录（比如系统临时目录）里的无关图片当成封面。
    if base
        .file_name()
        .and_then(|n| n.to_str())
        .map(is_middle_dir)
        .unwrap_or(false)
    {
        if let Some(parent) = base.parent() {
            dirs.push((parent.to_path_buf(), 2));
            push_image_subdirs(&mut dirs, parent, 3);
            if let Some(grand) = parent.parent() {
                dirs.push((grand.to_path_buf(), 3));
                push_image_subdirs(&mut dirs, grand, 4);
            }
        }
    }

    let mut best: Option<(i32, PathBuf)> = None;
    for (dir, depth) in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let file = entry.path();
            if !file.is_file() || !is_image(&file) {
                continue;
            }
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if size < 10 * 1024 {
                // 太小的图基本是小图标/缩略图，不像封面
                continue;
            }
            let mut score = name_score(&file) * 10 - depth as i32 * 5;
            if size > 200 * 1024 {
                score += 20;
            }
            if score <= 0 {
                continue;
            }
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, file));
            }
        }
    }
    best.map(|(_, path)| path)
}

fn to_wide(text: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(text)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

unsafe fn hicon_to_rgba(hicon: windows_sys::Win32::UI::WindowsAndMessaging::HICON) -> Result<(Vec<u8>, u32, u32), String> {
    let mut info: ICONINFO = std::mem::zeroed();
    if GetIconInfo(hicon, &mut info) == 0 {
        return Err("读取图标信息失败".into());
    }

    let mut bitmap: BITMAP = std::mem::zeroed();
    let got = GetObjectW(
        info.hbmColor as *mut _,
        std::mem::size_of::<BITMAP>() as i32,
        &mut bitmap as *mut _ as *mut _,
    );
    if got == 0 {
        DeleteObject(info.hbmColor as *mut _);
        DeleteObject(info.hbmMask as *mut _);
        return Err("读取图标位图失败".into());
    }

    let width = bitmap.bmWidth.max(1) as u32;
    let height = bitmap.bmHeight.max(1) as u32;

    let mut binfo: BITMAPINFO = std::mem::zeroed();
    binfo.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    binfo.bmiHeader.biWidth = width as i32;
    binfo.bmiHeader.biHeight = -(height as i32);
    binfo.bmiHeader.biPlanes = 1;
    binfo.bmiHeader.biBitCount = 32;
    binfo.bmiHeader.biCompression = BI_RGB;
    binfo.bmiHeader.biSizeImage = width * height * 4;

    let mut buffer = vec![0u8; (width * height * 4) as usize];
    let dc = GetDC(std::ptr::null_mut());
    let lines = GetDIBits(
        dc,
        info.hbmColor,
        0,
        height,
        buffer.as_mut_ptr() as *mut _,
        &mut binfo,
        DIB_RGB_COLORS,
    );
    ReleaseDC(std::ptr::null_mut(), dc);
    DeleteObject(info.hbmColor as *mut _);
    DeleteObject(info.hbmMask as *mut _);

    if lines == 0 {
        return Err("提取图标像素失败".into());
    }

    // GetDIBits 给的是 BGRA，转成 RGBA
    for pixel in buffer.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    // 部分老图标没有 alpha 通道，补成不透明
    if buffer.chunks_exact(4).all(|p| p[3] == 0) {
        for pixel in buffer.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
    }

    Ok((buffer, width, height))
}

/// 用 Windows Shell 取任意文件/文件夹的图标，转成 PNG 字节。
pub fn shell_icon_png(target: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let wide = to_wide(target);
    let mut info: SHFILEINFOW = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        SHGetFileInfoW(
            wide.as_ptr(),
            0,
            &mut info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if ok == 0 || info.hIcon.is_null() {
        return Err("系统没有为这个目标提供图标".into());
    }
    let rgba = unsafe { hicon_to_rgba(info.hIcon) };
    unsafe {
        DestroyIcon(info.hIcon);
    }
    rgba
}

pub fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("PNG 编码失败：{e}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| format!("PNG 编码失败：{e}"))?;
    }
    Ok(out)
}

/// 提取目标图标并返回 PNG 字节。
///
/// v0.5 起不再用于自动封面（用户不希望封面回退成 exe 图标），
/// 保留为可选能力，供以后做「用图标当封面」开关。
#[allow(dead_code)]
pub fn icon_png(target: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let (rgba, width, height) = shell_icon_png(target)?;
    let png = encode_png(&rgba, width, height)?;
    Ok((png, width, height))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn prefers_cover_names() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("logo.png"), vec![0u8; 30_000]).unwrap();
        fs::write(root.join("cover.jpg"), vec![0u8; 30_000]).unwrap();
        fs::write(root.join("screenshot01.png"), vec![0u8; 30_000]).unwrap();

        let found = find_local_cover(&root.to_string_lossy()).unwrap();
        assert_eq!(found.file_name().unwrap(), "cover.jpg");
    }

    #[test]
    fn finds_cover_in_images_subdir() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("images")).unwrap();
        fs::write(root.join("game.exe"), vec![0u8; 10]).unwrap();
        fs::write(root.join("images").join("header.png"), vec![0u8; 30_000]).unwrap();

        let found = find_local_cover(&root.join("game.exe").to_string_lossy()).unwrap();
        assert_eq!(found.file_name().unwrap(), "header.png");
    }

    #[test]
    fn ignores_tiny_images_and_non_images() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("cover.png"), vec![0u8; 1024]).unwrap();
        fs::write(dir.path().join("readme.txt"), b"hello").unwrap();
        assert!(find_local_cover(&dir.path().to_string_lossy()).is_none());
    }

    #[test]
    fn icon_extraction_works_for_system_executable() {
        let result = icon_png("C:\\Windows\\System32\\notepad.exe");
        // 个别精简系统可能没有记事本，允许失败但不 panic
        if let Ok((png, w, h)) = result {
            assert!(w > 0 && h > 0);
            assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        }
    }

    #[test]
    fn icon_extraction_rejects_missing_path() {
        assert!(icon_png("C:\\definitely\\missing\\nope.exe").is_err());
    }
}
