/**
 * @file 展示页项目文本动效；仅改变视觉文本，不改变原文读取或业务状态。
 * 对应文档：docs/前端实现.md §3.1、docs/界面与交互.md §2.2.1。
 */
import { createContext, useContext, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { SCRAMBLE_MS, scrambleCharacters, transitionCharacters } from "../lib/detailTransitions";
import { useReducedMotion } from "../lib/useReducedMotion";
import type { DetailTextTransition } from "../types";

const Motion = createContext<DetailTextTransition>("none");

/** 同一内容生命周期共享偏好，系统设置改变时立即恢复完整原文。 */
export function TextTransitionProvider({ mode, children }: { mode: DetailTextTransition; children: ReactNode }) {
  const reduced = useReducedMotion();
  return <Motion value={reduced ? "none" : mode}>{children}</Motion>;
}

/** 字素节点固定原文字宽，乱码绘制在独立覆盖层，避免跳字、重排或读出随机字符。 */
export function TransitionText({ text }: { text: string }) {
  const mode = useContext(Motion);
  const root = useRef<HTMLSpanElement>(null);
  const { characters, rest } = useMemo(() => transitionCharacters(text), [text]);
  useEffect(() => {
    if (mode !== "scramble") return;
    const nodes = root.current?.querySelectorAll<HTMLElement>("[data-scramble-character]");
    if (!nodes) return;
    let request = 0;
    let start: number | undefined;
    let lastTick = -1;
    const draw = (now: number) => {
      start ??= now;
      const elapsed = now - start;
      const tick = Math.floor(elapsed / 40);
      if (tick !== lastTick || elapsed >= SCRAMBLE_MS) {
        const frame = scrambleCharacters(characters, elapsed / SCRAMBLE_MS, tick);
        nodes.forEach(node => { node.textContent = frame[Number(node.dataset.characterIndex)]; });
        lastTick = tick;
      }
      if (elapsed < SCRAMBLE_MS) request = requestAnimationFrame(draw);
    };
    request = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(request);
      nodes.forEach(node => { node.textContent = characters[Number(node.dataset.characterIndex)]; });
    };
  }, [mode, characters]);

  if (mode === "none") return <>{text}</>;
  if (mode === "fade") return <span className="detail-text-fade">{text}</span>;
  return (
    <span ref={root} className="detail-transition-text" data-text-transition={mode}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {characters.map((character, index) => /^\s+$/u.test(character) ? character : (
          <span key={index} className="detail-character" style={{ "--character-delay": `${180 * index / Math.max(1, characters.length - 1)}ms` } as CSSProperties}>
            {mode === "stagger" ? character : <>
              <span className="detail-character-size">{character}</span>
              <span className="detail-character-glyph" data-scramble-character data-character-index={index}>{character}</span>
            </>}
          </span>
        ))}
        {rest}
      </span>
    </span>
  );
}
