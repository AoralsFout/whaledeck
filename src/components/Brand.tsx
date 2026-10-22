/**
 * @file 侧栏与关于页共用的图标、WhaleDeck 字标组合。
 *
 * 只负责品牌展示，不处理导航；对应文档：docs/界面与交互.md「品牌标识」。
 */
import { APP_ICON_URL } from "../lib/brand";

/** 使用主题文字呈现字标，避免固定颜色的图片文字在深色主题下不可读。 */
export function Brand({ about = false }: { about?: boolean }) {
  const size = about ? 64 : 32;
  return (
    <div className={`flex min-w-0 items-center ${about ? "gap-3" : "gap-2.5"}`} data-tauri-drag-region={about ? undefined : true}>
      <img src={APP_ICON_URL} width={size} height={size} alt="" className="shrink-0 object-contain" draggable={false} data-tauri-drag-region={about ? undefined : true} />
      <div className="min-w-0 leading-tight" data-tauri-drag-region={about ? undefined : true}>
        <p className={`m-0 font-bold tracking-tight ${about ? "text-[26px]" : "text-[15px]"}`} style={{ color: "var(--text)" }} data-tauri-drag-region={about ? undefined : true}>WhaleDeck</p>
        <p className={`m-0 mt-0.5 ${about ? "text-[12px]" : "text-[11px]"}`} style={{ color: "var(--text-dim)" }} data-tauri-drag-region={about ? undefined : true}>鲸鱼游戏台</p>
      </div>
    </div>
  );
}
