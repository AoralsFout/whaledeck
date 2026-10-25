/**
 * @file 侧栏取色与对比度测试：区域差异、透明像素、极端色彩、明暗主题和透明度。
 * 不渲染组件；对应文档：docs/前端实现.md §4.2.1、§6。
 */
import { describe, expect, it } from "vitest";
import { analyzeSidebarPixels, colorContrast, createSidebarPalette, panelBackgrounds, type Rgb } from "./sidebarPalette";

function pixels(colors: number[][]): Uint8ClampedArray { return new Uint8ClampedArray(colors.flat()); }
const options = { base: [16, 26, 46] as Rgb, fallback: [79, 214, 232] as Rgb, transparency: 1, clear: false };

describe("侧栏动态配色", () => {
  it("按实际取景区分上方与整幅主色，不让底部大片颜色主导顶部控件", () => {
    const red = [220, 60, 40, 255], blue = [20, 80, 220, 255];
    const colors = analyzeSidebarPixels(pixels([red, blue, blue, blue]), 1, 4, .25);
    expect(colors.top.seed).toEqual([220, 60, 40]);
    expect(colors.all.seed).toEqual([20, 80, 220]);
    const palette = createSidebarPalette(colors, options);
    expect(palette.primary[0]).toBeGreaterThan(palette.primary[2]);
  });

  it("透明像素不染黑取色，灰度和全透明图片保留主题强调色", () => {
    const colors = analyzeSidebarPixels(pixels([[255, 0, 0, 0], [80, 160, 200, 128]]), 1, 2, 1);
    expect(colors.top.mean).toEqual([80, 160, 200]);
    expect(colors.top.coverage).toBeCloseTo(128 / 510);
    for (const rgba of [[0, 0, 0, 0], [0, 0, 0, 255], [255, 255, 255, 255], [128, 128, 128, 255]]) {
      const gray = analyzeSidebarPixels(pixels([rgba]), 1, 1, 1);
      expect(gray.top.seed).toBeNull();
      const palette = createSidebarPalette(gray, options);
      expect(palette.primary[2]).toBeGreaterThan(palette.primary[0]);
    }
  });

  it("透明度参与合成，全透明模式按图片生成颜色且不依赖隐藏的滑杆值", () => {
    const colors = analyzeSidebarPixels(pixels([[255, 240, 210, 255]]), 1, 1, 1);
    expect(createSidebarPalette(colors, { ...options, transparency: 0 }).dark).toBe(true);
    expect(createSidebarPalette(colors, options).dark).toBe(false);
    expect(createSidebarPalette(colors, { ...options, transparency: 0, clear: true }))
      .toEqual(createSidebarPalette(colors, { ...options, transparency: 1, clear: true }));
    expect(createSidebarPalette(colors, { ...options, transparency: -5 }))
      .toEqual(createSidebarPalette(colors, { ...options, transparency: 0 }));
    const other = analyzeSidebarPixels(pixels([[80, 20, 120, 255]]), 1, 1, 1);
    expect(createSidebarPalette(colors, { ...options, transparency: 0 }))
      .toEqual(createSidebarPalette(other, { ...options, transparency: 0 }));
  });

  it("极端颜色、深浅主题和各档透明度下，正文、次文字、强调文字和描边满足对比度", () => {
    for (const base of [[16, 26, 46], [255, 255, 255]] as Rgb[]) {
      for (const red of [0, 64, 128, 192, 255]) for (const green of [0, 128, 255]) for (const blue of [0, 128, 255]) {
        const samples = analyzeSidebarPixels(pixels([[red, green, blue, 255], [255 - red, 255 - green, 255 - blue, 90]]), 1, 2, .5);
        for (const transparency of [0, .25, .52, .75, 1]) {
          const palette = createSidebarPalette(samples, { ...options, base, transparency });
          const backgrounds = [palette.surface, palette.control, palette.selected, palette.hover, ...panelBackgrounds(palette.surface, palette.panelAlpha)];
          for (const background of backgrounds) {
            for (const text of [palette.text, palette.muted, palette.primary]) expect(colorContrast(text, background)).toBeGreaterThanOrEqual(4.5);
            expect(colorContrast(palette.border, background)).toBeGreaterThanOrEqual(3);
            expect(colorContrast(palette.favorite, background)).toBeGreaterThanOrEqual(3);
            expect(colorContrast(palette.running, background)).toBeGreaterThanOrEqual(3);
          }
          expect(colorContrast(palette.primary, palette.onPrimary)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("取色失败使用保守主题配色，仍能保护未知的黑白背景", () => {
    const palette = createSidebarPalette(null, options);
    for (const background of panelBackgrounds(palette.surface, palette.panelAlpha)) {
      expect(colorContrast(palette.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(colorContrast(palette.muted, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
