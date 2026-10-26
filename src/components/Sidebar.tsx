/**
 * @file 左侧游戏库：品牌、搜索、筛选 chips、排序、工具按钮与游戏列表。
 *
 * 列表只消费派生的可见项；选中/启动通过全局 store，不在这里改持久化数据。
 * 对应文档：docs/界面与交互.md「布局」「列表项」、docs/前端实现.md §3。
 */
import { ArrowDownWideNarrow, ArrowLeft, FolderSearch, Plus, Search, Settings, Star, X } from "lucide-react";
import { formatPlaytime, formatRelative } from "../lib/format";
import { collectCategories } from "../lib/library";
import { DEFAULT_BACKGROUND_FIT, sidebarBackgroundSource } from "../lib/backgroundFit";
import { useSidebarBackgroundFit } from "../lib/useSidebarBackgroundFit";
import { useSidebarPalette } from "../lib/useSidebarPalette";
import { sidebarBlur } from "../lib/theme";
import { memo, useMemo } from "react";
import { SidebarBackground } from "./SidebarBackground";
import { Brand } from "./Brand";
import { GameIcon } from "./GameIcon";
import { useCoverSelection } from "./CoverSelectionProvider";
import { useLibrary } from "../store/useLibrary";
import { useLibraryView } from "../store/useLibraryView";
import type { Game, NavKey, SortKey } from "../types";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "最近游玩" },
  { value: "title", label: "名称" },
  { value: "playtime", label: "时长" },
  { value: "added", label: "添加时间" },
];

/** 列表缩略图：项目图标缺失或损坏时，由 GameIcon 显示应用图标。 */
function Thumb({ game }: { game: Game }) {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg"
      style={{
        background: "linear-gradient(135deg, rgba(var(--primary-rgb), .25), rgba(var(--accent-rgb), .18))",
      }}
    >
      <GameIcon file={game.iconFile} className="h-full w-full object-contain p-0.5" />
    </div>
  );
}

/** 外观变化由 CSS 呈现；记录与状态未变时保留已渲染的列表项和图片。 */
const LibraryItem = memo(function LibraryItem({ game, active, running, onNavigate }: {
  game: Game; active: boolean; running: boolean; onNavigate: () => void;
}) {
  return (
    <button
      onClick={() => { useLibrary.getState().select(game.id); onNavigate(); }}
      onDoubleClick={() => void useLibrary.getState().launchGame(game.id)}
      className="library-item mb-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left"
      aria-current={active ? "true" : undefined}
      title={`${game.title}\n${game.exePath}\n双击启动`}
    >
      <Thumb game={game} />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[13px] font-medium">{game.title}</p>
        <p className="m-0 mt-0.5 truncate text-[11px]" style={{ color: "var(--text-dim)" }}>
          {formatRelative(game.lastPlayedAt)} · {formatPlaytime(game.playtimeSec)}
        </p>
      </div>
      {running && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--sidebar-running, #7ee7c8)" }} title="运行中" aria-label="运行中" />}
      {game.favorite && <Star size={11} className="shrink-0" style={{ color: "var(--sidebar-favorite, #ffd166)" }} fill="currentColor" />}
    </button>
  );
});

/** 列表独立订阅选中与会话，避免调整主题或打开弹窗时遍历整份游戏库。 */
const LibraryList = memo(function LibraryList({ games, emptyLibrary, onNavigate }: {
  games: Game[]; emptyLibrary: boolean; onNavigate: () => void;
}) {
  const selectedId = useLibrary((s) => s.selectedId);
  const sessions = useLibrary((s) => s.sessions);
  const runningIds = useMemo(() => new Set(sessions.map((session) => session.gameId)), [sessions]);
  return (
    <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {games.length === 0 && (
        <p className="sidebar-empty rounded-lg px-3 py-6 text-center text-[11px]" style={{ color: "var(--text-dim)" }}>
          {emptyLibrary ? "还没有游戏，点右上角 + 添加" : "没有匹配的游戏"}
        </p>
      )}
      {games.map((game) => <LibraryItem key={game.id} game={game} active={game.id === selectedId} running={runningIds.has(game.id)} onNavigate={onNavigate} />)}
    </div>
  );
});

/** 侧栏；窄屏点击列表项后由 onNavigate 关闭覆盖层，弹窗开关不重渲染导航内容。 */
export const Sidebar = memo(function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const games = useLibrary((s) => s.games);
  const settings = useLibrary((s) => s.settings);
  const { visible } = useLibraryView();
  const cover = useCoverSelection();
  const transparent = (settings?.theme.sidebarTransparency ?? .52) >= 1;
  const glass = sidebarBlur(settings?.theme.sidebarBlur) > 0;
  const fitSource = settings ? sidebarBackgroundSource(settings.theme, cover.source) : null;
  const fitted = useSidebarBackgroundFit(fitSource, settings?.theme.sidebarBackgroundFit ?? DEFAULT_BACKGROUND_FIT, true, fitSource?.sourceKind === "superres" ? cover.revision : 0);
  // 图片和取景必须一起交接；原图回退会先居中，再跳到后台生成的取景。
  const displayedBackground = fitted.image?.url;
  const palette = useSidebarPalette(fitted.image, settings?.theme.sidebarTransparency ?? .52, transparent);
  const nav = useLibrary((s) => s.nav);
  const setNav = useLibrary((s) => s.setNav);
  const query = useLibrary((s) => s.query);
  const setQuery = useLibrary((s) => s.setQuery);
  const sort = useLibrary((s) => s.sort);
  const setSort = useLibrary((s) => s.setSort);
  const openNew = useLibrary((s) => s.openNew);
  const openScan = useLibrary((s) => s.openScan);
  const openSettings = useLibrary((s) => s.openSettings);

  const categories = collectCategories(games, settings?.categories ?? []);

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
      className="library-sidebar flex shrink-0 flex-col"
      data-has-background={Boolean(displayedBackground)}
      data-glass={glass}
      data-transparent={transparent}
      data-adaptive-color={Boolean(palette)}
      style={{
        ...palette,
      }}
    >
      <SidebarBackground image={fitted.image} mode={settings?.theme.detailBackgroundTransition ?? "blur"} />
      <div className="sidebar-controls">
        <div className="sidebar-brand flex items-center gap-2.5 px-4 pb-4 pt-4" data-tauri-drag-region>
          <Brand />
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
                  className="filter-chip rounded-full px-2.5 py-1 text-[12px]"
                  aria-pressed={active}
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
                className="input sidebar-sort"
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
      </div>

      <LibraryList games={visible} emptyLibrary={games.length === 0} onNavigate={onNavigate} />

      <div
        className="sidebar-footer flex items-center justify-between px-4 py-2.5"
      >
        <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
          {visible.length} / {games.length} 个项目
        </span>
        <button
          className="btn !px-2 !py-1 text-[10px]"
          onClick={openSettings}
        >
          <Settings size={11} />
          设置
        </button>
      </div>
    </aside>
  );
});
