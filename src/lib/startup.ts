/**
 * @file 首帧显示：等资源、字体与两帧后再显示并聚焦原生窗口。
 *
 * 隐藏窗口期间 WebView 可能节流动画帧，因此 nextFrame 带 100ms 兜底。
 * 对应文档：docs/前端实现.md「启动」、docs/系统架构.md §5.1。
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { waitForAssets } from "./assets";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    // Hidden WebViews may throttle animation frames; still allow startup to finish.
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      resolve();
    }, 100);
    const frame = requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Call after the library (or its error state) has mounted. */
export function showWindowWhenReady(): () => void {
  let cancelled = false;
  if (isTauri()) {
    void (async () => {
      await waitForAssets();
      await document.fonts.ready;
      // Allow decoded image state and the saved theme to commit, then paint.
      await nextFrame();
      await nextFrame();
      if (cancelled) return;
      const win = getCurrentWindow();
      await win.show();
      delete document.documentElement.dataset.starting;
      if (!cancelled) await win.setFocus();
    })().catch((error: unknown) => console.error("显示主窗口失败", error));
  }
  return () => { cancelled = true; };
}
