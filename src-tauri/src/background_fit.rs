//! 侧栏背景：有界解码、Lanczos3 适配、透明画布与可再生成缓存。
//!
//! 不保存设置、不覆盖源图；对应 docs/后端实现.md §7.1、docs/接口契约.md §2.5.1。
use crate::{commands::AppState, models::BackgroundFitMode};
use fast_image_resize::{images::Image, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::{
    metadata::Orientation, DynamicImage, ImageDecoder, ImageFormat, ImageReader, RgbaImage,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

static GENERATION: Mutex<()> = Mutex::new(());
const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SOURCE_PIXELS: u64 = 16_000_000;
const MAX_CACHE_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundFitRequest {
    pub source_kind: String,
    pub file: String,
    pub width: u32,
    pub height: u32,
    pub padding: u32,
    pub mode: BackgroundFitMode,
    pub position_x: u8,
    pub position_y: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundFitResult {
    pub file: String,
    pub source_width: u32,
    pub source_height: u32,
    pub width: u32,
    pub height: u32,
    pub padding: u32,
    pub cache_hit: bool,
}

/// 只在工作线程获取生成锁，不持有设置、游戏库或窗口线程的锁。
#[tauri::command]
pub async fn fit_sidebar_background(
    state: State<'_, AppState>,
    request: BackgroundFitRequest,
) -> Result<BackgroundFitResult, String> {
    let root = state.store.root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = GENERATION
            .lock()
            .map_err(|_| "背景处理暂不可用，请重启后重试".to_string())?;
        generate(&root, &request)
    })
    .await
    .map_err(|e| format!("背景适配任务失败：{e}"))?
}

/// 资源身份限定为目录中的一个文件名，包含 symlink 在内的目录逃逸也拒绝。
fn source_path(root: &Path, request: &BackgroundFitRequest) -> Result<PathBuf, String> {
    let directory = match request.source_kind.as_str() {
        "cover" => "covers",
        "superres" => "superres",
        "background" => "backgrounds",
        _ => return Err("背景来源无效，请重新选择图片".into()),
    };
    if request.file.is_empty()
        || request.file.len() > 255
        || request.file.contains(['/', '\\', ':'])
        || matches!(request.file.as_str(), "." | "..")
    {
        return Err("背景文件名无效，请重新选择图片".into());
    }
    let dir = root
        .join(directory)
        .canonicalize()
        .map_err(|e| format!("读取背景目录失败：{e}"))?;
    let file = dir
        .join(&request.file)
        .canonicalize()
        .map_err(|e| format!("背景图片不可用，请重新选择：{e}"))?;
    if !file.starts_with(&dir) || !file.is_file() {
        return Err("背景图片超出资源目录，请重新选择图片".into());
    }
    Ok(file)
}

fn validate_target(r: &BackgroundFitRequest) -> Result<(u32, u32), String> {
    if r.width == 0
        || r.height == 0
        || r.width > 4096
        || r.height > 4096
        || u64::from(r.width) * u64::from(r.height) > 4_000_000
        || r.padding > 512
        || r.position_x > 100
        || r.position_y > 100
    {
        return Err("背景适配尺寸或取景位置超出范围，请调整后重试".into());
    }
    let width = r.width + 2 * r.padding;
    let height = r.height + 2 * r.padding;
    if u64::from(width) * u64::from(height) > 6_000_000 {
        return Err("背景适配像素过多，请缩小窗口或显示缩放后重试".into());
    }
    Ok((width, height))
}

/// 内容摘要结合全部显示参数；同名原图被替换后不会误用旧缓存。
fn cache_name(bytes: &[u8], r: &BackgroundFitRequest) -> String {
    let identity = format!(
        "v1|{}|{}|{}|{}|{}|{:?}|{}|{}|",
        r.source_kind, r.file, r.width, r.height, r.padding, r.mode, r.position_x, r.position_y
    );
    let hash = identity
        .bytes()
        .chain(bytes.iter().copied())
        .fold(0xcbf29ce484222325_u64, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
        });
    format!("fit-v1-{hash:016x}.png")
}

