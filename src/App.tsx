import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { api, fileUrl, onGameStopped, onLaunchFailed } from "./lib/ipc";
import { applyTheme } from "./lib/theme";
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

export default function App() {
  const ready = useLibrary((s) => s.ready);
  const settings = useLibrary((s) => s.settings);
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
  useEffect(() => {
    if (!settings) return;
    applyTheme(settings.theme);
    const root = document.documentElement;
    const file = settings.theme.backgroundFile;
    if (!file) {
      root.style.setProperty("--bg-image", "none");
      return;
    }
    let alive = true;
    api
      .assetPath("background", file)
      .then((abs) => {
        if (alive) {
          root.style.setProperty("--bg-image", `url("${fileUrl(abs)}")`);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings]);

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
    </div>
  );
}
