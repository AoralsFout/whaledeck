/**
 * @file 已解码封面的两层切换展示；不加载图片、不保留旧游戏交互。
 * 对应文档：docs/前端实现.md §3.1、docs/界面与交互.md §2.2.1。
 */
import { coverFramingStyle } from "../lib/coverFraming";
import { useBackgroundTransition } from "../lib/useBackgroundTransition";
import type { CoverFraming, DetailBackgroundTransition } from "../types";

type Frame = { scope: string; url: string; framing: CoverFraming };

function ArtworkLayer({ frame, current }: { frame: Frame | null; current: boolean }) {
  return frame ? <img src={frame.url} alt="" className="game-cover-art h-full w-full object-cover" data-cover-current={current} style={coverFramingStyle(frame.framing)} draggable={false} />
    : <div className="h-full w-full detail-background-empty" />;
}

/** 只有就绪图所属游戏改变才过渡；更新取景与同游戏换图保留当前图像节点。 */
export function DetailBackground({ frame, identity, scope, mode }: { frame: Frame | null; identity: string; scope: string; mode: DetailBackgroundTransition }) {
  const state = useBackgroundTransition(frame, identity, mode);
  const { active } = state;
  return (
    <div className="detail-background absolute inset-0" aria-hidden="true" data-background-transition={active ? mode : "none"}>
      {active && <div key={`out-${state.serial}`} className="detail-background-layer detail-background-out"><ArtworkLayer frame={state.previous!.frame} current={false} /></div>}
      <div key={state.serial} className={`detail-background-layer${active ? " detail-background-in" : ""}`}><ArtworkLayer frame={state.current.frame} current={state.current.frame?.scope === scope} /></div>
      <div className="detail-background-shade absolute inset-0" />
    </div>
  );
}
