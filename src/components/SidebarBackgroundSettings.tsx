/**
 * @file 侧栏背景适配草稿：取景预览、确认保存与取消；不即时改变实际侧栏。
 * 对应文档：docs/界面与交互.md §4.3、docs/前端实现.md §4.2.1。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ImageOff, RotateCcw } from "lucide-react";
import { DEFAULT_BACKGROUND_FIT, sidebarBackgroundSource } from "../lib/backgroundFit";
import { useSidebarBackgroundFit } from "../lib/useSidebarBackgroundFit";
import { useAssetUrl } from "../lib/useAssetUrl";
import { useLibrary } from "../store/useLibrary";
import { useCoverSelection } from "./CoverSelectionProvider";
import type { SidebarBackgroundFit, Theme } from "../types";
import { RangeSlider } from "./RangeSlider";

const MODES = [
  { value: "contain", label: "完整显示", hint: "保留全图，空余区域显示底色" },
  { value: "cover", label: "铺满裁切", hint: "保持比例，可调整保留的画面" },
  { value: "stretch", label: "拉伸铺满", hint: "保留全图并铺满，人物可能变形" },
] as const;

/** 只在左侧栏页挂载；历史适配开关按常开处理，关闭或切页丢弃草稿。 */
export function SidebarBackgroundSettings({ theme, imageActions }: { theme: Theme; imageActions: ReactNode }) {
  const saved = { ...(theme.sidebarBackgroundFit ?? DEFAULT_BACKGROUND_FIT), enabled: true };
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<SidebarBackgroundFit>({ ...saved });
  const [saving, setSaving] = useState(false);
  const cover = useCoverSelection();
  const apply = useLibrary((state) => state.applySidebarBackgroundFit);
  const showToast = useLibrary((state) => state.showToast);
  const source = sidebarBackgroundSource(theme, cover.source);
  const original = useAssetUrl(source?.sourceKind ?? "background", source?.file);
  const fitted = useSidebarBackgroundFit(source, draft, true, source?.sourceKind === "superres" ? cover.revision : 0);
  useEffect(() => { setDraft(JSON.parse(savedKey) as SidebarBackgroundFit); }, [savedKey]);
  const dirty = JSON.stringify(draft) !== savedKey;
  // 请求尚未完成时用原图展示当前草稿，避免新参数套用到旧适配结果。
  const readyImage = !fitted.loading && !fitted.error ? fitted.image : null;
  const image = readyImage?.url ?? original;
  const paddingX = readyImage ? readyImage.padding / readyImage.width * 100 : 0;
  const paddingY = readyImage ? readyImage.padding / readyImage.height * 100 : 0;
  const patch = (value: Partial<SidebarBackgroundFit>) => setDraft((previous) => ({ ...previous, ...value }));
  const confirm = async () => {
    setSaving(true);
    try { if (await apply(draft)) showToast("success", "侧栏背景适配已应用"); }
    finally { setSaving(false); }
  };
  return (
    <fieldset className="sidebar-fit-settings" disabled={saving} aria-label="背景取景编辑">
      <div className="sidebar-fit-modes" role="group" aria-label="背景适配方式">
        {MODES.map((mode) => <button type="button" key={mode.value} className="sidebar-segment" disabled={!source} aria-pressed={draft.mode === mode.value} onClick={() => patch({ mode: mode.value })}>{mode.label}</button>)}
      </div>
      <div className="sidebar-fit-preview-row">
        <div className="sidebar-fit-preview-stage">
          <div className="sidebar-fit-preview" role="img" aria-label="侧栏背景适配预览" style={{ aspectRatio: `${fitted.size.cssWidth} / ${fitted.size.cssHeight}`, "--sidebar-preview-ratio": fitted.size.cssWidth / fitted.size.cssHeight } as CSSProperties}>
            {image && <div className="sidebar-fit-preview-art" style={{
              backgroundImage: `url(${JSON.stringify(image)})`,
              backgroundSize: readyImage ? "100% 100%" : draft.mode === "stretch" ? "100% 100%" : draft.mode,
              backgroundPosition: `${draft.positionX}% ${draft.positionY}%`,
              left: `${-paddingX}%`, right: `${-paddingX}%`, top: `${-paddingY}%`, bottom: `${-paddingY}%`,
            } as CSSProperties} />}
            {!image && <div className="sidebar-fit-placeholder"><ImageOff size={24} aria-hidden="true" /><span>{source ? "加载中…" : "暂无背景"}</span></div>}
          </div>
          <div className="sidebar-fit-image-actions">{imageActions}</div>
        </div>
        <div className="sidebar-fit-controls">
          <div className="sidebar-fit-caption">
            <strong>{source ? "图像调整" : "添加一张背景"}</strong>
            <p className="hint m-0">{source ? MODES.find((mode) => mode.value === draft.mode)?.hint : "选择左侧背景；未设置独立背景时，自动使用当前游戏封面。"}</p>
          </div>
          {draft.mode === "cover" && <fieldset className="sidebar-fit-position" disabled={!source}>
            <label className="sidebar-control-label" htmlFor="sidebar-fit-x"><span>水平位置</span><output htmlFor="sidebar-fit-x">{draft.positionX}%</output></label>
            <RangeSlider id="sidebar-fit-x" min={0} max={100} value={draft.positionX} aria-valuetext={`${draft.positionX}%`} onChange={(event) => patch({ positionX: Number(event.target.value) })} />
            <label className="sidebar-control-label" htmlFor="sidebar-fit-y"><span>垂直位置</span><output htmlFor="sidebar-fit-y">{draft.positionY}%</output></label>
            <RangeSlider id="sidebar-fit-y" min={0} max={100} value={draft.positionY} aria-valuetext={`${draft.positionY}%`} onChange={(event) => patch({ positionY: Number(event.target.value) })} />
            <button type="button" className="btn btn-ghost" disabled={draft.positionX === 50 && draft.positionY === 50} onClick={() => patch({ positionX: 50, positionY: 50 })}><RotateCcw size={13} aria-hidden="true" />居中</button>
          </fieldset>}
          {source && <p className="hint m-0">预览仅展示取景，应用后生效。</p>}
          {fitted.loading && <p className="hint m-0" role="status">正在生成预览…</p>}
          {fitted.error && <div className="sidebar-fit-error"><p className="hint m-0" role="alert">{fitted.error}</p><button type="button" className="btn" onClick={fitted.retry}>重试生成</button></div>}
          {source && <details className="sidebar-fit-info hint">
            <summary>图像信息</summary>
            {readyImage && <p>原图 {readyImage.sourceWidth} × {readyImage.sourceHeight}</p>}
            <p>侧栏 {fitted.size.cssWidth} × {fitted.size.cssHeight}</p>
            {fitted.dimensions && <p>适配 {fitted.dimensions.width} × {fitted.dimensions.height} 像素</p>}
          </details>}
        </div>
      </div>
      <div className="sidebar-fit-actions">
        <span className="hint" role="status">{!source ? "等待选择背景" : dirty ? "未应用" : "已保存"}</span>
        <button type="button" className="btn btn-ghost" disabled={!dirty || saving} onClick={() => setDraft({ ...saved })}>还原</button>
        <button type="button" className="btn btn-primary" disabled={!source || !image || !dirty || saving || fitted.loading || Boolean(fitted.error)} onClick={() => void confirm()}>{saving ? "正在应用…" : "应用取景"}</button>
      </div>
    </fieldset>
  );
}
