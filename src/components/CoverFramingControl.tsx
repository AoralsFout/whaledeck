/**
 * @file 窗口控制旁的封面调整把手：滚轮缩放、锁定鼠标拖动与设置入口。
 * 不修改图片文件；对应文档：docs/界面与交互.md §2.1、docs/前端实现.md §4.2.2。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Move } from "lucide-react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { dragCoverFraming } from "../lib/coverFraming";
import { useLibrary } from "../store/useLibrary";
import type { CoverQuickEditor } from "../store/coverQuickEdit";
import type { CoverFraming } from "../types";

/** Pointer Lock 只在鼠标手势内持有，键盘通过设置中的滑杆完成等价调整。 */
export function CoverFramingControl({ editor, disabled }: { editor?: CoverQuickEditor; disabled: boolean }) {
  const button = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const saving = useStore(editor ?? emptyEditor, state => state.saving);
  const openSettings = useCallback(() => {
    const selectedId = useLibrary.getState().selectedId;
    const open = () => {
      const state = useLibrary.getState();
      // 等待滚轮保存期间若切换游戏，不再弹出旧手势触发的设置。
      if (state.selectedId === selectedId) state.openCoverSettings();
    };
    if (editor) void editor.commit().then(open);
    else open();
  }, [editor]);

  useEffect(() => {
    const target = button.current;
    if (!target || !editor || disabled) return;
    let active: { framing: CoverFraming; dx: number; dy: number; moved: boolean;
      view: { width: number; height: number }; image: { width: number; height: number } } | null = null;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    let requesting = false;
    const flush = () => {
      clearTimeout(wheelTimer); wheelTimer = undefined;
      void editor.commit();
    };
    const geometry = () => {
      const main = document.getElementById("main-content");
      const image = main?.querySelector<HTMLImageElement>(".game-cover-art");
      if (!main || !image?.complete || !image.naturalWidth) return null;
      return { view: { width: main.clientWidth, height: main.clientHeight },
        image: { width: image.naturalWidth, height: image.naturalHeight } };
    };
    // 清理先移除手势，再解锁，防止 pointerlockchange 将主动释放误判为取消。
    const finish = (apply: boolean) => {
      const gesture = active;
      active = null;
      if (alive) setDragging(false);
      if (document.pointerLockElement === target) document.exitPointerLock();
      if (!gesture?.moved) return;
      if (apply) void editor.commit(); else editor.cancel();
    };
    const down = (event: MouseEvent) => {
      if (event.button !== 0 || active || requesting) return;
      suppressClick.current = false;
      const size = geometry();
      if (!size) return;
      flush();
      active = { framing: editor.value(), dx: 0, dy: 0, moved: false, ...size };
      requesting = true;
      try {
        Promise.resolve(target.requestPointerLock()).catch(() => {
          if (!alive || !active) return;
          finish(false);
          useLibrary.getState().showToast("error", "无法锁定鼠标，请点击调整把手进入封面设置调整。");
        }).finally(() => {
          requesting = false;
          if ((!alive || !active) && document.pointerLockElement === target) document.exitPointerLock();
        });
      } catch {
        requesting = false;
        finish(false);
        useLibrary.getState().showToast("error", "无法锁定鼠标，请点击调整把手进入封面设置调整。");
      }
    };
    const move = (event: MouseEvent) => {
      if (!active || document.pointerLockElement !== target) return;
      let dx = event.movementX, dy = event.movementY;
      if (!active.moved) {
        active.dx += dx; active.dy += dy;
        if (Math.hypot(active.dx, active.dy) < 3) return;
        dx = active.dx; dy = active.dy;
        active.moved = true;
        setDragging(true);
      }
      suppressClick.current = true;
      // 以裁切后的实际位置逐步移动，丢弃越界余量，让反向移动立即生效。
      active.framing = dragCoverFraming(active.framing, dx, dy, active.view, active.image);
      editor.preview(active.framing);
    };
    const up = (event: MouseEvent) => {
      if (event.button !== 0 || !active) return;
      const clicked = !active.moved;
      // 解锁后 click 可能不再投递到按钮；在释放时完成激活，并去重后续 click。
      suppressClick.current = true;
      finish(true);
      if (clicked) openSettings();
    };
    const cancel = () => {
      if (active) suppressClick.current = true;
      finish(false);
    };
    const lockChanged = () => { if (document.pointerLockElement !== target) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    const wheel = (event: WheelEvent) => {
      if (active || !geometry() || !event.deltaY) return;
      event.preventDefault();
      suppressClick.current = false;
      const current = editor.value();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      const zoom = Math.max(1, Math.min(3, current.zoom - pixels * .001));
      if (zoom === current.zoom) return;
      editor.preview({ ...current, zoom });
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(flush, 250);
    };
    target.addEventListener("mousedown", down);
    target.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.addEventListener("pointerlockchange", lockChanged);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      alive = false;
      target.removeEventListener("mousedown", down);
      target.removeEventListener("wheel", wheel);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("pointerlockchange", lockChanged);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      finish(false);
      if (wheelTimer !== undefined) flush();
    };
  }, [editor, disabled, openSettings]);

  return <button ref={button} type="button" className="window-control cover-framing-control"
    disabled={disabled} data-dragging={dragging} aria-label="调整当前游戏封面" aria-busy={saving}
    title="封面取景：滚轮缩放，按住拖动，点击打开封面设置"
    onClick={event => {
      if (event.detail !== 0 && suppressClick.current) return;
      openSettings();
    }}><Move size={17} aria-hidden="true" /></button>;
}

// 加载期同样保持 Hook 调用顺序；此状态不参与持久化。
const emptyEditor = createStore(() => ({ saving: false }));
