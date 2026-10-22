import { Plus } from "lucide-react";

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-5">
      <div className="relative">
        <div
          className="absolute -inset-8 rounded-full opacity-40 blur-2xl"
          style={{ background: "radial-gradient(circle, rgba(var(--primary-rgb), .5), transparent 70%)" }}
        />
        <div className="relative text-7xl">🐋</div>
      </div>
      <div className="text-center">
        <h2 className="m-0 text-lg font-semibold">游戏库还是空的</h2>
        <p className="m-0 mt-1.5 text-[13px]" style={{ color: "var(--text-dim)" }}>
          把散落各处的游戏收进来，点一下就能启动，还会自动记录游玩时长。
        </p>
      </div>
      <button className="btn btn-primary" onClick={onAdd}>
        <Plus size={15} />
        添加第一个游戏
      </button>
      <p className="m-0 text-[11px]" style={{ color: "var(--text-dim)" }}>
        支持任意本地 exe · 数据只保存在本机
      </p>
    </div>
  );
}
