import { useEffect, useState } from "react";
import { Clock, Heart, Play, Star } from "lucide-react";
import { formatPlaytime, formatRelative, formatTimer, titleFromPath } from "../lib/format";
import { useAssetUrl } from "../lib/useAssetUrl";
import { useLibrary } from "../store/useLibrary";
import type { Game, Session } from "../types";

function CoverPlaceholder({ title }: { title: string }) {
  const letter = (title || "?").trim().charAt(0).toUpperCase();
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background:
          "linear-gradient(135deg, rgba(var(--primary-rgb), .18), rgba(var(--accent-rgb), .12) 60%, transparent)",
      }}
    >
      <span
        className="text-4xl font-bold"
        style={{ color: "rgba(var(--primary-rgb), .85)" }}
      >
        {letter}
      </span>
    </div>
  );
}

type Props = { game: Game; running?: Session };

export function GameCard({ game, running }: Props) {
  const cover = useAssetUrl("cover", game.coverFile);
  const select = useLibrary((s) => s.select);
  const launch = useLibrary((s) => s.launchGame);
  const selectedId = useLibrary((s) => s.selectedId);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - running.startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);

  const active = selectedId === game.id;

  return (
    <div
      className="game-card group relative cursor-pointer overflow-hidden rounded-2xl border"
      style={{
        background: "var(--surface)",
        borderColor: active ? "rgba(var(--primary-rgb), .6)" : "var(--border)",
        boxShadow: active
          ? "0 0 0 1px rgba(var(--primary-rgb), .35), 0 18px 40px -22px rgba(var(--primary-rgb), .5)"
          : undefined,
      }}
      onClick={() => select(active ? null : game.id)}
      onDoubleClick={() => void launch(game.id)}
      title={`${game.title}\n${game.exePath}\n双击启动`}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-black/20">
        {cover ? (
          <img
            src={cover}
            alt={game.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            draggable={false}
          />
        ) : (
          <CoverPlaceholder title={game.title || titleFromPath(game.exePath)} />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent opacity-80" />

        {running && (
          <div
            className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium"
            style={{
              background: "rgba(8, 13, 26, .72)",
              color: "#7ee7c8",
              border: "1px solid rgba(126, 231, 200, .4)",
              backdropFilter: "blur(6px)",
            }}
          >
            <span className="running-dot h-1.5 w-1.5 rounded-full bg-[#7ee7c8]" />
            运行中 {formatTimer(elapsed)}
          </div>
        )}

        {game.favorite && (
          <div
            className="absolute right-2.5 top-2.5 rounded-full p-1"
            style={{ background: "rgba(8,13,26,.6)", color: "#ffd166" }}
            title="已收藏"
          >
            <Star size={12} fill="currentColor" />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 pb-2">
          <span className="chip" style={{ background: "rgba(8,13,26,.62)", borderColor: "rgba(255,255,255,.12)", color: "#dbe7ff" }}>
            {game.category || "未分类"}
          </span>
          <button
            className="btn btn-primary !rounded-full !px-3 !py-1.5 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              void launch(game.id);
            }}
            title="启动游戏"
          >
            <Play size={12} fill="currentColor" />
            启动
          </button>
        </div>
      </div>

      <div className="px-3 pb-3 pt-2.5">
        <p className="m-0 truncate text-[13px] font-medium" title={game.title}>
          {game.title}
        </p>
        <div className="mt-1 flex items-center justify-between text-[11px]" style={{ color: "var(--text-dim)" }}>
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {formatPlaytime(game.playtimeSec)}
          </span>
          <span>{formatRelative(game.lastPlayedAt)}</span>
        </div>
      </div>

      <button
        className="absolute bottom-3 right-2.5 rounded opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
        style={{ color: game.favorite ? "#ffd166" : "var(--text-dim)" }}
        onClick={(e) => {
          e.stopPropagation();
          void useLibrary.getState().toggleFavorite(game.id);
        }}
        title={game.favorite ? "取消收藏" : "加入收藏"}
      >
        <Heart size={13} fill={game.favorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
