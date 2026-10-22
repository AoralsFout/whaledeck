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
  pid: number;
  startedAt: number;
};

export type StoppedPayload = {
  gameId: string;
  sessionSec: number;
  playtimeSec: number;
};

export type NavKey =
  | { type: "all" }
  | { type: "favorites" }
  | { type: "hidden" }
  | { type: "category"; name: string };

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
  };
}
