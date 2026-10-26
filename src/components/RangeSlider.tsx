/**
 * @file 共用受控数值滑块：计算轨道填充，保留原生输入与键盘语义。
 * 不维护业务状态或保存设置；对应 docs/界面与交互.md §4.2.1、docs/前端实现.md §1。
 */
import type { ComponentPropsWithoutRef, CSSProperties } from "react";

type RangeSliderProps = Omit<ComponentPropsWithoutRef<"input">, "type" | "min" | "max" | "value" | "defaultValue"> & {
  min: number;
  max: number;
  value: number;
};

/** 填充终点补偿原生手柄的半径，使最小、最大及中间数值都与手柄中心对齐。 */
export function RangeSlider({ min, max, value, className = "", style, ...props }: RangeSliderProps) {
  const progress = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  return <input {...props} type="range" min={min} max={max} value={value}
    className={`range-slider ${className}`.trim()}
    style={{ ...style, "--range-fill": `calc(${progress * 100}% + ${9 - progress * 18}px)` } as CSSProperties} />;
}
