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
  generate: (id: string, preset: SuperResPreset, taskId: string, force?: boolean) => Promise<string | null>;
  cancel: (id: string, taskId: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  progress: (cb: (p: SuperResProgress) => void) => Promise<Off>;
  done: (cb: (p: SuperResDone) => void) => Promise<Off>;
  failed: (cb: (p: SuperResFailed) => void) => Promise<Off>;
  cancelled: (cb: (p: SuperResFailed) => void) => Promise<Off>;
  notify: (kind: "success" | "error" | "info", text: string) => void;
  invalidate?: (file?: string) => void;
}
interface State {
  preset: SuperResPreset;
  files: Record<SuperResPreset, string | null>;
  task: Omit<SuperResProgress, "gameId"> | null;
  ready: boolean;
  filesReady: boolean;
  checked: Record<SuperResPreset, boolean>;
  imageRevision: Record<SuperResPreset, number>;
  rejected: Record<SuperResPreset, boolean>;
  pending: boolean;
  cancelling: boolean;
  showEnhanced: boolean;
  connect: () => Off;
  select: (preset: SuperResPreset) => void;
  toggle: () => void;
  rejectFile: (preset: SuperResPreset, file: string) => void;
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
  const queries = new Map<SuperResPreset, Promise<void>>();
  let subscribed = false;
  const retired = new Set<string>();
  const current = (value: number) => connected && value === scope;
  return createStore<State>((set, get) => {
    // 无偏好时仅在效率缺失后探测质量，避免中间误判成原图；显式选择只等待自身。
    const refreshDisplay = () => {
      const s = get();
      const needsFallback = !hasChoice && !s.rejected.efficient && !s.task && s.preset === "efficient"
        && s.checked.efficient && !s.files.efficient && !s.checked.quality;
      set({ filesReady: s.checked[s.preset] && !needsFallback });
    };
    const resolveDisplay = async (lifetime: number): Promise<void> => {
      if (!current(lifetime)) return;
      if (!hasChoice && !get().rejected.efficient && !get().task && get().preset === "efficient" && get().checked.efficient && !get().files.efficient) {
        if (!get().checked.quality) {
          refreshDisplay();
          await ensurePreset("quality", lifetime);
        }
        if (current(lifetime) && !hasChoice && !get().task) set({ preset: get().files.quality ? "quality" : "efficient" });
      }
      if (current(lifetime)) refreshDisplay();
    };
    const ensurePreset = (preset: SuperResPreset, lifetime: number): Promise<void> => {
      if (!current(lifetime) || get().checked[preset]) return Promise.resolve();
      const existing = queries.get(preset);
      if (existing) return existing;
      const version = fileRevision[preset];
      const query = deps.status(gameId, preset).catch(() => null).then(async (file) => {
        if (!current(lifetime) || version !== fileRevision[preset]) return;
        set(s => ({ files: { ...s.files, [preset]: file }, checked: { ...s.checked, [preset]: true } }));
        await resolveDisplay(lifetime);
      }).finally(() => { if (queries.get(preset) === query) queries.delete(preset); });
      queries.set(preset, query);
      return query;
    };
    return {
      preset: choice?.preset ?? "efficient", files: { efficient: null, quality: null }, filesReady: false,
      checked: { efficient: false, quality: false },
      imageRevision: { efficient: 0, quality: 0 },
      rejected: { efficient: false, quality: false },
      task: null, ready: false, pending: false, cancelling: false, showEnhanced: choice?.showEnhanced ?? true,
      connect: () => {
        const lifetime = ++scope;
        connected = true;
        subscribed = false;
        queries.clear();
        action += 1;
        set({ ready: false, filesReady: false, checked: { efficient: false, quality: false }, pending: false, cancelling: false, task: null });
        const matches = (p: { gameId: string }) => current(lifetime) && p.gameId === gameId;
        const adopt = (p: SuperResProgress) => {
          if (!matches(p) || retired.has(p.taskId)) return;
          if (get().pending && !get().task) return;
          // 本地生成请求尚未确认时，旧任务的迟到进度不能替换它。
          if (get().task && get().task?.taskId !== p.taskId && get().pending) return;
          taskRevision += 1;
          set({ ...(!hasChoice ? { preset: p.preset } : {}), filesReady: get().checked[hasChoice ? get().preset : p.preset], task: { taskId: p.taskId, preset: p.preset, stage: p.stage, elapsedMs: p.elapsedMs }, pending: false });
          refreshDisplay();
          if (subscribed) void ensurePreset(get().preset, lifetime);
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
              if (!current(lifetime) || fileRevision[p.preset] !== version) return;
              // 旧封面的终态也会使首次查询失效；以本次实际查询结束该档等待。
              if (file !== p.file) {
                set(s => ({ files: { ...s.files, [p.preset]: file }, checked: { ...s.checked, [p.preset]: true } }));
                void resolveDisplay(lifetime);
                return;
              }
              deps.invalidate?.(file);
              set((s) => ({ files: { ...s.files, [p.preset]: file }, rejected: { ...s.rejected, [p.preset]: false }, checked: { ...s.checked, [p.preset]: true }, imageRevision: { ...s.imageRevision, [p.preset]: s.imageRevision[p.preset] + 1 }, ...(s.preset === p.preset ? { showEnhanced: true } : {}) }));
              if (get().preset === p.preset) remember(get());
              void resolveDisplay(lifetime);
              deps.notify("success", `${presetLabel(p.preset)}档封面已增强（${(p.elapsedMs / 1000).toFixed(1)} 秒）`);
            }).catch(() => {
              if (!current(lifetime) || fileRevision[p.preset] !== version) return;
              queries.delete(p.preset);
              void ensurePreset(p.preset, lifetime);
            });
          }),
          deps.failed((p) => finish(p, "error", `封面增强失败：${p.message}`)),
          deps.cancelled((p) => finish(p, "info", "已取消封面增强")),
        ];
        void Promise.allSettled(subscriptions).then(async (results) => {
          if (!current(lifetime)) return;
          subscribed = true;
          // 先发所选档位查询；显示不依赖任务快照或另一档返回。
          void ensurePreset(get().preset, lifetime);
          if (results.some((r) => r.status === "rejected")) {
            deps.notify("error", "封面增强事件连接失败，请重新打开详情页");
            return;
          }
          const version = taskRevision;
          await deps.task(gameId).then((task) => {
            if (!current(lifetime) || version !== taskRevision) return;
            if (task) adopt(task);
          }).catch(() => {});
          if (current(lifetime)) set({ ready: true });
        });
        return () => {
          if (current(lifetime)) { connected = false; scope += 1; set({ ready: false }); }
          subscriptions.forEach((p) => void p.then((off) => off()).catch(() => {}));
        };
      },
      select: (preset) => {
        if (get().task || get().pending) return;
        set({ preset, showEnhanced: true, filesReady: get().checked[preset] });
        remember(get());
        refreshDisplay();
        if (subscribed) void ensurePreset(preset, scope);
      },
      toggle: () => { set((s) => ({ showEnhanced: !s.showEnhanced })); remember(get()); },
      // 仅接纳仍属于该档位的文件，避免迟到失败信号破坏已替换的结果。
      rejectFile: (preset, file) => {
        if (!connected || get().files[preset] !== file) return;
        fileRevision[preset] += 1;
        deps.invalidate?.(file);
        set(s => ({ files: { ...s.files, [preset]: null }, rejected: { ...s.rejected, [preset]: true }, checked: { ...s.checked, [preset]: true } }));
        refreshDisplay();
        deps.notify("error", `${presetLabel(preset)}档增强图加载失败，已回退原图，可点击魔棒重新生成`);
      },
      start: async () => {
        if (!connected || !get().ready || !get().filesReady || get().task || get().pending) return;
        const lifetime = scope;
        const request = ++action;
        const preset = get().preset;
        const taskId = crypto.randomUUID();
        taskRevision += 1;
        const owns = () => current(lifetime) && request === action && get().task?.taskId === taskId;
        // 调用前占位，防止双击以及命令响应前就到达的进度事件覆盖状态。
        set({ pending: true, task: { taskId, preset, stage: "processing", elapsedMs: 0 } });
        try {
          const file = await (get().rejected[preset] ? deps.generate(gameId, preset, taskId, true) : deps.generate(gameId, preset, taskId));
          if (!owns()) return;
          if (file) {
            retired.add(taskId);
            fileRevision[preset] += 1;
            set((s) => ({ files: { ...s.files, [preset]: file }, rejected: { ...s.rejected, [preset]: false }, checked: { ...s.checked, [preset]: true }, task: null, pending: false, showEnhanced: true }));
            refreshDisplay();
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
              if (file) deps.invalidate?.(file);
              set((s) => ({ files: { ...s.files, [preset]: file }, checked: { ...s.checked, [preset]: true }, imageRevision: { ...s.imageRevision, [preset]: s.imageRevision[preset] + 1 } }));
              refreshDisplay();
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
          deps.invalidate?.();
          set({ files: { efficient: null, quality: null }, rejected: { efficient: false, quality: false }, checked: { efficient: true, quality: true }, filesReady: true, showEnhanced: true });
          deps.notify("info", "已删除所有增强封面，恢复原图");
        } catch (error) { if (current(lifetime) && request === action) deps.notify("error", String(error)); }
        finally { if (current(lifetime) && request === action) set({ pending: false }); }
      },
    };
  });
}
