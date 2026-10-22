/**
 * 用 Tauri 官方 CLI 从 imagegen 原始 PNG 生成全平台图标与前端补充尺寸。
 * 不绘制或手工缩放图片；对应文档：docs/工程规范.md「品牌资源与图标生成」。
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("@tauri-apps/cli/package.json")), "tauri.js");
const source = join(root, "assets/icon-source.png");
const icons = join(root, "src-tauri/icons");

/** 默认平台包和自定义尺寸分两次调用，避免 --png 关闭默认平台输出。 */
function generate(extra) {
  const result = spawnSync(process.execPath, [cli, "icon", source, ...extra], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Tauri 图标生成失败（退出码 ${result.status}）`);
}

generate(["--output", icons]);
generate(["--output", icons, "--png", "16", "--png", "24", "--png", "48"]);
