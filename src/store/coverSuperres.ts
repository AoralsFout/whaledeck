/**
 * @file 单张封面增强：档位缓存、生成/取消与订阅生命周期。
 *
 * 不修改游戏记录或原图；通过任务标识与请求版本隔离迟到的异步响应。
 * 对应文档：docs/前端实现.md §3.1、docs/接口契约.md §2.10。
 */
import { createStore } from "zustand/vanilla";
import type { SuperResDone, SuperResFailed, SuperResPreset, SuperResProgress } from "../lib/ipc";
import { coverSuperresPreference, type CoverSuperresChoice, type CoverSuperresPreference } from "./coverSuperresPreference";

type Off = () => void;
interface Dependencies {
  status: (id: string, preset: SuperResPreset) => Promise<string | null>;
  task: (id: string) => Promise<SuperResProgress | null>;
  generate: (id: string, preset: SuperResPreset, taskId: string) => Promise<string | null>;
  cancel: (id: string, taskId: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  progress: (cb: (p: SuperResProgress) => void) => Promise<Off>;
  done: (cb: (p: SuperResDone) => void) => Promise<Off>;
  failed: (cb: (p: SuperResFailed) => void) => Promise<Off>;
  cancelled: (cb: (p: SuperResFailed) => void) => Promise<Off>;
  notify: (kind: "success" | "error" | "info", text: string) => void;
}
interface State {
  preset: SuperResPreset;
  files: Record<SuperResPreset, string | null>;
  task: Omit<SuperResProgress, "gameId"> | null;
  ready: boolean;
  filesReady: boolean;
  pending: boolean;
  cancelling: boolean;
  showEnhanced: boolean;
  connect: () => Off;
  select: (preset: SuperResPreset) => void;
  toggle: () => void;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  remove: () => Promise<void>;
}
export const presetLabel = (preset: SuperResPreset) => preset === "quality" ? "质量" : "效率";

/** 未查明缓存前不能回退原图；详情只加载这一处确定的资源。 */
export function coverSuperresSource(state: Pick<State, "preset" | "showEnhanced" | "files" | "filesReady">, cover: string | null): { kind: "cover" | "superres"; file: string } | null {
  if (!cover || (state.showEnhanced && !state.filesReady)) return null;
  const enhanced = state.showEnhanced ? state.files[state.preset] : null;
  return enhanced ? { kind: "superres", file: enhanced } : { kind: "cover", file: cover };
}

/** 每个游戏/封面一个 store；作用域隔离卸载，任务标识隔离连续生成与取消。 */
export function createCoverSuperres(gameId: string, deps: Dependencies, preference: CoverSuperresPreference = coverSuperresPreference) {
  const choice = preference.read(gameId);
  let hasChoice = Boolean(choice);
  const remember = (value: CoverSuperresChoice) => {
    hasChoice = true;
    preference.write(gameId, { preset: value.preset, showEnhanced: value.showEnhanced });
  };
  let scope = 0;
  let connected = false;
  let action = 0;
  let taskRevision = 0;
  const fileRevision = { efficient: 0, quality: 0 };
  const retired = new Set<string>();
  const current = (value: number) => connected && value === scope;
  return createStore<State>((set, get) => ({
    preset: choice?.preset ?? "efficient", files: { efficient: null, quality: null }, filesReady: false,
    task: null, ready: false, pending: false, cancelling: false, showEnhanced: choice?.showEnhanced ?? true,
    connect: () => {
      const lifetime = ++scope;
      connected = true;
      action += 1;
      set({ ready: false, filesReady: false, pending: false, cancelling: false, task: null });
      const matches = (p: { gameId: string }) => current(lifetime) && p.gameId === gameId;
      const adopt = (p: SuperResProgress) => {
        if (!matches(p) || retired.has(p.taskId)) return;
        if (get().pending && !get().task) return;
        // 本地生成请求尚未确认时，旧任务的迟到进度不能替换它。
        if (get().task && get().task?.taskId !== p.taskId && get().pending) return;
        taskRevision += 1;
        set({ ...(!hasChoice ? { preset: p.preset } : {}), task: { taskId: p.taskId, preset: p.preset, stage: p.stage, elapsedMs: p.elapsedMs }, pending: false });
      };
      const settle = (p: { gameId: string; taskId: string }) => {
        if (!matches(p) || retired.has(p.taskId)) return false;
        retired.add(p.taskId);
        // 删除期间到达的旧终态不能取消删除的占位或恢复即将删除的缓存。
        if (get().pending && !get().task) return false;
        if (get().task && get().task?.taskId !== p.taskId) return false;
        action += 1;
        taskRevision += 1;
        set({ task: null, pending: false, cancelling: false });
        return true;
      };
      const finish = (p: SuperResFailed, kind: "info" | "error", text: string) => {
        if (settle(p)) deps.notify(kind, text);
      };
      const subscriptions = [
        deps.progress(adopt),
        deps.done((p) => {
          if (!settle(p)) return;
          const version = ++fileRevision[p.preset];
          // 原图可在任务中被修改，不能直接相信完成事件里的文件。
          void deps.status(gameId, p.preset).then((file) => {
            if (!current(lifetime) || fileRevision[p.preset] !== version || file !== p.file) return;
            set((s) => ({ files: { ...s.files, [p.preset]: file }, ...(s.preset === p.preset ? { showEnhanced: true } : {}) }));
            if (get().preset === p.preset) remember(get());
            deps.notify("success", `${presetLabel(p.preset)}档封面已增强（${(p.elapsedMs / 1000).toFixed(1)} 秒）`);
          }).catch(() => {});
        }),
        deps.failed((p) => finish(p, "error", `封面增强失败：${p.message}`)),
        deps.cancelled((p) => finish(p, "info", "已取消封面增强")),
      ];
      // 两档完成前不把 null 当作缓存不存在；查询仍在订阅后发出，避免漏掉完成事件。
      const loadFiles = () => Promise.all((["efficient", "quality"] as const).map(async (preset) => {
        const version = fileRevision[preset];
        try {
          const file = await deps.status(gameId, preset);
          if (current(lifetime) && version === fileRevision[preset]) set((s) => ({ files: { ...s.files, [preset]: file } }));
        } catch { /* 读取失败仍可显式生成，由生成命令报告具体原因。 */ }
      })).then(() => {
        if (!current(lifetime)) return;
        const state = get();
        const preset = state.task?.preset ?? (state.files.efficient ? "efficient" : state.files.quality ? "quality" : "efficient");
        set({ filesReady: true, ...(!hasChoice ? { preset } : {}) });
      });
      void Promise.allSettled(subscriptions).then(async (results) => {
        if (!current(lifetime)) return;
        if (results.some((r) => r.status === "rejected")) {
          void loadFiles();
          deps.notify("error", "封面增强事件连接失败，请重新打开详情页");
          return;
        }
        const version = taskRevision;
        await Promise.all([
          deps.task(gameId).then((task) => {
            if (!current(lifetime) || version !== taskRevision) return;
            if (task) adopt(task);
          }).catch(() => {}),
          loadFiles(),
        ]);
        if (current(lifetime)) set({ ready: true });
      });
      return () => {
        if (current(lifetime)) { connected = false; scope += 1; set({ ready: false }); }
        subscriptions.forEach((p) => void p.then((off) => off()).catch(() => {}));
      };
    },
    select: (preset) => {
      if (get().task || get().pending) return;
      set({ preset, showEnhanced: true });
      remember(get());
    },
    toggle: () => { set((s) => ({ showEnhanced: !s.showEnhanced })); remember(get()); },
    start: async () => {
      if (!connected || !get().ready || get().task || get().pending) return;
      const lifetime = scope;
      const request = ++action;
      const preset = get().preset;
      const taskId = crypto.randomUUID();
      taskRevision += 1;
      const owns = () => current(lifetime) && request === action && get().task?.taskId === taskId;
      // 调用前占位，防止双击以及命令响应前就到达的进度事件覆盖状态。
      set({ pending: true, task: { taskId, preset, stage: "processing", elapsedMs: 0 } });
      try {
        const file = await deps.generate(gameId, preset, taskId);
        if (!owns()) return;
        if (file) {
          retired.add(taskId);
          fileRevision[preset] += 1;
          set((s) => ({ files: { ...s.files, [preset]: file }, task: null, pending: false, showEnhanced: true }));
          remember(get());
          deps.notify("info", "已复用现有的增强封面");
        } else set({ pending: false });
      } catch (error) {
        if (!owns()) return;
        retired.add(taskId);
        set({ task: null, pending: false, cancelling: false });
        deps.notify("error", String(error));
      }
    },
    cancel: async () => {
      if (!connected || !get().task || get().pending || get().cancelling) return;
      const lifetime = scope;
      const taskId = get().task!.taskId;
      const preset = get().task!.preset;
      const owns = () => current(lifetime) && get().task?.taskId === taskId;
      set({ cancelling: true });
      try {
        const found = await deps.cancel(gameId, taskId);
        if (owns() && !found) {
          retired.add(taskId);
          taskRevision += 1;
          action += 1;
          const request = action;
          const version = fileRevision[preset];
          set({ task: null, cancelling: false });
          // 子进程可能刚好完成，且完成事件还未送达；此时仍应展示有效缓存。
          const file = await deps.status(gameId, preset);
          if (current(lifetime) && request === action && version === fileRevision[preset]) {
            set((s) => ({ files: { ...s.files, [preset]: file } }));
          }
        }
      } catch (error) {
        if (owns()) { set({ cancelling: false }); deps.notify("error", String(error)); }
      }
    },
    remove: async () => {
      if (!connected || !get().ready || get().task || get().pending) return;
      const lifetime = scope;
      const request = ++action;
      fileRevision.efficient += 1;
      fileRevision.quality += 1;
      set({ pending: true });
      try {
        await deps.remove(gameId);
        if (!current(lifetime) || request !== action) return;
        set({ files: { efficient: null, quality: null }, showEnhanced: true });
        deps.notify("info", "已删除所有增强封面，恢复原图");
      } catch (error) { if (current(lifetime) && request === action) deps.notify("error", String(error)); }
      finally { if (current(lifetime) && request === action) set({ pending: false }); }
    },
  }));
}