/// 从透明 RGBA 画布适配，缩放时启用 alpha 乘除以避免透明边缘染色。
fn render(source: &RgbaImage, r: &BackgroundFitRequest) -> Result<RgbaImage, String> {
    let scale = (f64::from(r.width) / f64::from(source.width()))
        .min(f64::from(r.height) / f64::from(source.height()));
    let (width, height) = if r.mode == BackgroundFitMode::Contain {
        (
            (f64::from(source.width()) * scale)
                .round()
                .clamp(1.0, f64::from(r.width)) as u32,
            (f64::from(source.height()) * scale)
                .round()
                .clamp(1.0, f64::from(r.height)) as u32,
        )
    } else {
        (r.width, r.height)
    };
    let input = Image::from_vec_u8(
        source.width(),
        source.height(),
        source.as_raw().clone(),
        PixelType::U8x4,
    )
    .map_err(|e| format!("读取背景像素失败：{e}"))?;
    let mut output = Image::new(width, height, PixelType::U8x4);
    let mut options = ResizeOptions::new()
        .resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3))
        .use_alpha(true);
    if r.mode == BackgroundFitMode::Cover {
        options = options.fit_into_destination(Some((
            f64::from(r.position_x) / 100.0,
            f64::from(r.position_y) / 100.0,
        )));
    }
    Resizer::new()
        .resize(&input, &mut output, &options)
        .map_err(|e| format!("背景缩放失败：{e}"))?;
    let resized =
        RgbaImage::from_raw(width, height, output.buffer().to_vec()).ok_or("背景输出像素不完整")?;
    let mut canvas = RgbaImage::new(r.width, r.height);
    image::imageops::replace(
        &mut canvas,
        &resized,
        i64::from((r.width - width) / 2),
        i64::from((r.height - height) / 2),
    );
    if r.padding == 0 {
        return Ok(canvas);
    }
    // 扩边仅复制现有画布边缘，保留完整显示的透明留空，不再次缩放构图。
    Ok(RgbaImage::from_fn(
        r.width + 2 * r.padding,
        r.height + 2 * r.padding,
        |x, y| {
            *canvas.get_pixel(
                x.saturating_sub(r.padding).min(r.width - 1),
                y.saturating_sub(r.padding).min(r.height - 1),
            )
        },
    ))
}

/// 仅淘汰本模块命名的缓存；不递归、不处理原图或其他资源。
fn prune_cache(dir: &Path, keep: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            if !name.starts_with("fit-v1-") || !name.ends_with(".png") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some((entry.path(), metadata.len(), metadata.modified().ok()))
        })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    let mut count = files.len();
    files.sort_by_key(|f| f.2);
    for (path, bytes, _) in files {
        if count <= 64 && total <= MAX_CACHE_BYTES {
            break;
        }
        if path != keep && fs::remove_file(path).is_ok() {
            count -= 1;
            total = total.saturating_sub(bytes);
        }
    }
}

