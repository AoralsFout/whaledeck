/**
 * @file 封面快捷编辑回归：实时草稿、串行合并、取消与失败恢复。
 * 对应文档：docs/前端实现.md §4.2.2。
 */
import { describe, expect, it, vi } from "vitest";
import { createCoverQuickEdit } from "./coverQuickEdit";
import type { CoverFraming } from "../types";

const initial: CoverFraming = { file: "cover.png", positionX: 50, positionY: 50, zoom: 1 };
const deferred = () => {
  let resolve!: (value: CoverFraming) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<CoverFraming>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("封面快捷取景", () => {
  it("预览与取消不写入，外部已保存参数成为下一次编辑基准", () => {
    const save = vi.fn(async (value: CoverFraming) => value);
    const editor = createCoverQuickEdit(initial, { save, error: vi.fn() });
    editor.preview({ ...initial, zoom: 2 });
    expect(editor.value().zoom).toBe(2);
    editor.cancel();
    expect(editor.value()).toEqual(initial);
    editor.sync({ ...initial, zoom: 1.5 });
    expect(editor.value().zoom).toBe(1.5);
    expect(save).not.toHaveBeenCalled();
  });

  it("连续操作串行保存并合并等待项，旧响应不会清除新预览", async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (value: CoverFraming) => value);
    const editor = createCoverQuickEdit(initial, { save, error: vi.fn() });
    editor.preview({ ...initial, zoom: 1.2 });
    const done = editor.commit();
    await Promise.resolve();
    editor.preview({ ...initial, zoom: 1.5 }); void editor.commit();
    editor.preview({ ...initial, zoom: 2 }); void editor.commit();
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ ...initial, zoom: 1.2 });
    await done;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].zoom).toBe(2);
    expect(editor.getState()).toEqual({ draft: null, saving: false });
    expect(editor.value().zoom).toBe(2);
  });

  it("保存回包不覆盖尚未释放的拖拽，取消返回最新确认值", async () => {
    const first = deferred();
    const editor = createCoverQuickEdit(initial, { save: () => first.promise, error: vi.fn() });
    editor.preview({ ...initial, zoom: 2 });
    const done = editor.commit();
    await Promise.resolve();
    editor.preview({ ...initial, zoom: 2, positionX: 30 });
    first.resolve({ ...initial, zoom: 2 }); await done;
    expect(editor.value().positionX).toBe(30);
    editor.cancel();
    expect(editor.value()).toEqual({ ...initial, zoom: 2 });
  });

  it("失败恢复已保存效果并允许重试，取消期间不残留草稿", async () => {
    const first = deferred();
    const error = vi.fn();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (value: CoverFraming) => value);
    const editor = createCoverQuickEdit(initial, { save, error });
    editor.preview({ ...initial, zoom: 2 });
    const done = editor.commit(); await Promise.resolve();
    editor.preview({ ...initial, positionX: 10 }); editor.cancel();
    first.reject(new Error("写入失败")); await done;
    expect(error).toHaveBeenCalledTimes(1);
    expect(editor.getState()).toEqual({ draft: null, saving: false });
    expect(editor.value()).toEqual(initial);
    editor.preview({ ...initial, zoom: 1.5 }); await editor.commit();
    expect(editor.value().zoom).toBe(1.5);
  });
});
