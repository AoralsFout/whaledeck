export type Game = {
  id: string;
  title: string;
  exePath: string;
  workDir: string;
  args: string;
  extraProcessNames: string[];
  coverFile: string | null;
  category: string;
  tags: string[];
  note: string;
  favorite: boolean;
  hidden: boolean;
  playtimeSec: number;
  lastPlayedAt: number | null;
  addedAt: number;
  /** 需要备份的存档目录，可以多个 */
  savePaths: string[];
  /** 元数据来源：bangumi / vndb / ymgal，空表示手动填写 */
  source: string;
  sourceId: string;
  developer: string;
  releaseDate: string;
  summary: string;
};

export type ThemePreset = "whale" | "abyss" | "sakura" | "mono";

export type Theme = {
  preset: ThemePreset;
  mode: "dark" | "light" | "system";
  primary: string;
  accent: string;
  backgroundFile: string | null;
  backgroundDim: number;
};

export type SortKey = "recent" | "title" | "playtime" | "added";

export type Settings = {
  theme: Theme;
  sort: SortKey;
  categories: string[];
};

export type Session = {
  gameId: string;
  pid: number;
  startedAt: number;
  baselinePlaytime: number;
};

export type LaunchResult = {
  /** 以进程方式启动时的 PID；用系统默认方式打开时为 null */
  pid: number | null;
  startedAt: number;
};

export type StoppedPayload = {
  gameId: string;
  sessionSec: number;
  playtimeSec: number;
};

export type ScanEntry = {
  path: string;
  name: string;
  size: number;
};

export type SaveBackup = {
  file: string;
  createdAt: number;
  size: number;
};

export type NavKey =
  | { type: "all" }
  | { type: "favorites" }
  | { type: "hidden" }
  | { type: "category"; name: string };

export type MetaSource = "bangumi" | "vndb" | "ymgal";

export type MetaItem = {
  source: MetaSource;
  id: string;
  title: string;
  subtitle: string;
  coverUrl: string | null;
  releaseDate: string;
  developer: string;
  summary: string;
  rating: number | null;
};

export function newGameDraft(): Game {
  return {
    id: "",
    title: "",
    exePath: "",
    workDir: "",
    args: "",
    extraProcessNames: [],
    coverFile: null,
    category: "",
    tags: [],
    note: "",
    favorite: false,
    hidden: false,
    playtimeSec: 0,
    lastPlayedAt: null,
    addedAt: 0,
    savePaths: [],
    source: "",
    sourceId: "",
    developer: "",
    releaseDate: "",
    summary: "",
  };
}

/** 判断是否按进程启动（可计时） */
export function isProcessTarget(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ["exe", "bat", "cmd", "com"].includes(ext) && path.includes(".");
}
