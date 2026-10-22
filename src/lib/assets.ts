/**
 * @file 启动期图片资源：解析路径、解码图片，并允许窗口等待它们完成。
 *
 * 任何图片失败/卡住都不能无限阻塞窗口显示，因此统一 3 秒超时。
 * 对应文档：docs/前端实现.md「资源」。
 */
import { api, fileUrl } from "./ipc";

const pendingAssets = new Set<Promise<string | null>>();

/** Resolve and decode local images before committing them to the UI. */
export function loadAssetUrl(kind: "cover" | "background" | "icon", file: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout>;
  const load = async () => {
    const url = fileUrl(await api.assetPath(kind, file));
    const image = new Image();
    image.src = url;
    await image.decode();
    return url;
  };
  // Missing or stalled artwork must not keep the native window hidden forever.
  const task = Promise.race([
    load().catch(() => null),
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 3000); }),
  ]).then((url) => {
    clearTimeout(timer);
    pendingAssets.delete(task);
    return url;
  });
  pendingAssets.add(task);
  return task;
}

/** 等待所有已发起的图片请求结束；失败/超时也会从集合移除，不会死循环。 */
export async function waitForAssets(): Promise<void> {
  while (pendingAssets.size > 0) {
    await Promise.all([...pendingAssets]);
  }
}
