/**
 * @file 资源 Hook：把数据目录中的文件名解析成可展示 URL。
 *
 * 用 {kind, file, url} 三元组校验，防止切换游戏时旧图片的异步结果覆盖新图片。
 * 对应文档：docs/前端实现.md「资源」。
 */
import { useEffect, useState } from "react";
import { loadAssetUrl } from "./assets";

/** 把数据目录里的封面/背景文件名解析成可展示的 asset URL */
export function useAssetUrl(
  kind: "cover" | "background" | "icon" | "superres",
  file: string | null | undefined,
): string | null {
  const [asset, setAsset] = useState<{ kind: string; file: string; url: string } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!file) {
      setAsset(null);
      return;
    }
    void loadAssetUrl(kind, file).then((url) => {
      if (alive) setAsset(url ? { kind, file, url } : null);
    });
    return () => {
      alive = false;
    };
  }, [kind, file]);

  return asset?.kind === kind && asset.file === file ? asset.url : null;
}
