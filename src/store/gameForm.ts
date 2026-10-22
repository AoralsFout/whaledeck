/**
 * @file 项目表单草稿：原值快照、逐字段候选与请求生命周期。
 *
 * 获取结果只合并到本次草稿，不写游戏库；保存由 useLibrary 负责。
 * 对应文档：docs/前端实现.md §3.2、docs/界面与交互.md §4.2。
 */
import { createStore } from "zustand/vanilla";
import type { AutofillField, AutofillResult, Game } from "../types";

export const AUTOFILL_LABELS: Record<AutofillField, string> = {
  title: "名称", developer: "开发商", note: "备注", iconFile: "图标", coverFile: "封面",
};

interface GameFormDependencies {
  fetch: (game: Game, field?: AutofillField) => Promise<AutofillResult>;
}

interface GameFormState {
  original: Game;
  draft: Game;
  fetching: AutofillField | "all" | null;
  status: string;
  error: string;
  patch: (part: Partial<Game>) => void;
  restore: (field: AutofillField) => void;
  acquire: (field?: AutofillField) => Promise<void>;
  connect: (autofill: boolean) => () => void;
}

/** 每次打开独立创建；连接版本使关闭或 StrictMode 重入后的旧响应失效。 */
export function createGameForm(initial: Game, { fetch }: GameFormDependencies) {
  let active = false;
  let version = 0;
  return createStore<GameFormState>((set, get) => ({
    original: structuredClone(initial),
    draft: structuredClone(initial),
    fetching: null,
    status: "",
    error: "",
    patch: (part) => set((state) => ({ draft: { ...state.draft, ...part } })),
    // 原值固定为打开时的快照，反复获取或手动修改都不改变恢复基准。
    restore: (field) => {
      if (get().fetching) return;
      set((state) => ({
        draft: { ...state.draft, [field]: state.original[field] },
        status: `已恢复${AUTOFILL_LABELS[field]}原值，尚未保存`, error: "",
      }));
    },
    // 获取期间互斥；生命周期版本检查先于任何草稿、状态或错误写入。
    acquire: async (field) => {
      if (!active || get().fetching) return;
      const game = structuredClone(get().draft);
      if (!game.exePath.trim()) {
        set({ error: "请先选择程序、文件或文件夹，再自动获取", status: "" });
        return;
      }
      const request = ++version;
      set({ fetching: field ?? "all", status: "正在读取本地信息与图像…", error: "" });
      try {
        const result = await fetch(game, field);
        if (!active || request !== version) return;
        const obtained = (Object.keys(AUTOFILL_LABELS) as AutofillField[]).filter((key) =>
          (!field || key === field) && (key === "iconFile" ? result.icon
            : key === "coverFile" ? result.cover : result.filled.includes(AUTOFILL_LABELS[key])),
        );
        // 只接受实际获取的字段，避免完整返回记录回滚其他草稿值。
        const part = Object.fromEntries(obtained.map((key) => [key, result.game[key]]));
        set((state) => ({
          draft: { ...state.draft, ...part }, fetching: null,
          status: obtained.length > 0
            ? `已获取${obtained.map((key) => AUTOFILL_LABELS[key]).join("、")}，可修改或恢复原值；确认保存后生效。`
            : `未获取到${field ? AUTOFILL_LABELS[field] : "可用的本地信息或图像"}，已保留现值，可手动填写或选择图片。`,
        }));
      } catch (error) {
        if (!active || request !== version) return;
        set({ fetching: null, status: "", error: `自动获取失败：${String(error)}。已保留现值，可重试或手动编辑。` });
      }
    },
    // React 重入时允许重新连接，旧连接的结果仍受请求版本隔离。
    connect: (autofill) => {
      active = true;
      if (autofill) void get().acquire();
      return () => {
        active = false;
        version += 1;
        set({ fetching: null });
      };
    },
  }));
}
