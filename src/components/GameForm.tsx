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
  const [errors, setErrors] = useState<{ title?: string; path?: string }>({});
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
    const nextErrors = {
      title: title ? undefined : "请填写名称",
      path: exePath ? undefined : "请选择要加入的程序、文件或文件夹",
    };
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.path) {
      document.getElementById(nextErrors.title ? "game-title" : "game-path")?.focus();
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
      await useLibrary.getState().saveGame(game);
    } finally {
      setSaving(false);
    }
  };

  const processLike = isProcessTarget(draft.exePath);

  return (
    <Modal title={isNew ? "加入新项目" : "编辑项目"} onClose={() => { if (!saving) closeForm(); }} width={680}>
      <div
        className="modal-header flex items-center justify-between border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="modal-title m-0 font-semibold">
          {isNew ? "加入新项目" : "编辑项目"}
        </h2>
        <button className="btn btn-ghost !p-1" onClick={closeForm} disabled={saving} aria-label="关闭">
          <X size={16} />
        </button>
      </div>

      <div className="modal-body form-body">
        <div className="form-cover flex flex-wrap items-center gap-4">
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
          <div className="form-cover-info">
            <div className="flex flex-wrap gap-2">
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

        <div className="form-fields grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label" htmlFor="game-title">名称 *</label>
            <input
              id="game-title"
              required
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? "game-title-error" : undefined}
              className="input"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="例如：星露谷物语 / 我的项目文件夹"
              autoFocus
            />
            {errors.title && <p id="game-title-error" className="field-error" role="alert">{errors.title}</p>}
          </div>

          <div className="col-span-2">
            <label className="label" htmlFor="game-path">程序 / 文件 / 文件夹 *（任何类型都可以）</label>
            <div className="form-path flex gap-2">
              <input
                id="game-path"
                required
                aria-invalid={Boolean(errors.path)}
                aria-describedby={errors.path ? "game-path-error" : "game-path-hint"}
                className="input font-mono"
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
            {errors.path && <p id="game-path-error" className="field-error" role="alert">{errors.path}</p>}
            <p id="game-path-hint" className="hint mt-1">
              {!draft.exePath
                ? "exe / bat / cmd 会以进程启动并统计时长；快捷方式、文档、图片、文件夹用系统默认方式打开，只记录最近打开。"
                : processLike
                  ? "将以进程方式启动，自动统计游玩时长。"
                  : "将用系统默认程序打开，不统计时长。"}
            </p>
          </div>

          <div className="col-span-2">
            <label className="label" htmlFor="game-workdir">工作目录（仅进程启动时生效）</label>
            <div className="flex gap-2">
              <input
                id="game-workdir"
                className="input font-mono"
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
            <label className="label" htmlFor="game-category">分类</label>
            <input
              id="game-category"
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
            <label className="label" htmlFor="game-tags">标签（逗号分隔）</label>
            <input
              id="game-tags"
              className="input"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="像素, 种田, 联机"
            />
          </div>

          <div className="col-span-2">
            <label className="label" htmlFor="game-args">启动参数</label>
            <input
              id="game-args"
              className="input font-mono"
              value={draft.args}
              onChange={(e) => patch({ args: e.target.value })}
              placeholder="可选，例如 -windowed -dx11"
              spellCheck={false}
            />
          </div>

          <div className="col-span-2">
            <label className="label" htmlFor="game-processes">额外进程名（可选，逗号分隔）</label>
            <input
              id="game-processes"
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
            <div className="form-save-paths">
              {draft.savePaths.map((path, index) => (
                <div className="flex gap-2" key={index}>
                  <input
                    aria-label={`存档目录 ${index + 1}`}
                    className="input font-mono"
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
            <label className="label" htmlFor="game-note">备注</label>
            <textarea
              id="game-note"
              className="input min-h-[64px] resize-y"
              value={draft.note}
              onChange={(e) => patch({ note: e.target.value })}
              placeholder="存档位置、Mod 说明、通关进度…"
            />
          </div>

          <div className="form-flags col-span-2 flex flex-wrap items-center gap-4 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={draft.favorite}
                onChange={(e) => patch({ favorite: e.target.checked })}
              />
              <Star size={13} style={{ color: draft.favorite ? "#ffd166" : "var(--text-dim)" }} />
              加入收藏
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
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
        className="modal-footer flex justify-end gap-3 border-t"
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
