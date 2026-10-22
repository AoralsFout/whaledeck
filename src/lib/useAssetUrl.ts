import { useEffect, useState } from "react";
import { api, fileUrl } from "./ipc";

/** 把数据目录里的封面/背景文件名解析成可展示的 asset URL */
export function useAssetUrl(
  kind: "cover" | "background",
  file: string | null | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!file) {
      setUrl(null);
      return;
    }
    api
      .assetPath(kind, file)
      .then((abs) => {
        if (alive) setUrl(fileUrl(abs));
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [kind, file]);

  return url;
}
