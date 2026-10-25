/**
 * @file 系统减少动态效果偏好订阅；不修改用户保存的动效方案。
 * 对应文档：docs/界面与交互.md §2.2.1、docs/前端实现.md §3.1。
 */
import { useSyncExternalStore } from "react";

const query = () => window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribe = (notify: () => void) => {
  const media = query();
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const snapshot = () => query().matches;

/** 同步读取首次偏好，避免减少动态效果开启时短暂启动动画。 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
