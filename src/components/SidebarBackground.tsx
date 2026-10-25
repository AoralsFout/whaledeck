/**
 * @file 侧栏已解码适配图的交接；只绘制背景，不加载原图或影响导航交互。
 * 对应文档：docs/前端实现.md §4.2.1、docs/界面与交互.md §4.3。
 */
import type { CSSProperties } from "react";
import type { BackgroundFitResult, DetailBackgroundTransition } from "../types";
import { useBackgroundTransition } from "../lib/useBackgroundTransition";

type Image = BackgroundFitResult & { url: string };

function ImageLayer({ image }: { image: Image | null }) {
  return <div className="sidebar-background-image" data-background-fitted={Boolean(image)} style={{
    "--sidebar-image": image ? `url(${JSON.stringify(image.url)})` : "none",
    "--sidebar-fit-padding-x": `${image ? image.padding / image.width * 100 : 0}%`,
    "--sidebar-fit-padding-y": `${image ? image.padding / image.height * 100 : 0}%`,
  } as CSSProperties} />;
}

/** 每层独立保存扩边；等待期间沿用旧标识，无图时立即清除交接历史。 */
export function SidebarBackground({ image, mode }: { image: Image | null; mode: DetailBackgroundTransition }) {
  const state = useBackgroundTransition(image, image?.url ?? null, mode);
  return <div className="sidebar-background" aria-hidden="true" data-background-transition={state.active ? mode : "none"}>
    {state.active && <div key={`out-${state.serial}`} className="detail-background-layer detail-background-out"><ImageLayer image={state.previous!.frame} /></div>}
    <div key={state.serial} className={`detail-background-layer${state.active ? " detail-background-in" : ""}`}><ImageLayer image={state.current.frame} /></div>
  </div>;
}
