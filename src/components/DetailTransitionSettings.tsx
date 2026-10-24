/**
 * @file 展示页过渡设置与可重播预览；持久化交由现有主题设置路径。
 * 对应文档：docs/界面与交互.md §2.2.1、docs/前端实现.md §3.1。
 */
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { DetailBackgroundTransition, DetailTextTransition, Theme } from "../types";
import { DetailBackground } from "./DetailBackground";
import { TextTransitionProvider, TransitionText } from "./TransitionText";

const BACKGROUNDS: { value: DetailBackgroundTransition; label: string }[] = [
  { value: "none", label: "无动画" },
  { value: "blur", label: "模糊渐变" },
  { value: "crossfade", label: "交叉透明度渐变" },
  { value: "slideRight", label: "左到右滑动" },
  { value: "slideLeft", label: "右到左滑动" },
  { value: "slideDown", label: "上到下滑动" },
  { value: "slideUp", label: "下到上滑动" },
];
const TEXTS: { value: DetailTextTransition; label: string }[] = [
  { value: "none", label: "无动画" },
  { value: "fade", label: "透明度渐变" },
  { value: "stagger", label: "逐字位移" },
  { value: "scramble", label: "乱码过渡" },
];

// 本地矢量示意图只用于效果预览，不访问用户图片或触发图片解码请求。
function previewUrl(alternate: boolean) {
  const colors = alternate ? ["#424979", "#a26887", "#dba78d"] : ["#123850", "#24768b", "#93c5ce"];
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="400" viewBox="0 0 900 400"><defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h900v400H0z"/><circle cx="${alternate ? 230 : 680}" cy="110" r="62" fill="${colors[2]}"/><path d="M0 310Q200 ${alternate ? 80 : 240} 450 310T900 270V400H0Z" fill="${colors[2]}" opacity=".28"/><path d="M0 350Q230 270 470 340T900 300V400H0Z" fill="${colors[0]}"/></svg>`)}`;
}

/** 选择即保存并切换预览；重播使用同一对背景与实际文本组件。 */
export function DetailTransitionSettings({ theme, onChange }: { theme: Theme; onChange: (patch: Partial<Theme>) => void }) {
  const [revision, setRevision] = useState(0);
  const background = theme.detailBackgroundTransition ?? "blur";
  const text = theme.detailTextTransition ?? "fade";
  const alternate = revision % 2 === 1;
  const frame = useMemo(() => ({
    scope: String(revision), url: previewUrl(alternate),
    framing: { file: "preview", positionX: 50, positionY: 50, zoom: 1 },
  }), [revision, alternate]);
  const replay = () => setRevision(value => value + 1);
  return <>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="detail-background-transition">背景过渡</label>
        <select id="detail-background-transition" className="input" value={background} onChange={event => { onChange({ detailBackgroundTransition: event.target.value as DetailBackgroundTransition }); replay(); }}>
          {BACKGROUNDS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="detail-text-transition">文本过渡</label>
        <select id="detail-text-transition" className="input" value={text} onChange={event => { onChange({ detailTextTransition: event.target.value as DetailTextTransition }); replay(); }}>
          {TEXTS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    </div>
    <div className="detail-transition-preview game-detail relative overflow-hidden rounded-xl" role="img" aria-label="展示页过渡效果预览">
      <DetailBackground frame={frame} identity={String(revision)} scope={frame.scope} mode={background} />
      <div className="relative p-6 text-white">
        <span className="text-[11px] text-white/70">效果预览</span>
        <TextTransitionProvider mode={text}>
          <div key={`${revision}-${text}`}>
            <p className="m-0 mt-2 text-2xl font-semibold"><TransitionText text={alternate ? "暮色漫游" : "深海回响"} /></p>
            <p className="m-0 mt-2 text-[13px] text-white/85"><TransitionText text={alternate ? "沿着晚霞，开启下一段旅程。" : "在熟悉的收藏中，发现新的故事。"} /></p>
          </div>
        </TextTransitionProvider>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn" type="button" onClick={replay}><RotateCcw size={14} aria-hidden="true" />重播预览</button>
      <p className="hint m-0">自动保存；系统减少动态效果开启时直接显示。</p>
    </div>
  </>;
}