fn generate(root: &Path, r: &BackgroundFitRequest) -> Result<BackgroundFitResult, String> {
    let (output_width, output_height) = validate_target(r)?;
    let path = source_path(root, r)?;
    let source = fs::File::open(path).map_err(|e| format!("读取背景失败：{e}"))?;
    let mut bytes = Vec::new();
    source
        .take(MAX_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取背景失败：{e}"))?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err("背景图片超过 64MiB，请选择较小的图片".into());
    }
    let mut reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| format!("识别背景图片失败：{e}"))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(192 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("背景图片无法解码，请换一张图片：{e}"))?;
    let (raw_width, raw_height) = decoder.dimensions();
    if raw_width == 0
        || raw_height == 0
        || u64::from(raw_width) * u64::from(raw_height) > MAX_SOURCE_PIXELS
    {
        return Err("背景图片超过 1600 万像素，请缩小原图后再试".into());
    }
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let (source_width, source_height) = match orientation {
        Orientation::Rotate90
        | Orientation::Rotate270
        | Orientation::Rotate90FlipH
        | Orientation::Rotate270FlipH => (raw_height, raw_width),
        _ => (raw_width, raw_height),
    };
    let dir = root.join("background-fit");
    fs::create_dir_all(&dir).map_err(|e| format!("创建背景缓存失败：{e}"))?;
    let file = cache_name(&bytes, r);
    let destination = dir.join(&file);
    let result = |cache_hit| BackgroundFitResult {
        file: file.clone(),
        source_width,
        source_height,
        width: r.width,
        height: r.height,
        padding: r.padding,
        cache_hit,
    };
    // 缓存也可能损坏：先校验格式、尺寸和分配预算，再完整解码。
    let valid_cache = (|| -> Result<bool, image::ImageError> {
        if fs::metadata(&destination)?.len() > MAX_SOURCE_BYTES {
            return Ok(false);
        }
        let mut cached = ImageReader::open(&destination)?;
        cached.set_format(ImageFormat::Png);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(output_width);
        limits.max_image_height = Some(output_height);
        limits.max_alloc = Some(64 * 1024 * 1024);
        cached.limits(limits);
        let decoder = cached.into_decoder()?;
        if decoder.dimensions() != (output_width, output_height) {
            return Ok(false);
        }
        DynamicImage::from_decoder(decoder)?;
        Ok(true)
    })()
    .unwrap_or(false);
    if valid_cache {
        return Ok(result(true));
    }
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|e| format!("背景解码失败：{e}"))?;
    image.apply_orientation(orientation);
    let output = render(&image.to_rgba8(), r)?;
    let temporary = dir.join(format!(".fit-{}.tmp", uuid::Uuid::new_v4()));
    let write = output
        .save_with_format(&temporary, ImageFormat::Png)
        .map_err(|e| format!("保存背景适配图失败：{e}"))
        .and_then(|_| {
            fs::rename(&temporary, &destination).map_err(|e| format!("更新背景缓存失败：{e}"))
        });
    if let Err(error) = write {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    prune_cache(&dir, &destination);
    Ok(result(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GenericImageView, Rgba};

    fn request() -> BackgroundFitRequest {
        BackgroundFitRequest {
            source_kind: "background".into(),
            file: "test.png".into(),
            width: 20,
            height: 60,
            padding: 0,
            mode: BackgroundFitMode::Contain,
            position_x: 50,
            position_y: 50,
        }
    }

    #[test]
    fn contain_preserves_picture_and_padding_copies_edges() {
        let src = RgbaImage::from_pixel(40, 20, Rgba([220, 60, 30, 255]));
        let mut r = request();
        let im = render(&src, &r).unwrap();
        assert_eq!(im.get_pixel(10, 0)[3], 0);
        assert_eq!(*im.get_pixel(10, 30), Rgba([220, 60, 30, 255]));
        r.mode = BackgroundFitMode::Stretch;
        r.padding = 4;
        let im = render(&src, &r).unwrap();
        assert_eq!(im.dimensions(), (28, 68));
        assert_eq!(im.get_pixel(0, 0), im.get_pixel(4, 4));
        assert_eq!(im.get_pixel(27, 67), im.get_pixel(23, 63));
    }

    #[test]
    fn cover_position_selects_correct_region_and_alpha_does_not_tint() {
        let src = RgbaImage::from_fn(120, 60, |x, _| {
            if x < 40 {
                Rgba([255, 0, 0, 255])
            } else if x > 79 {
                Rgba([0, 0, 255, 255])
            } else {
                Rgba([0, 255, 0, 255])
            }
        });
        let mut r = request();
        r.mode = BackgroundFitMode::Cover;
        r.position_x = 0;
        assert_eq!(
            *render(&src, &r).unwrap().get_pixel(10, 30),
            Rgba([255, 0, 0, 255])
        );
        r.position_x = 100;
        assert_eq!(
            *render(&src, &r).unwrap().get_pixel(10, 30),
            Rgba([0, 0, 255, 255])
        );
        let src = RgbaImage::from_fn(20, 20, |x, _| {
            if x < 10 {
                Rgba([255, 0, 0, 0])
            } else {
                Rgba([0, 0, 255, 255])
            }
        });
        r.mode = BackgroundFitMode::Stretch;
        let output = render(&src, &r).unwrap();
        for p in output.pixels().filter(|p| p[3] > 10) {
            assert!(p[0] < 3, "transparent red leaked into visible pixels");
        }
    }

    #[test]
    fn cache_changes_with_content_parameters_and_repairs_corruption() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("backgrounds")).unwrap();
        let source = dir.path().join("backgrounds/test.png");
        RgbaImage::from_pixel(40, 20, Rgba([120, 80, 40, 255]))
            .save(&source)
            .unwrap();
        let r = request();
        let first = generate(dir.path(), &r).unwrap();
        assert!(!first.cache_hit);
        assert!(generate(dir.path(), &r).unwrap().cache_hit);
        let cached = dir.path().join("background-fit").join(&first.file);
        fs::write(&cached, b"bad cache").unwrap();
        assert!(!generate(dir.path(), &r).unwrap().cache_hit);
        RgbaImage::from_pixel(40, 20, Rgba([10, 20, 30, 255]))
            .save(&source)
            .unwrap();
        assert_ne!(first.file, generate(dir.path(), &r).unwrap().file);
        let mut changed = r.clone();
        changed.mode = BackgroundFitMode::Stretch;
        assert_ne!(
            generate(dir.path(), &r).unwrap().file,
            generate(dir.path(), &changed).unwrap().file
        );
        assert_eq!(image::open(source).unwrap().dimensions(), (40, 20));
    }

    #[test]
    fn fits_original_and_both_superres_sources_without_crossing_directories() {
        let dir = tempfile::tempdir().unwrap();
        for directory in ["covers", "superres", "backgrounds"] {
            fs::create_dir(dir.path().join(directory)).unwrap();
        }
        let mut r = request();
        r.mode = BackgroundFitMode::Stretch;
        for (kind, directory, file, color) in [
            ("cover", "covers", "original.png", [200, 20, 20, 255]),
            ("superres", "superres", "efficient.png", [20, 200, 20, 255]),
            ("superres", "superres", "quality.png", [20, 20, 200, 255]),
        ] {
            RgbaImage::from_pixel(40, 20, Rgba(color))
                .save(dir.path().join(directory).join(file))
                .unwrap();
            r.source_kind = kind.into();
            r.file = file.into();
            let result = generate(dir.path(), &r).unwrap();
            let output = image::open(dir.path().join("background-fit").join(result.file))
                .unwrap()
                .to_rgba8();
            assert_eq!(*output.get_pixel(10, 30), Rgba(color));
            assert!(generate(dir.path(), &r).unwrap().cache_hit);
        }
        r.source_kind = "cover".into();
        assert!(generate(dir.path(), &r).is_err());
        r.source_kind = "superres".into();
        for file in [
            "../covers/original.png",
            "..\\covers\\original.png",
            "C:\\quality.png",
        ] {
            r.file = file.into();
            assert!(generate(dir.path(), &r).is_err());
        }
        r.source_kind = "unknown".into();
        r.file = "quality.png".into();
        assert!(generate(dir.path(), &r).is_err());
    }

    #[test]
    fn rejects_invalid_paths_sizes_and_broken_sources() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("backgrounds")).unwrap();
        let mut r = request();
        for name in ["../file.png", "C:\\file.png", "..", "sub/file.png"] {
            r.file = name.into();
            assert!(generate(dir.path(), &r).is_err());
        }
        r = request();
        r.width = u32::MAX;
        assert!(generate(dir.path(), &r).is_err());
        r = request();
        fs::write(dir.path().join("backgrounds/test.png"), b"broken").unwrap();
        assert!(generate(dir.path(), &r).is_err());
        assert!(fs::read_dir(dir.path().join("background-fit")).is_err());
    }

    #[test]
    fn exif_rotation_is_applied_before_fitting_and_cache_reports_rotated_size() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("backgrounds")).unwrap();
        let image = DynamicImage::ImageRgb8(image::RgbImage::from_fn(40, 20, |x, _| {
            if x < 20 {
                image::Rgb([240, 0, 0])
            } else {
                image::Rgb([0, 0, 240])
            }
        }));
        let mut jpeg = Cursor::new(Vec::new());
        image.write_to(&mut jpeg, ImageFormat::Jpeg).unwrap();
        // JPEG APP1 + big-endian TIFF，方向 6 表示顺时针旋转 90 度。
        let exif = b"Exif\0\0MM\0*\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01\0\x06\0\0\0\0\0\0";
        let mut oriented = vec![0xff, 0xd8, 0xff, 0xe1];
        oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        oriented.extend_from_slice(exif);
        oriented.extend_from_slice(&jpeg.into_inner()[2..]);
        fs::write(dir.path().join("backgrounds/rotated.jpg"), &oriented).unwrap();
        let mut r = request();
        r.file = "rotated.jpg".into();
        r.mode = BackgroundFitMode::Stretch;
        let first = generate(dir.path(), &r).unwrap();
        assert_eq!((first.source_width, first.source_height), (20, 40));
        let output = image::open(dir.path().join("background-fit").join(first.file))
            .unwrap()
            .to_rgb8();
        assert!(output.get_pixel(10, 5)[0] > 200);
        assert!(output.get_pixel(10, 55)[2] > 200);
        let cached = generate(dir.path(), &r).unwrap();
        assert!(cached.cache_hit);
        assert_eq!((cached.source_width, cached.source_height), (20, 40));
        assert_eq!(
            fs::read(dir.path().join("backgrounds/rotated.jpg")).unwrap(),
            oriented
        );
    }

    #[test]
    fn cache_cleanup_preserves_current_image_and_unrelated_files() {
        let dir = tempfile::tempdir().unwrap();
        let keep = dir.path().join("fit-v1-current.png");
        fs::write(&keep, b"current").unwrap();
        fs::write(dir.path().join("user.png"), b"original").unwrap();
        for i in 0..70 {
            fs::write(dir.path().join(format!("fit-v1-{i}.png")), b"cache").unwrap();
        }
        prune_cache(dir.path(), &keep);
        assert!(keep.is_file());
        assert_eq!(fs::read(dir.path().join("user.png")).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 65);
    }

    #[test]
    fn png_jpeg_webp_gif_and_bmp_have_real_outputs() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("backgrounds")).unwrap();
        let source = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            32,
            24,
            image::Rgb([100, 150, 200]),
        ));
        for (ext, format) in [
            ("png", ImageFormat::Png),
            ("jpg", ImageFormat::Jpeg),
            ("webp", ImageFormat::WebP),
            ("gif", ImageFormat::Gif),
            ("bmp", ImageFormat::Bmp),
        ] {
            let mut r = request();
            r.file = format!("test.{ext}");
            source
                .save_with_format(dir.path().join("backgrounds").join(&r.file), format)
                .unwrap();
            let result = generate(dir.path(), &r).unwrap();
            assert_eq!((result.source_width, result.source_height), (32, 24));
            assert!(dir
                .path()
                .join("background-fit")
                .join(result.file)
                .is_file());
        }
    }
}
