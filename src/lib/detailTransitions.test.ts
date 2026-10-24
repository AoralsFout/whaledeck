/**
 * @file 展示页文字过渡的 Unicode、空白、长文本与终帧边界回归。
 * 不渲染组件，视觉与快速切换另由界面验收覆盖。
 * 对应文档：docs/前端实现.md §3.1、docs/界面与交互.md §2.2.1。
 */
import { describe, expect, it } from "vitest";
import { MAX_ANIMATED_GRAPHEMES, scrambleCharacters, transitionCharacters } from "./detailTransitions";

describe("展示页文本过渡", () => {
  it("字素不拆散 emoji、组合音标与换行，保留原文", () => {
    const text = "鲸 e\u0301👨‍👩‍👧‍👦\n新旅程";
    const { characters, rest } = transitionCharacters(text);
    expect(characters).toContain("e\u0301");
    expect(characters).toContain("👨‍👩‍👧‍👦");
    expect(characters.join("") + rest).toBe(text);
  });

  it("长简介只建立有界的动画前缀，后缀完整保留", () => {
    const text = "🐳".repeat(5000);
    const { characters, rest } = transitionCharacters(text);
    expect(characters).toHaveLength(MAX_ANIMATED_GRAPHEMES);
    expect(characters.join("") + rest).toBe(text);
    expect(transitionCharacters("")).toEqual({ characters: [], rest: "" });
  });

  it("乱码帧保留空白与已恢复前缀，终帧精确恢复", () => {
    const { characters } = transitionCharacters("鲸鱼 A\n👨‍👩‍👧‍👦");
    const first = scrambleCharacters(characters, 0, 1);
    expect(first[2]).toBe(" ");
    expect(first[4]).toBe("\n");
    expect(scrambleCharacters(characters, 0.5, 3).slice(0, 3)).toEqual(characters.slice(0, 3));
    expect(scrambleCharacters(characters, 1, 10)).toEqual(characters);
    expect(scrambleCharacters(characters, 2, 11)).toEqual(characters);
    expect(scrambleCharacters([], 0, 0)).toEqual([]);
  });
});
