/** @file 侧栏适配像素预算、资源来源和合并队列回归；见 docs/前端实现.md §4.2.1。 */
import { describe, expect, it, vi } from "vitest";
import { backgroundFitSize, latestRequestQueue, sidebarBackgroundSource } from "./backgroundFit";
import type { Theme } from "../types";

describe("侧栏背景适配", () => {
  it("按实际区域和 DPR 生成，极端尺寸仍保留比例并满足后台预算", () => {
    expect(backgroundFitSize(258, 820, 2, true)).toEqual({ width: 516, height: 1640, padding: 144 });
    for (const [w, h, dpr] of [[258, 820, 8], [375, 812, 1.5], [8000, 3000, 3], [1, 90000, 100], [2000, 2000, 10]]) {
      const result = backgroundFitSize(w, h, dpr, true)!;
      expect(result.width).toBeLessThanOrEqual(4096);
      expect(result.height).toBeLessThanOrEqual(4096);
      expect(result.width * result.height).toBeLessThanOrEqual(4_000_000);
      expect((result.width + 2 * result.padding) * (result.height + 2 * result.padding)).toBeLessThanOrEqual(6_000_000);
      expect(Math.abs(result.width - result.height * w / h)).toBeLessThan(3);
    }
    for (const width of [0, -1, NaN, Infinity]) expect(backgroundFitSize(width, 820, 1, false)).toBeNull();
    expect(backgroundFitSize(258, 820, 1, false)?.padding).toBe(0);
  });

  it("沿用自定义图优先、磨砂封面回退与无图规则", () => {
    const theme = { sidebarBackgroundFile: "custom.png", sidebarGlass: true } as Theme;
    const cover = { kind: "cover" as const, file: "cover.jpg" };
    expect(sidebarBackgroundSource(theme, cover)).toEqual({ sourceKind: "background", file: "custom.png" });
    theme.sidebarBackgroundFile = null;
    expect(sidebarBackgroundSource(theme, cover)).toEqual({ sourceKind: "cover", file: "cover.jpg" });
    expect(sidebarBackgroundSource(theme, null)).toBeNull();
    theme.sidebarGlass = false;
    expect(sidebarBackgroundSource(theme, cover)).toBeNull();
    theme.sidebarClearGlass = true;
    expect(sidebarBackgroundSource(theme, cover)).toEqual({ sourceKind: "cover", file: "cover.jpg" });
    expect(sidebarBackgroundSource(theme, null)).toBeNull();
    theme.sidebarBackgroundFile = "custom.png";
    expect(sidebarBackgroundSource(theme, cover)).toEqual({ sourceKind: "background", file: "custom.png" });
  });

  it("磨砂与清晰背景沿用两档超分选择，查询待定不等同于无图", () => {
    for (const effect of [{ sidebarGlass: true }, { sidebarClearGlass: true }]) {
      const theme = { sidebarBackgroundFile: null, ...effect } as Theme;
      for (const preset of ["efficient", "quality"]) {
        expect(sidebarBackgroundSource(theme, { kind: "superres", file: `${preset}.png` }))
          .toEqual({ sourceKind: "superres", file: `${preset}.png` });
      }
      expect(sidebarBackgroundSource(theme, undefined)).toBeUndefined();
      expect(sidebarBackgroundSource(theme, null)).toBeNull();
      theme.sidebarBackgroundFile = "custom.png";
      expect(sidebarBackgroundSource(theme, undefined)).toEqual({ sourceKind: "background", file: "custom.png" });
      expect(sidebarBackgroundSource(theme, { kind: "superres", file: "quality.png" })).toEqual({ sourceKind: "background", file: "custom.png" });
      theme.sidebarBackgroundFile = null;
      theme.sidebarGlass = theme.sidebarClearGlass = false;
      expect(sidebarBackgroundSource(theme, undefined)).toBeNull();
    }
  });

  it("连续请求只执行当前项和最后一项，取消清除未执行项", async () => {
    let resolve!: (value: number) => void;
    const run = vi.fn((n: number) => n === 1 ? new Promise<number>((done) => { resolve = done; }) : Promise.resolve(n));
    const queue = latestRequestQueue(run);
    const first = queue.request(1);
    const skipped = queue.request(2);
    const last = queue.request(3);
    expect(await skipped).toBeNull();
    resolve(1);
    expect(await first).toBe(1);
    expect(await last).toBe(3);
    expect(run.mock.calls).toEqual([[1], [3]]);
    const active = queue.request(1);
    const pending = queue.request(4);
    queue.clearPending();
    expect(await pending).toBeNull();
    resolve(1); await active;
    expect(run).not.toHaveBeenCalledWith(4);
  });

  it("失败后仍执行后续请求，关闭后拒绝迟到结果", async () => {
    let resolve!: (value: number) => void;
    const queue = latestRequestQueue(vi.fn<(n: number) => Promise<number>>()
      .mockRejectedValueOnce(new Error("坏图"))
      .mockResolvedValueOnce(2)
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; })));
    await expect(queue.request(1)).rejects.toThrow("坏图");
    expect(await queue.request(2)).toBe(2);
    const active = queue.request(3);
    const pending = queue.request(4);
    queue.close(); resolve(3);
    expect(await active).toBeNull();
    expect(await pending).toBeNull();
    expect(await queue.request(5)).toBeNull();
  });
});
