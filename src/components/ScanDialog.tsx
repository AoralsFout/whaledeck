/**
 * @file 文件夹扫描对话框：选择目录、展示 exe 候选、批量加入与部分失败重试。
 *
 * 已在库中的路径置灰；加入期间保持扫描结果稳定，失败项保留勾选。
 * 对应文档：docs/前端实现.md「批量加入」、docs/界面与交互.md §5。
 */
import { useMemo, useState } from "react";
import { CheckSquare, FolderSearch, Loader2, Square, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import { api } from "../lib/ipc";
import { gamePathKey } from "../lib/library";
import { useLibrary } from "../store/useLibrary";
import type { ScanEntry } from "../types";
import { Modal } from "./Modal";

/** 扫描对话框；existing 用路径键判断是否已在库，fresh 才是可勾选候选。 */
export function ScanDialog() {
  const close = useLibrary((s) => s.closeScan);
  const games = useLibrary((s) => s.games);
  const showToast = useLibrary((s) => s.showToast);
  const addScannedGames = useLibrary((s) => s.addScannedGames);

  const [folder, setFolder] = useState("");
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  const existing = useMemo(
    () => new Set(games.map((g) => gamePathKey(g.exePath))),
    [games],
  );
  const fresh = entries.filter((e) => !existing.has(gamePathKey(e.path)));
  const selectedCount = fresh.filter((entry) => selected.has(entry.path)).length;

  // 扫描结果整体替换；已存在的路径不参与默认勾选。
  const runScan = async (dir: string) => {
    setScanning(true);
    try {
      const list = await api.scanFolder(dir);
      setEntries(list);
      setSelected(
        new Set(
          list
            .filter((e) => !existing.has(gamePathKey(e.path)))
            .map((e) => e.path),
        ),
      );
      if (list.length === 0) {
        showToast("info", "这个文件夹里没有找到 exe（已跳过系统目录）");
      }
    } catch (err) {
      showToast("error", String(err));
      setEntries([]);
    } finally {
      setScanning(false);
    }
  };

  const pickFolder = async () => {
    const dir = await api.pickFolder();
    if (!dir) return;
    setFolder(dir);
    await runScan(dir);
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    const all = fresh.map((e) => e.path);
    const everySelected = all.every((p) => selected.has(p));
    setSelected(everySelected ? new Set() : new Set(all));
  };

  const addSelected = async () => {
    if (saving || scanning) return;
    const chosen = fresh.filter((e) => selected.has(e.path));
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      const result = await addScannedGames(chosen);
      setSelected(new Set(result.remaining.map((entry) => entry.path)));
      if (!result.error) close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="扫描文件夹" onClose={() => { if (!saving) close(); }} width={720}>
      <div
        className="modal-header flex items-center justify-between border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="modal-title m-0 flex items-center gap-2 font-semibold">
          <FolderSearch size={16} />
          扫描文件夹
        </h2>
        <button className="btn btn-ghost !p-1" onClick={close} disabled={saving} aria-label="关闭">
          <X size={16} />
        </button>
      </div>

      <div className="modal-body scan-body">
        <div className="scan-folder flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" onClick={() => void pickFolder()} disabled={scanning || saving}>
            <FolderSearch size={14} />
            选择要扫描的文件夹
          </button>
          {folder && (
            <span className="min-w-0 break-words font-mono text-[12px] [overflow-wrap:anywhere]" title={folder} style={{ color: "var(--text-dim)" }}>
              {folder}
            </span>
          )}
        </div>

        {scanning && (
          <div className="flex items-center gap-3 py-6 text-[14px]" style={{ color: "var(--text-dim)" }}>
            <Loader2 size={14} className="animate-spin" />
            正在扫描（最多 6 层目录）…
          </div>
        )}

        {!scanning && entries.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px]" style={{ color: "var(--text-dim)" }}>
                找到 {entries.length} 个 exe，其中 {fresh.length} 个还没加入
              </span>
              <button className="btn btn-ghost" onClick={selectAll} disabled={saving}>
                全选 / 反选
              </button>
            </div>

            <div
              className="scan-results rounded-xl"
              style={{ border: "1px solid var(--border)" }}
            >
              {entries.map((entry) => {
                const added = existing.has(gamePathKey(entry.path));
                const checked = !added && selected.has(entry.path);
                return (
                  <label
                    key={entry.path}
                    className="flex cursor-pointer items-center gap-3 border-b p-4 last:border-b-0"
                    style={{ borderColor: "var(--border)", opacity: added ? 0.45 : 1 }}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--primary)]"
                      checked={checked}
                      disabled={added || saving}
                      onChange={() => toggle(entry.path)}
                    />
                    {checked ? (
                      <CheckSquare size={13} style={{ color: "var(--primary)" }} />
                    ) : (
                      <Square size={13} style={{ color: "var(--text-dim)" }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[14px]">{entry.name}</p>
                      <p className="m-0 mt-1 truncate text-[12px]" title={entry.path} style={{ color: "var(--text-dim)" }}>
                        {entry.path}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12px]" style={{ color: "var(--text-dim)" }}>
                      {added ? "已在库中" : formatBytes(entry.size)}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {!scanning && entries.length === 0 && (
          <p className="m-0 py-6 text-center text-[14px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
            选一个装了游戏或工具的文件夹，我会递归找出里面的 exe，勾选后批量加入。
          </p>
        )}
      </div>

      <div
        className="modal-footer flex items-center justify-between border-t"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-[13px]" style={{ color: "var(--text-dim)" }}>
          已选 {selectedCount} 个
        </span>
        <div className="flex flex-wrap gap-3">
          <button className="btn" onClick={close} disabled={saving}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void addSelected()}
            disabled={saving || scanning || selectedCount === 0}
          >
            {saving ? "加入中…" : `加入选中的 ${selectedCount} 个`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
