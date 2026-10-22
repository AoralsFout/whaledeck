/**
 * @file 启动期图片资源的测试：解码等待、失败占位与 3 秒超时。
 *
 * 对应文档：docs/前端实现.md §6。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./ipc";
import { loadAssetUrl, waitForAssets } from "./assets";

vi.mock("./ipc", () => ({ api: { assetPath: vi.fn() }, fileUrl: (path: string) => `asset:${path}` }));

describe("启动图片准备", () => {
  const decode = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.assetPath).mockResolvedValue("cover.png");
    decode.mockResolvedValue();
    vi.stubGlobal("Image", class { src = ""; decode = decode; });
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("路径解析后继续等待图片解码", async () => {
    let finish!: () => void;
    decode.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const image = loadAssetUrl("cover", "cover.png");
    const ready = vi.fn();
    const waiting = waitForAssets().then(ready);
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toHaveBeenCalledTimes(0);
    finish();
    expect(await image).toBe("asset:cover.png");
    await waiting;
    expect(ready).toHaveBeenCalledOnce();
  });

  it("损坏图片使用占位状态并解除等待", async () => {
    decode.mockRejectedValue(new Error("损坏图片"));
    expect(await loadAssetUrl("cover", "bad.png")).toBeNull();
    await waitForAssets();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("图片请求卡住时三秒后解除等待", async () => {
    vi.mocked(api.assetPath).mockReturnValue(new Promise(() => {}));
    const image = loadAssetUrl("background", "missing.png");
    const waiting = waitForAssets();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await image).toBeNull();
    await waiting;
  });
});
