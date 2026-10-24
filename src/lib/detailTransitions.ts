/**
 * @file 展示页过渡的字素拆分与有界乱码帧；不操作 DOM 或保存设置。
 * 对应文档：docs/前端实现.md §3.1、docs/界面与交互.md §2.2.1。
 */
export const BACKGROUND_TRANSITION_MS = 480;
export const SCRAMBLE_MS = 460;
export const MAX_ANIMATED_GRAPHEMES = 160;
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%+=?";

/** 保留组合字符与 emoji 整体；只为可见前缀建立逐字节点，限制长简介开销。 */
export function transitionCharacters(text: string): { characters: string[]; rest: string } {
  const characters: string[] = [];
  let end = 0;
  for (const part of segmenter.segment(text)) {
    if (characters.length === MAX_ANIMATED_GRAPHEMES) break;
    characters.push(part.segment);
    end = part.index + part.segment.length;
  }
  return { characters, rest: text.slice(end) };
}

/** 从左到右恢复；空白始终保留，终帧精确还原，稳定种子便于验证。 */
export function scrambleCharacters(characters: readonly string[], progress: number, tick: number): string[] {
  const resolved = Math.floor(Math.min(1, Math.max(0, progress)) * characters.length);
  return characters.map((character, index) => index < resolved || /^\s+$/u.test(character)
    ? character : GLYPHS[(index * 17 + tick * 13) % GLYPHS.length]);
}
