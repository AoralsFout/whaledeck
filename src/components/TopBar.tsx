import { ArrowDownWideNarrow, Plus, Search, X } from "lucide-react";
import { useLibrary } from "../store/useLibrary";
import type { SortKey } from "../types";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "最近游玩" },
  { value: "title", label: "名称" },
  { value: "playtime", label: "游玩时长" },
  { value: "added", label: "添加时间" },
];

export function TopBar() {
  const query = useLibrary((s) => s.query);
  const setQuery = useLibrary((s) => s.setQuery);
  const sort = useLibrary((s) => s.sort);
  const setSort = useLibrary((s) => s.setSort);
  const openNew = useLibrary((s) => s.openNew);

  return (
    <header className="flex items-center gap-3 px-7 pb-2 pt-6">
      <div className="relative flex-1 max-w-[460px]">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-dim)" }}
        />
        <input
          className="input pl-9 pr-8"
          placeholder="搜索游戏、分类或标签…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5"
            style={{ color: "var(--text-dim)" }}
            aria-label="清空搜索"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <ArrowDownWideNarrow
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-dim)" }}
          />
          <select
            className="input cursor-pointer appearance-none pl-8 pr-7"
            value={sort}
            onChange={(e) => void setSort(e.target.value as SortKey)}
            title="排序方式"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={15} />
          添加游戏
        </button>
      </div>
    </header>
  );
}
