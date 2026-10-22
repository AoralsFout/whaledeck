import type { Game, NavKey, SortKey } from "../types";

/** 应用导航与搜索过滤 */
export function filterGames(games: Game[], nav: NavKey, query: string): Game[] {
  const q = query.trim().toLowerCase();
  return games.filter((game) => {
    // 隐藏的游戏只在「已隐藏」视图里出现
    if (nav.type !== "hidden" && game.hidden) return false;
    if (nav.type === "hidden" && !game.hidden) return false;
    if (nav.type === "favorites" && !game.favorite) return false;
    if (nav.type === "category" && game.category !== nav.name) return false;
    if (!q) return true;
    const haystack = [game.title, game.category, ...game.tags].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

export function sortGames(games: Game[], sort: SortKey): Game[] {
  const list = [...games];
  switch (sort) {
    case "title":
      return list.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
    case "playtime":
      return list.sort((a, b) => b.playtimeSec - a.playtimeSec);
    case "added":
      return list.sort((a, b) => b.addedAt - a.addedAt);
    case "recent":
    default:
      return list.sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        const at = a.lastPlayedAt ?? 0;
        const bt = b.lastPlayedAt ?? 0;
        return bt - at;
      });
  }
}

export function collectCategories(games: Game[], extra: string[]): string[] {
  const set = new Set<string>(extra);
  for (const game of games) {
    if (game.category) set.add(game.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function countByCategory(games: Game[], name: string): number {
  return games.filter((g) => g.category === name).length;
}
