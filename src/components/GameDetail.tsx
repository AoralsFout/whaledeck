/**
 * @file 游戏详情：封面背景、可展开信息、固定操作栏与统计栏。
 *
 * 由 App 以游戏 id 作为 key 挂载，切换游戏即重置本地计时/备份/确认状态。
 * 对应文档：docs/界面与交互.md §2.2、docs/前端实现.md §3.1。
 */
import { memo, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  Archive,
  CloudDownload,
  Clock,
  ChevronDown,
  Copy,
  FolderOpen,
  ImageUp,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Wand2,
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
import { coverFraming, coverFramingStyle } from "../lib/coverFraming";
import {
  api,
  onSuperResCancelled,
  onSuperResDone,
  onSuperResFailed,
  onSuperResProgress,
  type SuperResPreset,
} from "../lib/ipc";
import { useLibrary } from "../store/useLibrary";
import { createCoverSuperres, presetLabel } from "../store/coverSuperres";
import { createSaveBackups } from "../store/saveBackups";
import { isProcessTarget, type Game } from "../types";
import { ActionTooltips } from "./ActionTooltips";
import { GameIcon } from "./GameIcon";

const PANEL_BG = "rgba(10, 16, 30, 0.38)";
const PANEL_STYLE = {
  background: PANEL_BG,
  border: "1px solid rgba(255,255,255,.09)",
  backdropFilter: "blur(16px)",
} as const;
const CONTENT_FADE = "linear-gradient(to bottom, #000 calc(100% - 40px), transparent 100%)";

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0" style={{ color: "rgba(180, 200, 230, .8)" }}>{icon}</span>
      <div className="min-w-0 leading-tight">
        <p className="m-0 text-[11px]" style={{ color: "#a8b8d2" }}>
          {label}
        </p>
        <p className="m-0 mt-0.5 text-[13px] break-words text-white">{value}</p>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0" style={{ color: "rgba(160, 180, 210, .9)" }}>
        {label}
      </span>
      <div className="min-w-0 text-right text-white">{children}</div>
    </div>
  );
}

/**
 * 详情主视图。
 *
 * 运行计时只做展示，真正结算在 Rust 监控线程；备份状态由独立 store 管理。
 */
