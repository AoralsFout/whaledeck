/**
 * @file 派生视图 Hook：把全局库状态映射为可见列表与当前选中。
 *
 * 过滤/排序/选择规则全部复用 lib/library.ts，组件不重复实现。
 * 对应文档：docs/前端实现.md「派生状态」。
 */
import { useMemo } from "react";
import { filterGames, selectVisibleGame, sortGames } from "../lib/library";
import { useLibrary } from "./useLibrary";

/** 可见列表与当前选中；选中项离开筛选结果时回落到首项。 */
export function useLibraryView() {
  const games = useLibrary((s) => s.games);
  const nav = useLibrary((s) => s.nav);
  const query = useLibrary((s) => s.query);
  const sort = useLibrary((s) => s.sort);
  const selectedId = useLibrary((s) => s.selectedId);
  const visible = useMemo(
    () => sortGames(filterGames(games, nav, query), sort),
    [games, nav, query, sort],
  );
  const selected = selectVisibleGame(visible, selectedId);
  return { visible, selected };
}
