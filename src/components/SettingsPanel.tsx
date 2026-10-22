import { useState } from "react";
import {
  Database,
  Download,
  FolderOpen,
  ImagePlus,
  Moon,
  Palette,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "../lib/ipc";
import { PRESETS, presetToTheme } from "../lib/theme";
import { useLibrary } from "../store/useLibrary";
import type { Theme, ThemePreset } from "../types";
import { Modal } from "./Modal";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="m-0 flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--text)" }}>
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}

export function SettingsPanel() {
  const settings = useLibrary((s) => s.settings);
  const updateSettings = useLibrary((s) => s.updateSettings);
  const closeSettings = useLibrary((s) => s.closeSettings);
  const showToast = useLibrary((s) => s.showToast);
  const games = useLibrary((s) => s.games);
  const [newCat, setNewCat] = useState("");
  const [importArmed, setImportArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!settings) return null;
  const theme = settings.theme;

  const patchTheme = (patch: Partial<Theme>) => {
    void updateSettings({ ...settings, theme: { ...theme, ...patch } });
  };

  const pickBackground = async () => {
    const src = await api.pickImage("background");
    if (!src) return;
    setBusy(true);
    try {
      const name = await api.importBackground(src);
      patchTheme({ backgroundFile: name });
      showToast("success", "背景图已更新");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const addCategory = () => {
    const name = newCat.trim();
    if (!name) return;
    if (settings.categories.includes(name)) {
      showToast("info", "这个分类已经存在");
      return;
    }
    void updateSettings({ ...settings, categories: [...settings.categories, name] });
    setNewCat("");
  };

  const removeCategory = (name: string) => {
    void updateSettings({
      ...settings,
      categories: settings.categories.filter((c) => c !== name),
    });
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const ok = await api.exportLibrary();
      if (ok) showToast("success", "游戏库已导出");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setImportArmed(false);
    setBusy(true);
    try {
      const count = await api.importLibrary();
      if (count > 0) {
        await useLibrary.getState().init();
        showToast("success", `已导入 ${count} 个游戏`);
      }
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeSettings} width={720}>
      <div
        className="flex items-center justify-between border-b px-5 py-3.5"
        style={{ borderColor: "var(--border)" }}
      >
        <h3 className="m-0 text-[15px] font-semibold">设置</h3>
        <button className="btn btn-ghost !p-1" onClick={closeSettings} aria-label="关闭">
          <X size={16} />
        </button>
      </div>

      <div className="max-h-[72vh] space-y-6 overflow-y-auto px-5 py-4">
        <Section title="外观 · 配色" icon={<Palette size={14} />}>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(PRESETS) as ThemePreset[]).map((key) => {
              const p = PRESETS[key];
              const active = theme.preset === key;
              return (
                <button
                  key={key}
                  onClick={() => patchTheme(presetToTheme(key, theme))}
                  className="rounded-xl border px-2.5 py-2 text-left transition-all"
                  style={{
                    borderColor: active ? "rgba(var(--primary-rgb), .65)" : "var(--border)",
                    background: active ? "rgba(var(--primary-rgb), .08)" : "var(--surface-2)",
                  }}
                  title={p.blurb}
                >
                  <div
                    className="mb-1.5 h-1.5 w-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${p.primary}, ${p.accent})` }}
                  />
                  <span className="text-[12px]">{p.name}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">主色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={theme.primary}
                  onChange={(e) => patchTheme({ primary: e.target.value })}
                  className="h-9 w-10 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                />
                <input
                  className="input font-mono !text-[11px] uppercase"
                  value={theme.primary}
                  onChange={(e) => patchTheme({ primary: e.target.value })}
                  spellCheck={false}
                />
              </div>
            </div>
            <div>
              <label className="label">强调色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={theme.accent}
                  onChange={(e) => patchTheme({ accent: e.target.value })}
                  className="h-9 w-10 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                />
                <input
                  className="input font-mono !text-[11px] uppercase"
                  value={theme.accent}
                  onChange={(e) => patchTheme({ accent: e.target.value })}
                  spellCheck={false}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="label">明暗模式</label>
            <div className="flex gap-2">
              {(
                [
                  { key: "dark", label: "深色", icon: <Moon size={13} /> },
                  { key: "light", label: "浅色", icon: <Sun size={13} /> },
                  { key: "system", label: "跟随系统", icon: <Palette size={13} /> },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  className="btn"
                  style={
                    theme.mode === m.key
                      ? { borderColor: "rgba(var(--primary-rgb), .6)", color: "var(--primary)", background: "rgba(var(--primary-rgb), .1)" }
                      : undefined
                  }
                  onClick={() => patchTheme({ mode: m.key })}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="外观 · 背景图" icon={<ImagePlus size={14} />}>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={() => void pickBackground()} disabled={busy}>
              <ImagePlus size={14} />
              {theme.backgroundFile ? "更换背景图" : "选择背景图"}
            </button>
            {theme.backgroundFile && (
              <button className="btn btn-ghost" onClick={() => patchTheme({ backgroundFile: null })}>
                <Trash2 size={14} />
                清除
              </button>
            )}
            <span className="hint">{theme.backgroundFile ? "已设置（可随时换）" : "支持 png / jpg / webp"}</span>
          </div>
          <div>
            <label className="label">背景遮罩强度（{Math.round(theme.backgroundDim * 100)}%）</label>
            <input
              type="range"
              min={0}
              max={95}
              value={Math.round(theme.backgroundDim * 100)}
              onChange={(e) => patchTheme({ backgroundDim: Number(e.target.value) / 100 })}
              className="w-full accent-[var(--primary)]"
            />
            <p className="hint m-0">数值越大背景越暗，文字更清晰。</p>
          </div>
        </Section>

        <Section title="分类管理" icon={<Database size={14} />}>
          <div className="flex gap-2">
            <input
              className="input"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder="新增一个分类，例如「独立游戏」"
              onKeyDown={(e) => {
                if (e.key === "Enter") addCategory();
              }}
            />
            <button className="btn shrink-0" onClick={addCategory}>
              添加
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {settings.categories.length === 0 && (
              <span className="hint">还没有自定义分类，游戏编辑时填写的分类也会自动出现在侧边栏。</span>
            )}
            {settings.categories.map((c) => (
              <span key={c} className="chip">
                {c}
                <button
                  className="ml-0.5 rounded-full p-0.5 hover:bg-white/10"
                  onClick={() => removeCategory(c)}
                  aria-label={`删除分类 ${c}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <p className="hint m-0">
            当前库里有 {games.length} 个游戏；删除分类不会改动游戏本身。
          </p>
        </Section>

        <Section title="数据" icon={<Download size={14} />}>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={() => void api.openDataDir()} disabled={busy}>
              <FolderOpen size={14} />
              打开数据目录
            </button>
            <button className="btn" onClick={() => void doExport()} disabled={busy}>
              <Download size={14} />
              导出游戏库
            </button>
            {importArmed ? (
              <>
                <button className="btn btn-danger" onClick={() => void doImport()} disabled={busy}>
                  <Upload size={14} />
                  确认覆盖导入
                </button>
                <button className="btn" onClick={() => setImportArmed(false)}>
                  取消
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setImportArmed(true)} disabled={busy}>
                <Upload size={14} />
                导入游戏库
              </button>
            )}
          </div>
          <p className="hint m-0">
            导出会同时复制封面到备份旁边的 <code>.covers</code> 文件夹。导入会覆盖当前库，请先导出备份。
          </p>
        </Section>

        <Section title="关于" icon={<Palette size={14} />}>
          <div className="space-y-1 text-[12px]" style={{ color: "var(--text-dim)" }}>
            <p className="m-0">WhaleDeck v0.1.0 · 本地游戏库管理器</p>
            <p className="m-0">
              GitHub:{" "}
              <span className="select-text" style={{ color: "var(--primary)" }}>
                github.com/shasha111250/whaledeck
              </span>
            </p>
            <p className="m-0">数据只保存在本机，不会上传到任何服务器。</p>
          </div>
        </Section>
      </div>

      <div
        className="flex items-center justify-between border-t px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="hint">设置即时生效并自动保存</span>
        <button className="btn btn-primary" onClick={closeSettings}>
          完成
        </button>
      </div>
    </Modal>
  );
}
