import { useMemo, useState } from "react";
import { CheckSquare, FolderSearch, Loader2, Square, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import { api } from "../lib/ipc";
import { useLibrary } from "../store/useLibrary";
import { newGameDraft, type ScanEntry } from "../types";
import { Modal } from "./Modal";

export function ScanDialog() {
  const close = useLibrary((s) => s.closeScan);
  const games = useLibrary((s) => s.games);
  const showToast = useLibrary((s) => s.showToast);

  const [folder, setFolder] = useState("");
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  const existing = useMemo(
    () => new Set(games.map((g) => g.exePath.toLowerCase())),
    [games],
  );
  const fresh = entries.filter((e) => !existing.has(e.path.toLowerCase()));

  const runScan = async (dir: string) => {
    setScanning(true);
    try {
      const list = await api.scanFolder(dir);
      setEntries(list);
      setSelected(
        new Set(
          list
            .filter((e) => !existing.has(e.path.toLowerCase()))
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
    const chosen = entries.filter((e) => selected.has(e.path));
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      for (const entry of chosen) {
        const draft = newGameDraft();
        draft.id = crypto.randomUUID();
        draft.title = entry.name.replace(/\.exe$/i, "");
        draft.exePath = entry.path;
        draft.workDir = entry.path.replace(/[\\/][^\\/]+$/, "");
        await api.saveGame(draft);
      }
      await useLibrary.getState().init();
      showToast("success", `已加入 ${chosen.length} 个游戏`);
      close();
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="扫描文件夹" onClose={() => { if (!saving) close(); }} width={720}>
      <div
        className="flex items-center justify-between border-b px-5 py-3.5"
        style={{ borderColor: "var(--border)" }}
      >
        <h3 className="m-0 flex items-center gap-2 text-[15px] font-semibold">
          <FolderSearch size={16} />
          扫描文件夹
        </h3>
        <button className="btn btn-ghost !p-1" onClick={close} aria-label="关闭">
          <X size={16} />
        </button>
      </div>

      <div className="max-h-[64vh] space-y-3 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={() => void pickFolder()} disabled={scanning}>
            <FolderSearch size={14} />
            选择要扫描的文件夹
          </button>
          {folder && (
            <span className="truncate font-mono text-[11px]" title={folder} style={{ color: "var(--text-dim)" }}>
              {folder}
            </span>
          )}
        </div>

        {scanning && (
          <div className="flex items-center gap-2 py-6 text-[12px]" style={{ color: "var(--text-dim)" }}>
            <Loader2 size={14} className="animate-spin" />
            正在扫描（最多 6 层目录）…
          </div>
        )}

        {!scanning && entries.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[12px]" style={{ color: "var(--text-dim)" }}>
                找到 {entries.length} 个 exe，其中 {fresh.length} 个还没加入
              </span>
              <button className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={selectAll}>
                全选 / 反选
              </button>
            </div>

            <div
              className="max-h-[42vh] overflow-y-auto rounded-xl"
              style={{ border: "1px solid var(--border)" }}
            >
              {entries.map((entry) => {
                const added = existing.has(entry.path.toLowerCase());
                const checked = selected.has(entry.path);
                return (
                  <label
                    key={entry.path}
                    className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0"
                    style={{ borderColor: "var(--border)", opacity: added ? 0.45 : 1 }}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--primary)]"
                      checked={checked}
                      disabled={added}
                      onChange={() => toggle(entry.path)}
                    />
                    {checked ? (
                      <CheckSquare size={13} style={{ color: "var(--primary)" }} />
                    ) : (
                      <Square size={13} style={{ color: "var(--text-dim)" }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[12px]">{entry.name}</p>
                      <p className="m-0 truncate text-[10px]" title={entry.path} style={{ color: "var(--text-dim)" }}>
                        {entry.path}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--text-dim)" }}>
                      {added ? "已在库中" : formatBytes(entry.size)}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {!scanning && entries.length === 0 && (
          <p className="py-6 text-center text-[12px]" style={{ color: "var(--text-dim)" }}>
            选一个装了游戏或工具的文件夹，我会递归找出里面的 exe，勾选后批量加入。
          </p>
        )}
      </div>

      <div
        className="flex items-center justify-between border-t px-5 py-3.5"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>
          已选 {selected.size} 个
        </span>
        <div className="flex gap-2">
          <button className="btn" onClick={close} disabled={saving}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void addSelected()}
            disabled={saving || selected.size === 0}
          >
            {saving ? "加入中…" : `加入选中的 ${selected.size} 个`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
