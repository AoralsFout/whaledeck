/**
 * @file 游戏写入、批量加入与关闭偏好测试：写后更新、失败保留、去重、串行与重试。
 *
 * 对应文档：docs/前端实现.md §2.1、§6。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/ipc";
import { newGameDraft, type ScanEntry, type Settings } from "../types";
import { useLibrary } from "./useLibrary";

vi.mock("../lib/ipc", () => ({ api: { saveGame: vi.fn(), setCloseBehavior: vi.fn(), saveSettings: vi.fn() } }));

const entries: ScanEntry[] = ["A", "B", "C"].map((name) => ({
  name: `${name}.exe`, path: `C:\\Games\\${name}.exe`, size: 1024,
}));

describe("游戏写入", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLibrary.setState({ ...useLibrary.getInitialState(), formOpen: true, scanOpen: true });
  });
  afterEach(() => {
    useLibrary.getState().hideToast();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  const appearanceSettings = (): Settings => ({
    theme: { preset: "whale", mode: "dark", primary: "#4fd6e8", accent: "#ff9ec7", backgroundFile: null, backgroundDim: .55, sidebarAutoHide: true, sidebarBlur: 0, sidebarBackgroundFile: null, sidebarTransparency: .52 },
    sort: "recent", categories: [], closeBehavior: null,
  });

  it("适配保存失败不应用，重试成功后才更新确认参数", async () => {
    useLibrary.setState({ settings: appearanceSettings() });
    const fit = { enabled: true, mode: "cover" as const, positionX: 72, positionY: 50 };
    vi.mocked(api.saveSettings).mockRejectedValueOnce("磁盘写入失败").mockImplementationOnce(async (settings) => settings);
    expect(await useLibrary.getState().applySidebarBackgroundFit(fit)).toBe(false);
    expect(useLibrary.getState().settings?.theme.sidebarBackgroundFit).toBeUndefined();
    expect(await useLibrary.getState().applySidebarBackgroundFit(fit)).toBe(true);
    expect(useLibrary.getState().settings?.theme.sidebarBackgroundFit).toEqual(fit);
  });

  it("适配保存与透明度、关闭偏好串行，迟到结果不覆盖最新外观", async () => {
    const initial = appearanceSettings();
    useLibrary.setState({ settings: initial });
    let finish!: (settings: Settings) => void;
    vi.mocked(api.saveSettings).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockImplementation(async (settings) => settings);
    vi.mocked(api.setCloseBehavior).mockResolvedValue({ ...initial, closeBehavior: "hide" });
    const fit = { enabled: true, mode: "contain" as const, positionX: 50, positionY: 50 };
    const applying = useLibrary.getState().applySidebarBackgroundFit(fit);
    await vi.waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1));
    expect(useLibrary.getState().settings?.theme.sidebarBackgroundFit).toBeUndefined();
    const transparency = useLibrary.getState().updateSettings({ ...initial, theme: { ...initial.theme, sidebarTransparency: .81 } });
    const closing = useLibrary.getState().setCloseBehavior("hide");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.setCloseBehavior).not.toHaveBeenCalled();
    finish({ ...initial, theme: { ...initial.theme, sidebarBackgroundFit: fit } });
    expect(await applying).toBe(true);
    await transparency; await closing;
    expect(vi.mocked(api.saveSettings).mock.calls[1][0].theme).toMatchObject({ sidebarBackgroundFit: fit, sidebarTransparency: .81 });
    expect(useLibrary.getState().settings).toMatchObject({ theme: { sidebarBackgroundFit: fit, sidebarTransparency: .81 }, closeBehavior: "hide" });
  });

  it("打开自动补全与取消均不改库，普通编辑与新增清除自动获取标记", () => {
    const game = { ...newGameDraft(), id: "a", title: "原名" };
    useLibrary.setState({ games: [game] });
    useLibrary.getState().openEdit(game, true);
    expect(useLibrary.getState()).toMatchObject({ editing: game, formAutofill: true, formOpen: true, games: [game] });
    useLibrary.getState().closeForm();
    expect(useLibrary.getState()).toMatchObject({ formOpen: false, formAutofill: false, games: [game] });
    useLibrary.getState().openEdit(game);
    expect(useLibrary.getState().formAutofill).toBe(false);
    useLibrary.getState().openNew();
    expect(useLibrary.getState().formAutofill).toBe(false);
    expect(api.saveGame).not.toHaveBeenCalled();
  });

  it("关闭行为只在保存成功后更新，失败时保留原选择", async () => {
    const settings: Settings = {
      theme: { preset: "whale", mode: "dark", primary: "#4fd6e8", accent: "#ff9ec7", backgroundFile: null, backgroundDim: .55, sidebarAutoHide: true, sidebarBlur: 0, sidebarBackgroundFile: null, sidebarTransparency: .52 },
      sort: "recent", categories: [], closeBehavior: null,
    };
    useLibrary.setState({ settings });
    vi.mocked(api.setCloseBehavior).mockRejectedValueOnce("写入失败");
    await useLibrary.getState().setCloseBehavior("exit");
    expect(useLibrary.getState().settings?.closeBehavior).toBeNull();
    expect(useLibrary.getState().toast?.text).toContain("写入失败");
    vi.mocked(api.setCloseBehavior).mockResolvedValueOnce({ ...settings, closeBehavior: "hide" });
    await useLibrary.getState().setCloseBehavior("hide");
    expect(useLibrary.getState().settings?.closeBehavior).toBe("hide");
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

  it("批量加入即时提交成功结果，第二项失败后停止并保留剩余项", async () => {
    let rejectSecond!: (error: Error) => void;
    vi.mocked(api.saveGame)
      .mockImplementationOnce(async (game) => ({ ...game, addedAt: 123 }))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectSecond = reject; }));
    const pending = useLibrary.getState().addScannedGames(entries);
    await vi.waitFor(() => expect(api.saveGame).toHaveBeenCalledTimes(2));
    expect(useLibrary.getState().games).toMatchObject([{ title: "A", addedAt: 123 }]);
    rejectSecond(new Error("磁盘写入失败"));
    const result = await pending;
    expect(result.added.map((game) => game.title)).toEqual(["A"]);
    expect(result.remaining).toEqual(entries.slice(1));
    expect(result.error).toEqual({ entry: entries[1], message: "磁盘写入失败" });
    expect(api.saveGame).toHaveBeenCalledTimes(2);
    expect(useLibrary.getState()).toMatchObject({ scanOpen: true, formOpen: true, selectedId: null, busy: false });
    expect(useLibrary.getState().toast?.text).toContain("已加入 1 个");
    expect(useLibrary.getState().toast?.text).toContain("剩余 2 个");
  });

  it("重试同一批次只加入未完成项，不重写或重复添加已成功项", async () => {
    vi.mocked(api.saveGame)
      .mockImplementationOnce(async (game) => ({ ...game, addedAt: 123 }))
      .mockRejectedValueOnce("暂时无法写入");
    await useLibrary.getState().addScannedGames(entries);
    vi.mocked(api.saveGame).mockImplementation(async (game) => ({ ...game, addedAt: 456 }));
    const result = await useLibrary.getState().addScannedGames(entries);
    expect(result.error).toBeNull();
    expect(result.remaining).toEqual([]);
    expect(result.skipped).toEqual([entries[0]]);
    expect(result.added.map((game) => game.title)).toEqual(["B", "C"]);
    expect(useLibrary.getState().games.map((game) => game.title)).toEqual(["A", "B", "C"]);
    expect(vi.mocked(api.saveGame).mock.calls.map(([game]) => game.exePath)).toEqual([
      entries[0].path, entries[1].path, entries[1].path, entries[2].path,
    ]);
  });

  it("首项失败时保持原库与筛选，全部待加入项可重试", async () => {
    const original = { ...newGameDraft(), id: "old", exePath: "C:\\Other.exe", title: "原项目" };
    useLibrary.setState({ games: [original], selectedId: "old", query: "原", nav: { type: "favorites" } });
    vi.mocked(api.saveGame).mockRejectedValue("拒绝访问");
    const result = await useLibrary.getState().addScannedGames(entries);
    expect(result.remaining).toEqual(entries);
    expect(result.added).toEqual([]);
    expect(api.saveGame).toHaveBeenCalledTimes(1);
    expect(useLibrary.getState()).toMatchObject({ games: [original], selectedId: "old", query: "原", nav: { type: "favorites" } });
  });

  it("批量加入跳过库内及批次中的重复路径，兼容大小写与分隔符", async () => {
    useLibrary.setState({ games: [{ ...newGameDraft(), id: "old", exePath: "c:/games/a.EXE" }] });
    vi.mocked(api.saveGame).mockImplementation(async (game) => game);
    const duplicate = { ...entries[1], path: "c:/GAMES/b.exe" };
    const result = await useLibrary.getState().addScannedGames([...entries, duplicate]);
    expect(result.added.map((game) => game.title)).toEqual(["B", "C"]);
    expect(result.skipped).toEqual([entries[0], duplicate]);
    expect(api.saveGame).toHaveBeenCalledTimes(2);
    expect(useLibrary.getState().games).toHaveLength(3);
  });

  it("空批次不写入且不改变现有通知", async () => {
    useLibrary.getState().showToast("info", "原有通知");
    const result = await useLibrary.getState().addScannedGames([]);
    expect(result).toEqual({ added: [], skipped: [], remaining: [], error: null });
    expect(api.saveGame).not.toHaveBeenCalled();
    expect(useLibrary.getState().toast?.text).toBe("原有通知");
  });

  it("全部成功后保留当前选择、设置和运行会话，草稿由原入口管理", async () => {
    const original = { ...newGameDraft(), id: "old", title: "正在运行", exePath: "C:\\Old.exe" };
    const session = { gameId: "old", pid: 42, startedAt: 123, baselinePlaytime: 0 };
    useLibrary.setState({ games: [original], selectedId: "old", sessions: [session], editing: original, sort: "title" });
    vi.mocked(api.saveGame).mockImplementation(async (game) => ({ ...game, addedAt: 789 }));
    const result = await useLibrary.getState().addScannedGames(entries);
    expect(result.error).toBeNull();
    expect(result.added).toHaveLength(3);
    expect(result.added.every((game) => game.addedAt === 789 && game.workDir === "C:\\Games")).toBe(true);
    expect(new Set(result.added.map((game) => game.id)).size).toBe(3);
    expect(useLibrary.getState()).toMatchObject({
      selectedId: "old", sessions: [session], editing: original, formOpen: true, scanOpen: true, sort: "title", ready: false,
    });
    expect(useLibrary.getState().toast).toMatchObject({ kind: "success", text: "已加入 3 个游戏" });
  });

  it("重叠的批次依次处理，共同路径只保存一次", async () => {
    vi.mocked(api.saveGame).mockImplementation(async (game) => game);
    const [first, second] = await Promise.all([
      useLibrary.getState().addScannedGames(entries.slice(0, 2)),
      useLibrary.getState().addScannedGames(entries.slice(1)),
    ]);
    expect(first.added.map((game) => game.title)).toEqual(["A", "B"]);
    expect(second.skipped).toEqual([entries[1]]);
    expect(second.added.map((game) => game.title)).toEqual(["C"]);
    expect(api.saveGame).toHaveBeenCalledTimes(3);
    expect(useLibrary.getState().games).toHaveLength(3);
  });

  it("部分失败的队列不会阻止后续批次", async () => {
    vi.mocked(api.saveGame)
      .mockRejectedValueOnce("第一次失败")
      .mockImplementation(async (game) => game);
    const [failed, retried] = await Promise.all([
      useLibrary.getState().addScannedGames(entries),
      useLibrary.getState().addScannedGames(entries),
    ]);
    expect(failed.remaining).toEqual(entries);
    expect(retried.added).toHaveLength(3);
    expect(retried.error).toBeNull();
  });

  it("收藏复用保存结果更新规则，不触发表单关闭或切换选择", async () => {
    const original = { ...newGameDraft(), id: "old", title: "原项目" };
    useLibrary.setState({ games: [original], selectedId: "old", editing: original });
    vi.mocked(api.saveGame).mockResolvedValue({ ...original, favorite: true, addedAt: 456 });
    await useLibrary.getState().toggleFavorite("old");
    expect(useLibrary.getState()).toMatchObject({
      games: [{ ...original, favorite: true, addedAt: 456 }], selectedId: "old", editing: original, formOpen: true,
    });
  });
});
