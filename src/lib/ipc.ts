import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Game,
  LaunchResult,
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
  pickExe: () => invoke<string | null>("pick_exe"),
  pickFolder: () => invoke<string | null>("pick_folder"),
  pickImage: (kind: "cover" | "background") =>
    invoke<string | null>("pick_image", { kind }),
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
  exportLibrary: () => invoke<boolean>("export_library"),
  importLibrary: () => invoke<number>("import_library"),
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
