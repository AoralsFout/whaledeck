/**
 * @file 已解码封面的两层切换展示；不加载图片、不保留旧游戏交互。
 * 对应文档：docs/前端实现.md §3.1、docs/界面与交互.md §2.2.1。
 */
import { useEffect, useState } from "react";
import { coverFramingStyle } from "../lib/coverFraming";
import { BACKGROUND_TRANSITION_MS } from "../lib/detailTransitions";
import { useReducedMotion } from "../lib/useReducedMotion";
import type { CoverFraming, DetailBackgroundTransition } from "../types";

type Frame = { scope: string; url: string; framing: CoverFraming };
type Artwork = { identity: string; frame: Frame | null };

function ArtworkLayer({ frame, current }: { frame: Frame | null; current: boolean }) {
  return frame ? <img src={frame.url} alt="" className="game-cover-art h-full w-full object-cover" data-cover-current={current} style={coverFramingStyle(frame.framing)} draggable={false} />
    : <div className="h-full w-full detail-background-empty" />;
}

/** 只有就绪图所属游戏改变才过渡；更新取景与同游戏换图保留当前图像节点。 */
export function DetailBackground({ frame, identity, scope, mode }: { frame: Frame | null; identity: string; scope: string; mode: DetailBackgroundTransition }) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<{ current: Artwork; previous: Artwork | null; serial: number }>(() => ({
    current: { identity, frame }, previous: null, serial: 0,
  }));
  // 渲染阶段派生状态让当前与退场层在同一帧交接；等待解码时 frame 与 identity 保持不变。
  if (state.current.frame !== frame || state.current.identity !== identity) {
    const changed = state.current.identity !== identity;
    setState({ current: { identity, frame }, previous: changed && !reduced && mode !== "none" ? state.current : changed ? null : state.previous, serial: state.serial + (changed ? 1 : 0) });
  }
  useEffect(() => {
    if (!state.previous) return;
    const timer = setTimeout(() => setState(current => ({ ...current, previous: null })), reduced || mode === "none" ? 0 : BACKGROUND_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [state.serial, state.previous, reduced, mode]);
  const active = Boolean(state.previous) && !reduced && mode !== "none";
  return (
    <div className="detail-background absolute inset-0" aria-hidden="true" data-background-transition={active ? mode : "none"}>
      {active && <div key={`out-${state.serial}`} className="detail-background-layer detail-background-out"><ArtworkLayer frame={state.previous!.frame} current={false} /></div>}
      <div key={state.serial} className={`detail-background-layer${active ? " detail-background-in" : ""}`}><ArtworkLayer frame={state.current.frame} current={state.current.frame?.scope === scope} /></div>
      <div className="detail-background-shade absolute inset-0" />
    </div>
  );
}
