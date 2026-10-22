import { describe, expect, it } from "vitest";
import type { Game } from "../types";
import { collectCategories, countByCategory, filterGames, sortGames } from "./library";

function game(partial: Partial<Game>): Game {
  return {
    id: "g1",
    title: "游戏",
    exePath: "C:\\g.exe",
    workDir: "",
    args: "",
    extraProcessNames: [],
    coverFile: null,
    category: "",
    tags: [],
    note: "",
    favorite: false,
    hidden: false,
    playtimeSec: 0,
    lastPlayedAt: null,
    addedAt: 0,
    savePaths: [],
    ...partial,
  };
}

const games: Game[] = [
  game({ id: "1", title: "星露谷物语", category: "种田", tags: ["像素"], playtimeSec: 7200, lastPlayedAt: 3000, favorite: true }),
  game({ id: "2", title: "泰拉瑞亚", category: "动作", tags: ["像素", "联机"], playtimeSec: 3600, lastPlayedAt: 2000 }),
  game({ id: "3", title: "空洞骑士", category: "动作", tags: ["银河城"], playtimeSec: 0, lastPlayedAt: null }),
  game({ id: "4", title: "隐藏游戏", category: "动作", hidden: true }),
];

describe("filterGames", () => {
  it("全部游戏排除隐藏项", () => {
    const list = filterGames(games, { type: "all" }, "");
    expect(list.map((g) => g.id)).toEqual(["1", "2", "3"]);
  });
  it("收藏筛选", () => {
    expect(filterGames(games, { type: "favorites" }, "").map((g) => g.id)).toEqual(["1"]);
  });
  it("已隐藏筛选", () => {
    expect(filterGames(games, { type: "hidden" }, "").map((g) => g.id)).toEqual(["4"]);
  });
  it("分类筛选", () => {
    expect(filterGames(games, { type: "category", name: "动作" }, "").map((g) => g.id)).toEqual(["2", "3"]);
  });
  it("搜索标题 / 标签 / 分类", () => {
    expect(filterGames(games, { type: "all" }, "骑士").map((g) => g.id)).toEqual(["3"]);
    expect(filterGames(games, { type: "all" }, "像素").map((g) => g.id)).toEqual(["1", "2"]);
    expect(filterGames(games, { type: "all" }, "动作").map((g) => g.id)).toEqual(["2", "3"]);
  });
  it("搜索大小写不敏感", () => {
    const list = filterGames([game({ id: "x", title: "Hades" })], { type: "all" }, "hades");
    expect(list).toHaveLength(1);
  });
});

describe("sortGames", () => {
  it("最近游玩且收藏置顶", () => {
    const ids = sortGames(filterGames(games, { type: "all" }, ""), "recent").map((g) => g.id);
    expect(ids[0]).toBe("1");
    expect(ids[1]).toBe("2");
    expect(ids[2]).toBe("3");
  });
  it("按名称", () => {
    const ids = sortGames(filterGames(games, { type: "all" }, ""), "title").map((g) => g.id);
    expect(ids).toHaveLength(3);
  });
  it("按游玩时长降序", () => {
    const ids = sortGames(games, "playtime").map((g) => g.id);
    expect(ids[0]).toBe("1");
    expect(ids[1]).toBe("2");
  });
});

describe("分类工具", () => {
  it("合并游戏分类与自定义分类并去重", () => {
    const list = collectCategories(games, ["独立", "动作"]);
    expect(list).toContain("动作");
    expect(list).toContain("种田");
    expect(list).toContain("独立");
    expect(list.filter((c) => c === "动作")).toHaveLength(1);
  });
  it("统计分类数量", () => {
    expect(countByCategory(games, "动作")).toBe(3);
  });
});
