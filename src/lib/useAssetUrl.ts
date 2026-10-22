import { useEffect, useState } from "react";
import { api, fileUrl } from "./ipc";

/** 把数据目录里的封面/背景文件名解析成可展示的 asset URL */
export function useAssetUrl(
  kind: "cover" | "background" | "icon",
  file: string | null | undefined,
): string | null {
  const [asset, setAsset] = useState<{ kind: string; file: string; url: string } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!file) {
      setAsset(null);
      return;
    }
    api
      .assetPath(kind, file)
      .then((abs) => {
        if (alive) setAsset({ kind, file, url: fileUrl(abs) });
      })
      .catch(() => {
        if (alive) setAsset(null);
      });
    return () => {
      alive = false;
    };
  }, [kind, file]);

  return asset?.kind === kind && asset.file === file ? asset.url : null;
}
