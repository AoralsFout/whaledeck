import { describe, expect, it, vi } from "vitest";
import type { MetaItem, MetaSource } from "../types";
import { createMetaSearch } from "./metaSearch";

function item(title: string): MetaItem {
  return { source: "bangumi", id: title, title, subtitle: "", coverUrl: null, releaseDate: "", developer: "", summary: "", rating: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(keyword = "游戏名") {
  const search = vi.fn<(source: MetaSource, keyword: string) => Promise<MetaItem[]>>();
  const notify = vi.fn();
  const store = createMetaSearch(keyword, { search, notify });
  return { store, search, notify };
}

describe("联网检索", () => {
  it("按提交时的来源和去除首尾空白的关键词搜索", async () => {
    const { store, search } = setup("  游戏名  ");
    store.getState().setSource("vndb");
    search.mockResolvedValue([{ ...item("结果"), source: "vndb" }]);
    await store.getState().runSearch();
    expect(search).toHaveBeenCalledWith("vndb", "游戏名");
    expect(store.getState()).toMatchObject({ loading: false, searched: true, items: [{ title: "结果" }] });
  });

  it("新请求先完成时，迟到的旧结果不能覆盖它", async () => {
    const { store, search, notify } = setup();
    const old = deferred<MetaItem[]>();
    const latest = deferred<MetaItem[]>();
    search.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const first = store.getState().runSearch();
    store.getState().setKeyword("新游戏名");
    const second = store.getState().runSearch();
    latest.resolve([item("新结果")]);
    await second;
    old.resolve([item("旧结果")]);
    await first;
    expect(store.getState()).toMatchObject({ items: [{ title: "新结果" }], loading: false });
    expect(notify).not.toHaveBeenCalled();
  });

  it("旧请求先完成时，不能结束仍在进行的新请求或显示旧内容", async () => {
    const { store, search } = setup();
    const old = deferred<MetaItem[]>();
    const latest = deferred<MetaItem[]>();
    search.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const first = store.getState().runSearch();
    const second = store.getState().runSearch();
    old.resolve([item("旧结果")]);
    await first;
    expect(store.getState()).toMatchObject({ loading: true, items: [] });
    latest.resolve([item("最新结果")]);
    await second;
    expect(store.getState()).toMatchObject({ loading: false, items: [{ title: "最新结果" }] });
  });

  it("即使来源和关键词相同，旧请求的错误也不能清空新结果", async () => {
    const { store, search, notify } = setup();
    const old = deferred<MetaItem[]>();
    search.mockReturnValueOnce(old.promise).mockResolvedValueOnce([item("最新结果")]);
    const first = store.getState().runSearch();
    await store.getState().runSearch();
    old.reject(new Error("旧错误"));
    await first;
    expect(store.getState().items).toEqual([item("最新结果")]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("旧请求的空结果与错误都不发送通知，也不关闭新请求的加载状态", async () => {
    const { store, search, notify } = setup();
    const oldEmpty = deferred<MetaItem[]>();
    const oldFailure = deferred<MetaItem[]>();
    const latest = deferred<MetaItem[]>();
    search.mockReturnValueOnce(oldEmpty.promise).mockReturnValueOnce(oldFailure.promise).mockReturnValueOnce(latest.promise);
    const first = store.getState().runSearch();
    const second = store.getState().runSearch();
    const third = store.getState().runSearch();
    oldEmpty.resolve([]);
    oldFailure.reject("旧错误");
    await Promise.all([first, second]);
    expect(store.getState().loading).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    latest.resolve([]);
    await third;
    expect(notify).toHaveBeenCalledExactlyOnceWith("info", "没搜到结果，换个别名或原名试试");
    expect(store.getState()).toMatchObject({ loading: false, searched: true, items: [] });
  });

  it("当前检索失败仍显示错误，并可通过原搜索动作重试", async () => {
    const { store, search, notify } = setup();
    search.mockRejectedValueOnce("无法连接").mockResolvedValueOnce([item("重试结果")]);
    await store.getState().runSearch();
    expect(store.getState()).toMatchObject({ loading: false, searched: true, items: [] });
    expect(notify).toHaveBeenCalledExactlyOnceWith("error", "无法连接");
    await store.getState().runSearch();
    expect(store.getState().items).toEqual([item("重试结果")]);
  });

  it("切换来源清理结果并使进行中的请求失效，不自动发起搜索", async () => {
    const { store, search, notify } = setup();
    const old = deferred<MetaItem[]>();
    search.mockReturnValueOnce(old.promise);
    const first = store.getState().runSearch();
    store.getState().setSource("vndb");
    expect(store.getState()).toMatchObject({ source: "vndb", loading: false, searched: false, items: [] });
    old.reject("旧来源错误");
    await first;
    expect(search).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    search.mockResolvedValueOnce([{ ...item("VNDB结果"), source: "vndb" }]);
    await store.getState().runSearch();
    expect(search).toHaveBeenLastCalledWith("vndb", "游戏名");
  });

  it("重复点击当前来源不取消正在进行的检索", async () => {
    const { store, search } = setup();
    const pending = deferred<MetaItem[]>();
    search.mockReturnValue(pending.promise);
    const request = store.getState().runSearch();
    store.getState().setSource("bangumi");
    expect(store.getState().loading).toBe(true);
    pending.resolve([item("结果")]);
    await request;
    expect(store.getState().items).toEqual([item("结果")]);
  });

  it("弹窗结束时使请求失效，迟到结果不再改动状态或通知", async () => {
    const { store, search, notify } = setup();
    const pending = deferred<MetaItem[]>();
    search.mockReturnValue(pending.promise);
    const request = store.getState().runSearch();
    store.getState().invalidate();
    const changes = vi.fn();
    const unsubscribe = store.subscribe(changes);
    pending.reject("关闭后的错误");
    await request;
    expect(changes).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ loading: false, searched: false, items: [] });
    unsubscribe();
  });

  it("生命周期重置后仍能发起新检索，先前请求保持失效", async () => {
    const { store, search, notify } = setup();
    const old = deferred<MetaItem[]>();
    search.mockReturnValueOnce(old.promise).mockResolvedValueOnce([item("新结果")]);
    const first = store.getState().runSearch();
    store.getState().invalidate();
    await store.getState().runSearch();
    old.resolve([]);
    await first;
    expect(store.getState().items).toEqual([item("新结果")]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("修改输入保留手动搜索流程，提交新检索时才替换当前结果", async () => {
    const { store, search } = setup();
    search.mockResolvedValueOnce([item("已有结果")]);
    await store.getState().runSearch();
    store.getState().setKeyword("尚未提交");
    expect(search).toHaveBeenCalledTimes(1);
    expect(store.getState().items).toEqual([item("已有结果")]);
    const pending = deferred<MetaItem[]>();
    search.mockReturnValueOnce(pending.promise);
    const request = store.getState().runSearch();
    expect(store.getState()).toMatchObject({ loading: true, items: [] });
    pending.resolve([item("新结果")]);
    await request;
  });

  it("空白关键词不发请求，也不清空当前结果", async () => {
    const { store, search, notify } = setup();
    search.mockResolvedValueOnce([item("已有结果")]);
    await store.getState().runSearch();
    store.getState().setKeyword("   ");
    await store.getState().runSearch();
    expect(search).toHaveBeenCalledTimes(1);
    expect(store.getState().items).toEqual([item("已有结果")]);
    expect(notify).not.toHaveBeenCalled();
  });
});
