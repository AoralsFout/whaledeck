/**
 * @file 已就绪背景快照的两层交接；不加载资源或修改持久化设置。
 * 对应文档：docs/前端实现.md §4.2.1、docs/界面与交互.md §2.2.1。
 */
import { useEffect, useState } from "react";
import type { DetailBackgroundTransition } from "../types";
import { BACKGROUND_TRANSITION_MS } from "./detailTransitions";
import { useReducedMotion } from "./useReducedMotion";

/** 标识只随已就绪目标改变；空标识清除历史，同标识更新保留图像节点。 */
export function useBackgroundTransition<T>(frame: T, identity: string | null, mode: DetailBackgroundTransition) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<{
    current: { identity: string | null; frame: T };
    previous: { identity: string | null; frame: T } | null;
    serial: number;
  }>(() => ({ current: { identity, frame }, previous: null, serial: 0 }));
  // 渲染阶段派生状态，确保图片和取景在同一帧交接，连续切换只保留最新退场层。
  if (state.current.frame !== frame || state.current.identity !== identity) {
    const changed = state.current.identity !== identity;
    const animate = changed && identity !== null && state.current.identity !== null && !reduced && mode !== "none";
    setState({
      current: { identity, frame },
      previous: animate ? state.current : changed ? null : state.previous,
      serial: state.serial + (changed ? 1 : 0),
    });
  }
  useEffect(() => {
    if (!state.previous) return;
    const timer = setTimeout(() => setState(current => ({ ...current, previous: null })), reduced || mode === "none" ? 0 : BACKGROUND_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [state.serial, state.previous, reduced, mode]);
  return { ...state, active: Boolean(state.previous) && !reduced && mode !== "none" };
}
