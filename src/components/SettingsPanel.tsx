/**
 * @file 设置对话框：常规、外观、左侧栏、封面、分类、数据与关于标签页。
 *
 * 普通设置即时生效；背景适配与封面取景先预览确认。导出/导入是覆盖操作，导入前需二次确认。
 * 对应文档：docs/界面与交互.md §4.3、docs/前端实现.md §3。
 */
import { useRef, useState } from "react";
import {
  Database,
  Crop,
  Download,
  FolderOpen,
  ImagePlus,
  Info,
  Moon,
  Palette,
  PanelLeft,
  Settings2,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "../lib/ipc";
import { MAX_SIDEBAR_BLUR, PRESETS, presetToTheme, sidebarBlur } from "../lib/theme";
import { useLibrary } from "../store/useLibrary";
import type { Theme, ThemePreset } from "../types";
import { Modal } from "./Modal";
import { Brand } from "./Brand";
import { SidebarBackgroundSettings } from "./SidebarBackgroundSettings";
import { CoverFramingSettings } from "./CoverFramingSettings";
import { DetailTransitionSettings } from "./DetailTransitionSettings";
import { RangeSlider } from "./RangeSlider";

const TABS = [
  { id: "general", label: "常规", icon: Settings2 },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "sidebar", label: "左侧栏", icon: PanelLeft },
  { id: "covers", label: "封面", icon: Crop },
  { id: "categories", label: "分类", icon: Database },
  { id: "data", label: "数据", icon: Download },
  { id: "about", label: "关于", icon: Info },
] as const;
type SettingsTab = (typeof TABS)[number]["id"];

/** 设置分组容器：统一标题与分组间距。 */
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="m-0 flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--text)" }}>
        {icon}
        {title}
      </h3>
      <div className="settings-section-content">{children}</div>
    </section>
  );
}

