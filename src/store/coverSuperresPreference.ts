/**
 * @file 逐游戏的封面增强显示偏好；只保存选择，不保存图片或任务。
 * 对应文档：docs/数据模型.md §2.7。
 */
import type { SuperResPreset } from "../lib/ipc";

export interface CoverSuperresChoice {
  preset: SuperResPreset;
  showEnhanced: boolean;
}
export interface CoverSuperresPreference {
  read: (gameId: string) => CoverSuperresChoice | null;
  write: (gameId: string, choice: CoverSuperresChoice) => void;
}

/** 存储被禁用时仍保留本进程选择；持久化数据必须在读取边界校验。 */
export function createCoverSuperresPreference(storage: () => Pick<Storage, "getItem" | "setItem">): CoverSuperresPreference {
  const memory = new Map<string, CoverSuperresChoice>();
  const key = (id: string) => `whaledeck.cover-superres.${id}`;
  return {
    read: (id) => {
      if (memory.has(id)) return { ...memory.get(id)! };
      try {
        const raw = storage().getItem(key(id));
        const value: unknown = raw ? JSON.parse(raw) : null;
        if (value && typeof value === "object" && "preset" in value && "showEnhanced" in value
          && (value.preset === "efficient" || value.preset === "quality") && typeof value.showEnhanced === "boolean") {
          return { preset: value.preset, showEnhanced: value.showEnhanced };
        }
        return null;
      } catch { return memory.get(id) ?? null; }
    },
    write: (id, choice) => {
      memory.set(id, { ...choice });
      try { storage().setItem(key(id), JSON.stringify(choice)); } catch { /* 继续使用进程内记忆。 */ }
    },
  };
}

export const coverSuperresPreference = createCoverSuperresPreference(() => localStorage);
