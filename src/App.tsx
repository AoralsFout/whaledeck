/**
 * @file 应用外壳：初始化游戏库、订阅后端事件、同步选中项、应用主题并显示窗口。
 *
 * 负责「跨组件的一次性生命周期」，不承载具体业务表单逻辑。
 * 对应文档：docs/前端实现.md「状态分层」「启动、主题与资源」。
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { Menu } from "lucide-react";
import { onGameStopped, onLaunchFailed, onSettingsChanged } from "./lib/ipc";
import { applyTheme } from "./lib/theme";
import { useAssetUrl } from "./lib/useAssetUrl";
import { showWindowWhenReady } from "./lib/startup";
import { useLibrary } from "./store/useLibrary";
import { useLibraryView } from "./store/useLibraryView";
import { Sidebar } from "./components/Sidebar";
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
        <div className="text-5xl">🐋</div>
        <p className="m-0 text-sm" style={{ color: "var(--text-dim)" }}>
          正在打开游戏库…
        </p>
        <Toast />
        <CloseDialog />
      </div>
    );
  }

  return (
    <div className="app-shell flex h-full" data-navigation-open={navigationOpen}>
      <WindowChrome />
      <button className="btn mobile-nav-toggle" aria-label="打开游戏库" aria-expanded={navigationOpen} aria-controls="library-sidebar" onClick={() => setNavigationOpen(true)}>
        <Menu size={17} aria-hidden="true" /> 游戏库
      </button>
      <Sidebar onNavigate={() => setNavigationOpen(false)} />
      <main id="main-content" className="relative min-h-0 min-w-0 flex-1">
        {selected ? <GameDetail key={selected.id} game={selected} /> : <EmptyState onAdd={openNew} filtered={gameCount > 0} onReset={() => {
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
