/**
 * @file 背景适配的来源、像素预算与合并请求队列；不保存设置或操作 DOM。
 * 对应文档：docs/前端实现.md §4.2.1、docs/数据模型.md §2.6。
 */
import type { BackgroundSource, SidebarBackgroundFit, Theme } from "../types";

export const DEFAULT_BACKGROUND_FIT: Readonly<SidebarBackgroundFit> = {
  enabled: true, mode: "contain", positionX: 50, positionY: 50,
};

/** 自定义图片优先；封面沿用共享选择，undefined 保留查询等待态而不误判成无图。 */
export function sidebarBackgroundSource(theme: Theme, cover: { kind: "cover" | "superres"; file: string } | null | undefined): BackgroundSource | null | undefined {
  if (theme.sidebarBackgroundFile) return { sourceKind: "background", file: theme.sidebarBackgroundFile };
  if (!theme.sidebarGlass && !theme.sidebarClearGlass) return null;
  return cover ? { sourceKind: cover.kind, file: cover.file } : cover;
}

/** 大窗口与高 DPR 统一按比例降到预算内，不因某一边钳制而改变构图。 */
export function backgroundFitSize(cssWidth: number, cssHeight: number, dpr: number, glass: boolean) {
  if (![cssWidth, cssHeight, dpr].every((v) => Number.isFinite(v) && v > 0)) return null;
  const scale = Math.min(dpr, 4096 / cssWidth, 4096 / cssHeight, Math.sqrt(4_000_000 / (cssWidth * cssHeight)));
  let width = Math.max(1, Math.floor(cssWidth * scale));
  let height = Math.max(1, Math.floor(cssHeight * scale));
  let padding = glass ? Math.min(512, Math.round(36 * scale)) : 0;
  const outerPixels = (width + 2 * padding) * (height + 2 * padding);
  if (outerPixels > 6_000_000) {
    const reduction = Math.sqrt(6_000_000 / outerPixels);
    width = Math.max(1, Math.floor(width * reduction));
    height = Math.max(1, Math.floor(height * reduction));
    padding = Math.floor(padding * reduction);
  }
  return { width, height, padding };
}

/** 每个消费者仅保留一个执行中和最新待执行请求；被替代的调用直接结束。 */
export function latestRequestQueue<T, R>(run: (input: T) => Promise<R>) {
  type Job = { input: T; resolve: (value: R | null) => void; reject: (error: unknown) => void };
  let active = false;
  let pending: Job | null = null;
  let closed = false;
  const pump = async () => {
    if (active || !pending || closed) return;
    active = true;
    const job = pending;
    pending = null;
    try { const value = await run(job.input); job.resolve(closed ? null : value); }
    catch (error) { if (closed) job.resolve(null); else job.reject(error); }
    finally { active = false; void pump(); }
  };
  return {
    request: (input: T): Promise<R | null> => {
      if (closed) return Promise.resolve(null);
      pending?.resolve(null);
      return new Promise((resolve, reject) => { pending = { input, resolve, reject }; void pump(); });
    },
    clearPending: () => { pending?.resolve(null); pending = null; },
    close: () => { closed = true; pending?.resolve(null); pending = null; },
  };
}
