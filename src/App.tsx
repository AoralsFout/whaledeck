import { useEffect } from "react";
import { api, fileUrl, onGameStopped, onLaunchFailed } from "./lib/ipc";
import { applyTheme } from "./lib/theme";
import { useLibrary } from "./store/useLibrary";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { GameGrid } from "./components/GameGrid";
import { GameDetail } from "./components/GameDetail";
import { GameForm } from "./components/GameForm";
import { SettingsPanel } from "./components/SettingsPanel";
import { Toast } from "./components/Toast";
import { ScanDialog } from "./components/ScanDialog";

export default function App() {
  const ready = useLibrary((s) => s.ready);
  const settings = useLibrary((s) => s.settings);
  const selectedId = useLibrary((s) => s.selectedId);
  const formOpen = useLibrary((s) => s.formOpen);
  const settingsOpen = useLibrary((s) => s.settingsOpen);
  const scanOpen = useLibrary((s) => s.scanOpen);
  const init = useLibrary((s) => s.init);

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
        <div className="text-5xl">🐋</div>
        <p className="m-0 text-sm" style={{ color: "var(--text-dim)" }}>
          正在打开游戏库…
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-8">
          <GameGrid />
        </div>
      </main>

      {selectedId && <GameDetail />}
      {formOpen && <GameForm />}
      {settingsOpen && <SettingsPanel />}
      {scanOpen && <ScanDialog />}
      <Toast />
    </div>
  );
}
