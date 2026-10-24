/**
 * @file 封面取景回归：旧数据、换图隔离、拖动几何及边缘约束。
 * 对应 docs/前端实现.md §4.2.2、docs/数据模型.md §2.1。
 */
import { describe, expect, it } from "vitest";
import { coverFraming, coverFramingStyle, dragCoverFraming } from "./coverFraming";

describe("封面取景", () => {
  const start = { file: "a.jpg", positionX: 50, positionY: 50, zoom: 1 };
  it("旧数据居中显示，新封面不继承旧图取景", () => {
    expect(coverFraming({ coverFile: "a.jpg" })).toEqual(start);
    expect(coverFraming({ coverFile: "b.jpg", coverFraming: { ...start, positionX: 12, zoom: 2 } })).toEqual({ ...start, file: "b.jpg" });
  });
  it("保留合法取景并限制导入数据的异常参数", () => {
    const saved = { ...start, positionX: 22, positionY: 91, zoom: 1.7 };
    expect(coverFraming({ coverFile: saved.file, coverFraming: saved })).toEqual(saved);
    expect(coverFraming({ coverFile: start.file, coverFraming: { ...start, positionX: NaN, positionY: 150, zoom: .2 } })).toEqual({ ...start, positionY: 100 });
  });
  it("横向拖动按实际溢出比例移动，纵向无可裁切区域时保持不变", () => {
    const next = dragCoverFraming(start, 25, 40, { width: 100, height: 100 }, { width: 200, height: 100 });
    expect(next.positionX).toBe(25); expect(next.positionY).toBe(50);
  });
  it("竖向拖动与缩放后的移动范围正确，边缘不会露白", () => {
    const next = dragCoverFraming({ ...start, zoom: 2 }, -50, -75, { width: 100, height: 100 }, { width: 100, height: 200 });
    expect(next.positionX).toBe(100); expect(next.positionY).toBe(75);
    const edge = dragCoverFraming(start, 0, 10000, { width: 100, height: 100 }, { width: 100, height: 200 });
    expect(edge.positionY).toBe(0);
  });
  it("图像尚未加载或预览未布局时不改变草稿", () => {
    expect(dragCoverFraming(start, 20, 20, { width: 0, height: 100 }, { width: 200, height: 100 })).toEqual(start);
  });
  it("预览与主区使用同一位置和缩放支点", () => {
    expect(coverFramingStyle({ ...start, positionX: 0, positionY: 100, zoom: 3 })).toEqual({ objectPosition: "0% 100%", transformOrigin: "0% 100%", transform: "scale(3)" });
  });
});
