/**
 * @file 侧栏适配资源：测量可视区域、合并后台任务并拒绝迟到结果。
 * 不改设置；对应文档 docs/前端实现.md §4.2.1。
 */
import { useEffect, useState } from "react";
import type { BackgroundFitRequest, BackgroundFitResult, BackgroundSource, SidebarBackgroundFit } from "../types";
import { backgroundFitSize, latestRequestQueue } from "./backgroundFit";
import { loadAssetUrl } from "./assets";
import { api } from "./ipc";

type FittedImage = BackgroundFitResult & { url: string };
const inFlight = new Map<string, Promise<FittedImage>>();

/** 同时打开预览和实际侧栏时，共用相同的执行中任务；完成后仍由后端核验内容缓存。 */
function loadFit(request: BackgroundFitRequest): Promise<FittedImage> {
  const key = JSON.stringify(request);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = (async () => {
    const result = await api.fitSidebarBackground(request);
    const url = await loadAssetUrl("backgroundFit", result.file);
    if (!url) throw new Error("适配图片加载失败，请重试或更换图片");
    return { ...result, url };
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, task);
  return task;
}

/** 隐藏侧栏仍有稳定布局尺寸；列表滚动和鼠标呼出不会触发重新采样。 */
export function useSidebarSize() {
  const [size, setSize] = useState({ cssWidth: 258, cssHeight: 820, dpr: window.devicePixelRatio || 1 });
  useEffect(() => {
    const element = document.getElementById("library-sidebar");
    if (!element) return;
    let media: MediaQueryList | null = null;
    const measure = () => {
      const next = { cssWidth: element.clientWidth, cssHeight: element.clientHeight, dpr: window.devicePixelRatio || 1 };
      if (next.cssWidth && next.cssHeight) setSize((previous) => previous.cssWidth === next.cssWidth && previous.cssHeight === next.cssHeight && previous.dpr === next.dpr ? previous : next);
    };
    const watchDensity = () => {
      media?.removeEventListener("change", watchDensity);
      measure();
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media.addEventListener("change", watchDensity);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    watchDensity();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); media?.removeEventListener("change", watchDensity); window.removeEventListener("resize", measure); };
  }, []);
  return size;
}

/** 禁用或换图后立即隔离旧图；同来源缩放期间保留上一次结果，避免闪白。 */
export function useSidebarBackgroundFit(source: BackgroundSource | null, config: SidebarBackgroundFit, glass: boolean) {
  const size = useSidebarSize();
  const dimensions = backgroundFitSize(size.cssWidth, size.cssHeight, size.dpr, glass);
  const identity = source ? JSON.stringify(source) : "";
  const request: BackgroundFitRequest | null = source && config.enabled && dimensions ? { ...source, ...dimensions, mode: config.mode, positionX: config.positionX, positionY: config.positionY } : null;
  const key = request ? JSON.stringify(request) : "";
  const [state, setState] = useState<{ identity: string; key: string; image: FittedImage | null; error: string | null }>({ identity: "", key: "", image: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [queue, setQueue] = useState<ReturnType<typeof latestRequestQueue<BackgroundFitRequest, FittedImage>> | null>(null);
  useEffect(() => {
    const worker = latestRequestQueue(loadFit);
    setQueue(worker);
    return () => worker.close();
  }, []);
  useEffect(() => {
    if (!key || !queue) return;
    let alive = true;
    const current = JSON.parse(key) as BackgroundFitRequest;
    const timer = setTimeout(() => {
      void queue.request(current).then((image) => {
        if (alive && image) setState({ identity, key, image, error: null });
      }).catch((error: unknown) => {
        if (alive) setState((previous) => ({ identity, key, image: previous.identity === identity ? previous.image : null, error: String(error) }));
      });
    }, 200);
    return () => { alive = false; clearTimeout(timer); queue.clearPending(); };
  }, [key, identity, queue, attempt]);
  return {
    size, dimensions,
    image: config.enabled && state.identity === identity ? state.image : null,
    error: key && state.key === key ? state.error : null,
    loading: Boolean(key && state.key !== key),
    retry: () => {
      setState((previous) => ({ ...previous, key: "", error: null }));
      setAttempt((previous) => previous + 1);
    },
  };
}
