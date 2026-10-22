/**
 * @file Tauri IPC 的唯一封装：命令名、参数与事件的集中映射。
 *
 * 组件与 store 只调用这里的 `api`，不直接 `invoke`；命令签名见 docs/接口契约.md。
 * 对应文档：docs/接口契约.md「前端封装映射」。
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AutofillResult,
  Game,
  LaunchResult,
  MetaItem,
  MetaSource,
  SaveBackup,
  ScanEntry,
  Session,
  Settings,
  StoppedPayload,
} from "../types";

/** 与 Rust 命令一一对应的调用表；新增命令时同步 docs/接口契约.md。 */
export const api = {
  listGames: () => invoke<Game[]>("list_games"),
  saveGame: (game: Game) => invoke<Game>("save_game", { game }),
  deleteGame: (id: string) => invoke<boolean>("delete_game", { id }),
  launchGame: (id: string) => invoke<LaunchResult>("launch_game", { id }),
  getSessions: () => invoke<Session[]>("get_sessions"),
  resetPlaytime: (id: string, sec: number) =>
    invoke<Game>("reset_playtime", { id, sec }),
  pickEntry: () => invoke<string | null>("pick_entry"),
  pickFolder: () => invoke<string | null>("pick_folder"),
  pickImage: (kind: "cover" | "background") =>
    invoke<string | null>("pick_image", { kind }),
  scanFolder: (path: string) =>
    invoke<ScanEntry[]>("scan_folder", { path }),
  importCover: (id: string, src: string) =>
    invoke<string>("import_cover", { id, src }),
  importBackground: (src: string) =>
    invoke<string>("import_background", { src }),
  assetPath: (kind: "cover" | "background" | "icon", file: string) =>
    invoke<string>("asset_path", { kind, file }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) =>
    invoke<Settings>("save_settings", { settings }),
  openDataDir: () => invoke<void>("open_data_dir"),
  backupSaves: (id: string) => invoke<SaveBackup>("backup_saves", { id }),
  listSaveBackups: (id: string) =>
    invoke<SaveBackup[]>("list_save_backups", { id }),
  restoreSaveBackup: (id: string, file: string) =>
    invoke<number>("restore_save_backup", { id, file }),
  openBackupsDir: (id: string) => invoke<void>("open_backups_dir", { id }),
  exportLibrary: () => invoke<boolean>("export_library"),
  importLibrary: () => invoke<number>("import_library"),
  searchMeta: (source: MetaSource, keyword: string) =>
    invoke<MetaItem[]>("search_meta", { source, keyword }),
  applyMeta: (gameId: string, item: MetaItem) =>
    invoke<Game>("apply_meta", { gameId, item }),
  autofill: (gameId: string) => invoke<AutofillResult>("autofill", { gameId }),
};

export function fileUrl(absPath: string): string {
  return convertFileSrc(absPath);
}

export function onGameStopped(cb: (p: StoppedPayload) => void) {
  return listen<StoppedPayload>("game-stopped", (e) => cb(e.payload));
}

export function onLaunchFailed(cb: (p: { gameId: string; message: string }) => void) {
  return listen<{ gameId: string; message: string }>("launch-failed", (e) =>
    cb(e.payload),
  );
}
