/**
 * @file 展示页封面替换测试：保留旧图及取景，隔离迟到解码、无图与卸载。
 * 对应文档：docs/前端实现.md §4.2。
 */
import { describe, expect, it, vi } from "vitest";
import { createCoverArtwork } from "./coverArtwork";
import type { loadAssetUrl } from "../lib/assets";

const framing = { file: "a.png", positionX: 20, positionY: 50, zoom: 1.5 };
const nextFraming = { file: "b.png", positionX: 80, positionY: 50, zoom: 1 };
const source = { kind: "superres" as const, file: "a-efficient.png" };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>(done => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const load = vi.fn<typeof loadAssetUrl>().mockResolvedValue("asset:a");
  const store = createCoverArtwork(load);
  return { store, load };
}

describe("展示页封面替换", () => {
  it("增强图失败交给当前请求恢复，原图加载完前保持旧图", async () => {
    const { store, load } = setup();
    store.getState().update("a", source, framing); await flush();
    const previous = store.getState().frame;
    const onFailure = vi.fn(); load.mockResolvedValueOnce(null);
    store.getState().update("b", { ...source, file: "bad.png" }, nextFraming, onFailure); await flush();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(store.getState().frame).toBe(previous);
    const original = deferred(); load.mockReturnValueOnce(original.promise);
    store.getState().update("b", { kind: "cover", file: "b.png" }, nextFraming, onFailure);
    expect(store.getState().frame).toBe(previous);
    original.resolve("asset:original"); await flush();
    expect(store.getState().frame?.url).toBe("asset:original");
  });

  it("迟到失败不报告；当前原图也失败时清理上一游戏图像", async () => {
    const { store, load } = setup();
    store.getState().update("a", source, framing); await flush();
    const old = deferred(); const staleFailure = vi.fn();
    load.mockReturnValueOnce(old.promise);
    store.getState().update("b", { ...source, file: "bad.png" }, nextFraming, staleFailure);
    const currentFailure = vi.fn(); load.mockResolvedValueOnce(null);
    store.getState().update("c", { kind: "cover", file: "c.png" }, nextFraming, currentFailure); await flush();
    old.resolve(null); await flush();
    expect(staleFailure).not.toHaveBeenCalled();
    expect(currentFailure).toHaveBeenCalledOnce();
    expect(store.getState().frame).toBeNull();
  });

  it("缓存待定和新图解码期间保持旧图及取景，解码完成后一起替换", async () => {
    const { store, load } = setup();
    store.getState().update("a", source, framing); await flush();
    const previous = store.getState().frame;
    store.getState().update("b", undefined, nextFraming);
    expect(store.getState().frame).toBe(previous);
    expect(load).toHaveBeenCalledTimes(1);
    const next = deferred(); load.mockReturnValueOnce(next.promise);
    store.getState().update("b", { ...source, file: "b-quality.png" }, nextFraming);
    expect(store.getState().frame).toBe(previous);
    next.resolve("asset:b"); await flush();
    expect(store.getState().frame).toEqual({ scope: "b", url: "asset:b", framing: nextFraming });
  });

  it("快速切换时，旧解码即使晚于新目标完成也不能替换当前图", async () => {
    const { store, load } = setup();
    const old = deferred(); load.mockReturnValueOnce(old.promise);
    store.getState().update("a", source, framing);
    load.mockResolvedValueOnce("asset:b");
    store.getState().update("b", { ...source, file: "b.png" }, nextFraming); await flush();
    old.resolve("asset:late-a"); await flush();
    expect(store.getState().frame).toEqual({ scope: "b", url: "asset:b", framing: nextFraming });
  });

  it("缓存待定也使上一目标的解码失效", async () => {
    const { store, load } = setup();
    const old = deferred(); load.mockReturnValueOnce(old.promise);
    store.getState().update("a", source, framing);
    store.getState().update("b", undefined, nextFraming);
    old.resolve("asset:late-a"); await flush();
    expect(store.getState().frame).toBeNull();
  });

  it("只调整取景不会重复加载，等待解码时采用最新取景", async () => {
    const { store, load } = setup();
    const next = deferred(); load.mockReturnValueOnce(next.promise);
    store.getState().update("a", source, framing);
    const changed = { ...framing, zoom: 2 };
    store.getState().update("a", source, changed);
    expect(load).toHaveBeenCalledTimes(1);
    next.resolve("asset:a"); await flush();
    expect(store.getState().frame?.framing).toEqual(changed);
    store.getState().update("a", source, framing);
    expect(store.getState().frame?.framing).toEqual(framing);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("明确无图或解码失败后清理旧图，避免无限保留其他游戏封面", async () => {
    const { store, load } = setup();
    store.getState().update("a", source, framing); await flush();
    store.getState().update("b", null, nextFraming);
    expect(store.getState().frame).toBeNull();
    store.getState().update("a", source, framing); await flush();
    const failed = deferred(); load.mockReturnValueOnce(failed.promise);
    store.getState().update("b", { ...source, file: "bad.png" }, nextFraming);
    expect(store.getState().frame?.url).toBe("asset:a");
    failed.resolve(null); await flush();
    expect(store.getState().frame).toBeNull();
  });

  it("改用用户背景时清空封面并丢弃迟到解码，清除背景后可恢复同一项目", async () => {
    const { store, load } = setup();
    store.getState().update("a", source, framing); await flush();
    const pending = deferred(); load.mockReturnValueOnce(pending.promise);
    store.getState().update("b", { kind: "cover", file: "b.png" }, nextFraming);
    store.getState().update("b", null, nextFraming);
    expect(store.getState().frame).toBeNull();
    pending.resolve("asset:late-cover"); await flush();
    expect(store.getState().frame).toBeNull();
    store.getState().update("b", { kind: "cover", file: "b.png" }, nextFraming); await flush();
    expect(store.getState().frame).toEqual({ scope: "b", url: "asset:a", framing: nextFraming });
  });

  it("卸载丢弃迟到结果，StrictMode 重连能重新加载同一目标", async () => {
    const { store, load } = setup();
    const old = deferred(); load.mockReturnValueOnce(old.promise);
    store.getState().update("a", source, framing);
    store.getState().dispose();
    store.getState().update("a", source, framing); await flush();
    old.resolve("asset:stale"); await flush();
    expect(store.getState().frame?.url).toBe("asset:a");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
