/**
 * @file Vite / Vitest 配置：固定端口、忽略 Rust 构建目录、node 环境单测。
 *
 * 对应文档：docs/工程规范.md「环境与命令」。
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri 需要固定端口，且不能清屏
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // 显式绑定 IPv4 回环：部分 Windows 环境里 localhost 会优先解析到 ::1，
    // 若 Vite 只监听 ::1，Tauri 探测 http://127.0.0.1:1420 会一直卡在等待 dev server。
    host: "127.0.0.1",
    watch: {
      // 不要让 Vite 监听 Rust 侧目录：cargo 编译时会在 src-tauri/target 里
      // 反复创建/占用 .exe、.pdb，Node 文件监听器会抛 EBUSY 并终止 dev 进程。
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome120",
    minify: "esbuild",
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