/** 设置面板；普通设置即时写回，适配草稿由独立编辑器确认。 */
export function SettingsPanel() {
  const settings = useLibrary((s) => s.settings);
  const updateSettings = useLibrary((s) => s.updateSettings);
  const setCloseBehavior = useLibrary((s) => s.setCloseBehavior);
  const closeSettings = useLibrary((s) => s.closeSettings);
  const showToast = useLibrary((s) => s.showToast);
  const gameCount = useLibrary((s) => s.games.length);
  const [newCat, setNewCat] = useState("");
  const [importArmed, setImportArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<SettingsTab>(() => useLibrary.getState().settingsInitialTab);
  const contentRef = useRef<HTMLDivElement>(null);

  const selectTab = (next: SettingsTab) => {
    setTab(next);
    setImportArmed(false);
    contentRef.current?.scrollTo({ top: 0 });
  };

  if (!settings) return null;
  const theme = settings.theme;

  const patchTheme = (patch: Partial<Theme>) => {
    // 选图跨越异步对话框，从最新状态合并，避免覆盖期间的外观修改。
    const current = useLibrary.getState().settings;
    if (current) void updateSettings({ ...current, theme: { ...current.theme, ...patch } });
  };

  const pickBackground = async (target: "main" | "sidebar" = "main") => {
    setBusy(true);
    try {
      const src = await api.pickImage("background");
      if (!src) return;
      const name = await api.importBackground(src, target);
      patchTheme(target === "sidebar" ? { sidebarBackgroundFile: name } : { backgroundFile: name });
      showToast("success", target === "sidebar" ? "左侧栏背景已更新" : "背景图已更新");
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
    <Modal title="设置" onClose={closeSettings} width={780}>
      <div
        className="settings-header border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="m-0 text-[17px] font-semibold">设置</h2>
          <button className="btn btn-ghost !p-1" onClick={closeSettings} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div
          className="settings-tabs"
          role="tablist"
          aria-label="设置分类"
          onKeyDown={(event) => {
            const focusedTab = (event.target as HTMLElement).closest('[role="tab"]');
            const current = TABS.findIndex((item) => `settings-tab-${item.id}` === focusedTab?.id);
            if (current < 0) return;
            let next = current;
            if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
            else if (event.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = TABS.length - 1;
            else return;
            event.preventDefault();
            selectTab(TABS[next].id);
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`settings-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className="settings-tab"
              onClick={() => selectTab(id)}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-body" ref={contentRef}>
        <div
          key={tab}
          id={`settings-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
          tabIndex={0}
          className="settings-page"
        >
          {tab === "covers" && <CoverFramingSettings />}
          {tab === "general" && (
            <Section title="关闭行为" icon={<Settings2 size={16} aria-hidden="true" />}>
              <p className="hint m-0">选择点击窗口关闭按钮时的行为。{settings.closeBehavior === null ? "当前：首次关闭时询问。" : "修改后自动保存。"}</p>
              <div className="grid gap-3" role="group" aria-label="关闭行为">
                {([
                  { value: "hide", label: "后台隐藏", description: "隐藏到程序托盘，继续追踪和记录运行时长。" },
                  { value: "exit", label: "直接关闭", description: "退出 WhaleDeck；有程序正在运行时，会再次确认。" },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    className="close-behavior-option"
                    aria-pressed={settings.closeBehavior === option.value}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try { await setCloseBehavior(option.value); }
                      finally { setBusy(false); }
                    }}
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className="hint">{option.description}</span>
                  </button>
                ))}
              </div>
              <p className="hint m-0">后台隐藏后，点击托盘图标可恢复窗口；右键菜单可退出 WhaleDeck。</p>
            </Section>
          )}
          {tab === "appearance" && (
            <>
              <Section title="主题配色" icon={<Palette size={16} aria-hidden="true" />}>
                <div className="settings-presets grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(Object.keys(PRESETS) as ThemePreset[]).map((key) => {
                    const p = PRESETS[key];
                    const active = theme.preset === key;
                    return (
                      <button
                        key={key}
                        aria-pressed={active}
                        onClick={() => patchTheme(presetToTheme(key, theme))}
                        className="settings-preset rounded-xl border text-left"
                        style={{
                          borderColor: active ? "rgba(var(--primary-rgb), .65)" : "var(--border)",
                          background: active ? "rgba(var(--primary-rgb), .08)" : "var(--surface-2)",
                        }}
                        title={p.blurb}
                      >
                        <div
                          className="h-1.5 w-full rounded-full"
                          style={{ background: `linear-gradient(90deg, ${p.primary}, ${p.accent})` }}
                        />
                        <span className="text-[13px] font-medium">{p.name}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="settings-colors grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="theme-primary">主色</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="选择主色"
                        value={theme.primary}
                        onChange={(e) => patchTheme({ primary: e.target.value })}
                        className="settings-color-input"
                      />
                      <input
                        className="input font-mono !text-[11px] uppercase"
                        id="theme-primary"
                        value={theme.primary}
                        onChange={(e) => patchTheme({ primary: e.target.value })}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="theme-accent">强调色</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="选择强调色"
                        value={theme.accent}
                        onChange={(e) => patchTheme({ accent: e.target.value })}
                        className="settings-color-input"
                      />
                      <input
                        className="input font-mono !text-[11px] uppercase"
                        id="theme-accent"
                        value={theme.accent}
                        onChange={(e) => patchTheme({ accent: e.target.value })}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="label">明暗模式</label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="明暗模式">
                    {(
                      [
                        { key: "dark", label: "深色", icon: <Moon size={13} /> },
                        { key: "light", label: "浅色", icon: <Sun size={13} /> },
                        { key: "system", label: "跟随系统", icon: <Palette size={13} /> },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.key}
                        aria-pressed={theme.mode === m.key}
                        className="btn"
                        style={
                          theme.mode === m.key
                            ? { borderColor: "rgba(var(--primary-rgb), .6)", color: "var(--primary-ink)", background: "rgba(var(--primary-rgb), .1)" }
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

              <Section title="展示页过渡" icon={<Palette size={16} aria-hidden="true" />}>
                <DetailTransitionSettings theme={theme} onChange={patchTheme} />
              </Section>

              <Section title="背景图" icon={<ImagePlus size={16} aria-hidden="true" />}>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn" onClick={() => void pickBackground()} disabled={busy}>
                    <ImagePlus size={14} />
                    {theme.backgroundFile ? "更换背景图" : "选择背景图"}
                  </button>
                  {theme.backgroundFile && (
                    <button className="btn btn-ghost" disabled={busy} onClick={() => patchTheme({ backgroundFile: null })}>
                      <Trash2 size={14} />
                      清除
                    </button>
                  )}
                  <span className="hint">{theme.backgroundFile ? "已设置（可随时换）" : "支持 png / jpg / webp"}</span>
                </div>
                <p className="hint m-0">设置后所有项目统一使用此背景，清除后恢复各项目封面。</p>
                <div>
                  <label className="sidebar-control-label" htmlFor="background-dim"><span>背景遮罩强度</span><output htmlFor="background-dim">{Math.round(theme.backgroundDim * 100)}%</output></label>
                  <RangeSlider
                    id="background-dim"
                    min={0}
                    max={95}
                    value={Math.round(theme.backgroundDim * 100)}
                    aria-valuetext={`${Math.round(theme.backgroundDim * 100)}%`}
                    onChange={(e) => patchTheme({ backgroundDim: Number(e.target.value) / 100 })}
                  />
                  <p className="hint m-0">数值越大背景越暗，文字更清晰。</p>
                </div>
              </Section>
            </>
          )}

          {tab === "sidebar" && (
            <>
              <Section title="侧栏效果" icon={<PanelLeft size={16} aria-hidden="true" />}>
                <label className="sidebar-auto-hide" htmlFor="sidebar-auto-hide">
                  <span>自动隐藏</span>
                  <input id="sidebar-auto-hide" type="checkbox" role="switch" aria-checked={theme.sidebarAutoHide ?? true} checked={theme.sidebarAutoHide ?? true} onChange={(e) => patchTheme({ sidebarAutoHide: e.target.checked })} />
                </label>
                <div>
                  <label className="sidebar-control-label" htmlFor="sidebar-blur"><span>模糊度</span><output htmlFor="sidebar-blur">{sidebarBlur(theme.sidebarBlur)} px</output></label>
                  <RangeSlider
                    id="sidebar-blur"
                    min={0}
                    max={MAX_SIDEBAR_BLUR}
                    step={1}
                    value={sidebarBlur(theme.sidebarBlur)}
                    aria-valuetext={`${sidebarBlur(theme.sidebarBlur)} 像素`}
                    onChange={(e) => patchTheme({ sidebarBlur: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="sidebar-control-label" htmlFor="sidebar-transparency"><span>底色透明度</span><output htmlFor="sidebar-transparency">{Math.round((theme.sidebarTransparency ?? 0.52) * 100)}%</output></label>
                  <RangeSlider
                    id="sidebar-transparency"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round((theme.sidebarTransparency ?? 0.52) * 100)}
                    aria-valuetext={`${Math.round((theme.sidebarTransparency ?? 0.52) * 100)}%`}
                    onChange={(e) => patchTheme({ sidebarTransparency: Number(e.target.value) / 100 })}
                  />
                </div>
              </Section>
              <Section title="背景与取景" icon={<ImagePlus size={16} aria-hidden="true" />}>
                <SidebarBackgroundSettings theme={theme} imageActions={<>
                  <button className="btn" onClick={() => void pickBackground("sidebar")} disabled={busy}>
                    <ImagePlus size={14} aria-hidden="true" />
                    {busy ? "正在选择…" : theme.sidebarBackgroundFile ? "更换背景" : "选择背景"}
                  </button>
                  {theme.sidebarBackgroundFile && (
                    <button className="btn btn-ghost" disabled={busy} onClick={() => patchTheme({ sidebarBackgroundFile: null })}>
                      <Trash2 size={14} aria-hidden="true" /> 清除背景
                    </button>
                  )}
                  <span className="hint">{theme.sidebarBackgroundFile ? "自定义背景" : "跟随当前游戏封面"}</span>
                </>} />
              </Section>
            </>
          )}

          {tab === "categories" && (
            <Section title="分类管理" icon={<Database size={16} aria-hidden="true" />}>
              <p className="hint m-0">按自己的习惯整理游戏和项目，分类会显示在游戏库侧栏。</p>
              <div className="flex gap-2">
                <input
                  aria-label="新增分类"
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
              <div className="settings-category-list flex flex-wrap gap-2">
                {settings.categories.length === 0 && (
                  <span className="hint">还没有自定义分类，游戏编辑时填写的分类也会自动出现在侧边栏。</span>
                )}
                {settings.categories.map((c) => (
                  <span key={c} className="chip">
                    {c}
                    <button
                      className="settings-category-remove rounded-full hover:bg-white/10"
                      onClick={() => removeCategory(c)}
                      aria-label={`删除分类 ${c}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <p className="hint m-0">
                当前库里有 {gameCount} 个游戏；删除分类不会改动游戏本身。
              </p>
            </Section>
          )}

          {tab === "data" && (
            <>
              <Section title="本地数据" icon={<FolderOpen size={16} aria-hidden="true" />}>
                <p className="hint m-0">游戏库与外观设置保存在本机，可以随时打开目录查看。</p>
                  <button className="btn" onClick={() => void api.openDataDir()} disabled={busy}>
                    <FolderOpen size={14} />
                    打开数据目录
                  </button>
              </Section>
              <Section title="备份与迁移" icon={<Download size={16} aria-hidden="true" />}>
                <p className="hint m-0">导出游戏库留作备份，或从已有备份恢复。</p>
                <div className="flex flex-wrap items-center gap-3">
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
            </>
          )}

          {tab === "about" && (
            <Section title="WhaleDeck" icon={<Info size={16} aria-hidden="true" />}>
              <div className="settings-about text-[13px]" style={{ color: "var(--text-dim)" }}>
                <Brand about />
                <p className="m-0">WhaleDeck v0.8.1 · 本地游戏 / 项目启动台</p>
                <p className="m-0">
                  GitHub:{" "}
                  <span className="select-text" style={{ color: "var(--primary-ink)" }}>
                    github.com/shasha111250/whaledeck
                  </span>
                </p>
                <p className="m-0">数据只保存在本机，不会上传到任何服务器。</p>
              </div>
            </Section>
          )}
        </div>
      </div>

      <div
        className="settings-footer flex items-center justify-between border-t"
        style={{ borderColor: "var(--border)" }}
      >
        {(tab !== "covers" || !settings.theme.backgroundFile) && <span className="hint">{tab === "covers" ? "取景需点「确认保存取景」；关闭设置会丢弃未保存的修改" : "普通设置自动保存；背景适配需点应用"}</span>}
        <button className="btn btn-primary ml-auto" onClick={closeSettings}>
          完成
        </button>
      </div>
    </Modal>
  );
}
