import { useState } from "react";
import { Archive, EyeOff, FolderOpen, ImagePlus, Star, X } from "lucide-react";
import { dirFromPath, titleFromPath } from "../lib/format";
import { api } from "../lib/ipc";
import { collectCategories } from "../lib/library";
import { useAssetUrl } from "../lib/useAssetUrl";
import { useLibrary } from "../store/useLibrary";
import { isProcessTarget, newGameDraft, type Game } from "../types";
import { Modal } from "./Modal";

export function GameForm() {
  const editing = useLibrary((s) => s.editing);
  const games = useLibrary((s) => s.games);
  const settings = useLibrary((s) => s.settings);
  const closeForm = useLibrary((s) => s.closeForm);
  const showToast = useLibrary((s) => s.showToast);

  const isNew = !editing || !games.some((g) => g.id === editing.id);

  const [draft, setDraft] = useState<Game>(() => {
    const base = editing ?? newGameDraft();
    return { ...base, id: base.id || crypto.randomUUID() };
  });
  const [tagsText, setTagsText] = useState((editing?.tags ?? []).join(", "));
  const [extraText, setExtraText] = useState(
    (editing?.extraProcessNames ?? []).join(", "),
  );
  const [saving, setSaving] = useState(false);
  const coverUrl = useAssetUrl("cover", draft.coverFile);

  const patch = (part: Partial<Game>) => setDraft((d) => ({ ...d, ...part }));
  const suggestions = collectCategories(games, settings?.categories ?? []);

  const applyFileTarget = (path: string) => {
    setDraft((d) => ({
      ...d,
      exePath: path,
      title: d.title.trim() ? d.title : titleFromPath(path),
      workDir: d.workDir.trim() ? d.workDir : dirFromPath(path),
    }));
  };

  const applyFolderTarget = (dir: string) => {
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
    setDraft((d) => ({
      ...d,
      exePath: dir,
      title: d.title.trim() ? d.title : name,
    }));
  };

  const pickTarget = async () => {
    const path = await api.pickEntry();
    if (path) applyFileTarget(path);
  };

  const pickTargetFolder = async () => {
    const dir = await api.pickFolder();
    if (dir) applyFolderTarget(dir);
  };

  const pickWorkDir = async () => {
    const dir = await api.pickFolder();
    if (dir) patch({ workDir: dir });
  };

  const pickCover = async () => {
    const src = await api.pickImage("cover");
    if (!src) return;
    try {
      const name = await api.importCover(draft.id, src);
      patch({ coverFile: name });
    } catch (err) {
      showToast("error", String(err));
    }
  };

  const addSavePath = async () => {
    const dir = await api.pickFolder();
    if (!dir) return;
    setDraft((d) => ({ ...d, savePaths: [...d.savePaths, dir] }));
  };

  const removeSavePath = (index: number) => {
    setDraft((d) => ({
      ...d,
      savePaths: d.savePaths.filter((_, i) => i !== index),
    }));
  };

  const splitList = (text: string) =>
    text
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const save = async () => {
    const title = draft.title.trim();
    const exePath = draft.exePath.trim();
    if (!title) {
      showToast("error", "请填写名称");
      return;
    }
    if (!exePath) {
      showToast("error", "请选择要加入的程序、文件或文件夹");
      return;
    }
    const game: Game = {
      ...draft,
      title,
      exePath,
      workDir: draft.workDir.trim(),
      category: draft.category.trim(),
      tags: splitList(tagsText),
      extraProcessNames: splitList(extraText),
      savePaths: draft.savePaths.map((p) => p.trim()).filter(Boolean),
    };

    setSaving(true);
    try {
      await api.saveGame(game);
      const state = useLibrary.getState();
      state.closeForm();
      state.showToast("success", isNew ? "已加入" : "修改已保存");
      await state.init();
      useLibrary.getState().select(game.id);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setSaving(false);
    }
  };

  const processLike = isProcessTarget(draft.exePath);

  return (
    <Modal onClose={closeForm} width={680}>
      <div
        className="flex items-center justify-between border-b px-5 py-3.5"
        style={{ borderColor: "var(--border)" }}
      >
        <h3 className="m-0 text-[15px] font-semibold">
          {isNew ? "加入新项目" : "编辑项目"}
        </h3>
        <button className="btn btn-ghost !p-1" onClick={closeForm} aria-label="关闭">
          <X size={16} />
        </button>
      </div>

      <div className="max-h-[68vh] space-y-4 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="h-20 w-32 shrink-0 overflow-hidden rounded-xl border"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
          >
            {coverUrl ? (
              <img src={coverUrl} alt="封面预览" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ImagePlus size={20} style={{ color: "var(--text-dim)" }} />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <button className="btn" onClick={() => void pickCover()}>
                <ImagePlus size={14} />
                选择封面
              </button>
              {draft.coverFile && (
                <button className="btn btn-ghost" onClick={() => patch({ coverFile: null })}>
                  移除
                </button>
              )}
            </div>
            <p className="hint m-0">封面会复制进数据目录，原图移动了也不影响。</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">名称 *</label>
            <input
              className="input"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="例如：星露谷物语 / 我的项目文件夹"
              autoFocus
            />
          </div>

          <div className="col-span-2">
            <label className="label">程序 / 文件 / 文件夹 *（任何类型都可以）</label>
            <div className="flex gap-2">
              <input
                className="input font-mono !text-[11px]"
                value={draft.exePath}
                onChange={(e) => patch({ exePath: e.target.value })}
                placeholder="C:\Games\xxx\xxx.exe 或 C:\Docs\笔记.pdf 或某个文件夹"
                spellCheck={false}
              />
              <button className="btn shrink-0" onClick={() => void pickTarget()}>
                <FolderOpen size={14} />
                选择文件
              </button>
              <button className="btn shrink-0" onClick={() => void pickTargetFolder()}>
                文件夹
              </button>
            </div>
            <p className="hint mt-1">
              {!draft.exePath
                ? "exe / bat / cmd 会以进程启动并统计时长；快捷方式、文档、图片、文件夹用系统默认方式打开，只记录最近打开。"
                : processLike
                  ? "将以进程方式启动，自动统计游玩时长。"
                  : "将用系统默认程序打开，不统计时长。"}
            </p>
          </div>

          <div className="col-span-2">
            <label className="label">工作目录（仅进程启动时生效）</label>
            <div className="flex gap-2">
              <input
                className="input font-mono !text-[11px]"
                value={draft.workDir}
                onChange={(e) => patch({ workDir: e.target.value })}
                placeholder="留空则使用程序所在目录"
                spellCheck={false}
              />
              <button className="btn shrink-0" onClick={() => void pickWorkDir()}>
                <FolderOpen size={14} />
                选择
              </button>
            </div>
          </div>

          <div>
            <label className="label">分类</label>
            <input
              className="input"
              list="category-suggestions"
              value={draft.category}
              onChange={(e) => patch({ category: e.target.value })}
              placeholder="游戏 / 工具 / 独立…"
            />
            <datalist id="category-suggestions">
              {suggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="label">标签（逗号分隔）</label>
            <input
              className="input"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="像素, 种田, 联机"
            />
          </div>

          <div className="col-span-2">
            <label className="label">启动参数</label>
            <input
              className="input font-mono !text-[11px]"
              value={draft.args}
              onChange={(e) => patch({ args: e.target.value })}
              placeholder="可选，例如 -windowed -dx11"
              spellCheck={false}
            />
          </div>

          <div className="col-span-2">
            <label className="label">额外进程名（可选，逗号分隔）</label>
            <input
              className="input"
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              placeholder="游戏由启动器拉起时填写，例如 GameLauncher.exe"
            />
            <p className="hint mt-1">
              用于应对「点了启动器才出现游戏本体」的情况：任一同名进程存在就算仍在运行。
            </p>
          </div>

          <div className="col-span-2">
            <label className="label">
              <span className="flex items-center gap-1.5">
                <Archive size={12} />
                存档目录（可多个，用于备份）
              </span>
            </label>
            <div className="space-y-1.5">
              {draft.savePaths.map((path, index) => (
                <div className="flex gap-2" key={`${index}-${path}`}>
                  <input
                    className="input font-mono !text-[11px]"
                    value={path}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        savePaths: d.savePaths.map((p, i) =>
                          i === index ? e.target.value : p,
                        ),
                      }))
                    }
                    placeholder="C:\Users\...\AppData\Roaming\Game\Saves"
                    spellCheck={false}
                  />
                  <button
                    className="btn shrink-0"
                    onClick={() => removeSavePath(index)}
                  >
                    移除
                  </button>
                </div>
              ))}
              <button className="btn" onClick={() => void addSavePath()}>
                <FolderOpen size={14} />
                添加存档目录
              </button>
            </div>
            <p className="hint mt-1">
              加入后可在详情页一键打包备份，存档坏了能还原回来。
            </p>
          </div>

          <div className="col-span-2">
            <label className="label">备注</label>
            <textarea
              className="input min-h-[64px] resize-y"
              value={draft.note}
              onChange={(e) => patch({ note: e.target.value })}
              placeholder="存档位置、Mod 说明、通关进度…"
            />
          </div>

          <div className="col-span-2 flex items-center gap-5 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={draft.favorite}
                onChange={(e) => patch({ favorite: e.target.checked })}
              />
              <Star size={13} style={{ color: draft.favorite ? "#ffd166" : "var(--text-dim)" }} />
              加入收藏
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={draft.hidden}
                onChange={(e) => patch({ hidden: e.target.checked })}
              />
              <EyeOff size={13} style={{ color: "var(--text-dim)" }} />
              隐藏（在侧边栏「已隐藏」里查看）
            </label>
          </div>
        </div>
      </div>

      <div
        className="flex justify-end gap-2 border-t px-5 py-3.5"
        style={{ borderColor: "var(--border)" }}
      >
        <button className="btn" onClick={closeForm} disabled={saving}>
          取消
        </button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? "保存中…" : isNew ? "加入" : "保存"}
        </button>
      </div>
    </Modal>
  );
}
