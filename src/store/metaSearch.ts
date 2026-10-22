import { createStore } from "zustand/vanilla";
import type { MetaItem, MetaSource } from "../types";

interface MetaSearchDependencies {
  search: (source: MetaSource, keyword: string) => Promise<MetaItem[]>;
  notify: (kind: "info" | "error", text: string) => void;
}

interface MetaSearchState {
  source: MetaSource;
  keyword: string;
  items: MetaItem[];
  loading: boolean;
  searched: boolean;
  setSource: (source: MetaSource) => void;
  setKeyword: (keyword: string) => void;
  runSearch: () => Promise<void>;
  invalidate: () => void;
}

// One store per dialog: request identity also scopes late IPC responses to its lifetime.
export function createMetaSearch(initialKeyword: string, { search, notify }: MetaSearchDependencies) {
  let version = 0;

  return createStore<MetaSearchState>((set, get) => ({
    source: "bangumi",
    keyword: initialKeyword,
    items: [],
    loading: false,
    searched: false,
    setSource: (source) => {
      if (source === get().source) return;
      get().invalidate();
      set({ source });
    },
    setKeyword: (keyword) => set({ keyword }),
    invalidate: () => {
      version += 1;
      set({ items: [], loading: false, searched: false });
    },
    runSearch: async () => {
      const { source, keyword } = get();
      const text = keyword.trim();
      if (!text) return;
      const request = ++version;
      set({ items: [], loading: true, searched: true });

      try {
        const items = await search(source, text);
        if (request !== version) return;
        set({ items, loading: false });
        if (items.length === 0) notify("info", "没搜到结果，换个别名或原名试试");
      } catch (error) {
        if (request !== version) return;
        set({ items: [], loading: false });
        notify("error", String(error));
      }
    },
  }));
}
