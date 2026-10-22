/**
 * @file 项目草稿测试：候选隔离、逐项覆盖与恢复、失败保留、请求生命周期。
 *
 * 只测试内存状态，不调用真实 IPC 或渲染组件。
 * 对应文档：docs/前端实现.md §3.2、§6。
 */
import { describe, expect, it, vi } from "vitest";
import { newGameDraft, type AutofillResult, type Game } from "../types";
import { createGameForm } from "./gameForm";

const original: Game = {
  ...newGameDraft(), id: "a", exePath: "C:\\Games\\a.exe", title: "手动名称",
  developer: "原开发商", note: "原备注", coverFile: "old.jpg", iconFile: "old.png",
};
const result = (game: Game = original): AutofillResult => ({
  game: { ...game, title: "程序名称", developer: "程序公司", note: "描述 · v1", coverFile: "new.jpg", iconFile: "new.png" },
  icon: true, cover: true, coverDetail: "cover.jpg", filled: ["名称", "开发商", "备注"],
});
const deferred = () => {
  let resolve!: (value: AutofillResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AutofillResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("项目表单候选", () => {
  it("全部候选只更新独立草稿，原始记录与原值快照保持不变", async () => {
    const initial = structuredClone(original);
    const fetch = vi.fn().mockResolvedValue(result());
    const store = createGameForm(initial, { fetch });
    store.getState().connect(false);
    await store.getState().acquire();
    expect(store.getState().draft).toEqual(result().game);
    expect(store.getState().original).toEqual(original);
    expect(initial).toEqual(original);
    expect(store.getState().status).toContain("确认保存后生效");
  });

  it("单字段只覆盖对应值，读取当前草稿路径与其他手动改动", async () => {
    const fetch = vi.fn().mockResolvedValue(result());
    const store = createGameForm(original, { fetch });
    store.getState().connect(false);
    store.getState().patch({ exePath: "D:\\Other.exe", note: "未保存的备注" });
    await store.getState().acquire("developer");
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ exePath: "D:\\Other.exe", note: "未保存的备注" }), "developer");
    expect(store.getState().draft).toEqual({ ...original, exePath: "D:\\Other.exe", note: "未保存的备注", developer: "程序公司" });
  });

  it("各字段可恢复打开时的原值，空文本和空图像也能恢复", async () => {
    const initial = { ...original, developer: "", note: "", coverFile: null, iconFile: null };
    const store = createGameForm(initial, { fetch: vi.fn().mockResolvedValue(result()) });
    store.getState().connect(false);
    await store.getState().acquire();
    for (const field of ["title", "developer", "note", "iconFile", "coverFile"] as const) {
      store.getState().restore(field);
      expect(store.getState().draft[field]).toEqual(initial[field]);
    }
    expect(store.getState().draft).toEqual(initial);
  });

  it("无结果或获取失败保留所有草稿值，并允许重试", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ...result(), icon: false, cover: false, filled: [] })
      .mockRejectedValueOnce(new Error("无法读取"))
      .mockResolvedValueOnce(result());
    const store = createGameForm(original, { fetch });
    store.getState().connect(false);
    await store.getState().acquire();
    expect(store.getState().draft).toEqual(original);
    expect(store.getState().status).toContain("已保留现值");
    await store.getState().acquire("note");
    expect(store.getState().draft).toEqual(original);
    expect(store.getState().error).toContain("无法读取");
    await store.getState().acquire("note");
    expect(store.getState().draft.note).toBe("描述 · v1");
    expect(store.getState().error).toBe("");
  });

  it("空路径不发请求；正在获取时阻止重复请求与恢复", async () => {
    const task = deferred();
    const fetch = vi.fn().mockReturnValue(task.promise);
    const store = createGameForm({ ...original, exePath: " " }, { fetch });
    store.getState().connect(false);
    await store.getState().acquire("title");
    expect(fetch).not.toHaveBeenCalled();
    expect(store.getState().error).toContain("请先选择");
    store.getState().patch({ exePath: original.exePath, title: "待保留草稿" });
    const pending = store.getState().acquire("title");
    await store.getState().acquire("coverFile");
    store.getState().restore("title");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getState().draft.title).toBe("待保留草稿");
    task.resolve(result());
    await pending;
    expect(store.getState().fetching).toBeNull();
  });

  it("关闭后丢弃迟到响应；重入只接受新连接的结果", async () => {
    const oldTask = deferred();
    const newTask = deferred();
    const fetch = vi.fn().mockReturnValueOnce(oldTask.promise).mockReturnValueOnce(newTask.promise);
    const store = createGameForm(original, { fetch });
    const disconnect = store.getState().connect(false);
    const oldRequest = store.getState().acquire();
    disconnect();
    store.getState().connect(false);
    const newRequest = store.getState().acquire("title");
    newTask.resolve({ ...result(), game: { ...original, title: "新请求名称" } });
    await newRequest;
    oldTask.resolve(result());
    await oldRequest;
    expect(store.getState().draft).toEqual({ ...original, title: "新请求名称" });
  });

  it("关闭后的错误不再展示，自动入口连接即获取候选", async () => {
    const task = deferred();
    const fetch = vi.fn().mockReturnValue(task.promise);
    const store = createGameForm(original, { fetch });
    const disconnect = store.getState().connect(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getState().fetching).toBe("all");
    disconnect();
    task.reject(new Error("迟到错误"));
    await task.promise.catch(() => {});
    expect(store.getState()).toMatchObject({ fetching: null, error: "", draft: original });
  });
});
