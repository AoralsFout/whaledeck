import type { Game, NavKey, SortKey } from "../types";

/** Windows 目标路径在扫描去重和写入重试时使用同一比较规则。 */
export function gamePathKey(path: string): string {
  return path.trim().replaceAll("/", "\\").toLowerCase();
}

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

/** 列表与详情共享同一选择规则，避免展示筛选结果之外的项目。 */
export function getLibraryView(
  games: Game[], nav: NavKey, query: string, sort: SortKey, selectedId: string | null,
) {
  const visible = sortGames(filterGames(games, nav, query), sort);
  const selected = visible.find((game) => game.id === selectedId) ?? visible[0] ?? null;
  return { visible, selected };
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
