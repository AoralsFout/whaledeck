/**
 * @file 存档备份生命周期的测试：乱序读取、备份后刷新、互斥与还原确认。
 *
 * 对应文档：docs/前端实现.md §2.3、§6。
 */
import { describe, expect, it, vi } from "vitest";
import type { SaveBackup } from "../types";
import { createSaveBackups } from "./saveBackups";

const oldBackup: SaveBackup = { file: "100.zip", createdAt: 100, size: 512 };
const newBackup: SaveBackup = { file: "200.zip", createdAt: 200, size: 2048 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(gameId = "game-a") {
  const dependencies = {
    list: vi.fn<(id: string) => Promise<SaveBackup[]>>().mockResolvedValue([oldBackup]),
    backup: vi.fn<(id: string) => Promise<SaveBackup>>().mockResolvedValue(newBackup),
    restore: vi.fn<(id: string, file: string) => Promise<number>>().mockResolvedValue(3),
    openDirectory: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    notify: vi.fn(),
  };
  const store = createSaveBackups(gameId, dependencies);
  const connect = async () => {
    const disconnect = store.getState().connect();
    await Promise.resolve();
    return disconnect;
  };
  return { store, dependencies, connect };
}

describe("存档备份", () => {
  it("进入详情读取该游戏的列表，离开时清理列表与还原确认", async () => {
    const { store, dependencies, connect } = setup();
    const disconnect = await connect();
    expect(dependencies.list).toHaveBeenCalledExactlyOnceWith("game-a");
    expect(store.getState().backups).toEqual([oldBackup]);
    store.getState().selectRestore(oldBackup.file);
    expect(store.getState().restoreTarget).toBe(oldBackup.file);
    disconnect();
    expect(store.getState()).toMatchObject({ backups: [], busy: false, restoreTarget: null });
  });

  it("初始读取失败保持空列表，仍能备份并刷新", async () => {
    const { store, dependencies, connect } = setup();
    dependencies.list.mockRejectedValueOnce("读取失败").mockResolvedValueOnce([newBackup]);
    await connect();
    expect(store.getState().backups).toEqual([]);
    expect(dependencies.notify).not.toHaveBeenCalled();
    await store.getState().backup();
    expect(store.getState()).toMatchObject({ backups: [newBackup], busy: false });
    expect(dependencies.notify).toHaveBeenCalledExactlyOnceWith("success", "存档已备份（2.0 KB）");
  });

  it("备份成功立即接纳记录，刷新完成前保持忙碌，完成后使用完整列表", async () => {
    const { store, dependencies, connect } = setup();
    await connect();
    const refresh = deferred<SaveBackup[]>();
    dependencies.list.mockReturnValueOnce(refresh.promise);
    const request = store.getState().backup();
    await Promise.resolve();
    expect(dependencies.backup).toHaveBeenCalledExactlyOnceWith("game-a");
    expect(store.getState()).toMatchObject({ backups: [newBackup, oldBackup], busy: true });
    expect(dependencies.notify).not.toHaveBeenCalled();
    const older = { ...oldBackup, file: "50.zip", createdAt: 50 };
    refresh.resolve([newBackup, oldBackup, older]);
    await request;
    expect(store.getState()).toMatchObject({ backups: [newBackup, oldBackup, older], busy: false });
    expect(dependencies.notify).toHaveBeenCalledExactlyOnceWith("success", "存档已备份（2.0 KB）");
  });

  it("备份成功后刷新失败保留新旧记录，重试时按文件名去重", async () => {
    const { store, dependencies, connect } = setup();
    await connect();
    dependencies.list.mockRejectedValue("刷新失败");
    await store.getState().backup();
    expect(store.getState()).toMatchObject({ backups: [newBackup, oldBackup], busy: false });
    expect(dependencies.notify).toHaveBeenLastCalledWith("success", "存档已备份（2.0 KB）");
    await store.getState().backup();
    expect(store.getState().backups).toEqual([newBackup, oldBackup]);
  });

  it("迟到的初始读取不能覆盖备份后的记录或刷新结果", async () => {
    const { store, dependencies } = setup();
    const initial = deferred<SaveBackup[]>();
    const refreshed = deferred<SaveBackup[]>();
    dependencies.list.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refreshed.promise);
    store.getState().connect();
    const request = store.getState().backup();
    await Promise.resolve();
    initial.resolve([oldBackup]);
    await Promise.resolve();
    expect(store.getState()).toMatchObject({ backups: [newBackup], busy: true });
    refreshed.resolve([newBackup, oldBackup]);
    await request;
    expect(store.getState().backups).toEqual([newBackup, oldBackup]);
  });

  it("备份失败保留已有列表、释放忙碌状态，原操作可重试", async () => {
    const { store, dependencies, connect } = setup();
    await connect();
    dependencies.backup.mockRejectedValueOnce("目录不可读");
    await store.getState().backup();
    expect(store.getState()).toMatchObject({ backups: [oldBackup], busy: false });
    expect(dependencies.notify).toHaveBeenCalledExactlyOnceWith("error", "目录不可读");
    dependencies.list.mockResolvedValueOnce([newBackup, oldBackup]);
    await store.getState().backup();
    expect(store.getState().backups).toEqual([newBackup, oldBackup]);
  });

  it("点击还原只选择确认目标，取消与无效文件不执行还原", async () => {
    const { store, dependencies, connect } = setup();
    await connect();
    await store.getState().restore();
    store.getState().selectRestore("其他游戏.zip");
    expect(store.getState().restoreTarget).toBeNull();
    store.getState().selectRestore(oldBackup.file);
    expect(dependencies.restore).not.toHaveBeenCalled();
    store.getState().selectRestore(null);
    await store.getState().restore();
    expect(dependencies.restore).not.toHaveBeenCalled();
  });

  it("确认后仅还原已选择的备份，完成后清理确认并提示文件数", async () => {
    const { store, dependencies, connect } = setup();
    await connect();
    const pending = deferred<number>();
    dependencies.restore.mockReturnValueOnce(pending.promise);
    store.getState().selectRestore(oldBackup.file);
    const request = store.getState().restore();
    expect(store.getState()).toMatchObject({ busy: true, restoreTarget: oldBackup.file });
    expect(dependencies.restore).toHaveBeenCalledExactlyOnceWith("game-a", oldBackup.file);
    pending.resolve(3);
    await request;
    expect(store.getState()).toMatchObject({ backups: [oldBackup], busy: false, restoreTarget: null });
    expect(dependencies.notify).toHaveBeenCalledExactlyOnceWith("success", "已还原 3 个文件到存档目录");
  });

  it("还原失败按原流程收起确认，重新选择后可重试", async () => {
    const { store, dependencies, connect } = setup();
    await connect();
    dependencies.restore.mockRejectedValueOnce("写入失败").mockResolvedValueOnce(0);
    store.getState().selectRestore(oldBackup.file);
    await store.getState().restore();
    expect(store.getState()).toMatchObject({ busy: false, restoreTarget: null });
    expect(dependencies.notify).toHaveBeenCalledExactlyOnceWith("error", "写入失败");
    store.getState().selectRestore(oldBackup.file);
    await store.getState().restore();
    expect(dependencies.notify).toHaveBeenLastCalledWith("success", "已还原 0 个文件到存档目录");
  });

  it.each(["backup", "restore"] as const)("%s 期间重复和交叉操作均不重复写入或变更确认", async (action) => {
    const { store, dependencies, connect } = setup();
    await connect();
    const pendingBackup = deferred<SaveBackup>();
    const pendingRestore = deferred<number>();
    dependencies.backup.mockReturnValueOnce(pendingBackup.promise);
    dependencies.restore.mockReturnValueOnce(pendingRestore.promise);
    store.getState().selectRestore(oldBackup.file);
    const request = store.getState()[action]();
    store.getState().selectRestore(null);
    await Promise.all([store.getState().backup(), store.getState().restore()]);
    expect(store.getState().restoreTarget).toBe(oldBackup.file);
    expect(dependencies.backup).toHaveBeenCalledTimes(action === "backup" ? 1 : 0);
    expect(dependencies.restore).toHaveBeenCalledTimes(action === "restore" ? 1 : 0);
    pendingBackup.resolve(newBackup);
    pendingRestore.resolve(3);
    await request;
    expect(store.getState().busy).toBe(false);
  });

  it.each(["backup", "restore"] as const)("离开后 %s 成功返回不刷新列表、改动状态或发送通知", async (action) => {
    const { store, dependencies, connect } = setup();
    const disconnect = await connect();
    const pendingBackup = deferred<SaveBackup>();
    const pendingRestore = deferred<number>();
    dependencies.backup.mockReturnValueOnce(pendingBackup.promise);
    dependencies.restore.mockReturnValueOnce(pendingRestore.promise);
    store.getState().selectRestore(oldBackup.file);
    const request = store.getState()[action]();
    disconnect();
    const changes = vi.fn();
    store.subscribe(changes);
    pendingBackup.resolve(newBackup);
    pendingRestore.resolve(3);
    await request;
    expect(changes).not.toHaveBeenCalled();
    expect(dependencies.notify).not.toHaveBeenCalled();
    expect(dependencies.list).toHaveBeenCalledTimes(1);
  });

  it("重新进入时旧生命周期的读取、错误与清理不能影响新操作", async () => {
    const { store, dependencies } = setup();
    const oldRead = deferred<SaveBackup[]>();
    const oldWrite = deferred<SaveBackup>();
    const newWrite = deferred<SaveBackup>();
    dependencies.list.mockReturnValueOnce(oldRead.promise);
    dependencies.backup.mockReturnValueOnce(oldWrite.promise).mockReturnValueOnce(newWrite.promise);
    const oldDisconnect = store.getState().connect();
    const first = store.getState().backup();
    oldDisconnect();
    store.getState().connect();
    await Promise.resolve();
    store.getState().selectRestore(oldBackup.file);
    const second = store.getState().backup();
    oldDisconnect();
    oldRead.resolve([newBackup]);
    oldWrite.reject("过期操作错误");
    await first;
    expect(store.getState()).toMatchObject({ backups: [oldBackup], busy: true, restoreTarget: oldBackup.file });
    expect(dependencies.notify).not.toHaveBeenCalled();
    dependencies.list.mockResolvedValueOnce([newBackup, oldBackup]);
    newWrite.resolve(newBackup);
    await second;
    expect(store.getState()).toMatchObject({ backups: [newBackup, oldBackup], busy: false });
    expect(dependencies.notify).toHaveBeenCalledTimes(1);
  });

  it("刷新移除已选择的备份时清理确认，不能还原不存在的条目", async () => {
    const { store, dependencies, connect } = setup();
    await connect();
    store.getState().selectRestore(oldBackup.file);
    dependencies.list.mockResolvedValueOnce([newBackup]);
    await store.getState().backup();
    expect(store.getState().restoreTarget).toBeNull();
    await store.getState().restore();
    expect(dependencies.restore).not.toHaveBeenCalled();
  });

  it("目录使用当前游戏身份，打开失败通知，离开后的错误静默", async () => {
    const { store, dependencies, connect } = setup("game-b");
    const disconnect = await connect();
    await store.getState().openDirectory();
    expect(dependencies.openDirectory).toHaveBeenCalledExactlyOnceWith("game-b");
    dependencies.openDirectory.mockRejectedValueOnce("打开目录失败");
    await store.getState().openDirectory();
    expect(dependencies.notify).toHaveBeenCalledExactlyOnceWith("error", "打开目录失败");
    dependencies.notify.mockClear();
    const pending = deferred<void>();
    dependencies.openDirectory.mockReturnValueOnce(pending.promise);
    const request = store.getState().openDirectory();
    disconnect();
    pending.reject("关闭后的错误");
    await request;
    expect(dependencies.notify).not.toHaveBeenCalled();
    await Promise.all([store.getState().backup(), store.getState().restore(), store.getState().openDirectory()]);
    expect(dependencies.backup).not.toHaveBeenCalled();
    expect(dependencies.restore).not.toHaveBeenCalled();
    expect(dependencies.openDirectory).toHaveBeenCalledTimes(3);
  });
});
