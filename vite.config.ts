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
    host: false,
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
