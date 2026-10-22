import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  CloudDownload,
  Clock,
  Copy,
  FolderOpen,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  formatBytes,
  formatDate,
  formatPlaytime,
  formatRelative,
  formatTimer,
  shortPath,
} from "../lib/format";
import { useAssetUrl } from "../lib/useAssetUrl";
import { api } from "../lib/ipc";
import { useLibrary } from "../store/useLibrary";
import { isProcessTarget, type SaveBackup } from "../types";

function CoverFallback({ title }: { title: string }) {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background:
          "linear-gradient(135deg, rgba(var(--primary-rgb), .28), rgba(var(--accent-rgb), .18) 55%, rgba(var(--bg-rgb), .9))",
      }}
    >
      <span className="text-7xl font-bold" style={{ color: "rgba(var(--primary-rgb), .8)" }}>
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

const PANEL_BG = "color-mix(in srgb, var(--surface-2) 68%, transparent)";

export function GameDetail() {
  const game = useLibrary((s) => s.games.find((g) => g.id === s.selectedId) ?? null);
  const running = useLibrary((s) => s.sessions.find((x) => x.gameId === s.selectedId));
  const select = useLibrary((s) => s.select);
  const openEdit = useLibrary((s) => s.openEdit);
  const openMeta = useLibrary((s) => s.openMeta);
  const launch = useLibrary((s) => s.launchGame);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const applyGame = useLibrary((s) => s.applyGame);
  const deleteGame = useLibrary((s) => s.deleteGame);
  const showToast = useLibrary((s) => s.showToast);
  const cover = useAssetUrl("cover", game?.coverFile ?? null);

  const [elapsed, setElapsed] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fixTime, setFixTime] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [backups, setBackups] = useState<SaveBackup[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

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
    setRestoreTarget(null);
  }, [game?.id]);

  const refreshBackups = useCallback(async () => {
    if (!game) return;
    try {
      setBackups(await api.listSaveBackups(game.id));
    } catch {
      setBackups([]);
    }
  }, [game?.id]);

  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

  if (!game) return null;

  const processLike = isProcessTarget(game.exePath);

  const saveTime = async () => {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 0) {
      showToast("error", "请输入正确的分钟数");
      return;
    }
    try {
      const updated = await api.resetPlaytime(game.id, Math.round(value * 60));
      applyGame(updated);
      setFixTime(false);
      showToast("success", "时长已修正");
    } catch (err) {
      showToast("error", String(err));
    }
  };

  const copyPath = () => {
    navigator.clipboard
      .writeText(game.exePath)
      .then(() => showToast("info", "已复制路径"))
      .catch(() => showToast("error", "复制失败"));
  };

  const applyAutoCover = async () => {
    setCoverBusy(true);
    try {
      const outcome = await api.autoCover(game.id);
      applyGame({ ...game, coverFile: outcome.coverFile });
      showToast("success", `已使用本地封面：${outcome.detail}`);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setCoverBusy(false);
    }
  };

  const doBackup = async () => {
    setBackupBusy(true);
    try {
      const backup = await api.backupSaves(game.id);
      await refreshBackups();
      showToast("success", `存档已备份（${formatBytes(backup.size)}）`);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBackupBusy(false);
    }
  };

  const doRestore = async (file: string) => {
    setBackupBusy(true);
    try {
      const count = await api.restoreSaveBackup(game.id, file);
      showToast("success", `已还原 ${count} 个文件到存档目录`);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBackupBusy(false);
      setRestoreTarget(null);
    }
  };

  return (
    <div
      className="animate-drawer-in fixed inset-y-0 right-0 z-30 flex w-[480px] flex-col border-l shadow-2xl"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--surface) 70%, transparent)",
        backdropFilter: "blur(28px) saturate(1.15)",
        WebkitBackdropFilter: "blur(28px) saturate(1.15)",
      }}
    >
      {/* 大横幅封面 */}
      <div className="relative h-[300px] w-full shrink-0 overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt={game.title}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <CoverFallback title={game.title} />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/5" />
        <button
          className="absolute right-3 top-3 rounded-full bg-black/30 p-1.5 text-white/90 backdrop-blur-md transition-colors hover:bg-white/20"
          onClick={() => select(null)}
          aria-label="关闭详情"
        >
          <X size={16} />
        </button>
        <div className="absolute inset-x-5 bottom-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="chip"
              style={{
                background: "rgba(8,13,26,.55)",
                borderColor: "rgba(255,255,255,.16)",
                color: "#e3ecff",
                backdropFilter: "blur(8px)",
              }}
            >
              {game.category || "未分类"}
            </span>
            {game.tags.map((tag) => (
              <span
                key={tag}
                className="chip"
                style={{
                  background: "rgba(8,13,26,.5)",
                  borderColor: "rgba(255,255,255,.14)",
                  color: "#c9d8f7",
                  backdropFilter: "blur(8px)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 标题 */}
      <div className="shrink-0 px-5 pt-4">
        <h2 className="m-0 truncate text-lg font-semibold">{game.title}</h2>
      </div>

      {/* 操作条（毛玻璃） */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5"
        style={{
          borderColor: "var(--border)",
          background: "color-mix(in srgb, var(--surface) 55%, transparent)",
          backdropFilter: "blur(14px)",
        }}
      >
        <button
          className="btn btn-primary flex-1 !py-2.5"
          disabled={Boolean(running)}
          onClick={() => void launch(game.id)}
        >
          <Play size={15} fill="currentColor" />
          {running
            ? `运行中 ${formatTimer(elapsed)}`
            : processLike
              ? "启动"
              : "用默认程序打开"}
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
        <button
          className="btn !px-3 !py-2.5"
          onClick={openMeta}
          title="联网补全封面和信息"
        >
          <CloudDownload size={15} />
        </button>
        <button
          className="btn !px-3 !py-2.5"
          onClick={() => void applyAutoCover()}
          disabled={coverBusy}
          title="自动封面：在游戏目录里找 cover / header / poster 等图片"
        >
          <Sparkles size={15} />
        </button>
      </div>

      {/* 信息内容 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
        <section
          className="space-y-2.5 rounded-xl p-3.5 text-[12px]"
          style={{ background: PANEL_BG, border: "1px solid var(--border)" }}
        >
          <Row label="目标">
            <span className="block truncate" title={game.exePath}>
              {shortPath(game.exePath)}
            </span>
          </Row>
          {processLike && (
            <Row label="工作目录">
              <span className="block truncate" title={game.workDir}>
                {game.workDir ? shortPath(game.workDir) : "（与程序同目录）"}
              </span>
            </Row>
          )}
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
              {processLike ? formatPlaytime(game.playtimeSec) : "不统计"}
            </span>
          </Row>
          <Row label="最近打开">
            <span>{formatRelative(game.lastPlayedAt)}</span>
          </Row>
          {game.developer && (
            <Row label="开发商">
              <span>{game.developer}</span>
            </Row>
          )}
          {game.releaseDate && (
            <Row label="发售日期">
              <span>{game.releaseDate}</span>
            </Row>
          )}
          {game.source && (
            <Row label="信息来源">
              <span className="chip">
                {game.source}
                {game.sourceId ? ` · ${game.sourceId}` : ""}
              </span>
            </Row>
          )}
          <Row label="加入时间">
            <span>{formatDate(game.addedAt)}</span>
          </Row>
        </section>

        {processLike && (
          <>
            {fixTime ? (
              <div
                className="rounded-xl p-3"
                style={{ background: PANEL_BG, border: "1px solid var(--border)" }}
              >
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
              </div>
            )}
          </>
        )}

        <section
          className="rounded-xl p-3.5 text-[12px]"
          style={{ background: PANEL_BG, border: "1px solid var(--border)" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-medium">
              <Archive size={13} />
              存档备份
            </span>
            <button
              className="btn btn-ghost !px-2 !py-1 text-[11px]"
              onClick={() => void api.openBackupsDir(game.id)}
            >
              <FolderOpen size={12} />
              备份目录
            </button>
          </div>

          {game.savePaths.length === 0 ? (
            <p className="hint m-0">
              还没设置存档目录。点右上角「编辑」添加后，就能一键备份存档、坏了再还原。
            </p>
          ) : (
            <>
              <div className="mb-2 space-y-0.5">
                {game.savePaths.map((path) => (
                  <p key={path} className="m-0 truncate" title={path} style={{ color: "var(--text-dim)" }}>
                    {shortPath(path, 42)}
                  </p>
                ))}
              </div>
              <button
                className="btn btn-primary w-full !py-2"
                onClick={() => void doBackup()}
                disabled={backupBusy}
              >
                <Save size={14} />
                {backupBusy ? "处理中…" : "立即备份存档"}
              </button>

              {backups.length > 0 && (
                <div className="mt-2 space-y-1">
                  {backups.slice(0, 5).map((backup) => (
                    <div
                      key={backup.file}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                      style={{ background: "color-mix(in srgb, var(--surface) 70%, transparent)" }}
                    >
                      <span className="truncate">
                        {formatDate(backup.createdAt)}{" "}
                        {new Date(backup.createdAt).toTimeString().slice(0, 5)}
                      </span>
                      <span className="shrink-0 text-[10px]" style={{ color: "var(--text-dim)" }}>
                        {formatBytes(backup.size)}
                      </span>
                      {restoreTarget === backup.file ? (
                        <div className="flex shrink-0 gap-1">
                          <button
                            className="btn btn-danger !px-2 !py-0.5 text-[10px]"
                            onClick={() => void doRestore(backup.file)}
                            disabled={backupBusy}
                          >
                            确认还原
                          </button>
                          <button
                            className="btn !px-2 !py-0.5 text-[10px]"
                            onClick={() => setRestoreTarget(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn shrink-0 !px-2 !py-0.5 text-[10px]"
                          onClick={() => setRestoreTarget(backup.file)}
                          title="把备份覆盖回存档目录"
                        >
                          <RotateCcw size={10} />
                          还原
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {game.summary && (
          <div
            className="rounded-xl p-3 text-[12px] leading-5"
            style={{ background: PANEL_BG, border: "1px solid var(--border)" }}
          >
            <p className="m-0 mb-1 text-[11px] font-medium" style={{ color: "var(--text-dim)" }}>
              简介
            </p>
            <p className="m-0 line-clamp-6 whitespace-pre-wrap" style={{ color: "var(--text)" }}>
              {game.summary}
            </p>
          </div>
        )}

        {game.note && (
          <div
            className="rounded-xl p-3 text-[12px] leading-5"
            style={{ background: PANEL_BG, border: "1px solid var(--border)" }}
          >
            <p className="m-0 whitespace-pre-wrap" style={{ color: "var(--text)" }}>
              {game.note}
            </p>
          </div>
        )}

        <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
          {confirmDelete ? (
            <div
              className="space-y-2 rounded-xl p-3"
              style={{ background: "rgba(244,63,94,.1)", border: "1px solid rgba(244,63,94,.32)" }}
            >
              <p className="m-0 text-[12px]">确定从库中移除「{game.title}」吗？</p>
              <p className="m-0 text-[11px]" style={{ color: "var(--text-dim)" }}>
                只删除库里的记录，本地文件与存档都不会被动。
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
