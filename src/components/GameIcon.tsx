/**
 * @file 项目图标展示与缺失、损坏图片的应用图标回退。
 *
 * 只影响展示，不修改 iconFile；对应文档：docs/前端实现.md「资源」。
 */
import { useState, type CSSProperties } from "react";
import { APP_ICON_URL } from "../lib/brand";
import { useAssetUrl } from "../lib/useAssetUrl";

/** 解析失败和显示阶段失败都回退；失败状态按 URL 隔离，换图后可重新显示。 */
export function GameIcon({ file, size = 32, className, style, alt = "" }: {
  file: string | null | undefined;
  size?: number;
  className?: string;
  style?: CSSProperties;
  alt?: string;
}) {
  const custom = useAssetUrl("icon", file);
  const [failed, setFailed] = useState<string | null>(null);
  const src = custom && custom !== failed ? custom : APP_ICON_URL;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt}
      className={className}
      style={style}
      draggable={false}
      onError={() => { if (src !== APP_ICON_URL) setFailed(src); }}
    />
  );
}
