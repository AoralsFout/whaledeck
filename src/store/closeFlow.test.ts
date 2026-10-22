/**
 * @file 关闭弹窗状态测试：启动快照、事件竞态、互斥提交和失败/卸载保护。
 *
 * 不模拟真实进程或原生窗口；对应文档：docs/前端实现.md §4.4。
 */
import { describe, expect, it, vi } from "vitest";
import type { CloseRequest } from "../types";
import { createCloseFlow } from "./closeFlow";

const choose: CloseRequest = { kind: "choose", runningCount: 0, message: "" };
const warning: CloseRequest = { kind: "confirmExit", runningCount: 2, message: "" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function setup(snapshot = Promise.resolve<CloseRequest | null>(choose)) {
  let receive!: (request: CloseRequest | null) => void;
  const off = vi.fn();
  const deps = {
    subscribe: vi.fn(async (cb: typeof receive) => { receive = cb; return off; }),
    snapshot: vi.fn(() => snapshot),
    resolve: vi.fn(async (_action: string): Promise<CloseRequest | null> => null),
  };
  const store = createCloseFlow(deps);
  const disconnect = store.getState().connect();
  return { store, deps, off, disconnect, emit: (request: CloseRequest | null) => receive(request) };
}

describe("关闭弹窗生命周期", () => {
  it("订阅后读取快照，恢复前端加载前的关闭请求", async () => {
    const { store, deps, disconnect } = setup();
    await vi.waitFor(() => expect(store.getState().request).toEqual(choose));
    expect(deps.subscribe.mock.invocationCallOrder[0]).toBeLessThan(deps.snapshot.mock.invocationCallOrder[0]);
    disconnect();
  });

  it("新取消事件不会被迟到的启动快照重新打开", async () => {
    const snapshot = deferred<CloseRequest | null>();
    const { store, deps, emit, disconnect } = setup(snapshot.promise);
    await vi.waitFor(() => expect(deps.snapshot).toHaveBeenCalled());
    emit(null);
    snapshot.resolve(choose);
    await snapshot.promise;
    await Promise.resolve();
    expect(store.getState().request).toBeNull();
    disconnect();
  });

  it("首次选择直接关闭后显示运行警告，重复确认只提交一次", async () => {
    const { store, deps, disconnect } = setup();
    await vi.waitFor(() => expect(store.getState().request).toEqual(choose));
    const response = deferred<CloseRequest | null>();
    deps.resolve.mockReturnValueOnce(response.promise);
    const first = store.getState().submit("exit");
    await store.getState().submit("exit");
    await store.getState().submit("cancel");
    expect(deps.resolve).toHaveBeenCalledTimes(1);
    response.resolve(warning);
    await first;
    expect(store.getState()).toMatchObject({ request: warning, busy: false });
    await store.getState().submit("cancel");
    expect(store.getState().request).toBeNull();
    disconnect();
  });

  it("新警告事件优先于旧提交响应", async () => {
    const { store, deps, emit, disconnect } = setup();
    await vi.waitFor(() => expect(store.getState().request).toEqual(choose));
    deps.resolve.mockImplementationOnce(async () => { emit(warning); return choose; });
    await store.getState().submit("exit");
    expect(store.getState()).toMatchObject({ request: warning, busy: false });
    disconnect();
  });

  it("结算失败保留警告供重试和取消", async () => {
    const { store, deps, disconnect } = setup(Promise.resolve(warning));
    await vi.waitFor(() => expect(store.getState().request).toEqual(warning));
    deps.resolve.mockRejectedValueOnce("磁盘写入失败");
    await store.getState().submit("confirmExit");
    expect(store.getState()).toMatchObject({ request: warning, busy: false });
    expect(store.getState().error).toContain("磁盘写入失败");
    await store.getState().submit("cancel");
    expect(store.getState().request).toBeNull();
    disconnect();
  });

  it("卸载后迟到快照与事件不再修改状态，并取消订阅", async () => {
    const snapshot = deferred<CloseRequest | null>();
    const { store, deps, emit, disconnect, off } = setup(snapshot.promise);
    await vi.waitFor(() => expect(deps.snapshot).toHaveBeenCalled());
    disconnect();
    emit(warning);
    snapshot.resolve(choose);
    await snapshot.promise;
    expect(off).toHaveBeenCalledOnce();
    expect(store.getState().request).toBeNull();
  });
});
