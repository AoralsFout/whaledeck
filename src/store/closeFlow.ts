/**
 * @file 关闭弹窗状态：事件与快照衔接、互斥提交、卸载后丢弃迟到响应。
 *
 * 不决定能否退出、不写盘；权威关闭状态由后端管理。
 * 对应文档：docs/前端实现.md §4.4、docs/接口契约.md。
 */
import { createStore } from "zustand/vanilla";
import type { CloseAction, CloseRequest } from "../types";

type Dependencies = {
  subscribe: (cb: (request: CloseRequest | null) => void) => Promise<() => void>;
  snapshot: () => Promise<CloseRequest | null>;
  resolve: (action: CloseAction) => Promise<CloseRequest | null>;
};
type CloseFlow = {
  request: CloseRequest | null;
  busy: boolean;
  error: string;
  connect: () => () => void;
  submit: (action: CloseAction) => Promise<void>;
};

/** 先订阅再取快照；新事件使旧快照失效，防止已取消的弹窗重新出现。 */
export function createCloseFlow(deps: Dependencies) {
  let lifetime = 0;
  let revision = 0;
  return createStore<CloseFlow>((set, get) => ({
    request: null, busy: false, error: "",
    connect: () => {
      const current = ++lifetime;
      set({ request: null, busy: false, error: "" });
      let off: (() => void) | undefined;
      void deps.subscribe((request) => {
        if (current !== lifetime) return;
        revision++;
        set({ request, error: "" });
      }).then(async (unsubscribe) => {
        if (current !== lifetime) { unsubscribe(); return; }
        off = unsubscribe;
        const version = revision;
        const request = await deps.snapshot();
        if (current === lifetime && version === revision) set({ request });
      }).catch((err: unknown) => {
        if (current === lifetime) set({ error: `读取关闭请求失败，请重试关闭：${String(err)}` });
      });
      return () => { if (current === lifetime) lifetime++; off?.(); };
    },
    /** 提交完成前忽略重复按钮与取消，避免同一个选择产生多个退出请求。 */
    submit: async (action) => {
      if (get().busy || !get().request) return;
      const current = lifetime;
      const version = revision;
      set({ busy: true, error: "" });
      try {
        const request = await deps.resolve(action);
        if (current === lifetime && version === revision) set({ request });
      } catch (err) {
        if (current === lifetime) set({ error: `操作失败，请重试或取消：${String(err)}` });
      } finally {
        if (current === lifetime) set({ busy: false });
      }
    },
  }));
}
