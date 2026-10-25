/**
 * @file 当前游戏的共享封面选择：连接超分状态，向背景和设置发布同一资源。
 * 不生成图片或保存游戏记录；对应文档：docs/前端实现.md §3.1、§4.2.1。
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useStore } from "zustand";
import { api, onSuperResCancelled, onSuperResDone, onSuperResFailed, onSuperResProgress } from "../lib/ipc";
import { invalidateAssetUrls } from "../lib/assets";
import { coverSuperresSource, createCoverSuperres } from "../store/coverSuperres";
import { useLibrary } from "../store/useLibrary";
import type { Game } from "../types";

type CoverSelection = {
  enhanceStore: ReturnType<typeof createCoverSuperres>;
  source: ReturnType<typeof coverSuperresSource> | undefined;
  revision: number;
};
const Context = createContext<CoverSelection | null>(null);

/** 当前选择只有一份查询与订阅；无选中游戏时不连接后端，切换时清理旧生命周期。 */
export function CoverSelectionProvider({ game, children }: { game: Game | null; children: ReactNode }) {
  const notify = useLibrary(state => state.showToast);
  const enhanceStore = useMemo(() => createCoverSuperres(game?.id ?? "", {
    status: api.superresStatus, task: api.superresTask, generate: api.superresGenerate,
    cancel: api.superresCancel, remove: api.superresRemove,
    progress: onSuperResProgress, done: onSuperResDone,
    failed: onSuperResFailed, cancelled: onSuperResCancelled, notify,
    invalidate: file => invalidateAssetUrls("superres", file),
  }), [game?.id, game?.coverFile, notify]);
  useEffect(() => {
    if (game?.id) return enhanceStore.getState().connect();
  }, [enhanceStore, game?.id]);
  const enhancement = useStore(enhanceStore);
  const source = !game?.coverFile ? null : coverSuperresSource(enhancement, game.coverFile) ?? undefined;
  const revision = source?.kind === "superres" ? enhancement.imageRevision[enhancement.preset] : 0;
  return <Context.Provider value={{ enhanceStore, source, revision }}>{children}</Context.Provider>;
}

/** 所有消费者必须位于 App 的共享范围内，避免悄悄创建第二份超分选择。 */
export function useCoverSelection() {
  const selection = useContext(Context);
  if (!selection) throw new Error("封面选择尚未初始化");
  return selection;
}
