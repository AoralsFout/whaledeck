/**
 * @file 侧栏图片的区域取色与局部配色纯函数；不加载图片、不访问 DOM、不保存主题。
 * 对应文档：docs/前端实现.md §4.2.1、docs/界面与交互.md §4.3。
 */
export type Rgb = readonly [number, number, number];
type Region = { mean: Rgb; seed: Rgb | null; coverage: number };
export type SidebarImageColors = { top: Region; all: Region };
export type SidebarPalette = {
  dark: boolean; surface: Rgb; control: Rgb; selected: Rgb; hover: Rgb;
  controlOpacity: number; selectedOpacity: number; hoverOpacity: number;
  text: Rgb; muted: Rgb; primary: Rgb; border: Rgb; selectedBorder: Rgb; favorite: Rgb; running: Rgb;
};

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return a.map((value, i) => Math.round(value * (1 - amount) + b[i] * amount)) as [number, number, number];
}

function luminance(color: Rgb): number {
  const linear = color.map(value => value / 255 <= .04045 ? value / 255 / 12.92 : ((value / 255 + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}

/** 使用线性化 sRGB 计算文字与承载表面的对比度，不能直接比较 RGB 平均值。 */
export function colorContrast(a: Rgb, b: Rgb): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

function minContrast(color: Rgb, backgrounds: Rgb[]): number {
  return Math.min(...backgrounds.map(background => colorContrast(color, background)));
}

function readable(color: Rgb, backgrounds: Rgb[], ratio: number): Rgb {
  const target = minContrast(WHITE, backgrounds) > minContrast(BLACK, backgrounds) ? WHITE : BLACK;
  // 有限步进保留原有色相，必要时逐渐向可读的黑或白靠拢。
  for (let i = 0; i <= 100; i++) {
    const candidate = mix(color, target, i / 100);
    if (minContrast(candidate, backgrounds) >= ratio) return candidate;
  }
  return target;
}

function region(pixels: Uint8ClampedArray, start: number, end: number): Region {
  const buckets = new Map<number, { weight: number; sum: number[] }>();
  let weight = 0;
  const sum = [0, 0, 0];
  for (let i = start; i < end; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (!alpha) continue;
    weight += alpha;
    const color = [pixels[i], pixels[i + 1], pixels[i + 2]];
    color.forEach((value, channel) => { sum[channel] += value * alpha; });
    const key = (color[0] >> 5) * 64 + (color[1] >> 5) * 8 + (color[2] >> 5);
    const bucket = buckets.get(key) ?? { weight: 0, sum: [0, 0, 0] };
    bucket.weight += alpha;
    color.forEach((value, channel) => { bucket.sum[channel] += value * alpha; });
    buckets.set(key, bucket);
  }
  let seed: Rgb | null = null;
  let best = 0;
  for (const bucket of buckets.values()) {
    const color = bucket.sum.map(value => Math.round(value / bucket.weight)) as [number, number, number];
    const chroma = Math.max(...color) - Math.min(...color);
    // 避免黑白留空和极少量鲜艳噪点压过图片中有代表性的颜色。
    const score = bucket.weight * (.25 + chroma / 255);
    if (chroma >= 16 && bucket.weight >= weight * .01 && score > best) { seed = color; best = score; }
  }
  return {
    mean: weight ? sum.map(value => Math.round(value / weight)) as [number, number, number] : BLACK,
    seed, coverage: weight / Math.max(1, (end - start) / 4),
  };
}

/** 上方取色独立于整幅图；透明像素只贡献覆盖率，不能当成黑色背景。 */
export function analyzeSidebarPixels(pixels: Uint8ClampedArray, width: number, height: number, topFraction: number): SidebarImageColors {
  const end = width * height * 4;
  const topEnd = width * Math.max(1, Math.min(height, Math.ceil(height * topFraction))) * 4;
  return { top: region(pixels, 0, topEnd), all: region(pixels, 0, end) };
}

/** 背景只决定明暗与合成校正；控件使用中性薄层，避免图片平均色污染所有表面。 */
export function createSidebarPalette(colors: SidebarImageColors | null, options: {
  base: Rgb; fallback: Rgb; transparency: number; clear: boolean;
}): SidebarPalette {
  const amount = options.clear ? 1 : Math.max(0, Math.min(1, options.transparency));
  const top = colors?.top;
  const average = top ? mix(options.base, top.mean, top.coverage) : options.base;
  const background = mix(options.base, average, amount);
  const seed = mix(options.fallback, top?.seed ?? colors?.all.seed ?? options.fallback, amount);
  const dark = colorContrast(WHITE, background) >= colorContrast(BLACK, background);
  const surface: Rgb = dark ? [24, 28, 34] : [250, 251, 253];
  const control = surface;
  const controlOpacity = dark ? .22 : .38;
  const selectedOpacity = dark ? .34 : .52;
  const hoverOpacity = dark ? .28 : .44;
  const composedControl = mix(background, control, controlOpacity);
  const primary = readable(mix(seed, dark ? WHITE : BLACK, dark ? .32 : .20), [surface, composedControl], 4.7);
  const selected = mix(surface, primary, .035);
  const hover = surface;
  // 保留原始填色与采样处的实际合成色两份约束，CSS 必须使用相同 alpha 绘制。
  const surfaces = [surface, selected, composedControl, mix(background, selected, selectedOpacity), mix(background, hover, hoverOpacity)];
  const text = readable(dark ? [245, 247, 251] : [20, 27, 38], surfaces, 4.7);
  const muted = readable(mix(surface, text, .76), surfaces, 4.7);
  const safePrimary = readable(primary, surfaces, 4.7);
  return {
    dark, surface, control, selected, hover, controlOpacity, selectedOpacity, hoverOpacity, text, muted,
    primary: safePrimary,
    border: mix(control, text, .18),
    selectedBorder: mix(control, safePrimary, .35),
    favorite: readable([255, 209, 102], surfaces, 3.2),
    running: readable([126, 231, 200], surfaces, 3.2),
  };
}

/** 只写入侧栏作用域；背景图与整幅遮罩使用独立变量，防止反馈改变取色依据。 */
export function sidebarPaletteStyle(palette: SidebarPalette): Record<string, string> {
  const rgb = (value: Rgb) => `rgb(${value.join(", ")})`;
  const rgba = (value: Rgb, opacity: number) => `rgba(${value.join(", ")}, ${opacity})`;
  return {
    "--surface": rgb(palette.surface), "--surface-2": rgba(palette.control, palette.controlOpacity),
    "--text": rgb(palette.text), "--text-dim": rgb(palette.muted),
    "--primary": rgb(palette.primary), "--primary-ink": rgb(palette.primary),
    "--primary-rgb": palette.primary.join(", "), "--accent-rgb": palette.primary.join(", "),
    "--border": rgba(palette.border, .48),
    "--sidebar-selected": rgba(palette.selected, palette.selectedOpacity), "--sidebar-hover": rgba(palette.hover, palette.hoverOpacity),
    "--sidebar-selected-border": rgba(palette.selectedBorder, .60),
    "--sidebar-favorite": rgb(palette.favorite), "--sidebar-running": rgb(palette.running),
    "--sidebar-color-scheme": palette.dark ? "dark" : "light",
  };
}
