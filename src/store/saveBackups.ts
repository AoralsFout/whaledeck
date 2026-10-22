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
