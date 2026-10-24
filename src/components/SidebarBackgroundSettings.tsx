/**
 * @file 侧栏背景适配草稿：取景预览、确认保存与取消；不即时改变实际侧栏。
 * 对应文档：docs/界面与交互.md §4.3、docs/前端实现.md §4.2.1。
 */
import { useEffect, useState, type CSSProperties } from "react";
import { DEFAULT_BACKGROUND_FIT, sidebarBackgroundSource } from "../lib/backgroundFit";
import { useSidebarBackgroundFit } from "../lib/useSidebarBackgroundFit";
import { useAssetUrl } from "../lib/useAssetUrl";
import { useLibrary } from "../store/useLibrary";
import type { SidebarBackgroundFit, Theme } from "../types";

const MODES = [
  { value: "contain", label: "完整显示", hint: "保留全图，空余区域显示底色" },
  { value: "cover", label: "铺满裁切", hint: "保持比例，可调整保留的画面" },
  { value: "stretch", label: "拉伸铺满", hint: "保留全图并铺满，人物可能变形" },
] as const;

/** 本组件只在外观页挂载，关闭或切页会丢弃尚未确认的草稿。 */
export function SidebarBackgroundSettings({ theme }: { theme: Theme }) {
  const saved = theme.sidebarBackgroundFit ?? DEFAULT_BACKGROUND_FIT;
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<SidebarBackgroundFit>({ ...saved });
  const [saving, setSaving] = useState(false);
  const cover = useLibrary((state) => state.games.find((game) => game.id === state.selectedId)?.coverFile);
  const apply = useLibrary((state) => state.applySidebarBackgroundFit);
  const showToast = useLibrary((state) => state.showToast);
  const source = sidebarBackgroundSource(theme, cover);
  const original = useAssetUrl(source?.sourceKind ?? "background", source?.file);
  const fitted = useSidebarBackgroundFit(source, draft, Boolean(theme.sidebarGlass && !theme.sidebarClearGlass));
  useEffect(() => { setDraft(JSON.parse(savedKey) as SidebarBackgroundFit); }, [savedKey]);
  const dirty = JSON.stringify(draft) !== savedKey;
  const image = draft.enabled ? fitted.image?.url ?? original : original;
  const paddingX = fitted.image && draft.enabled ? fitted.image.padding / fitted.image.width * 100 : 0;
  const paddingY = fitted.image && draft.enabled ? fitted.image.padding / fitted.image.height * 100 : 0;
  const patch = (value: Partial<SidebarBackgroundFit>) => setDraft((previous) => ({ ...previous, ...value }));
  const confirm = async () => {
    setSaving(true);
    try { if (await apply(draft)) showToast("success", "侧栏背景适配已应用"); }
    finally { setSaving(false); }
  };
  return (
    <fieldset className="sidebar-fit-settings" disabled={saving}>
      <legend className="label">背景适配</legend>
      <label className="sidebar-option">
        <span><strong>侧栏背景适配</strong><span className="hint">调整分辨率与取景，预览后点应用保存。</span></span>
        <input aria-label="侧栏背景适配" type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />
      </label>
      {draft.enabled && <>
        <div className="sidebar-fit-modes" role="group" aria-label="背景适配方式">
          {MODES.map((mode) => <button key={mode.value} className="btn" aria-pressed={draft.mode === mode.value} onClick={() => patch({ mode: mode.value })}>{mode.label}</button>)}
        </div>
        <p className="hint m-0">{MODES.find((mode) => mode.value === draft.mode)?.hint}</p>
        {draft.mode === "cover" && <div className="sidebar-fit-position">
          <label className="label" htmlFor="sidebar-fit-x">水平取景（{draft.positionX}%）</label>
          <input id="sidebar-fit-x" type="range" min="0" max="100" value={draft.positionX} onChange={(event) => patch({ positionX: Number(event.target.value) })} />
          <label className="label" htmlFor="sidebar-fit-y">垂直取景（{draft.positionY}%）</label>
          <input id="sidebar-fit-y" type="range" min="0" max="100" value={draft.positionY} onChange={(event) => patch({ positionY: Number(event.target.value) })} />
          <button className="btn btn-ghost" onClick={() => patch({ positionX: 50, positionY: 50 })}>恢复居中</button>
        </div>}
        <div className="sidebar-fit-preview-row">
          <div className="sidebar-fit-preview" role="img" aria-label="侧栏背景适配预览" style={{ aspectRatio: `${fitted.size.cssWidth} / ${fitted.size.cssHeight}` }}>
            {image && <div className="sidebar-fit-preview-art" style={{
              backgroundImage: `url(${JSON.stringify(image)})`,
              backgroundSize: fitted.image ? "100% 100%" : draft.mode === "stretch" ? "100% 100%" : draft.mode,
              backgroundPosition: `${draft.positionX}% ${draft.positionY}%`,
              left: `${-paddingX}%`, right: `${-paddingX}%`, top: `${-paddingY}%`, bottom: `${-paddingY}%`,
            } as CSSProperties} />}
          </div>
          <div className="sidebar-fit-info hint">
            <p className="m-0">{dirty ? "取景预览，尚未应用" : "当前取景预览"}</p>
            {fitted.image && <p>原图 {fitted.image.sourceWidth} × {fitted.image.sourceHeight}</p>}
            <p>侧栏 {fitted.size.cssWidth} × {fitted.size.cssHeight} CSS 像素</p>
            {fitted.dimensions && <p>生成 {fitted.dimensions.width} × {fitted.dimensions.height} 像素</p>}
            <p>预览清晰展示取景；磨砂和透明度以实际侧栏为准。</p>
            {!source && <p>请选择侧栏背景，或开启磨砂使用当前游戏封面。</p>}
            {fitted.loading && <p role="status">正在生成预览…</p>}
            {fitted.error && <><p role="alert">{fitted.error}</p><button className="btn" onClick={fitted.retry}>重试生成</button></>}
          </div>
        </div>
      </>}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={!dirty || saving || Boolean(draft.enabled && source && (fitted.loading || fitted.error))} onClick={() => void confirm()}>{saving ? "正在应用…" : "应用适配"}</button>
        <button className="btn" disabled={!dirty || saving} onClick={() => setDraft({ ...saved })}>取消修改</button>
        <span className="hint" role="status">{dirty ? "有未应用的修改" : "已保存"}</span>
      </div>
    </fieldset>
  );
}
