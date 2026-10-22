import { ArrowDownWideNarrow, ArrowLeft, FolderSearch, Plus, Search, Settings, Star, X } from "lucide-react";
import { formatPlaytime, formatRelative } from "../lib/format";
import { collectCategories } from "../lib/library";
import { useAssetUrl } from "../lib/useAssetUrl";
import { useLibrary } from "../store/useLibrary";
import { useLibraryView } from "../store/useLibraryView";
import type { Game, NavKey, SortKey } from "../types";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "最近游玩" },
  { value: "title", label: "名称" },
  { value: "playtime", label: "时长" },
  { value: "added", label: "添加时间" },
];

function Thumb({ game }: { game: Game }) {
  const icon = useAssetUrl("icon", game.iconFile);
  const cover = useAssetUrl("cover", game.coverFile);
  const src = icon ?? cover;
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg"
      style={{
        background: "linear-gradient(135deg, rgba(var(--primary-rgb), .25), rgba(var(--accent-rgb), .18))",
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className={icon ? "h-full w-full object-contain p-0.5" : "h-full w-full object-cover"}
          draggable={false}
        />
      ) : (
        <span className="text-[13px] font-semibold" style={{ color: "rgba(var(--primary-rgb), .9)" }}>
          {(game.title || "?").charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const games = useLibrary((s) => s.games);
  const settings = useLibrary((s) => s.settings);
  const nav = useLibrary((s) => s.nav);
  const setNav = useLibrary((s) => s.setNav);
  const query = useLibrary((s) => s.query);
  const setQuery = useLibrary((s) => s.setQuery);
  const sort = useLibrary((s) => s.sort);
  const setSort = useLibrary((s) => s.setSort);
  const selectedId = useLibrary((s) => s.selectedId);
  const select = useLibrary((s) => s.select);
  const openNew = useLibrary((s) => s.openNew);
  const openScan = useLibrary((s) => s.openScan);
  const openSettings = useLibrary((s) => s.openSettings);
  const sessions = useLibrary((s) => s.sessions);

  const categories = collectCategories(games, settings?.categories ?? []);
  const { visible } = useLibraryView();

  const isActive = (key: NavKey) => {
    if (key.type !== nav.type) return false;
    if (key.type === "category" && nav.type === "category") return key.name === nav.name;
    return true;
  };

  const chips: NavKey[] = [
    { type: "all" },
    { type: "favorites" },
    ...(games.some((g) => g.hidden) ? [{ type: "hidden" } as NavKey] : []),
    ...categories.map((name): NavKey => ({ type: "category", name })),
  ];

  return (
    <aside
      id="library-sidebar"
      aria-label="游戏库"
      className="library-sidebar flex shrink-0 flex-col border-r"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--surface) 48%, transparent)",
        backdropFilter: "blur(24px) saturate(1.15)",
      }}
    >
      <div className="sidebar-brand flex items-center gap-2.5 px-4 pb-4 pt-4" data-tauri-drag-region>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg text-base"
          data-tauri-drag-region
          style={{
            background: "linear-gradient(135deg, rgba(var(--primary-rgb), .22), rgba(var(--accent-rgb), .18))",
            border: "1px solid rgba(var(--primary-rgb), .3)",
          }}
        >
          🐋
        </div>
        <div className="min-w-0 leading-tight" data-tauri-drag-region>
          <p className="m-0 text-[14px] font-semibold tracking-wide" data-tauri-drag-region>WhaleDeck</p>
          <p className="m-0 mt-0.5 text-[11px]" style={{ color: "var(--text-dim)" }} data-tauri-drag-region>
            鲸鱼游戏台
          </p>
        </div>
        <button
          className="btn btn-ghost ml-auto !p-1"
          onClick={openSettings}
          title="设置"
          aria-label="设置"
        >
          <Settings size={14} />
        </button>
      </div>

      <button className="btn btn-ghost mobile-sidebar-back mx-3 mb-3" onClick={onNavigate}>
        <ArrowLeft size={16} aria-hidden="true" /> 返回详情
      </button>

      <div className="space-y-2 px-3">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-dim)" }}
          />
          <input
            className="input sidebar-search"
            aria-label="搜索游戏、分类、标签"
            placeholder="搜索游戏、分类、标签…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          {query && (
            <button
              className="search-clear absolute right-1 top-1/2 -translate-y-1/2 rounded"
              style={{ color: "var(--text-dim)" }}
              onClick={() => setQuery("")}
              aria-label="清空搜索"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <div className="sidebar-filters flex flex-wrap gap-1.5 pb-1" role="group" aria-label="筛选游戏">
          {chips.map((chip) => {
            const active = isActive(chip);
            const label =
              chip.type === "all"
                ? "全部"
                : chip.type === "favorites"
                  ? "收藏"
                  : chip.type === "hidden"
                    ? "已隐藏"
                    : chip.name;
            return (
              <button
                key={chip.type + ("name" in chip ? chip.name : "")}
                onClick={() => setNav(chip)}
                className="filter-chip rounded-full px-2.5 py-1 text-[12px] transition-colors"
                aria-pressed={active}
                style={{
                  background: active ? "rgba(var(--primary-rgb), .16)" : "var(--surface-2)",
                  color: active ? "var(--primary-ink)" : "var(--text-dim)",
                  border: `1px solid ${active ? "rgba(var(--primary-rgb), .4)" : "var(--border)"}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <ArrowDownWideNarrow
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-dim)" }}
            />
            <select
              className="input sidebar-sort cursor-pointer appearance-none"
              value={sort}
              onChange={(e) => void setSort(e.target.value as SortKey)}
              title="排序方式"
              aria-label="排序方式"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn sidebar-tool !px-2" onClick={openScan} title="扫描文件夹" aria-label="扫描文件夹">
            <FolderSearch size={13} />
          </button>
          <button className="btn btn-primary sidebar-tool !px-2" onClick={openNew} title="添加项目" aria-label="添加项目">
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-[11px]" style={{ color: "var(--text-dim)" }}>
            {games.length === 0 ? "还没有游戏，点右上角 + 添加" : "没有匹配的游戏"}
          </p>
        )}
        {visible.map((game) => {
          const active = game.id === selectedId;
          const running = sessions.some((s) => s.gameId === game.id);
          return (
            <button
              key={game.id}
              onClick={() => { select(game.id); onNavigate(); }}
              onDoubleClick={() => void useLibrary.getState().launchGame(game.id)}
              className="library-item mb-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors"
              aria-current={active ? "true" : undefined}
              style={{
                background: active ? "rgba(var(--primary-rgb), .13)" : "transparent",
                border: `1px solid ${active ? "rgba(var(--primary-rgb), .3)" : "transparent"}`,
              }}
              title={`${game.title}\n${game.exePath}\n双击启动`}
            >
              <Thumb game={game} />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[13px] font-medium">
                  {game.title}
                </p>
                <p className="m-0 mt-0.5 truncate text-[11px]" style={{ color: "var(--text-dim)" }}>
                  {formatRelative(game.lastPlayedAt)} · {formatPlaytime(game.playtimeSec)}
                </p>
              </div>
              {running && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#7ee7c8]" title="运行中" aria-label="运行中" />
              )}
              {game.favorite && (
                <Star size={11} className="shrink-0" style={{ color: "#ffd166" }} fill="currentColor" />
              )}
            </button>
          );
        })}
      </div>

      <div
        className="flex items-center justify-between border-t px-4 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
          {visible.length} / {games.length} 个项目
        </span>
        <button
          className="btn btn-ghost !px-2 !py-1 text-[10px]"
          onClick={openSettings}
        >
          <Settings size={11} />
          设置
        </button>
      </div>
    </aside>
  );
}
