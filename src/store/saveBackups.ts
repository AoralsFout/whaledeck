/**
 * @file 单个游戏的存档备份状态：列表、备份、还原确认、互斥与生命周期。
 *
 * 详情页按游戏挂载，卸载后所有迟到响应被丢弃；备份与还原共享忙碌状态。
 * 对应文档：docs/前端实现.md「对话框级 store」、docs/界面与交互.md §5。
 */
import { createStore } from "zustand/vanilla";
import { formatBytes } from "../lib/format";
import type { SaveBackup } from "../types";

interface SaveBackupsDependencies {
  list: (gameId: string) => Promise<SaveBackup[]>;
  backup: (gameId: string) => Promise<SaveBackup>;
  restore: (gameId: string, file: string) => Promise<number>;
  openDirectory: (gameId: string) => Promise<void>;
  notify: (kind: "success" | "error", text: string) => void;
}

interface SaveBackupsState {
  backups: SaveBackup[];
  busy: boolean;
  restoreTarget: string | null;
  connect: () => () => void;
  backup: () => Promise<void>;
  selectRestore: (file: string | null) => void;
  restore: () => Promise<void>;
  openDirectory: () => Promise<void>;
}

// The detail view is keyed by game ID; each store owns exactly that game's lifecycle.
export function createSaveBackups(gameId: string, dependencies: SaveBackupsDependencies) {
  let lifetime = 0;
  let connected = false;
  let listRequest = 0;
  const current = (scope: number) => connected && scope === lifetime;

  return createStore<SaveBackupsState>((set, get) => {
    // 只接受最新一次列表读取，避免初始读取晚返回覆盖备份后的新列表。
    const refresh = async (scope: number) => {
      const request = ++listRequest;
      try {
        const backups = await dependencies.list(gameId);
        if (!current(scope) || request !== listRequest) return;
        const target = get().restoreTarget;
        set({ backups, restoreTarget: backups.some((b) => b.file === target) ? target : null });
      } catch {
        // Reading failure must not discard an acknowledged backup or the known list.
      }
    };

    return {
      backups: [],
      busy: false,
      restoreTarget: null,
      connect: () => {
        const scope = ++lifetime;
        connected = true;
        set({ backups: [], busy: false, restoreTarget: null });
        void refresh(scope);
        return () => {
          if (!current(scope)) return;
          connected = false;
          lifetime += 1;
          set({ backups: [], busy: false, restoreTarget: null });
        };
      },
      backup: async () => {
        if (!connected || get().busy) return;
        const scope = lifetime;
        set({ busy: true });
        try {
          const backup = await dependencies.backup(gameId);
          if (!current(scope)) return;
          // Invalidate the initial read before accepting the newly written record.
          listRequest += 1;
          set(({ backups }) => ({
            backups: [backup, ...backups.filter((b) => b.file !== backup.file)]
              .sort((a, b) => b.createdAt - a.createdAt),
          }));
          await refresh(scope);
          if (current(scope)) dependencies.notify("success", `存档已备份（${formatBytes(backup.size)}）`);
        } catch (error) {
          if (current(scope)) dependencies.notify("error", String(error));
        } finally {
          if (current(scope)) set({ busy: false });
        }
      },
      selectRestore: (file) => {
        if (!connected || get().busy) return;
        if (file === null || get().backups.some((b) => b.file === file)) set({ restoreTarget: file });
      },
      restore: async () => {
        const { restoreTarget, backups, busy } = get();
        if (!connected || busy || restoreTarget === null || !backups.some((b) => b.file === restoreTarget)) return;
        const scope = lifetime;
        set({ busy: true });
        try {
          const count = await dependencies.restore(gameId, restoreTarget);
          if (current(scope)) dependencies.notify("success", `已还原 ${count} 个文件到存档目录`);
        } catch (error) {
          if (current(scope)) dependencies.notify("error", String(error));
        } finally {
          if (current(scope)) set({ busy: false, restoreTarget: null });
        }
      },
      openDirectory: async () => {
        if (!connected) return;
        const scope = lifetime;
        try {
          await dependencies.openDirectory(gameId);
        } catch (error) {
          if (current(scope)) dependencies.notify("error", String(error));
        }
      },
    };
  });
}
