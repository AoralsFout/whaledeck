/**
 * @file 图片资源测试：解码等待、复用与失效、内存边界、失败和超时。
 *
 * 对应文档：docs/前端实现.md §6。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./ipc";
import { decodedAssetImage, invalidateAssetUrls, loadAssetUrl, waitForAssets } from "./assets";

vi.mock("./ipc", () => ({ api: { assetPath: vi.fn() }, fileUrl: (path: string) => `asset:${path}` }));

describe("启动图片准备", () => {
  const decode = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    invalidateAssetUrls();
    vi.useFakeTimers();
    vi.mocked(api.assetPath).mockResolvedValue("cover.png");
    decode.mockResolvedValue();
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 100; naturalHeight = 100; decode = decode; });
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
    expect(await image).toMatch(/^asset:cover\.png\?v=\d+$/);
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

  it("同一图片并发与往返切换只解析和解码一次", async () => {
    const first = loadAssetUrl("superres", "reusable.png");
    const second = loadAssetUrl("superres", "reusable.png");
    expect(await first).toMatch(/^asset:cover\.png\?v=\d+$/);
    await second;
    await loadAssetUrl("superres", "reusable.png");
    expect(api.assetPath).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("失败不会缓存，下次加载可以重试", async () => {
    decode.mockRejectedValueOnce(new Error("损坏"));
    expect(await loadAssetUrl("superres", "retry.png")).toBeNull();
    expect(await loadAssetUrl("superres", "retry.png")).toMatch(/^asset:cover\.png\?v=\d+$/);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("适配图在解码前开启匿名 CORS，取色可借用已解码资源并随失效清理", async () => {
    const corsAtDecode: string[] = [];
    vi.stubGlobal("Image", class {
      src = ""; crossOrigin = ""; naturalWidth = 100; naturalHeight = 100;
      decode() { corsAtDecode.push(this.crossOrigin); return Promise.resolve(); }
    });
    expect(decodedAssetImage("backgroundFit", "palette.png")).toBeNull();
    await loadAssetUrl("backgroundFit", "palette.png");
    expect(corsAtDecode).toEqual(["anonymous"]);
    expect(decodedAssetImage("backgroundFit", "palette.png")?.src).toContain("asset:cover.png");
    invalidateAssetUrls("backgroundFit", "palette.png");
    expect(decodedAssetImage("backgroundFit", "palette.png")).toBeNull();
  });

  it("同名资源失效后重新解码，旧请求不能写回缓存", async () => {
    let finish!: () => void;
    decode.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    vi.mocked(api.assetPath).mockResolvedValueOnce("old.png").mockResolvedValue("new.png");
    const old = loadAssetUrl("superres", "same.png");
    await vi.advanceTimersByTimeAsync(0);
    invalidateAssetUrls("superres", "same.png");
    const fresh = await loadAssetUrl("superres", "same.png");
    expect(fresh).toMatch(/^asset:new\.png\?v=\d+$/);
    finish(); await old;
    expect(await loadAssetUrl("superres", "same.png")).toBe(fresh);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("超时后旧解码不能缓存，后续请求正常加载", async () => {
    let finish!: () => void;
    decode.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const old = loadAssetUrl("superres", "timeout.png");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await old).toBeNull();
    finish(); await vi.advanceTimersByTimeAsync(0);
    await loadAssetUrl("superres", "timeout.png");
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("按最近使用及像素预算淘汰，不无限保留解码图片", async () => {
    for (let i = 0; i < 32; i++) await loadAssetUrl("cover", `${i}.png`);
    await loadAssetUrl("cover", "0.png");
    await loadAssetUrl("cover", "extra.png");
    await loadAssetUrl("cover", "0.png");
    expect(decode).toHaveBeenCalledTimes(33);
    await loadAssetUrl("cover", "1.png");
    expect(decode).toHaveBeenCalledTimes(34);
    invalidateAssetUrls(); decode.mockClear();
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 4096; naturalHeight = 4096; decode = decode; });
    await loadAssetUrl("cover", "large-a.png");
    await loadAssetUrl("cover", "large-b.png");
    await loadAssetUrl("cover", "large-a.png");
    expect(decode).toHaveBeenCalledTimes(3);
  });
});
