/**
 * @file 首帧显示的测试：资源/字体/两帧顺序、隐藏 WebView 兜底、取消与非 Tauri 环境。
 *
 * 对应文档：docs/前端实现.md §4.1、docs/系统架构.md §5.1。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { waitForAssets } from "./assets";
import { showWindowWhenReady } from "./startup";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("./assets", () => ({ waitForAssets: vi.fn() }));

describe("启动窗口", () => {
  const show = vi.fn(async () => {});
  const setFocus = vi.fn(async () => {});

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getCurrentWindow, { partial: true }).mockReturnValue({ show, setFocus });
    vi.mocked(waitForAssets).mockResolvedValue();
    vi.stubGlobal("document", { fonts: { ready: Promise.resolve() }, documentElement: { dataset: { starting: "true" } } });
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
    vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("等待资源、字体和两帧后才显示并聚焦", async () => {
    let finishAssets!: () => void;
    let finishFonts!: () => void;
    vi.mocked(waitForAssets).mockReturnValue(new Promise((resolve) => { finishAssets = resolve; }));
    vi.stubGlobal("document", {
      fonts: { ready: new Promise<void>((resolve) => { finishFonts = resolve; }) },
      documentElement: { dataset: { starting: "true" } },
    });
    showWindowWhenReady();
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).toHaveBeenCalledTimes(0);
    finishAssets();
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).toHaveBeenCalledTimes(0);
    finishFonts();
    await vi.advanceTimersByTimeAsync(16);
    expect(show).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(16);
    expect(show).toHaveBeenCalledOnce();
    expect(setFocus).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.starting).toBeUndefined();
  });

  it("隐藏 WebView 不执行动画帧时仍能显示", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    showWindowWhenReady();
    await vi.advanceTimersByTimeAsync(200);
    expect(show).toHaveBeenCalledOnce();
  });

  it("卸载后不显示窗口", async () => {
    const cancel = showWindowWhenReady();
    cancel();
    await vi.runAllTimersAsync();
    expect(show).toHaveBeenCalledTimes(0);
  });

  it("浏览器预览不调用原生 API", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    showWindowWhenReady();
    await vi.runAllTimersAsync();
    expect(waitForAssets).toHaveBeenCalledTimes(0);
    expect(getCurrentWindow).toHaveBeenCalledTimes(0);
  });
});
