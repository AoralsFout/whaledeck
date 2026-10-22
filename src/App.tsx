import { useEffect } from "react";
import { api, fileUrl, onGameStopped, onLaunchFailed } from "./lib/ipc";
import { applyTheme } from "./lib/theme";
import { useLibrary } from "./store/useLibrary";
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
  const games = useLibrary((s) => s.games);
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
    const exists = selectedId && games.some((g) => g.id === selectedId);
    if (exists) return;
    if (games.length > 0) select(games[0].id);
    else if (selectedId) select(null);
  }, [ready, games, selectedId, select]);

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

  const selected = games.find((g) => g.id === selectedId);

  return (
    <div className="flex h-full">
      <WindowChrome />
      <Sidebar />
      <main className="relative min-w-0 flex-1">
        {selected ? <GameDetail /> : <EmptyState onAdd={openNew} />}
      </main>

      {formOpen && <GameForm />}
      {settingsOpen && <SettingsPanel />}
      {scanOpen && <ScanDialog />}
      {metaOpen && <MetaDialog />}
      <Toast />
    </div>
  );
}
