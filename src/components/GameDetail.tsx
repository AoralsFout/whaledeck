import { useEffect, useState } from "react";
import {
  Clock,
  Copy,
  FolderOpen,
  Pencil,
  Play,
  RotateCcw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { formatDate, formatPlaytime, formatRelative, formatTimer, shortPath } from "../lib/format";
import { useAssetUrl } from "../lib/useAssetUrl";
import { api } from "../lib/ipc";
import { useLibrary } from "../store/useLibrary";

function CoverFallback({ title }: { title: string }) {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background:
          "linear-gradient(135deg, rgba(var(--primary-rgb), .22), rgba(var(--accent-rgb), .14) 70%, transparent)",
      }}
    >
      <span className="text-6xl font-bold" style={{ color: "rgba(var(--primary-rgb), .8)" }}>
        {(title || "?").charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0" style={{ color: "var(--text-dim)" }}>
        {label}
      </span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}

export function GameDetail() {
  const game = useLibrary((s) => s.games.find((g) => g.id === s.selectedId) ?? null);
  const running = useLibrary((s) => s.sessions.find((x) => x.gameId === s.selectedId));
  const select = useLibrary((s) => s.select);
  const openEdit = useLibrary((s) => s.openEdit);
  const launch = useLibrary((s) => s.launchGame);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const deleteGame = useLibrary((s) => s.deleteGame);
  const showToast = useLibrary((s) => s.showToast);
  const cover = useAssetUrl("cover", game?.coverFile ?? null);

  const [elapsed, setElapsed] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fixTime, setFixTime] = useState(false);
  const [minutes, setMinutes] = useState("");

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

  useEffect(() => {
    setConfirmDelete(false);
    setFixTime(false);
  }, [game?.id]);

  if (!game) return null;

  const saveTime = async () => {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 0) {
      showToast("error", "请输入正确的分钟数");
      return;
    }
    try {
      const updated = await api.resetPlaytime(game.id, Math.round(value * 60));
      useLibrary.getState().applyGame(updated);
      setFixTime(false);
      showToast("success", "时长已修正");
    } catch (err) {
      showToast("error", String(err));
    }
  };

  const copyPath = () => {
    navigator.clipboard
      .writeText(game.exePath)
      .then(() => showToast("info", "已复制程序路径"))
      .catch(() => showToast("error", "复制失败"));
  };

  return (
    <div
      className="animate-drawer-in fixed inset-y-0 right-0 z-30 flex w-[420px] flex-col border-l shadow-2xl"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--surface) 90%, transparent)",
        backdropFilter: "blur(22px)",
      }}
    >
      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden">
        {cover ? (
          <img src={cover} alt={game.title} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <CoverFallback title={game.title} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
        <button
          className="absolute right-3 top-3 rounded-full p-1.5 text-white/85 transition-colors hover:bg-white/15"
          onClick={() => select(null)}
          aria-label="关闭详情"
        >
          <X size={16} />
        </button>
        <div className="absolute inset-x-4 bottom-3">
          <h2 className="m-0 truncate text-lg font-semibold text-white">{game.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="chip" style={{ background: "rgba(8,13,26,.6)", borderColor: "rgba(255,255,255,.14)", color: "#dbe7ff" }}>
              {game.category || "未分类"}
            </span>
            {game.tags.map((tag) => (
              <span key={tag} className="chip" style={{ background: "rgba(8,13,26,.6)", borderColor: "rgba(255,255,255,.14)", color: "#c6d5f5" }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary flex-1 !py-2.5"
            disabled={Boolean(running)}
            onClick={() => void launch(game.id)}
          >
            <Play size={15} fill="currentColor" />
            {running ? `运行中 ${formatTimer(elapsed)}` : "启动游戏"}
          </button>
          <button
            className="btn !px-3 !py-2.5"
            onClick={() => void toggleFavorite(game.id)}
            title={game.favorite ? "取消收藏" : "加入收藏"}
            style={{ color: game.favorite ? "#ffd166" : undefined }}
          >
            <Star size={15} fill={game.favorite ? "currentColor" : "none"} />
          </button>
          <button className="btn !px-3 !py-2.5" onClick={() => openEdit(game)} title="编辑">
            <Pencil size={15} />
          </button>
        </div>

        <section
          className="space-y-2.5 rounded-xl p-3.5 text-[12px]"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >
          <Row label="程序">
            <span className="block truncate" title={game.exePath}>
              {shortPath(game.exePath)}
            </span>
          </Row>
          <Row label="工作目录">
            <span className="block truncate" title={game.workDir}>
              {game.workDir ? shortPath(game.workDir) : "（与程序同目录）"}
            </span>
          </Row>
          {game.args && (
            <Row label="启动参数">
              <span className="block truncate" title={game.args}>
                {game.args}
              </span>
            </Row>
          )}
          {game.extraProcessNames.length > 0 && (
            <Row label="额外进程">
              <span>{game.extraProcessNames.join("、")}</span>
            </Row>
          )}
          <Row label="累计时长">
            <span className="font-medium" style={{ color: "var(--text)" }}>
              {formatPlaytime(game.playtimeSec)}
            </span>
          </Row>
          <Row label="最近游玩">
            <span>{formatRelative(game.lastPlayedAt)}</span>
          </Row>
          <Row label="添加时间">
            <span>{formatDate(game.addedAt)}</span>
          </Row>
        </section>

        {fixTime ? (
          <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
            <label className="label">修正累计时长（分钟）</label>
            <div className="flex items-center gap-2">
              <input
                className="input"
                type="number"
                min={0}
                value={minutes}
                placeholder={String(Math.floor(game.playtimeSec / 60))}
                onChange={(e) => setMinutes(e.target.value)}
                autoFocus
              />
              <button className="btn btn-primary" onClick={() => void saveTime()}>
                保存
              </button>
              <button className="btn" onClick={() => setFixTime(false)}>
                取消
              </button>
            </div>
            <p className="hint mt-2">填 0 表示清零。记录以本地数据为准。</p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
              onClick={() => {
                setMinutes(String(Math.floor(game.playtimeSec / 60)));
                setFixTime(true);
              }}
            >
              <Clock size={12} />
              修正时长
            </button>
            <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={copyPath}>
              <Copy size={12} />
              复制路径
            </button>
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
              onClick={() => showToast("info", `程序所在目录：${game.workDir || "见程序路径"}`)}
            >
              <FolderOpen size={12} />
              目录
            </button>
            <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={() => void useLibrary.getState().applyGame(game)} title="刷新">
              <RotateCcw size={12} />
            </button>
          </div>
        )}

        {game.note && (
          <div className="rounded-xl p-3 text-[12px] leading-5" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
            <p className="m-0 whitespace-pre-wrap" style={{ color: "var(--text)" }}>
              {game.note}
            </p>
          </div>
        )}

        <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
          {confirmDelete ? (
            <div className="space-y-2 rounded-xl p-3" style={{ background: "rgba(244,63,94,.08)", border: "1px solid rgba(244,63,94,.3)" }}>
              <p className="m-0 text-[12px]">确定从库中移除「{game.title}」吗？</p>
              <p className="m-0 text-[11px]" style={{ color: "var(--text-dim)" }}>
                只删除库里的记录，本地游戏文件不会被动。
              </p>
              <div className="flex gap-2">
                <button className="btn btn-danger flex-1" onClick={() => void deleteGame(game.id)}>
                  确认移除
                </button>
                <button className="btn flex-1" onClick={() => setConfirmDelete(false)}>
                  再想想
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-ghost w-full text-[12px]"
              style={{ color: "#fb7185" }}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={13} />
              从库中移除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
