/**
 * @file 无边框窗口的拖动区、封面快捷入口与最小化/最大化/关闭控制。
 *
 * 非 Tauri（浏览器预览）不调用原生 API；最大化/全屏时同步 data-window-expanded。
 * 对应文档：docs/界面与交互.md §2.1、docs/前端实现.md §4.4。
 */
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useLibrary } from "../store/useLibrary";
import type { CoverQuickEditor } from "../store/coverQuickEdit";
import { CoverFramingControl } from "./CoverFramingControl";

// 浏览器预览不调用原生窗口 API。
const appWindow = isTauri() ? getCurrentWindow() : null;

/** 窗口控制条与封面快捷入口；原生窗口按钮仅在 Tauri 环境启用。 */
export function WindowChrome({ coverEditor, coverDisabled = true }: { coverEditor?: CoverQuickEditor; coverDisabled?: boolean }) {
  const [maximized, setMaximized] = useState(false);
  const customBackground = useLibrary(s => Boolean(s.settings?.theme.backgroundFile));

  useEffect(() => {
    if (!appWindow) return;
    const win = appWindow;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncState = async () => {
      try {
        const [isMaximized, isFullscreen] = await Promise.all([
          win.isMaximized(),
          win.isFullscreen(),
        ]);
        if (disposed) return;
        setMaximized(isMaximized);
        document.documentElement.dataset.windowExpanded = String(isMaximized || isFullscreen);
      } catch (err) {
        console.error("读取窗口状态失败", err);
      }
    };

    void win.onResized(() => void syncState()).then((off) => {
      if (disposed) off();
      else unlisten = off;
    }).catch((err: unknown) => console.error("监听窗口状态失败", err));
    void syncState();

    return () => {
      disposed = true;
      unlisten?.();
      delete document.documentElement.dataset.windowExpanded;
    };
  }, []);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (err) {
      useLibrary.getState().showToast("error", `窗口操作失败：${String(err)}`);
    }
  };

  return (
    <>
      {/* 透明拖动区不占布局空间，双击由 Tauri 切换最大化。 */}
      <div className="window-drag-region" data-tauri-drag-region aria-hidden="true" />
      <div className="window-chrome-actions">
        {!customBackground && <CoverFramingControl editor={coverEditor} disabled={coverDisabled} />}
        <div className="window-controls" role="group" aria-label="窗口控制">
          <button
            type="button"
            className="window-control"
            aria-label="最小化"
            title="最小化"
            disabled={!appWindow}
            onClick={() => appWindow && void run(() => appWindow.minimize())}
          >
            <Minus size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="window-control"
            aria-label={maximized ? "还原窗口" : "最大化"}
            title={maximized ? "还原窗口" : "最大化"}
            disabled={!appWindow}
            onClick={() => appWindow && void run(() => appWindow.toggleMaximize())}
          >
            {maximized ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="window-control window-control-close"
            aria-label="关闭窗口"
            title="关闭窗口"
            disabled={!appWindow}
            onClick={() => appWindow && void run(() => appWindow.close())}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  );
}
