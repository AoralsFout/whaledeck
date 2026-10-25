/**
 * @file 侧栏局部配色订阅：消费已显示图片的采样和根主题，不修改全局颜色或设置。
 * 对应文档：docs/前端实现.md §4.2.1。
 */
import { useMemo, useSyncExternalStore } from "react";
import { createSidebarPalette, sidebarPaletteStyle, type SidebarImageColors } from "./sidebarPalette";
import { hexToRgb } from "./theme";

const subscribe = (notify: () => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-mode"] });
  return () => observer.disconnect();
};
const snapshot = () => {
  const style = getComputedStyle(document.documentElement);
  return [style.getPropertyValue("--surface").trim(), style.getPropertyValue("--primary").trim()].join("|");
};

/** 根主题在 App 的 layout effect 中应用，订阅实际变量也能覆盖系统主题切换。 */
export function useSidebarPalette(image: { colors: SidebarImageColors | null } | null, transparency: number, clear: boolean) {
  const theme = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => {
    if (!image) return undefined;
    const [base, fallback] = theme.split("|");
    return sidebarPaletteStyle(createSidebarPalette(image.colors, {
      base: hexToRgb(base), fallback: hexToRgb(fallback), transparency, clear,
    }));
  }, [image, theme, transparency, clear]);
}
