import { describe, expect, it } from "vitest";
import {
  dirFromPath,
  formatDate,
  formatPlaytime,
  formatRelative,
  formatTimer,
  shortPath,
  titleFromPath,
} from "./format";

describe("formatPlaytime", () => {
  it("未玩过", () => {
    expect(formatPlaytime(0)).toBe("未玩过");
  });
  it("不足一分钟", () => {
    expect(formatPlaytime(30)).toBe("不到 1 分钟");
  });
  it("分钟", () => {
    expect(formatPlaytime(90)).toBe("1 分钟");
    expect(formatPlaytime(59 * 60)).toBe("59 分钟");
  });
  it("小时与分钟", () => {
    expect(formatPlaytime(3600)).toBe("1 小时");
    expect(formatPlaytime(3660)).toBe("1 小时 1 分钟");
  });
  it("天", () => {
    expect(formatPlaytime(86400)).toBe("1 天");
    expect(formatPlaytime(86400 + 7200)).toBe("1 天 2 小时");
  });
});

describe("formatTimer", () => {
  it("补零", () => {
    expect(formatTimer(3723)).toBe("01:02:03");
    expect(formatTimer(0)).toBe("00:00:00");
  });
  it("负数归零", () => {
    expect(formatTimer(-5)).toBe("00:00:00");
  });
});

describe("formatRelative", () => {
  const now = 1_700_000_000_000;
  const rel = (offsetMs: number) => {
    const original = Date.now;
    Date.now = () => now;
    try {
      return formatRelative(now - offsetMs);
    } finally {
      Date.now = original;
    }
  };

  it("没有记录", () => {
    expect(formatRelative(null)).toBe("从未玩过");
  });
  it("刚刚", () => {
    expect(rel(5_000)).toBe("刚刚");
  });
  it("分钟 / 小时 / 天", () => {
    expect(rel(5 * 60_000)).toBe("5 分钟前");
    expect(rel(3 * 3600_000)).toBe("3 小时前");
    expect(rel(25 * 3600_000)).toBe("昨天");
    expect(rel(5 * 86400_000)).toBe("5 天前");
  });
  it("超过一个月显示日期", () => {
    expect(formatDate(now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("路径工具", () => {
  it("从 exe 推断标题", () => {
    expect(titleFromPath("C:\\Games\\Stardew Valley.exe")).toBe("Stardew Valley");
    expect(titleFromPath("D:/Games/terraria.EXE")).toBe("terraria");
  });
  it("从 exe 推断目录", () => {
    expect(dirFromPath("C:\\Games\\a\\b.exe")).toBe("C:\\Games\\a");
    expect(dirFromPath("C:/Games/a/b.exe")).toBe("C:/Games/a");
  });
  it("短路径保留尾部", () => {
    const short = shortPath("C:\\a\\b\\c\\d\\e\\f\\g\\h.exe", 20);
    expect(short.length).toBe(20);
    expect(short.endsWith("h.exe")).toBe(true);
  });
});
