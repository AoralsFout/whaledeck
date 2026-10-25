/**
 * @file 对已解码侧栏适配图做有限缓存的小画布取色；不加载原图、不改变图片显示。
 * 对应文档：docs/前端实现.md §4.2.1。
 */
import type { BackgroundFitResult } from "../types";
import { analyzeSidebarPixels, type SidebarImageColors } from "./sidebarPalette";

const cache = new Map<string, SidebarImageColors>();

/** 缩略采样保留原比例和扩边，滤镜后截取可见区；安全限制或画布失败只降级配色。 */
export function sampleSidebarImage(image: HTMLImageElement | null, fit: BackgroundFitResult, glass: boolean): SidebarImageColors | null {
  if (!image) return null;
  const key = JSON.stringify([image.src, fit.width, fit.height, fit.padding, glass]);
  const existing = cache.get(key);
  if (existing) { cache.delete(key); cache.set(key, existing); return existing; }
  try {
    const scale = Math.min(48 / fit.width, 144 / fit.height);
    const width = Math.max(1, Math.round(fit.width * scale));
    const height = Math.max(1, Math.round(fit.height * scale));
    const padding = Math.ceil(fit.padding * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width + 2 * padding;
    canvas.height = height + 2 * padding;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    // 固定扩边对应 CSS 的 72px，按默认 24px 磨砂采样；滑块拖动只更新显示滤镜。
    if (glass) context.filter = `blur(${padding / 3}px) saturate(1.15)`;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(padding, padding, width, height).data;
    const colors = analyzeSidebarPixels(pixels, width, height, .4);
    cache.set(key, colors);
    if (cache.size > 24) cache.delete(cache.keys().next().value!);
    return colors;
  } catch {
    // WebView 的资源安全策略可能禁止读画布；不能因此阻止已解码图片显示。
    return null;
  }
}
