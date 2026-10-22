import type { Theme, ThemePreset } from "../types";

export const PRESETS: Record<
  ThemePreset,
  { name: string; primary: string; accent: string; blurb: string }
> = {
  whale: { name: "鲸鱼娘", primary: "#4fd6e8", accent: "#ff9ec7", blurb: "默认 · 深海青 + 腮红粉" },
  abyss: { name: "深海", primary: "#5b8cff", accent: "#22d3ee", blurb: "冷静的蓝紫" },
  sakura: { name: "樱花", primary: "#ff9ec7", accent: "#a78bfa", blurb: "柔和粉紫" },
  mono: { name: "极简", primary: "#c7d2fe", accent: "#94a3b8", blurb: "低饱和灰蓝" },
};

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0").slice(0, 6);
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return [79, 214, 232];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function resolveMode(mode: Theme["mode"]): "dark" | "light" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const mode = resolveMode(theme.mode);
  root.dataset.mode = mode;
  root.dataset.preset = theme.preset;
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--accent", theme.accent);
  const [r, g, b] = hexToRgb(theme.primary);
  root.style.setProperty("--primary-rgb", `${r}, ${g}, ${b}`);
  const [ar, ag, ab] = hexToRgb(theme.accent);
  root.style.setProperty("--accent-rgb", `${ar}, ${ag}, ${ab}`);
  root.style.setProperty("--bg-dim", String(theme.backgroundDim));
}

export function presetToTheme(preset: ThemePreset, base: Theme): Theme {
  const p = PRESETS[preset];
  return { ...base, preset, primary: p.primary, accent: p.accent };
}
