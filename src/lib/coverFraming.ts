/**
 * @file 封面显示取景：兼容缺省参数、共享显示样式及拖动位置换算。
 * 只计算显示范围，不修改图片；对应 docs/数据模型.md §2.1、docs/前端实现.md §4.2.2。
 */
import type { CoverFraming, Game } from "../types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

/** 文件绑定使旧图取景不会误用到新图；旧库与非法数据回到安全的显示范围。 */
export function coverFraming(game: Pick<Game, "coverFile" | "coverFraming">): CoverFraming {
  const saved = game.coverFraming?.file === game.coverFile ? game.coverFraming : null;
  return {
    file: game.coverFile ?? "",
    positionX: clamp(finite(saved?.positionX ?? 50, 50), 0, 100),
    positionY: clamp(finite(saved?.positionY ?? 50, 50), 0, 100),
    zoom: clamp(finite(saved?.zoom ?? 1, 1), 1, 3),
  };
}

/** 同一公式用于预览和实际主区；缩放围绕取景点，边缘位置也不会露出空白。 */
export function coverFramingStyle(framing: CoverFraming) {
  const position = `${framing.positionX}% ${framing.positionY}%`;
  return { objectPosition: position, transform: `scale(${framing.zoom})`, transformOrigin: position };
}

/** 按 cover 后的真实溢出范围换算拖动，不可移动的轴保持原位置。 */
export function dragCoverFraming(
  start: CoverFraming, dx: number, dy: number,
  view: { width: number; height: number }, image: { width: number; height: number },
): CoverFraming {
  if (view.width <= 0 || view.height <= 0 || image.width <= 0 || image.height <= 0) return start;
  const scale = Math.max(view.width / image.width, view.height / image.height) * start.zoom;
  const move = (position: number, delta: number, overflow: number) => overflow > .5 ? clamp(position - delta / overflow * 100, 0, 100) : position;
  return { ...start,
    positionX: move(start.positionX, dx, image.width * scale - view.width),
    positionY: move(start.positionY, dy, image.height * scale - view.height),
  };
}
