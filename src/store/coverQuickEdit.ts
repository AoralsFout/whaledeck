/**
 * @file 封面快捷取景草稿与串行保存，不直接读写游戏库或图片。
 * 对应文档：docs/前端实现.md §4.2.2。
 */
import { createStore } from "zustand/vanilla";
import type { CoverFraming } from "../types";

/** 预览独立于持久化；保存期间继续操作时，只保留最新待提交值。 */
export function createCoverQuickEdit(initial: CoverFraming, deps: {
  save: (framing: CoverFraming) => Promise<CoverFraming>;
  error: (error: unknown) => void;
}) {
  const store = createStore<{ draft: CoverFraming | null; saving: boolean }>(() => ({ draft: null, saving: false }));
  let saved = initial;
  let confirmed = initial;
  let previewing = false;
  let pending: CoverFraming | null = null;
  let running: Promise<void> | null = null;

  const editor = Object.assign(store, {
    value: () => store.getState().draft ?? saved,
    preview: (value: CoverFraming) => { previewing = true; store.setState({ draft: value }); },
    // 外部设置保存后同步基准，正在编辑或保存的草稿不被覆盖。
    sync: (value: CoverFraming) => {
      if (!store.getState().draft && !store.getState().saving) saved = confirmed = value;
    },
    cancel: () => {
      previewing = false;
      store.setState({ draft: store.getState().saving ? confirmed : null });
    },
    commit: (): Promise<void> => {
      const draft = store.getState().draft;
      if (!draft) return running ?? Promise.resolve();
      confirmed = draft;
      previewing = false;
      pending = draft;
      if (running) return running;
      store.setState({ saving: true });
      // 延迟到微任务执行，确保同步抛错也不会留下已完成的 running 标记。
      running = Promise.resolve().then(async () => {
        while (pending) {
          const job = pending;
          pending = null;
          try {
            saved = await deps.save(job);
          } catch (error) {
            deps.error(error);
          }
          if (!pending) {
            confirmed = saved;
            if (!previewing) store.setState({ draft: null });
          }
        }
      }).finally(() => { running = null; store.setState({ saving: false }); });
      return running;
    },
  });
  return editor;
}

export type CoverQuickEditor = ReturnType<typeof createCoverQuickEdit>;
