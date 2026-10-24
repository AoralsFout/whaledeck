/**
 * @file 封面增强测试：两档缓存、异步事件、取消、删除和组件生命周期。
 * 对应文档：docs/前端实现.md §3.1、docs/接口契约.md §2.10。
 */
import { describe, expect, it, vi } from "vitest";
import type { SuperResDone, SuperResFailed, SuperResPreset, SuperResProgress } from "../lib/ipc";
import { coverSuperresSource, createCoverSuperres } from "./coverSuperres";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup() {
  let progress!: (p: SuperResProgress) => void;
  let done!: (p: SuperResDone) => void;
  let failed!: (p: SuperResFailed) => void;
  let cancelled!: (p: SuperResFailed) => void;
  const off = vi.fn();
  const deps = {
    status: vi.fn<(id: string, preset: SuperResPreset) => Promise<string | null>>().mockResolvedValue(null),
    generate: vi.fn<(id: string, preset: SuperResPreset, taskId: string, force?: boolean) => Promise<string | null>>().mockResolvedValue(null),
    task: vi.fn<() => Promise<SuperResProgress | null>>().mockResolvedValue(null),
    cancel: vi.fn<(id: string, taskId: string) => Promise<boolean>>().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(undefined), notify: vi.fn(),
    invalidate: vi.fn(),
    progress: async (cb: typeof progress) => { progress = cb; return off; },
    done: async (cb: typeof done) => { done = cb; return off; },
    failed: async (cb: typeof failed) => { failed = cb; return off; },
    cancelled: async (cb: typeof cancelled) => { cancelled = cb; return off; },
  };
  const store = createCoverSuperres("g", deps, { read: () => null, write: vi.fn() });
  return { store, deps, off, progress: (p: SuperResProgress) => progress(p), done: (p: SuperResDone) => done(p),
    failed: (p: SuperResFailed) => failed(p), cancelled: (p: SuperResFailed) => cancelled(p) };
}

