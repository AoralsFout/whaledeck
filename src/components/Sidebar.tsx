import { EyeOff, FolderHeart, Gamepad2, LayoutGrid, Settings, Star, Tag } from "lucide-react";
import { collectCategories } from "../lib/library";
import { useLibrary } from "../store/useLibrary";
import type { NavKey } from "../types";

type NavItemProps = {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
};

function NavItem({ active, icon, label, count, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors"
      style={{
        background: active ? "rgba(var(--primary-rgb), 0.12)" : "transparent",
        color: active ? "var(--primary)" : "var(--text-dim)",
        border: active
          ? "1px solid rgba(var(--primary-rgb), 0.22)"
          : "1px solid transparent",
      }}
    >
      <span className="flex w-4 justify-center">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span className="text-[11px] opacity-70">{count}</span>
      )}
    </button>
  );
}

export function Sidebar() {
  const games = useLibrary((s) => s.games);
  const settings = useLibrary((s) => s.settings);
  const nav = useLibrary((s) => s.nav);
  const setNav = useLibrary((s) => s.setNav);
  const openSettings = useLibrary((s) => s.openSettings);

  const categories = collectCategories(games, settings?.categories ?? []);
  const isAll = nav.type === "all";
  const isFav = nav.type === "favorites";
  const hiddenCount = games.filter((g) => g.hidden).length;

  return (
    <aside
      className="flex w-[236px] shrink-0 flex-col border-r"
      style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--surface) 55%, transparent)" }}
    >
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
          style={{
            background: "linear-gradient(135deg, rgba(var(--primary-rgb), .22), rgba(var(--accent-rgb), .18))",
            border: "1px solid rgba(var(--primary-rgb), .3)",
          }}
        >
          🐋
        </div>
        <div className="leading-tight">
          <p className="m-0 text-[15px] font-semibold tracking-wide">WhaleDeck</p>
          <p className="m-0 text-[10px]" style={{ color: "var(--text-dim)" }}>
            鲸鱼游戏台
          </p>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        <NavItem
          active={isAll}
          icon={<LayoutGrid size={15} />}
          label="全部游戏"
          count={games.filter((g) => !g.hidden).length}
          onClick={() => setNav({ type: "all" } as NavKey)}
        />
        <NavItem
          active={isFav}
          icon={<Star size={15} />}
          label="收藏"
          count={games.filter((g) => g.favorite && !g.hidden).length}
          onClick={() => setNav({ type: "favorites" } as NavKey)}
        />
        {hiddenCount > 0 && (
          <NavItem
            active={nav.type === "hidden"}
            icon={<EyeOff size={15} />}
            label="已隐藏"
            count={hiddenCount}
            onClick={() => setNav({ type: "hidden" } as NavKey)}
          />
        )}
      </nav>

      <div className="mt-5 flex-1 overflow-y-auto px-3">
        <div className="mb-1.5 flex items-center gap-1.5 px-3">
          <Tag size={11} style={{ color: "var(--text-dim)" }} />
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-dim)" }}>
            分类
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {categories.length === 0 && (
            <p className="px-3 py-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
              还没有分类，编辑游戏时填写即可
            </p>
          )}
          {categories.map((name) => (
            <NavItem
              key={name}
              active={nav.type === "category" && nav.name === name}
              icon={<FolderHeart size={15} />}
              label={name}
              count={games.filter((g) => g.category === name && !g.hidden).length}
              onClick={() => setNav({ type: "category", name })}
            />
          ))}
        </div>
      </div>

      <div className="border-t px-3 py-3" style={{ borderColor: "var(--border)" }}>
        <NavItem
          active={false}
          icon={<Settings size={15} />}
          label="设置"
          onClick={openSettings}
        />
        <div className="mt-2 flex items-center justify-between px-3">
          <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
            共 {games.length} 个游戏
          </span>
          <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-dim)" }}>
            <Gamepad2 size={10} /> v0.4.0
          </span>
        </div>
      </div>
    </aside>
  );
}
