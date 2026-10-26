# <img src="src-tauri/icons/128x128.png" width="64" height="64" alt="" /> WhaleDeck

> 本地游戏 / 项目启动台 —— 把散落各处的东西收进一个界面，一触即达，记录时长。

WhaleDeck 是一个 Windows 桌面应用（Tauri 2 + React 19 + TypeScript）：核心功能不依赖网络，数据只存本机，不上传、不碰你的文件和存档（手动备份除外）；只有主动使用的「联网补全」会访问公开接口获取数据。

![WhaleDeck 界面（示例数据）](docs/sc-l.png)
![WhaleDeck 界面（示例数据）](docs/sc-d.png)

## 功能

- **随心加**：不止游戏。任意 exe、快捷方式、bat/cmd、文档、图片、文件夹……什么东西都可以。
  - exe / bat / cmd：以进程方式启动，自动计时与进程监控。
  - 其他文件与文件夹：用系统默认程序打开，只记录「最近打开」。
- **一键打开**：双击列表项或点底栏按钮，正确传递工作目录与启动参数。
- **自动计时**：后台每 2 秒采样进程，游戏退出后自动结算并累计时长；支持「额外进程名」应对启动器拉起的游戏。
- **异常补算**：启动时写 `pending_session.json`，异常退出后下次启动按时间差补算（上限 12 小时）。
- **文件夹扫描**：选一个装着游戏的文件夹，递归找出 exe，勾选后批量加入（自动跳过已在库中的）。
- **联网补全**：按名称从 Bangumi / VNDB / 月幕 搜索条目，一键应用封面、简介、开发商、发售日期；搜不到可手动选封面。
- **自动补全**：读取程序版本信息补名称/开发商/备注，提取系统图标，并优先使用游戏目录里的本地封面。
- **图像分层**：横版封面用于主区背景，程序图标用于侧栏缩略图，互不冒充。
  - 未设置项目图标或图片无法加载时，自动使用 WhaleDeck 应用图标。
- **存档备份**：给每个游戏配置一到多个存档目录，一键打包成 zip；存档坏了可以还原回去。
- **可靠存储**：数据存本机 JSON，原子写入 + 保留 5 份备份，损坏自动回退。
- **界面**：沉浸式封面详情、固定底部操作/统计栏、无边框圆角窗口；4 套预设主题，可自定义主色、强调色、背景图与遮罩。
- **备份迁移**：导出/导入整个库（含封面文件夹）。

## 安装

- 安装包：运行 `pnpm tauri build`，生成 `WhaleDeck_0.8.1_x64-setup.exe`（NSIS，按当前用户安装，无需管理员权限）。
- 便携版：构建后取 `src-tauri/target/release/WhaleDeck.exe`，自行打包为 zip。
- 仓库暂无 Release，请自行构建。

## 开发

前置要求：Node.js 20+、pnpm、Rust（MSVC 工具链）、WebView2（Windows 10/11 自带）。

```bash
pnpm install          # 安装前端依赖
pnpm tauri dev        # 开发模式（Vite + Tauri 热更新）
pnpm build            # 只构建前端（含类型检查）
pnpm test             # 前端测试（Vitest）
pnpm icons            # 用 Tauri 官方工具从正式 PNG 批量生成图标包
cd src-tauri && cargo test   # Rust 测试
pnpm tauri build      # 打包安装程序（NSIS）
```

工程规范、注释要求、提交规范见 [docs/工程规范.md](docs/工程规范.md)。

## 数据位置

```text
%APPDATA%\com.whaledeck.app\
├─ data\games.json
├─ data\settings.json
├─ data\pending_session.json
├─ data\backup\        # 最近 5 份游戏/设置备份
├─ covers\             # 封面
├─ icons\              # 程序图标
├─ backgrounds\        # 背景图
└─ backups\<游戏 id>\  # 存档备份 zip
```

字段与写入/恢复策略见 [docs/数据模型.md](docs/数据模型.md)。

## 文档

文档按职责拆分，每个事实只有一个权威来源；入口与权威矩阵见 **[docs/文档索引.md](docs/文档索引.md)**。

| 文档 | 内容 |
|---|---|
| [产品定义](docs/产品定义.md) | 定位、范围、用户故事、合规 |
| [系统架构](docs/系统架构.md) | 技术栈、运行时、模块地图、关键流程 |
| [数据模型](docs/数据模型.md) | 字段、存储布局、写入与恢复 |
| [IPC 契约](docs/接口契约.md) | 命令、参数、返回值、事件 |
| [前端实现](docs/前端实现.md) | 状态、视图规则、组件 |
| [后端实现](docs/后端实现.md) | Rust 模块、算法、限制 |
| [界面与交互](docs/界面与交互.md) | 布局、视觉、交互、可访问性 |
| [工程规范](docs/工程规范.md) | 命令、代码/注释、提交、发布、gh |
| [版本记录](docs/版本记录.md) | 每个版本改了什么、为什么 |
| [术语表](GLOSSARY.md) | 统一叫法 |

## 数据来源

「联网补全」使用以下平台的公开接口，感谢它们提供数据：

- [Bangumi 番组计划](https://bgm.tv/)
- [VNDB](https://vndb.org/)
- [月幕 Galgame](https://www.ymgal.games/)

只用于个人整理自己的游戏库，请遵守各平台的非商业使用条款。

## 许可

MIT
