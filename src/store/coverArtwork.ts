/**
 * @file 展示页封面的解码与替换；保留当前图像，不参与增强档位或游戏写入。
 * 对应文档：docs/前端实现.md §4.2。
 */
import { createStore } from "zustand/vanilla";
import { loadAssetUrl } from "../lib/assets";
import type { CoverFraming } from "../types";

type Source = { kind: "cover" | "superres"; file: string };
type Frame = { scope: string; url: string; framing: CoverFraming };
interface State {
  frame: Frame | null;
  update: (scope: string, source: Source | null | undefined, framing: CoverFraming) => void;
  dispose: () => void;
}

/** undefined 表示目标尚未查明，null 表示明确无图；仅当前请求可提交解码结果。 */
export function createCoverArtwork(load: typeof loadAssetUrl = loadAssetUrl) {
  let revision = 0;
  let key: string | null = null;
  let latestFraming: CoverFraming;
  return createStore<State>((set, get) => ({
    frame: null,
    update: (scope, source, framing) => {
      latestFraming = framing;
      const nextKey = JSON.stringify([scope, source === undefined ? "pending" : source]);
      if (key === nextKey) {
        const frame = get().frame;
        if (frame?.scope === scope) set({ frame: { ...frame, framing } });
        return;
      }
      key = nextKey;
      const request = ++revision;
      if (source === undefined) return;
      if (source === null) { set({ frame: null }); return; }
      void load(source.kind, source.file).then((url) => {
        if (request !== revision) return;
        set({ frame: url ? { scope, url, framing: latestFraming } : null });
      });
    },
    // StrictMode 可重新进入同一目标；卸载只使异步结果失效，不修改已显示图像。
    dispose: () => { revision += 1; key = null; },
  }));
}
