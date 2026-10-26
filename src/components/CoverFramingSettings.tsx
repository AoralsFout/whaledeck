/**
 * @file 设置中的逐游戏封面取景：拖动、缩放和独立草稿确认。
 * 不裁剪原文件；对应 docs/界面与交互.md §4.3、docs/前端实现.md §4.2.2。
 */
import { useEffect, useRef, useState } from "react";
import { Crop, RotateCcw } from "lucide-react";
import { loadAssetUrl } from "../lib/assets";
import { coverFraming, coverFramingStyle, dragCoverFraming } from "../lib/coverFraming";
import { api } from "../lib/ipc";
import { useLibrary } from "../store/useLibrary";
import type { CoverFraming, Game } from "../types";
import { RangeSlider } from "./RangeSlider";

/** 全局背景启用时卸载编辑器；按游戏与文件重新挂载，切换时丢弃未确认草稿。 */
export function CoverFramingSettings() {
  const games = useLibrary(s => s.games);
  const selectedId = useLibrary(s => s.selectedId);
  const customBackground = useLibrary(s => Boolean(s.settings?.theme.backgroundFile));
  const [id, setId] = useState(selectedId ?? games[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const game = games.find(g => g.id === id) ?? games[0];
  return <section className="cover-framing-settings">
    <div>
      <h3 className="m-0 flex items-center gap-2 text-[14px] font-semibold"><Crop size={16} aria-hidden="true" />封面显示取景</h3>
      {!customBackground && <p className="hint mt-2 mb-0">调整游戏详情背景的截取范围，原图完整保留。每款游戏单独保存，侧栏仍使用原有背景适配。</p>}
    </div>
    {customBackground ? <p className="hint m-0" role="status">已启用全局背景图，主区不再显示游戏封面，因此暂时隐藏封面取景设置。请到「设置 → 外观 → 背景图」清除图片后再调整；已保存的封面取景会保留。</p>
      : !game ? <p className="hint">请先加入游戏并应用一张封面。</p> : <>
      <div>
        <label className="label" htmlFor="cover-framing-game">选择游戏</label>
        <select id="cover-framing-game" className="input" value={game.id} disabled={saving} onChange={e => setId(e.target.value)}>
          {games.map(g => <option key={g.id} value={g.id}>{g.title}{g.coverFile ? "" : "（无封面）"}</option>)}
        </select>
      </div>
      {game.coverFile ? <FramingEditor key={`${game.id}:${game.coverFile}`} game={game} onSaving={setSaving} />
        : <p className="hint" role="status">这个游戏还没有封面，请先通过联网补全或编辑项目添加封面。</p>}
    </>}
  </section>;
}

/** 编辑器只在确认时调用专用命令，避免覆盖游戏的并发计时与元数据更新。 */
function FramingEditor({ game, onSaving }: { game: Game; onSaving: (saving: boolean) => void }) {
  const saved = coverFraming(game);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [ratio, setRatio] = useState(16 / 10);
  const preview = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; start: CoverFraming; width: number; height: number } | null>(null);
  const showToast = useLibrary(s => s.showToast);
  useEffect(() => { setDraft(JSON.parse(savedKey) as CoverFraming); }, [savedKey]);
  useEffect(() => {
    let alive = true;
    setLoadState("loading"); setImage(null);
    void loadAssetUrl("cover", game.coverFile!).then(url => {
      if (!alive) return;
      if (!url) { setLoadState("error"); return; }
      setImage({ url, width: 0, height: 0 });
    });
    return () => { alive = false; };
  }, [game.coverFile, attempt]);
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (!main) return;
    const measure = () => { if (main.clientWidth && main.clientHeight) setRatio(main.clientWidth / main.clientHeight); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(main);
    return () => observer.disconnect();
  }, []);
  const dirty = JSON.stringify(draft) !== savedKey;
  const patch = (value: Partial<CoverFraming>) => setDraft(previous => ({ ...previous, ...value }));
  const confirm = async () => {
    setSaving(true); onSaving(true);
    try {
      const updated = await api.saveCoverFraming(game.id, draft);
      useLibrary.getState().applyGame(updated);
      showToast("success", "封面取景已保存");
    } catch (error) { showToast("error", `保存取景失败：${String(error)}`); }
    finally { setSaving(false); onSaving(false); }
  };
  return <div className="cover-framing-editor">
    <div>
      <div className="cover-framing-preview" ref={preview} style={{ aspectRatio: ratio, width: `min(100%, calc(min(260px, 30vh) * ${ratio}))` }}
        role="img" aria-label={`${game.title}封面取景预览，可拖动画面或使用下方滑杆`}
        data-ready={loadState === "ready" && !saving}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0 || saving || loadState !== "ready" || !image?.width) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: { ...draft }, width: rect.width, height: rect.height };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (!start || start.pointerId !== event.pointerId || !image || saving) return;
          setDraft(dragCoverFraming(start.start, event.clientX - start.x, event.clientY - start.y, start, image));
        }}
        onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {image && <img src={image.url} alt="" draggable={false} className="cover-framing-art h-full w-full object-cover" style={coverFramingStyle(draft)}
          onLoad={event => { const img = event.currentTarget; setImage({ url: img.src, width: img.naturalWidth, height: img.naturalHeight }); setLoadState("ready"); }}
          onError={() => { setLoadState("error"); setImage(null); }} />}
        {loadState !== "ready" && <span className="cover-framing-placeholder">{loadState === "loading" ? "正在加载封面…" : "封面加载失败"}</span>}
      </div>
      <p className="hint mt-2 mb-0" role="status">{dirty ? "预览中，尚未保存" : "当前已保存的取景"} · 拖动画面调整截取位置，缩放后可移动更多区域。</p>
      {loadState === "error" && <button className="btn mt-2" onClick={() => setAttempt(previous => previous + 1)}>重新加载封面</button>}
    </div>
    <fieldset className="cover-framing-controls" disabled={saving || loadState !== "ready"}>
      <legend className="sr-only">调整封面取景</legend>
      <label htmlFor="cover-framing-x">水平位置 <output htmlFor="cover-framing-x">{Math.round(draft.positionX)}%</output></label>
      <RangeSlider id="cover-framing-x" min={0} max={100} step={1} value={draft.positionX} aria-valuetext={`${Math.round(draft.positionX)}%`} onChange={e => patch({ positionX: Number(e.target.value) })} />
      <label htmlFor="cover-framing-y">垂直位置 <output htmlFor="cover-framing-y">{Math.round(draft.positionY)}%</output></label>
      <RangeSlider id="cover-framing-y" min={0} max={100} step={1} value={draft.positionY} aria-valuetext={`${Math.round(draft.positionY)}%`} onChange={e => patch({ positionY: Number(e.target.value) })} />
      <label htmlFor="cover-framing-zoom">缩放 <output htmlFor="cover-framing-zoom">{Math.round(draft.zoom * 100)}%</output></label>
      <RangeSlider id="cover-framing-zoom" min={100} max={300} step={1} value={Math.round(draft.zoom * 100)} aria-valuetext={`${Math.round(draft.zoom * 100)}%`} onChange={e => patch({ zoom: Number(e.target.value) / 100 })} />
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ghost" onClick={() => setDraft(coverFraming({ coverFile: game.coverFile }))}><RotateCcw size={14} aria-hidden="true" />恢复居中</button>
        <button className="btn" disabled={!dirty} onClick={() => setDraft(saved)}>取消修改</button>
        <button className="btn btn-primary" disabled={!dirty} onClick={() => void confirm()}>{saving ? "保存中…" : "确认保存取景"}</button>
      </div>
    </fieldset>
  </div>;
}
