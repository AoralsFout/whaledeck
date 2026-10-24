/**
 * @file 应用外壳：初始化游戏库、订阅后端事件、同步选中项、应用主题并显示窗口。
 *
 * 负责「跨组件的一次性生命周期」，不承载具体业务表单逻辑。
 * 对应文档：docs/前端实现.md「状态分层」「启动、主题与资源」。
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { api, onGameStopped, onLaunchFailed, onSettingsChanged } from "./lib/ipc";
import { coverFraming } from "./lib/coverFraming";
import { createCoverQuickEdit } from "./store/coverQuickEdit";
import { applyTheme } from "./lib/theme";
import { useAssetUrl } from "./lib/useAssetUrl";
import { APP_ICON_URL } from "./lib/brand";
import { showWindowWhenReady } from "./lib/startup";
import { useLibrary } from "./store/useLibrary";
import { useLibraryView } from "./store/useLibraryView";
import { SidebarNavigation } from "./components/SidebarNavigation";
import { GameDetail } from "./components/GameDetail";
import { GameForm } from "./components/GameForm";
import { SettingsPanel } from "./components/SettingsPanel";
import { ScanDialog } from "./components/ScanDialog";
import { MetaDialog } from "./components/MetaDialog";
import { EmptyState } from "./components/EmptyState";
import { Toast } from "./components/Toast";
import { WindowChrome } from "./components/WindowChrome";
import { CloseDialog } from "./components/CloseDialog";

/**
 * 应用根组件：加载库 → 派生选中项 → 应用主题 → 首帧后显示窗口。
 *
 * 异步事件通过 store 的 getState() 分发，避免把订阅绑到某次渲染的闭包。
 */
export default function App() {
  const ready = useLibrary((s) => s.ready);
  const settings = useLibrary((s) => s.settings);
  const background = useAssetUrl("background", settings?.theme.backgroundFile);
  const { selected } = useLibraryView();
  const gameCount = useLibrary((s) => s.games.length);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const selectedId = useLibrary((s) => s.selectedId);
  const formOpen = useLibrary((s) => s.formOpen);
  const settingsOpen = useLibrary((s) => s.settingsOpen);
  const scanOpen = useLibrary((s) => s.scanOpen);
  const metaOpen = useLibrary((s) => s.metaOpen);
  const init = useLibrary((s) => s.init);
  const select = useLibrary((s) => s.select);
  const openNew = useLibrary((s) => s.openNew);

  // 文件改变即隔离旧草稿；保存回包只应用到仍存在且封面未更换的记录。
  const coverEditor = useMemo(() => {
    const id = selected?.id;
    const file = selected?.coverFile;
    return createCoverQuickEdit(coverFraming(selected ?? { coverFile: null }), {
      save: async framing => {
        if (!id) throw new Error("请先选择游戏");
        const updated = await api.saveCoverFraming(id, framing);
        const state = useLibrary.getState();
        if (state.games.some(game => game.id === id && game.coverFile === file)) state.applyGame(updated);
        return coverFraming(updated);
      },
      error: error => useLibrary.getState().showToast("error", `保存封面取景失败：${String(error)}`),
    });
  }, [selected?.id, selected?.coverFile]);
  useEffect(() => {
    if (selected) coverEditor.sync(coverFraming(selected));
  }, [coverEditor, selected]);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const subs = [
      onGameStopped((p) => useLibrary.getState().handleStopped(p)),
      onLaunchFailed((p) => useLibrary.getState().handleLaunchFailed(p.message)),
      onSettingsChanged((settings) => useLibrary.setState({ settings, sort: settings.sort })),
    ];
    return () => {
      subs.forEach((p) => {
        void p.then((un) => un());
      });
    };
  }, []);

  // 默认选中第一个游戏
  useEffect(() => {
    if (!ready) return;
    const nextId = selected?.id ?? null;
    if (selectedId !== nextId) select(nextId);
  }, [ready, selected?.id, selectedId, select]);

  // 主题应用 + 背景图
  useLayoutEffect(() => {
    if (!settings) return;
    applyTheme(settings.theme);
    document.documentElement.style.setProperty("--bg-image", background ? `url("${background}")` : "none");
  }, [settings, background]);

  useEffect(() => {
    if (ready) return showWindowWhenReady();
  }, [ready]);

  // 跟随系统主题变化
  useEffect(() => {
    if (!settings || settings.theme.mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => applyTheme(settings.theme);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings]);

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <WindowChrome />
        <img src={APP_ICON_URL} width={64} height={64} alt="" draggable={false} />
        <p className="m-0 text-sm" style={{ color: "var(--text-dim)" }}>
          正在打开游戏库…
        </p>
        <Toast />
        <CloseDialog />
      </div>
    );
  }

  return (
    <div className="app-shell flex h-full" data-navigation-open={navigationOpen} data-sidebar-auto-hide={settings?.theme.sidebarAutoHide ?? true}>
      <WindowChrome coverEditor={coverEditor} coverDisabled={formOpen || settingsOpen || scanOpen || metaOpen} />
      <SidebarNavigation open={navigationOpen} onOpenChange={setNavigationOpen} autoHide={settings?.theme.sidebarAutoHide ?? true} dialogOpen={formOpen || settingsOpen || scanOpen || metaOpen} />
      <main id="main-content" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1">
        {selected ? <GameDetail game={selected} coverEditor={coverEditor} /> : <EmptyState onAdd={openNew} filtered={gameCount > 0} onReset={() => {
          useLibrary.getState().setQuery("");
          useLibrary.getState().setNav({ type: "all" });
        }} />}
      </main>

      {formOpen && <GameForm />}
      {settingsOpen && <SettingsPanel />}
      {scanOpen && <ScanDialog />}
      {metaOpen && <MetaDialog />}
      <Toast />
      <CloseDialog />
    </div>
  );
}
