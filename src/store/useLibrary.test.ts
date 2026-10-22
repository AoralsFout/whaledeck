import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/ipc";
import { newGameDraft } from "../types";
import { useLibrary } from "./useLibrary";

vi.mock("../lib/ipc", () => ({ api: { saveGame: vi.fn() } }));

describe("游戏写入", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLibrary.setState({ games: [], selectedId: null, nav: { type: "all" }, query: "", formOpen: true, busy: false });
  });
  afterEach(() => {
    useLibrary.getState().hideToast();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("新增使用保存结果更新列表与选择，不必重新载入整个库", async () => {
    const draft = { ...newGameDraft(), id: "new", title: "新游戏" };
    vi.mocked(api.saveGame).mockResolvedValue({ ...draft, addedAt: 123 });
    await useLibrary.getState().saveGame(draft);
    expect(useLibrary.getState().games).toEqual([{ ...draft, addedAt: 123 }]);
    expect(useLibrary.getState()).toMatchObject({ selectedId: "new", formOpen: false, busy: false });
  });

  it("编辑替换原项，保存结果在当前筛选外时转到可见视图", async () => {
    const original = { ...newGameDraft(), id: "a", title: "原名" };
    useLibrary.setState({ games: [original], query: "原名" });
    const updated = { ...original, title: "新名", hidden: true };
    vi.mocked(api.saveGame).mockResolvedValue(updated);
    await useLibrary.getState().saveGame(updated);
    expect(useLibrary.getState()).toMatchObject({ games: [updated], nav: { type: "hidden" }, query: "", selectedId: "a" });
  });

  it("保存失败保留草稿窗口和原有列表", async () => {
    const draft = { ...newGameDraft(), id: "a", title: "草稿" };
    useLibrary.setState({ editing: draft });
    vi.mocked(api.saveGame).mockRejectedValue(new Error("写入失败"));
    await useLibrary.getState().saveGame(draft);
    expect(useLibrary.getState()).toMatchObject({ games: [], formOpen: true, editing: draft, busy: false });
    expect(useLibrary.getState().toast?.kind).toBe("error");
  });
});
