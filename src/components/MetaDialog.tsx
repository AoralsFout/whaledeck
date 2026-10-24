/**
 * @file 联网补全对话框：选择数据源、搜索、应用元数据或手动选封面。
 *
 * 检索状态放在 createMetaSearch 的独立 store 中，关闭弹窗即让旧请求失效。
 * 对应文档：docs/系统架构.md §5.3、docs/前端实现.md §2.3。
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { CloudDownload, Crop, ImagePlus, Loader2, Search, X } from "lucide-react";
import { api } from "../lib/ipc";
import { useLibrary } from "../store/useLibrary";
import { createMetaSearch } from "../store/metaSearch";
import type { MetaItem, MetaSource } from "../types";
import { Modal } from "./Modal";

const SOURCES: { key: MetaSource; label: string; blurb: string }[] = [
  { key: "bangumi", label: "Bangumi", blurb: "番组计划 · 游戏条目" },
  { key: "vndb", label: "VNDB", blurb: "视觉小说数据库" },
  { key: "ymgal", label: "月幕", blurb: "Galgame 档案" },
];

/** 来源 key → 界面显示名；未知来源原样返回，避免空标签。 */
function sourceName(source: string): string {
  return SOURCES.find((s) => s.key === source)?.label ?? source;
}

/** 联网补全弹窗；无结果时保留手动选封面入口。 */
export function MetaDialog() {
  const close = useLibrary((s) => s.closeMeta);
  const game = useLibrary((s) => s.games.find((g) => g.id === s.selectedId) ?? null);
  const applyGame = useLibrary((s) => s.applyGame);
  const showToast = useLibrary((s) => s.showToast);
  const openCoverSettings = useLibrary((s) => s.openCoverSettings);

  const [searchStore] = useState(() => createMetaSearch(game?.title ?? "", {
    search: api.searchMeta,
    notify: showToast,
  }));
  const { source, keyword, items, loading, searched, setSource, setKeyword, runSearch } = useStore(searchStore);
  const [applying, setApplying] = useState<string | null>(null);
  useEffect(() => () => searchStore.getState().invalidate(), [searchStore]);

  const apply = async (item: MetaItem, adjustCover = false) => {
    if (!game) return;
    setApplying(item.id);
    try {
      const updated = await api.applyMeta(game.id, item);
      applyGame(updated);
      showToast("success", "已应用封面与信息");
      close();
      if (adjustCover && updated.coverFile) openCoverSettings();
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setApplying(null);
    }
  };

  const manualPick = async () => {
    if (!game) return;
    const src = await api.pickImage("cover");
    if (!src) return;
    try {
      const name = await api.importCover(game.id, src);
      applyGame({ ...game, coverFile: name });
      showToast("success", "封面已更新");
      close();
    } catch (err) {
      showToast("error", String(err));
    }
  };

  return (
    <Modal title="联网补全信息" onClose={close} width={700}>
      <div
        className="modal-header flex items-center justify-between border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="modal-title m-0 flex items-center gap-2 font-semibold">
          <CloudDownload size={16} />
          联网补全信息
        </h2>
        <button className="btn btn-ghost !p-1" onClick={close} aria-label="关闭">
          <X size={16} />
        </button>
      </div>

      <div className="modal-body meta-body">
        <div className="meta-source">
          <div className="flex gap-3">
            {SOURCES.map((s) => (
              <button
                key={s.key}
                aria-pressed={source === s.key}
                className="btn flex-1 !py-2"
                onClick={() => setSource(s.key)}
                title={s.blurb}
                style={
                  source === s.key
                    ? {
                        borderColor: "rgba(var(--primary-rgb), .6)",
                        color: "var(--primary-ink)",
                        background: "rgba(var(--primary-rgb), .1)",
                      }
                    : undefined
                }
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="hint m-0">{SOURCES.find((s) => s.key === source)?.blurb}</p>
        </div>

        <div className="flex gap-2">
          <input
            aria-label="游戏原名或中文名"
            className="input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            placeholder="游戏原名或中文名，例如 CLANNAD"
            autoFocus
          />
          <button className="btn btn-primary shrink-0" onClick={() => void runSearch()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            搜索
          </button>
        </div>

        <div className="meta-results">
          {loading && (
            <p className="m-0 py-8 text-center text-[14px]" style={{ color: "var(--text-dim)" }}>
              正在从 {sourceName(source)} 搜索…
            </p>
          )}
          {!loading && searched && items.length === 0 && (
            <div className="meta-empty py-6 text-center">
              <p className="m-0 text-[14px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
                没找到结果。可以换原名 / 中文名再试，或直接手动选一张封面。
              </p>
              <button className="btn" onClick={() => void manualPick()}>
                <ImagePlus size={14} />
                手动选择封面图片
              </button>
            </div>
          )}
          {!loading &&
            items.map((item) => {
              const key = `${item.source}-${item.id}`;
              return (
                <div
                  key={key}
                  className="flex gap-4 rounded-xl p-4"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                >
                  <div
                    className="h-[86px] w-[64px] shrink-0 overflow-hidden rounded-lg"
                    style={{ background: "var(--surface)" }}
                  >
                    {item.coverUrl ? (
                      <img
                        src={item.coverUrl}
                        alt={item.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 break-words text-[14px] font-medium">{item.title}</p>
                    {item.subtitle && (
                      <p className="m-0 mt-1 break-words text-[12px]" style={{ color: "var(--text-dim)" }}>
                        {item.subtitle}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "var(--text-dim)" }}>
                      <span className="chip">{sourceName(item.source)}</span>
                      {item.releaseDate && <span>{item.releaseDate}</span>}
                      {item.developer && <span className="truncate">{item.developer}</span>}
                      {item.rating != null && <span>评分 {item.rating}</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="btn btn-primary" onClick={() => void apply(item)} disabled={applying !== null}>
                        {applying === item.id ? "应用中…" : "应用封面和信息"}
                      </button>
                      {item.coverUrl && <button className="btn" disabled={applying !== null} onClick={() => void apply(item, true)}>
                        <Crop size={14} aria-hidden="true" />应用并调整封面
                      </button>}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <div
        className="modal-footer flex items-center justify-between border-t"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="hint">
          数据来自 Bangumi / VNDB / 月幕的公开接口，仅供个人整理使用
        </span>
        <div className="flex shrink-0 flex-wrap gap-2">
          {game?.coverFile && <button className="btn" disabled={applying !== null} onClick={openCoverSettings}><Crop size={14} aria-hidden="true" />调整当前封面</button>}
          <button className="btn" onClick={close}>关闭</button>
        </div>
      </div>
    </Modal>
  );
}
