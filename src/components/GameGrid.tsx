import { filterGames, sortGames } from "../lib/library";
import { useLibrary } from "../store/useLibrary";
import { EmptyState } from "./EmptyState";
import { GameCard } from "./GameCard";

export function GameGrid() {
  const games = useLibrary((s) => s.games);
  const nav = useLibrary((s) => s.nav);
  const query = useLibrary((s) => s.query);
  const sort = useLibrary((s) => s.sort);
  const sessions = useLibrary((s) => s.sessions);
  const openNew = useLibrary((s) => s.openNew);
  const setQuery = useLibrary((s) => s.setQuery);
  const setNav = useLibrary((s) => s.setNav);

  if (games.length === 0) {
    return <EmptyState onAdd={openNew} />;
  }

  const visible = sortGames(filterGames(games, nav, query), sort);

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <div className="text-4xl opacity-60">🫧</div>
        <p className="m-0 text-sm" style={{ color: "var(--text-dim)" }}>
          这里没有匹配的游戏
        </p>
        <div className="flex gap-2">
          {query && (
            <button className="btn" onClick={() => setQuery("")}>
              清空搜索
            </button>
          )}
          {nav.type !== "all" && (
            <button className="btn" onClick={() => setNav({ type: "all" })}>
              看全部游戏
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="grid gap-4 pt-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(214px, 1fr))" }}
    >
      {visible.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          running={sessions.find((s) => s.gameId === game.id)}
        />
      ))}
    </div>
  );
}
