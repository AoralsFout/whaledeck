/**
 * @file 图片资源：解析路径、共享解码与有限复用，并允许窗口等待加载完成。
 *
 * 任何图片失败/卡住都不能无限阻塞窗口显示，因此统一 3 秒超时。
 * 对应文档：docs/前端实现.md「资源」。
 */
import { api, fileUrl } from "./ipc";

const pendingAssets = new Set<Promise<string | null>>();
type AssetKind = "cover" | "background" | "icon" | "superres" | "backgroundFit";
const loading = new Map<string, Promise<string | null>>();
const decoded = new Map<string, { url: string; image: HTMLImageElement; bytes: number }>();
const MAX_IMAGES = 32;
const MAX_BYTES = 96 * 1024 * 1024;
let assetRevision = 0;

/** 重新生成或删除可复用同名文件；使旧请求失效，防止迟到解码恢复旧缓存。 */
export function invalidateAssetUrls(kind?: AssetKind, file?: string): void {
  assetRevision += 1;
  const matches = (key: string) => {
    const [cachedKind, cachedFile] = JSON.parse(key) as [AssetKind, string];
    return (!kind || cachedKind === kind) && (!file || cachedFile === file);
  };
  for (const key of loading.keys()) if (matches(key)) loading.delete(key);
  for (const key of decoded.keys()) if (matches(key)) decoded.delete(key);
}

/** 合并并发加载并保留已解码 Image；LRU 与像素预算限制内存，不缓存失败。 */
export function loadAssetUrl(kind: AssetKind, file: string): Promise<string | null> {
  const key = JSON.stringify([kind, file]);
  const cached = decoded.get(key);
  if (cached) {
    decoded.delete(key);
    decoded.set(key, cached);
    return Promise.resolve(cached.url);
  }
  const existing = loading.get(key);
  if (existing) return existing;
  let timer: ReturnType<typeof setTimeout>;
  let image: HTMLImageElement | null = null;
  const revision = assetRevision;
  const load = async () => {
    const base = fileUrl(await api.assetPath(kind, file));
    const url = revision ? `${base}${base.includes("?") ? "&" : "?"}v=${revision}` : base;
    image = new Image();
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
    if (loading.get(key) === task) {
      loading.delete(key);
      if (url && image) {
        const bytes = image.naturalWidth * image.naturalHeight * 4;
        if (bytes <= MAX_BYTES) {
          decoded.set(key, { url, image, bytes });
          let total = [...decoded.values()].reduce((sum, entry) => sum + entry.bytes, 0);
          while (decoded.size > MAX_IMAGES || total > MAX_BYTES) {
            const oldest = decoded.keys().next().value!;
            total -= decoded.get(oldest)!.bytes;
            decoded.delete(oldest);
          }
        }
      }
    }
    return url;
  });
  loading.set(key, task);
  pendingAssets.add(task);
  return task;
}

/** 等待所有已发起的图片请求结束；失败/超时也会从集合移除，不会死循环。 */
export async function waitForAssets(): Promise<void> {
  while (pendingAssets.size > 0) {
    await Promise.all([...pendingAssets]);
  }
}
