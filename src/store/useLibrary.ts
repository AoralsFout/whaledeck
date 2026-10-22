import { create } from "zustand";
import { api } from "../lib/ipc";
import { filterGames, gamePathKey } from "../lib/library";
import { dirFromPath, titleFromPath } from "../lib/format";
import type {
  Game,
  NavKey,
  Settings,
  Session,
  SortKey,
  ScanEntry,
  StoppedPayload,
} from "../types";
import { newGameDraft } from "../types";

export type ToastKind = "success" | "error" | "info";
export type Toast = { id: number; kind: ToastKind; text: string };
export type BatchAddResult = {
  added: Game[];
  skipped: ScanEntry[];
  remaining: ScanEntry[];
  error: { entry: ScanEntry; message: string } | null;
};

type LibraryState = {
  games: Game[];
  settings: Settings | null;
  sessions: Session[];
  ready: boolean;
  busy: boolean;
  query: string;
  nav: NavKey;
  sort: SortKey;
  selectedId: string | null;
  formOpen: boolean;
  editing: Game | null;
  settingsOpen: boolean;
  scanOpen: boolean;
  metaOpen: boolean;
  toast: Toast | null;

  init: () => Promise<void>;
  setQuery: (q: string) => void;
  setNav: (nav: NavKey) => void;
  setSort: (sort: SortKey) => Promise<void>;
  select: (id: string | null) => void;
  openNew: () => void;
  openEdit: (game: Game) => void;
  closeForm: () => void;
  saveGame: (game: Game) => Promise<boolean>;
  addScannedGames: (entries: ScanEntry[]) => Promise<BatchAddResult>;
  deleteGame: (id: string) => Promise<void>;
  applyGame: (game: Game) => void;
  launchGame: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  updateSettings: (next: Settings) => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
  openScan: () => void;
  closeScan: () => void;
  openMeta: () => void;
  closeMeta: () => void;
  showToast: (kind: ToastKind, text: string) => void;
  hideToast: () => void;
  handleStopped: (p: StoppedPayload) => void;
  handleLaunchFailed: (message: string) => void;
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function mergeSavedGame(games: Game[], saved: Game): Game[] {
  return games.some((game) => game.id === saved.id)
    ? games.map((game) => game.id === saved.id ? saved : game)
    : [...games, saved];
}

export const useLibrary = create<LibraryState>((set, get) => {
  // Persist first; accept only the backend's acknowledged record into the library.
  const persistGame = async (game: Game) => {
    const saved = await api.saveGame(game);
    set((state) => ({ games: mergeSavedGame(state.games, saved) }));
    return saved;
  };

  const runBatch = async (entries: ScanEntry[]): Promise<BatchAddResult> => {
    const result: BatchAddResult = { added: [], skipped: [], remaining: [], error: null };
    const alreadyAdded = (entry: ScanEntry) => get().games.some(
      (game) => gamePathKey(game.exePath) === gamePathKey(entry.path),
    );
    for (const [index, entry] of entries.entries()) {
      if (alreadyAdded(entry)) {
        result.skipped.push(entry);
        continue;
      }
      try {
        const saved = await persistGame({
          ...newGameDraft(),
          id: crypto.randomUUID(),
          title: titleFromPath(entry.path),
          exePath: entry.path,
          workDir: dirFromPath(entry.path),
        });
        result.added.push(saved);
      } catch (error) {
        result.remaining = entries.slice(index).filter((item) => !alreadyAdded(item));
        result.error = { entry, message: error instanceof Error ? error.message : String(error) };
        get().showToast("error",
          `已加入 ${result.added.length} 个，剩余 ${result.remaining.length} 个未加入。${entry.name}：${result.error.message}。可重试剩余项目。`,
        );
        return result;
      }
    }
    if (entries.length > 0) {
      get().showToast(result.added.length > 0 ? "success" : "info",
        `已加入 ${result.added.length} 个游戏${result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 个已在库中的项目` : ""}`);
    }
    return result;
  };
  let additionsQueue: Promise<void> = Promise.resolve();

  return {
    games: [],
    settings: null,
    sessions: [],
    ready: false,
    busy: false,
    query: "",
    nav: { type: "all" },
    sort: "recent",
    selectedId: null,
    formOpen: false,
    editing: null,
    settingsOpen: false,
    scanOpen: false,
    metaOpen: false,
    toast: null,

    init: async () => {
      try {
        const [games, settings, sessions] = await Promise.all([
          api.listGames(),
          api.getSettings(),
          api.getSessions(),
        ]);
        set({
          games,
          settings,
          sessions,
          sort: settings.sort,
          ready: true,
        });
      } catch (err) {
        set({ ready: true });
        get().showToast("error", `加载游戏库失败：${String(err)}`);
      }
    },

    setQuery: (query) => set({ query }),
    setNav: (nav) => set({ nav }),

    setSort: async (sort) => {
      set({ sort });
      const settings = get().settings;
      if (settings) {
        const next = { ...settings, sort };
        set({ settings: next });
        try {
          await api.saveSettings(next);
        } catch {
          /* 排序偏好保存失败不打断使用 */
        }
      }
    },

    select: (selectedId) => set({ selectedId }),

    openNew: () => set({ editing: newGameDraft(), formOpen: true }),
    openEdit: (game) => set({ editing: { ...game }, formOpen: true }),
    closeForm: () => set({ editing: null, formOpen: false }),

    saveGame: async (game) => {
      set({ busy: true });
      try {
        const saved = await persistGame(game);
        set((s) => ({
          formOpen: false,
          editing: null,
          selectedId: saved.id,
          ...(filterGames([saved], s.nav, s.query).length === 0
            ? { nav: saved.hidden ? { type: "hidden" as const } : { type: "all" as const }, query: "" }
            : {}),
        }));
        get().showToast("success", "已保存");
        return true;
      } catch (err) {
        get().showToast("error", String(err));
        return false;
      } finally {
        set({ busy: false });
      }
    },

    addScannedGames: (entries) => {
      const selected = [...entries];
      const batch = additionsQueue.then(() => runBatch(selected));
      additionsQueue = batch.then(() => {}, () => {});
      return batch;
    },

    deleteGame: async (id) => {
      try {
        await api.deleteGame(id);
        set((s) => ({
          games: s.games.filter((g) => g.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        }));
        get().showToast("info", "已从库中移除（本地文件不受影响）");
      } catch (err) {
        get().showToast("error", String(err));
      }
    },

    applyGame: (game) =>
      set((s) => ({
        games: s.games.some((g) => g.id === game.id) ? mergeSavedGame(s.games, game) : s.games,
      })),

    launchGame: async (id) => {
      const game = get().games.find((g) => g.id === id);
      if (!game) return;
      try {
        const result = await api.launchGame(id);
        set((s) => {
          const games = s.games.map((g) =>
            g.id === id ? { ...g, lastPlayedAt: result.startedAt } : g,
          );
          if (result.pid === null) {
            // 非 exe：用系统默认程序打开，不产生计时会话
            return { games, sessions: s.sessions };
          }
          const session: Session = {
            gameId: id,
            pid: result.pid,
            startedAt: result.startedAt,
            baselinePlaytime: game.playtimeSec,
          };
          return {
            games,
            sessions: [...s.sessions.filter((x) => x.gameId !== id), session],
          };
        });
        if (result.pid === null) {
          get().showToast("info", "已用系统默认程序打开");
        }
      } catch (err) {
        get().showToast("error", String(err));
      }
    },

    toggleFavorite: async (id) => {
      const game = get().games.find((g) => g.id === id);
      if (!game) return;
      try {
        await persistGame({ ...game, favorite: !game.favorite });
      } catch (err) {
        get().showToast("error", String(err));
      }
    },

    updateSettings: async (next) => {
      set({ settings: next, sort: next.sort });
      try {
        await api.saveSettings(next);
      } catch (err) {
        get().showToast("error", `保存设置失败：${String(err)}`);
      }
    },

    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),
    openScan: () => set({ scanOpen: true }),
    closeScan: () => set({ scanOpen: false }),
    openMeta: () => set({ metaOpen: true }),
    closeMeta: () => set({ metaOpen: false }),

    showToast: (kind, text) => {
      if (toastTimer) clearTimeout(toastTimer);
      set({ toast: { id: Date.now(), kind, text } });
      toastTimer = setTimeout(() => set({ toast: null }), 3400);
    },
    hideToast: () => {
      if (toastTimer) clearTimeout(toastTimer);
      set({ toast: null });
    },

    handleStopped: (p) => {
      set((s) => ({
        sessions: s.sessions.filter((x) => x.gameId !== p.gameId),
        games: s.games.map((g) =>
          g.id === p.gameId ? { ...g, playtimeSec: p.playtimeSec } : g,
        ),
      }));
      const minutes = Math.max(1, Math.round(p.sessionSec / 60));
      get().showToast("info", `本次游玩 ${minutes} 分钟，已记录`);
    },

    handleLaunchFailed: (message) => {
      get().showToast("error", message);
    },
  };
});
