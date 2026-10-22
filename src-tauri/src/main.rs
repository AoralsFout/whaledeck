//! Windows 可执行入口：发布构建隐藏控制台窗口，然后调用库的 run()。
//!
//! 对应文档：docs/系统架构.md、docs/后端实现.md「模块与装配」。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    whaledeck_lib::run()
}
