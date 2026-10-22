# WhaleDeck 🐋

> 本地游戏库管理器 —— 把散落各处的游戏收进一个启动台，点一下就玩，自动记录游玩时长。

WhaleDeck 是一个 Windows 桌面应用（Tauri 2 + React 19 + TypeScript），只管理你自己电脑上的游戏：不联网、不上传、不碰游戏文件本身。

## 功能

- **游戏库**：添加任意本地 exe，自动带出名称与工作目录；分类、标签、备注、收藏、隐藏。
- **一键启动**：双击卡片或点「启动」，正确传递工作目录与启动参数。
- **自动计时**：后台每 2 秒采样进程，游戏退出后自动结算并累计时长；支持「额外进程名」应对启动器拉起的游戏。
- **可靠存储**：数据存本机 JSON，原子写入 + 保留 5 份备份，损坏自动回退；异常退出用 `pending_session.json` 补算时长。
- **封面**：本地图片复制进数据目录，无封面时用渐变色首字母占位。
- **外观自定义**：4 套预设主题（默认鲸鱼娘配色）、自定义主色/强调色、自定义背景图与遮罩强度、深色/浅色/跟随系统。
- **备份迁移**：导出/导入游戏库（含封面文件夹）。

## 界面

- 左侧：全部游戏 / 收藏 / 分类 / 已隐藏 / 设置
- 顶部：搜索、排序、添加游戏
- 主区：自适应卡片网格
- 右侧：详情抽屉（启动、编辑、修正时长、移除）

## 开发

前置要求：Node.js 20+、pnpm、Rust（MSVC 工具链）、WebView2（Windows 10/11 自带）。

```bash
pnpm install          # 安装前端依赖
pnpm tauri dev        # 开发模式（Vite + Tauri 热更新）
pnpm build            # 只构建前端
pnpm test             # 前端测试（Vitest）
cd src-tauri && cargo test   # Rust 测试
pnpm tauri build      # 打包安装程序（NSIS）
```

## 数据位置

```
%APPDATA%\com.whaledeck.app\
├─ data\games.json
├─ data\settings.json
├─ data\backup\        # 最近 5 份自动备份
├─ covers\             # 封面
└─ backgrounds\        # 背景图
```

## 项目结构

```
src/                     React 前端（组件 / 页面 / 状态 / 工具）
src-tauri/src/           Rust 后端（命令 / 存储 / 启动器 / 监控）
docs/设计方案.md          设计基线与约定
scripts/make_icon.py     生成应用图标源图
```

## 设计文档

需求、数据模型、IPC 接口、里程碑都在 [docs/设计方案.md](docs/设计方案.md)。**改需求先改文档，再改代码。**

## 许可

MIT
