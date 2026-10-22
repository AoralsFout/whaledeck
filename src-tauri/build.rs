//! Tauri 构建脚本：生成上下文与 Windows 资源，不参与运行时逻辑。
//!
//! 对应文档：docs/工程规范.md「版本与发布」。
fn main() {
    tauri_build::build()
}
