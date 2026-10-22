import { Plus } from "lucide-react";

export function EmptyState({ onAdd, filtered = false, onReset }: { onAdd: () => void; filtered?: boolean; onReset?: () => void }) {
  return (
    <div className="empty-state flex h-full flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-20">
      <div className="relative">
        <div
          className="absolute -inset-8 rounded-full opacity-40 blur-2xl"
          style={{ background: "radial-gradient(circle, rgba(var(--primary-rgb), .5), transparent 70%)" }}
        />
        <div className="relative text-7xl">🐋</div>
      </div>
      <div className="text-center">
        <h1 className="m-0 text-lg font-semibold">{filtered ? "没有匹配的项目" : "游戏库还是空的"}</h1>
        <p className="m-0 mt-1.5 text-[13px]" style={{ color: "var(--text-dim)" }}>
          {filtered ? "试试其他关键词或分类，也可以清除筛选查看游戏库。" : "把散落各处的游戏收进来，点一下就能启动，还会自动记录游玩时长。"}
        </p>
      </div>
      <button className="btn btn-primary" onClick={filtered ? onReset : onAdd}>
        <Plus size={15} />
        {filtered ? "清除筛选" : "添加第一个游戏"}
      </button>
      <p className="m-0 text-[11px]" style={{ color: "var(--text-dim)" }}>
        支持任意本地 exe · 数据只保存在本机
      </p>
    </div>
  );
}