describe("封面超分", () => {
  it("增强图加载失败后回退原图，不自动生成，点击才强制重建当前档", async () => {
    const { store, deps, done } = setup();
    deps.status.mockImplementation(async (_, preset) => `${preset}.png`);
    store.getState().connect(); await flush();
    store.getState().rejectFile("efficient", "efficient.png");
    expect(coverSuperresSource(store.getState(), "original.png")).toEqual({ kind: "cover", file: "original.png" });
    expect(store.getState().rejected.efficient).toBe(true);
    expect(deps.invalidate).toHaveBeenCalledWith("efficient.png");
    expect(deps.notify).toHaveBeenCalledWith("error", expect.stringContaining("加载失败"));
    expect(deps.generate).not.toHaveBeenCalled();
    await store.getState().start();
    expect(deps.generate).toHaveBeenCalledExactlyOnceWith("g", "efficient", expect.any(String), true);
    done({ gameId: "g", taskId: store.getState().task!.taskId, preset: "efficient", file: "efficient.png", elapsedMs: 200 });
    await flush();
    expect(store.getState().rejected.efficient).toBe(false);
    expect(coverSuperresSource(store.getState(), "original.png")).toEqual({ kind: "superres", file: "efficient.png" });
  });

  it("加载失败仅标记对应档位，旧文件或卸载后的失败不能破坏当前缓存", async () => {
    const { store, deps } = setup();
    deps.status.mockImplementation(async (_, preset) => `${preset}.png`);
    const disconnect = store.getState().connect(); await flush();
    store.getState().select("quality"); await flush();
    store.getState().rejectFile("quality", "old.png");
    expect(deps.notify).not.toHaveBeenCalled();
    store.getState().rejectFile("quality", "quality.png");
    expect(store.getState().files).toEqual({ efficient: "efficient.png", quality: null });
    disconnect(); store.getState().rejectFile("efficient", "efficient.png");
    expect(store.getState().files.efficient).toBe("efficient.png");
  });

  it("恢复所选质量档时只查询质量，不等待或读取效率档", async () => {
    const { deps } = setup();
    const blocked = deferred<string | null>();
    deps.status.mockImplementation((_, preset) => preset === "quality" ? Promise.resolve("quality.png") : blocked.promise);
    const store = createCoverSuperres("g", deps, { read: () => ({ preset: "quality", showEnhanced: true }), write: vi.fn() });
    store.getState().connect(); await flush();
    expect(deps.status).toHaveBeenCalledExactlyOnceWith("g", "quality");
    expect(coverSuperresSource(store.getState(), "original.png")).toEqual({ kind: "superres", file: "quality.png" });
    store.getState().select("efficient"); await flush();
    expect(coverSuperresSource(store.getState(), "original.png")).toBeNull();
    store.getState().select("quality");
    expect(coverSuperresSource(store.getState(), "original.png")).toEqual({ kind: "superres", file: "quality.png" });
    expect(deps.status).toHaveBeenCalledTimes(2);
    blocked.resolve("efficient.png"); await flush();
    expect(store.getState().preset).toBe("quality");
  });

  it("无偏好且效率缓存存在时不查询另一档", async () => {
    const { store, deps } = setup();
    deps.status.mockResolvedValue("efficient.png");
    store.getState().connect(); await flush();
    expect(deps.status).toHaveBeenCalledExactlyOnceWith("g", "efficient");
    expect(coverSuperresSource(store.getState(), "original.png")).toEqual({ kind: "superres", file: "efficient.png" });
  });

  it("新档位尚未查明时不能短暂输出原图，迟到查询不改变所选档位", async () => {
    const { store, deps } = setup();
    deps.status.mockResolvedValueOnce("efficient.png");
    store.getState().connect(); await flush();
    const slow = deferred<string | null>(); deps.status.mockReturnValueOnce(slow.promise);
    const sources: ReturnType<typeof coverSuperresSource>[] = [];
    store.subscribe(() => sources.push(coverSuperresSource(store.getState(), "original.png")));
    store.getState().select("quality");
    store.getState().select("efficient");
    slow.resolve("quality.png"); await flush();
    expect(sources.some(source => source?.kind === "cover")).toBe(false);
    expect(store.getState().preset).toBe("efficient");
  });

  it("同名图片重新生成完成后使图片缓存及展示版本失效，删除清空资源复用", async () => {
    const { store, deps, done } = setup();
    deps.status.mockResolvedValue("same.png");
    store.getState().connect(); await flush();
    done({ gameId: "g", taskId: "refresh", preset: "efficient", file: "same.png", elapsedMs: 100 });
    await flush();
    expect(deps.invalidate).toHaveBeenCalledWith("same.png");
    expect(store.getState().imageRevision.efficient).toBe(1);
    await store.getState().remove();
    expect(deps.invalidate).toHaveBeenLastCalledWith();
  });

  it("旧完成事件打断首次查询时，当前无缓存仍能结束查询并允许生成", async () => {
    const { deps, done } = setup();
    const initial = deferred<string | null>();
    deps.status.mockReturnValueOnce(initial.promise).mockResolvedValue(null);
    const store = createCoverSuperres("g", deps, { read: () => ({ preset: "quality", showEnhanced: true }), write: vi.fn() });
    store.getState().connect(); await flush();
    done({ gameId: "g", taskId: "old-cover", preset: "quality", file: "old.png", elapsedMs: 100 });
    await flush(); initial.resolve("stale.png"); await flush();
    expect(coverSuperresSource(store.getState(), "original.png")).toEqual({ kind: "cover", file: "original.png" });
    expect(store.getState().files.quality).toBeNull();
    await store.getState().start();
    expect(deps.generate).toHaveBeenCalledOnce();
  });

  it("切换游戏重建详情后恢复该游戏的质量档及原图选择", async () => {
    const { deps } = setup();
    let choice = { preset: "efficient" as SuperResPreset, showEnhanced: true };
    const preference = { read: () => choice, write: (_id: string, value: typeof choice) => { choice = value; } };
    const first = createCoverSuperres("g", deps, preference);
    const disconnect = first.getState().connect(); await flush();
    first.getState().select("quality");
    first.getState().toggle();
    disconnect();
    const second = createCoverSuperres("g", deps, preference);
    second.getState().connect(); await flush();
    expect(second.getState()).toMatchObject({ preset: "quality", showEnhanced: false });
  });

  it("没有选择记录且只有质量缓存时直接选择质量档", async () => {
    const { store, deps } = setup();
    deps.status.mockImplementation(async (_, preset) => preset === "quality" ? "quality.png" : null);
    store.getState().connect(); await flush();
    expect(store.getState()).toMatchObject({ preset: "quality", showEnhanced: true });
  });

  it("两档查询结束前不能把未知缓存当作不存在", async () => {
    const { store, deps } = setup();
    const quality = deferred<string | null>();
    deps.status.mockImplementation(async (_, preset) => preset === "quality" ? quality.promise : null);
    store.getState().connect(); await flush();
    expect(store.getState()).toMatchObject({ filesReady: false });
    quality.resolve("quality.png"); await flush();
    expect(store.getState()).toMatchObject({ filesReady: true, preset: "quality" });
  });

  it("查询期间与质量缓存就绪后都不会选择原图资源", async () => {
    const { store, deps } = setup();
    const efficient = deferred<string | null>();
    const quality = deferred<string | null>();
    deps.status.mockImplementation((_, preset) => preset === "quality" ? quality.promise : efficient.promise);
    const sources: ReturnType<typeof coverSuperresSource>[] = [];
    const sample = () => sources.push(coverSuperresSource(store.getState(), "original.png"));
    store.subscribe(sample);
    sample(); store.getState().connect(); await flush();
    efficient.resolve(null); await flush();
    expect(sources.every((source) => source === null)).toBe(true);
    quality.resolve("quality.png"); await flush();
    expect(coverSuperresSource(store.getState(), "original.png")).toEqual({ kind: "superres", file: "quality.png" });
    expect(sources.some((source) => source?.kind === "cover")).toBe(false);
  });

  it("记住的质量档缺失时保留档位，查明后才选择原图", async () => {
    const { deps } = setup();
    deps.status.mockImplementation(async (_, preset) => preset === "efficient" ? "efficient.png" : null);
    const preference = { read: () => ({ preset: "quality" as const, showEnhanced: true }), write: vi.fn() };
    const store = createCoverSuperres("g", deps, preference);
    expect(coverSuperresSource(store.getState(), "original.png")).toBeNull();
    store.getState().connect(); await flush();
    expect(store.getState().preset).toBe("quality");
    expect(coverSuperresSource(store.getState(), "original.png")).toEqual({ kind: "cover", file: "original.png" });
  });

  it("恢复运行中任务不会覆盖已记住的显示选择", async () => {
    const { deps, progress } = setup();
    deps.task.mockResolvedValue({ gameId: "g", taskId: "running", preset: "efficient", stage: "processing", elapsedMs: 100 });
    const preference = { read: () => ({ preset: "quality" as const, showEnhanced: false }), write: vi.fn() };
    const store = createCoverSuperres("g", deps, preference);
    store.getState().connect(); await flush();
    progress({ gameId: "g", taskId: "running", preset: "efficient", stage: "saving", elapsedMs: 200 });
    expect(store.getState()).toMatchObject({ preset: "quality", showEnhanced: false, task: { preset: "efficient", stage: "saving" } });
    expect(preference.write).not.toHaveBeenCalled();
  });


  it("删除期间的迟到进度和完成不能中断删除或恢复旧文件", async () => {
    const { store, deps, progress, done } = setup();
    deps.status.mockResolvedValue("existing.png");
    store.getState().connect(); await flush();
    const response = deferred<void>();
    deps.remove.mockReturnValueOnce(response.promise);
    const removing = store.getState().remove();
    progress({ gameId: "g", taskId: "old", preset: "efficient", stage: "saving", elapsedMs: 900 });
    done({ gameId: "g", taskId: "old", preset: "efficient", file: "existing.png", elapsedMs: 1000 });
    expect(store.getState()).toMatchObject({ pending: true, task: null });
    response.resolve(); await removing; await flush();
    expect(store.getState()).toMatchObject({ pending: false, files: { efficient: null, quality: null } });
  });

  it("取消恰逢任务完成时刷新结果，不依赖迟到完成事件", async () => {
    const { store, deps } = setup();
    store.getState().connect(); await flush();
    await store.getState().start();
    deps.cancel.mockResolvedValue(false);
    deps.status.mockResolvedValue("finished.png");
    await store.getState().cancel();
    expect(store.getState()).toMatchObject({ task: null, cancelling: false, files: { efficient: "finished.png" } });
  });
  it("返回详情时从快照恢复质量档缩图阶段，并按任务标识取消", async () => {
    const { store, deps } = setup();
    deps.task.mockResolvedValue({ gameId: "g", taskId: "running", preset: "quality", stage: "resizing", elapsedMs: 8100 });
    store.getState().connect(); await flush();
    expect(store.getState()).toMatchObject({ ready: true, preset: "quality", task: { taskId: "running", stage: "resizing", elapsedMs: 8100 } });
    await store.getState().cancel();
    expect(deps.cancel).toHaveBeenCalledExactlyOnceWith("g", "running");
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it("迟到的任务快照不能让已结束的任务重新转圈", async () => {
    const { store, deps, done } = setup();
    const snapshot = deferred<SuperResProgress | null>();
    deps.task.mockReturnValueOnce(snapshot.promise);
    store.getState().connect(); await flush();
    deps.status.mockResolvedValue("quality.png");
    done({ gameId: "g", taskId: "finished", preset: "quality", file: "quality.png", elapsedMs: 8500 });
    await flush();
    snapshot.resolve({ gameId: "g", taskId: "finished", preset: "quality", stage: "processing", elapsedMs: 500 });
    await flush();
    expect(store.getState()).toMatchObject({ ready: true, task: null, files: { quality: "quality.png" } });
  });

  it("新任务不接受上一任务迟到的失败、完成和进度", async () => {
    const { store, deps, cancelled, failed, done, progress } = setup();
    store.getState().connect(); await flush();
    await store.getState().start();
    const oldId = store.getState().task!.taskId;
    cancelled({ gameId: "g", taskId: oldId, preset: "efficient", message: "已取消" });
    await store.getState().start();
    const newId = store.getState().task!.taskId;
    failed({ gameId: "g", taskId: oldId, preset: "efficient", message: "迟到错误" });
    done({ gameId: "g", taskId: oldId, preset: "efficient", file: "old.png", elapsedMs: 900 });
    progress({ gameId: "g", taskId: oldId, preset: "efficient", stage: "saving", elapsedMs: 800 });
    expect(store.getState().task?.taskId).toBe(newId);
    expect(deps.notify).toHaveBeenCalledExactlyOnceWith("info", "已取消封面增强");
  });

  it("旧生成命令的迟到缓存响应不替换下一任务", async () => {
    const { store, deps, cancelled, progress } = setup();
    store.getState().connect(); await flush();
    const response = deferred<string | null>();
    deps.generate.mockReturnValueOnce(response.promise);
    const generating = store.getState().start();
    const oldId = store.getState().task!.taskId;
    progress({ gameId: "g", taskId: oldId, preset: "efficient", stage: "processing", elapsedMs: 500 });
    cancelled({ gameId: "g", taskId: oldId, preset: "efficient", message: "已取消" });
    await store.getState().start();
    const newId = store.getState().task!.taskId;
    response.resolve("old.png"); await generating;
    expect(store.getState().task?.taskId).toBe(newId);
    expect(store.getState().files.efficient).toBeNull();
  });

  it("一个档位完成时不丢弃另一档尚未返回的缓存查询", async () => {
    const { store, deps, done } = setup();
    const efficient = deferred<string | null>();
    deps.status.mockReturnValueOnce(efficient.promise);
    store.getState().connect(); await flush();
    deps.status.mockResolvedValue("quality.png");
    done({ gameId: "g", taskId: "quality", preset: "quality", file: "quality.png", elapsedMs: 8000 });
    efficient.resolve("efficient.png"); await flush();
    expect(store.getState().files).toEqual({ efficient: "efficient.png", quality: "quality.png" });
  });
  it("旧取消响应晚于下一次生成时不能清除新任务", async () => {
    const { store, deps, cancelled } = setup();
    store.getState().connect(); await flush();
    await store.getState().start();
    const response = deferred<boolean>();
    deps.cancel.mockReturnValueOnce(response.promise);
    const cancelling = store.getState().cancel();
    cancelled({ gameId: "g", taskId: store.getState().task!.taskId, preset: "efficient", message: "已取消" });
    await store.getState().start();
    response.resolve(false); await cancelling;
    expect(store.getState().task).not.toBeNull();
  });
  it("默认效率；切档只显示独立缓存，不运行模型；删除清空两档", async () => {
    const { store, deps } = setup();
    deps.status.mockImplementation(async (_, preset) => `${preset}.png`);
    store.getState().connect(); await flush();
    expect(store.getState()).toMatchObject({ ready: true, preset: "efficient", files: { efficient: "efficient.png", quality: null } });
    store.getState().select("quality");
    await flush();
    expect(store.getState().preset).toBe("quality");
    expect(store.getState().files.quality).toBe("quality.png");
    expect(deps.generate).not.toHaveBeenCalled();
    await store.getState().remove();
    expect(store.getState().files).toEqual({ efficient: null, quality: null });
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith("g");
  });

  it("订阅就绪前不能生成，双击只启动一次，任务中不能切档或删除", async () => {
    const { store, deps, progress } = setup();
    const disconnect = store.getState().connect();
    await store.getState().start(); expect(deps.generate).not.toHaveBeenCalled();
    await flush();
    const request = deferred<string | null>(); deps.generate.mockReturnValueOnce(request.promise);
    store.getState().select("quality");
    const first = store.getState().start();
    await store.getState().start();
    store.getState().select("efficient"); await store.getState().remove();
    expect(deps.generate).toHaveBeenCalledExactlyOnceWith("g", "quality", expect.any(String));
    expect(deps.remove).not.toHaveBeenCalled();
    expect(store.getState().preset).toBe("quality");
    progress({ gameId: "other", taskId: "other", preset: "efficient", stage: "saving", elapsedMs: 20 });
    expect(store.getState().task?.preset).toBe("quality");
    request.resolve(null); await first; disconnect();
  });

  it("完成后校验当前封面，不接纳旧封面结果；正确结果按档写入", async () => {
    const { store, deps, done } = setup();
    store.getState().connect(); await flush();
    done({ gameId: "g", taskId: "external-task", preset: "quality", file: "old.png", elapsedMs: 7000 });
    await flush(); expect(store.getState().files.quality).toBeNull();
    deps.status.mockResolvedValue("quality.png");
    done({ gameId: "g", taskId: "valid-task", preset: "quality", file: "quality.png", elapsedMs: 8200 });
    await flush();
    expect(store.getState().files).toEqual({ efficient: null, quality: "quality.png" });
    expect(deps.notify).toHaveBeenCalledExactlyOnceWith("success", "质量档封面已增强（8.2 秒）");
  });

  it("删除后不被迟到的完成校验恢复", async () => {
    const { store, deps, done } = setup();
    store.getState().connect(); await flush();
    const late = deferred<string | null>(); deps.status.mockReturnValueOnce(late.promise);
    done({ gameId: "g", taskId: "external-task", preset: "quality", file: "late.png", elapsedMs: 5000 });
    await store.getState().remove(); late.resolve("late.png"); await flush();
    expect(store.getState().files.quality).toBeNull();
  });

  it("取消等待后端确认，失败可重试，已有缓存保留", async () => {
    const { store, deps, cancelled, failed } = setup();
    deps.status.mockResolvedValue("existing.png");
    store.getState().connect(); await flush();
    store.getState().select("quality"); await flush(); await store.getState().start();
    await store.getState().cancel();
    expect(store.getState()).toMatchObject({ cancelling: true, task: { preset: "quality" } });
    cancelled({ gameId: "g", taskId: store.getState().task!.taskId, preset: "quality", message: "已取消" });
    expect(store.getState()).toMatchObject({ task: null, cancelling: false });
    await store.getState().start();
    failed({ gameId: "g", taskId: store.getState().task!.taskId, preset: "quality", message: "Vulkan 不可用" });
    expect(store.getState()).toMatchObject({ task: null, pending: false, files: { efficient: "existing.png" } });
    await store.getState().start(); expect(deps.generate).toHaveBeenCalledTimes(3);
  });

  it("离开详情清理订阅并丢弃迟到响应", async () => {
    const { store, deps, off, done } = setup();
    const disconnect = store.getState().connect(); await flush();
    const late = deferred<string | null>(); deps.generate.mockReturnValueOnce(late.promise);
    const request = store.getState().start(); disconnect();
    late.resolve("late.png"); await request;
    done({ gameId: "g", taskId: "external-task", preset: "efficient", file: "late.png", elapsedMs: 100 });
    await flush();
    expect(off).toHaveBeenCalledTimes(4);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(store.getState().files.efficient).toBeNull();
  });

  it("StrictMode 重连不接纳上一轮读取，缓存命中直接展示", async () => {
    const { store, deps } = setup();
    const old = deferred<string | null>(); deps.status.mockReturnValueOnce(old.promise);
    const disconnect = store.getState().connect(); await flush(); disconnect();
    store.getState().connect(); await flush();
    old.resolve("stale.png"); await flush();
    expect(store.getState().files.efficient).toBeNull();
    deps.generate.mockResolvedValue("cached.png"); await store.getState().start();
    expect(store.getState()).toMatchObject({ task: null, files: { efficient: "cached.png" } });
  });
});