export const GameDetail = memo(function GameDetail({ game }: { game: Game }) {
  const running = useLibrary((s) => s.sessions.find((x) => x.gameId === game.id));
  const openEdit = useLibrary((s) => s.openEdit);
  const openMeta = useLibrary((s) => s.openMeta);
  const launch = useLibrary((s) => s.launchGame);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const applyGame = useLibrary((s) => s.applyGame);
  const deleteGame = useLibrary((s) => s.deleteGame);
  const showToast = useLibrary((s) => s.showToast);
  const cover = useAssetUrl("cover", game?.coverFile ?? null);
  const enhanceStore = useMemo(() => createCoverSuperres(game.id, {
    status: api.superresStatus, task: api.superresTask, generate: api.superresGenerate,
    cancel: api.superresCancel, remove: api.superresRemove,
    progress: onSuperResProgress, done: onSuperResDone,
    failed: onSuperResFailed, cancelled: onSuperResCancelled, notify: showToast,
  }), [game.id, game.coverFile, showToast]);
  useEffect(() => enhanceStore.getState().connect(), [enhanceStore]);
  const enhancement = useStore(enhanceStore);
  const enhancedFile = enhancement.files[enhancement.preset];
  const enhanceTask = enhancement.task;
  const showEnhanced = enhancement.showEnhanced;
  const enhancedCover = useAssetUrl("superres", enhancedFile);
  // 增强图未解码完成前继续显示原图，避免切档闪空。
  const displayCover = showEnhanced && enhancedCover ? enhancedCover : cover;
  const enhanceBusy = !enhancement.ready || enhancement.pending || Boolean(enhanceTask);
  const setSuperresProgress = useLibrary((s) => s.setSuperresProgress);
  const progressText = enhanceTask
    ? `${presetLabel(enhanceTask.preset)}档 · ${enhancement.cancelling ? "正在取消" : enhanceTask.stage === "saving" ? "正在保存" : enhanceTask.stage === "resizing" ? "正在调整尺寸" : "正在增强"} ${(enhanceTask.elapsedMs / 1000).toFixed(1)} 秒`
    : null;
  // 只同步展示文案；终态清空任务时隐藏提示，切换详情时避免残留上一张封面的进度。
  useEffect(() => {
    setSuperresProgress(progressText);
    return () => setSuperresProgress(null);
  }, [progressText, setSuperresProgress]);

  const [elapsed, setElapsed] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fixTime, setFixTime] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [backupStore] = useState(() => createSaveBackups(game.id, {
    list: api.listSaveBackups,
    backup: api.backupSaves,
    restore: api.restoreSaveBackup,
    openDirectory: api.openBackupsDir,
    notify: showToast,
  }));
  const { backups, busy: backupBusy, restoreTarget, selectRestore, backup: doBackup, restore: doRestore, openDirectory } = useStore(backupStore);
  useEffect(() => backupStore.getState().connect(), [backupStore]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);

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

  return (
    <div className="game-detail relative flex h-full flex-col overflow-hidden">
      {/* 全幅背景（只用封面，不用图标） */}
      <div className="absolute inset-0">
        {displayCover ? (
          <img src={displayCover} alt="" className="game-cover-art h-full w-full object-cover" style={coverFramingStyle(coverFraming(game))} draggable={false} />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background:
                "linear-gradient(135deg, rgba(var(--primary-rgb), .22), rgba(var(--accent-rgb), .14) 50%, var(--hero-bg))",
            }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(5,9,18,.06) 0%, rgba(5,9,18,.2) 36%, rgba(5,9,18,.58) 64%, rgba(8,13,26,.88) 84%, var(--hero-bg) 100%)",
          }}
        />
      </div>

      {/* 内容 */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto"
        style={{
          scrollbarGutter: "stable",
          scrollPaddingBottom: "3rem",
          maskImage: CONTENT_FADE,
          WebkitMaskImage: CONTENT_FADE,
        }}
      >
        {/* 底部留出渐隐高度，滚动到底后仍能完整阅读和操作最后一项。 */}
        <div className="detail-content flex min-h-full flex-col justify-end pb-12 pt-20">
          {/* 标题 + 图标 */}
          <div className="flex items-center gap-3">
            <GameIcon
              file={game.iconFile}
              size={44}
              className="h-11 w-11 shrink-0 rounded-xl object-contain p-1"
              style={{
                background: "rgba(8,13,26,.45)",
                border: "1px solid rgba(255,255,255,.14)",
                backdropFilter: "blur(8px)",
              }}
            />
            <div className="min-w-0">
              <h1
                className="game-title m-0 text-3xl font-semibold text-white"
                title={game.title}
                style={{ textShadow: "0 2px 24px rgba(0,0,0,.65)" }}
              >
                {game.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className="chip"
                  style={{
                    background: "rgba(8,13,26,.55)",
                    borderColor: "rgba(255,255,255,.16)",
                    color: "#e3ecff",
                  }}
                >
                  {game.category || "未分类"}
                </span>
                {game.tags.map((tag) => (
                  <span
                    key={tag}
                    className="chip"
                    style={{
                      background: "rgba(8,13,26,.45)",
                      borderColor: "rgba(255,255,255,.12)",
                      color: "#c9d8f7",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 保留悬停预览，也允许键盘和触屏固定展开。 */}
          <div className="detail-disclosure mt-4" data-expanded={detailsOpen}>
            <button
              className="btn detail-toggle"
              aria-expanded={detailsOpen}
              aria-controls="game-details"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              {detailsOpen ? "收起详情" : "游戏详情"}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div id="game-details" className="detail-panels mt-3">
              <div className="detail-grid grid grid-cols-1 gap-4">
                {game.summary && (
                  <section className="rounded-xl p-4 text-[12px] leading-5" style={PANEL_STYLE}>
                    <p className="m-0 mb-1.5 text-[11px] font-medium" style={{ color: "rgba(160,180,210,.9)" }}>
                      简介
                    </p>
                    <p className="m-0 line-clamp-6 whitespace-pre-wrap text-white/90">{game.summary}</p>
                  </section>
                )}

                <section className="space-y-2.5 rounded-xl p-4 text-[12px]" style={PANEL_STYLE}>
                  <Row label="目标">{shortPath(game.exePath)}</Row>
                  {processLike && (
                    <Row label="工作目录">{game.workDir ? shortPath(game.workDir) : "（与程序同目录）"}</Row>
                  )}
                  {game.developer && <Row label="开发商">{game.developer}</Row>}
                  {game.releaseDate && <Row label="发售日期">{game.releaseDate}</Row>}
                  <Row label="加入时间">{formatDate(game.addedAt)}</Row>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      className="btn btn-ghost !px-2 !py-1 text-[11px] text-white/70 hover:!text-white"
                      onClick={() => {
                        setMinutes(String(Math.floor(game.playtimeSec / 60)));
                        setFixTime(true);
                      }}
                    >
                      <Clock size={12} />
                      修正时长
                    </button>
                    <button
                      className="btn btn-ghost !px-2 !py-1 text-[11px] text-white/70 hover:!text-white"
                      onClick={copyPath}
                    >
                      <Copy size={12} />
                      复制路径
                    </button>
                  </div>
                </section>

                <section className="rounded-xl p-4 text-[12px] xl:col-span-2" style={PANEL_STYLE}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium text-white/90">
                      <Archive size={13} />
                      存档备份
                    </span>
                    <button
                      className="btn btn-ghost !px-2 !py-1 text-[11px] text-white/70 hover:!text-white"
                      onClick={() => void openDirectory()}
                    >
                      <FolderOpen size={12} />
                      备份目录
                    </button>
                  </div>

                  {game.savePaths.length === 0 ? (
                    <p className="m-0 text-white/75 leading-relaxed">还没设置存档目录。点「编辑」添加后，就能一键备份存档、坏了再还原。</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="btn btn-primary !px-4 !py-1.5 text-[11px]" onClick={() => void doBackup()} disabled={backupBusy}>
                        <Save size={13} />
                        {backupBusy ? "处理中…" : "立即备份存档"}
                      </button>
                      {backups.slice(0, 5).map((backup) => (
                        <div
                          key={backup.file}
                          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-white/85"
                          style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)" }}
                        >
                          <span>
                            {formatDate(backup.createdAt)}{" "}
                            {new Date(backup.createdAt).toTimeString().slice(0, 5)}
                          </span>
                          <span className="text-white/45">{formatBytes(backup.size)}</span>
                          {restoreTarget === backup.file ? (
                            <span className="flex gap-1">
                              <button
                                className="btn btn-danger !px-2 !py-0.5 text-[10px]"
                                onClick={() => void doRestore()}
                                disabled={backupBusy}
                              >
                                确认还原
                              </button>
                              <button className="btn !px-2 !py-0.5 text-[10px]" onClick={() => selectRestore(null)}>
                                取消
                              </button>
                            </span>
                          ) : (
                            <button className="btn !px-2 !py-0.5 text-[10px]" onClick={() => selectRestore(backup.file)}>
                              <RotateCcw size={10} />
                              还原
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {game.note && (
                  <section className="rounded-xl p-4 text-[12px] leading-5 xl:col-span-2" style={PANEL_STYLE}>
                    <p className="m-0 mb-1.5 text-[11px] font-medium" style={{ color: "rgba(160,180,210,.9)" }}>
                      备注
                    </p>
                    <p className="m-0 whitespace-pre-wrap text-white/90">{game.note}</p>
                  </section>
                )}
              </div>

              {fixTime && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl p-3" style={{ background: PANEL_BG, border: "1px solid rgba(255,255,255,.1)" }}>
                  <input
                    aria-label="累计游玩分钟数"
                    className="input max-w-[180px]"
                    type="number"
                    min={0}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    autoFocus
                  />
                  <button className="btn btn-primary" onClick={() => void saveTime()}>
                    保存时长（分钟）
                  </button>
                  <button className="btn" onClick={() => setFixTime(false)}>
                    取消
                  </button>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                {confirmDelete ? (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2"
                    style={{ background: "rgba(244,63,94,.14)", border: "1px solid rgba(244,63,94,.4)" }}
                  >
                    <span className="text-[11px] text-white/85">确认从库中移除？本地文件不会动。</span>
                    <button className="btn btn-danger !px-3 !py-1 text-[11px]" onClick={() => void deleteGame(game.id)}>
                      确认
                    </button>
                    <button className="btn !px-3 !py-1 text-[11px]" onClick={() => setConfirmDelete(false)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-ghost !px-2 !py-1 text-[11px]"
                    style={{ color: "rgba(251,113,133,.85)" }}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={12} />
                    从库中移除
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 独立底栏：详情单独滚动，操作与统计始终固定在展示面板底部。 */}
      <footer
        className="detail-footer relative z-10 shrink-0"
        aria-label="游戏操作与信息"
        // 与滚动区预留相同的滚动条宽度，保持内容左右边界一致。
        style={{ scrollbarGutter: "stable" }}
      >
        {/* 游戏操作 */}
        <ActionTooltips className="detail-actions flex flex-wrap items-center gap-2 py-4">
          <button
            className="btn btn-primary !px-7 !py-2.5 text-[13px]"
            data-tooltip={running ? "游戏运行中，退出后自动记录时长" : processLike ? "启动游戏并自动记录游玩时长" : "使用系统默认程序打开文件或文件夹"}
            disabled={Boolean(running) || launchBusy}
            onClick={async () => {
              setLaunchBusy(true);
              try { await launch(game.id); } finally { setLaunchBusy(false); }
            }}
          >
            <Play size={16} fill="currentColor" />
            {running
              ? `运行中 ${formatTimer(elapsed)}`
              : launchBusy ? "正在打开…" : processLike
                ? "开始游戏"
                : "用默认程序打开"}
          </button>
          <select
            className="btn !px-2 text-[12px]"
            aria-label="封面增强档位"
            value={enhancement.preset}
            disabled={enhanceBusy || !game.coverFile}
            onChange={(e) => enhancement.select(e.target.value as SuperResPreset)}
            title={enhancement.preset === "quality"
              ? "质量档：细节优先，通常约 8–15 秒，实际依设备与图片而变；选择后点击魔棒生成"
              : "效率档：通常约 3–6 秒；选择后点击魔棒生成"}
          >
            <option value="efficient">效率</option>
            <option value="quality">质量</option>
          </select>
          {enhanceTask ? (
            <button
              className="btn btn-icon-glass"
              onClick={() => void enhancement.cancel()}
              disabled={enhancement.pending || enhancement.cancelling}
              data-tooltip="取消并终止超分进程"
              aria-label="取消增强"
            >
              <X size={15} />
            </button>
          ) : enhancedFile ? (
            <>
              <button
                className="btn btn-icon-glass"
                onClick={enhancement.toggle}
                data-tooltip={showEnhanced ? "当前显示增强图，点击看原图" : "当前显示原图，点击看增强图"}
                aria-label="切换原图与增强图"
                aria-pressed={showEnhanced}
                style={{ color: showEnhanced ? "#8ad4ff" : undefined }}
              >
                <ImageUp size={15} />
              </button>
              <button
                className="btn btn-icon-glass"
                onClick={() => void enhancement.remove()}
                disabled={enhanceBusy}
                data-tooltip="删除此游戏所有档位的增强图，恢复原封面"
                aria-label="删除增强图"
              >
                <Trash2 size={15} />
              </button>
            </>
          ) : (
            <button
              className="btn btn-icon-glass"
              onClick={() => void enhancement.start()}
              disabled={enhanceBusy || !game.coverFile}
              data-tooltip={!game.coverFile ? "请先设置封面" : enhancement.preset === "quality" ? "质量档：细节优先，通常约 8–15 秒，实际依设备与图片而变；本机处理" : "效率档：本机增强封面，通常约 3–6 秒"}
              aria-label="增强封面"
            >
              <Wand2 size={15} />
            </button>
          )}
          <button
            className="btn btn-icon-glass"
            onClick={() => void toggleFavorite(game.id)}
            data-tooltip={game.favorite ? "取消收藏" : "加入收藏，在最近游玩列表中置顶"}
            aria-label={game.favorite ? "取消收藏" : "加入收藏"}
            aria-pressed={game.favorite}
            style={{ color: game.favorite ? "#ffd166" : undefined }}
          >
            <Star size={15} fill={game.favorite ? "currentColor" : "none"} />
          </button>
          <button className="btn btn-icon-glass" onClick={() => openEdit(game)} data-tooltip="编辑名称、分类、封面与启动参数" aria-label="编辑项目">
            <Pencil size={15} />
          </button>
          <button className="btn btn-icon-glass" onClick={openMeta} data-tooltip="联网搜索封面、简介和开发商信息" aria-label="联网补全封面和信息">
            <CloudDownload size={15} />
          </button>
          <button
            className="btn btn-icon-glass"
            onClick={() => openEdit(game, true)}
            data-tooltip="预览程序信息、图标和本地封面，确认后保存"
            aria-label="自动补全"
          >
            <Sparkles size={15} />
          </button>
        </ActionTooltips>

        {/* 游戏信息 */}
        <div className="detail-stats flex flex-wrap items-center gap-x-8 gap-y-3 py-3">
          <Stat icon={<Clock size={14} />} label="最近游玩" value={formatRelative(game.lastPlayedAt)} />
          <Stat
            icon={<Play size={14} />}
            label="累计时长"
            value={processLike ? formatPlaytime(game.playtimeSec) : "不统计"}
          />
          <Stat icon={<Tag size={14} />} label="分类" value={game.category || "未分类"} />
          <Stat icon={<Archive size={14} />} label="存档目录" value={`${game.savePaths.length} 个`} />
          {game.source && <Stat icon={<CloudDownload size={14} />} label="来源" value={game.source} />}
        </div>
      </footer>
    </div>
  );
});
