import { useMemo } from "react";
import { getLibraryView } from "../lib/library";
import { useLibrary } from "./useLibrary";

export function useLibraryView() {
  const games = useLibrary((s) => s.games);
  const nav = useLibrary((s) => s.nav);
  const query = useLibrary((s) => s.query);
  const sort = useLibrary((s) => s.sort);
  const selectedId = useLibrary((s) => s.selectedId);
  return useMemo(
    () => getLibraryView(games, nav, query, sort, selectedId),
    [games, nav, query, sort, selectedId],
  );
}
