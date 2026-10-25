/**
 * @file 封面增强偏好测试：逐游戏持久化、损坏数据及存储不可用回退。
 * 对应文档：docs/数据模型.md §2.7。
 */
import { describe, expect, it } from "vitest";
import { createCoverSuperresPreference } from "./coverSuperresPreference";

describe("封面增强显示偏好", () => {
  it("分别保存游戏选择，新进程恢复档位及原图选择，不保存图片路径", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const first = createCoverSuperresPreference(() => storage);
    first.write("a", { preset: "quality", showEnhanced: false });
    first.write("b", { preset: "efficient", showEnhanced: true });
    const reopened = createCoverSuperresPreference(() => storage);
    expect(reopened.read("a")).toEqual({ preset: "quality", showEnhanced: false });
    expect(reopened.read("b")).toEqual({ preset: "efficient", showEnhanced: true });
    expect(reopened.read("c")).toBeNull();
    expect(JSON.parse(values.get("whaledeck.cover-superres.a")!)).toEqual({ preset: "quality", showEnhanced: false });
  });

  it.each(["broken", "null", '{"preset":"invalid","showEnhanced":true}', '{"preset":"quality","showEnhanced":"false"}'])("损坏记录 %s 使用默认选择", (raw) => {
    const preference = createCoverSuperresPreference(() => ({ getItem: () => raw, setItem: () => {} }));
    expect(preference.read("a")).toBeNull();
  });

  it("存储完全禁用或只禁止写入时仍记住当前进程内的选择", () => {
    const choice = { preset: "quality" as const, showEnhanced: false };
    const unavailable = () => { throw new Error("不可用"); };
    for (const storage of [unavailable, () => ({ getItem: () => null, setItem: unavailable })]) {
      const preference = createCoverSuperresPreference(storage);
      expect(preference.read("a")).toBeNull();
      preference.write("a", choice);
      expect(preference.read("a")).toEqual(choice);
    }
  });
});
