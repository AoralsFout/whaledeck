import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  CoverOutcome,
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
  assetPath: (kind: "cover" | "background", file: string) =>
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
  autoCover: (gameId: string) =>
    invoke<CoverOutcome>("auto_cover", { gameId }),
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
