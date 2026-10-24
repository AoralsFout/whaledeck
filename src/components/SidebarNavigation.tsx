/**
 * @file 侧栏导航：常驻、边缘呼出、延迟收起、焦点保护与窄屏导航。
 *
 * 只管理临时导航状态，不修改游戏库或外观设置。
 * 对应文档：docs/界面与交互.md §2.1、docs/前端实现.md「组件职责」。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialogOpen: boolean;
  autoHide: boolean;
};

/** 鼠标不抢焦点；隐藏时用 inert 隔离控件，键盘仍可从边缘按钮进入。 */
export function SidebarNavigation({ open, onOpenChange, dialogOpen, autoHide }: Props) {
  const dockRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnFocus = useRef(false);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const pinned = !compact && !autoHide;
  const expanded = pinned || open;
  const previousAutoHide = useRef(autoHide);

  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const reveal = () => {
    cancelHide();
    if (!pinned) onOpenChange(true);
  };

  // 回调执行时重新检查真实焦点与鼠标位置，避免迟到的定时器打断输入或重新进入。
  const scheduleHide = useCallback(() => {
    cancelHide();
    if (pinned || compact || dialogOpen) return;
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      const dock = dockRef.current;
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement && dock?.contains(focused)
        && focused.matches("input, select, textarea, :focus-visible");
      if (!dock?.matches(":hover") && !editing) onOpenChange(false);
    }, 180);
  }, [cancelHide, compact, dialogOpen, onOpenChange, pinned]);

  useEffect(() => cancelHide, [cancelHide]);

  // 窄屏主区在展开时不可见，需等收起提交到 DOM 后才能把焦点还给它。
  useLayoutEffect(() => {
    if (!expanded && returnFocus.current) {
      returnFocus.current = false;
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }
  }, [expanded]);

  // 设置弹窗关闭时会还原焦点到侧栏；切回隐藏式时先保留触发按钮可用。
  useLayoutEffect(() => {
    if (previousAutoHide.current === autoHide) return;
    previousAutoHide.current = autoHide;
    cancelHide();
    // 窄屏始终由按钮控制，切换桌面偏好不能提前隐藏弹窗的返回目标。
    if (compact) return;
    const dock = dockRef.current;
    onOpenChange(autoHide && Boolean(dialogOpen || dock?.matches(":hover") || dock?.contains(document.activeElement)));
  }, [autoHide, cancelHide, compact, dialogOpen, onOpenChange]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const handleChange = () => {
      cancelHide();
      returnFocus.current = (media.matches || autoHide) && Boolean(dockRef.current?.contains(document.activeElement));
      setCompact(media.matches);
      onOpenChange(false);
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [autoHide, cancelHide, onOpenChange]);

  // 弹窗期间保留触发按钮；关闭后再按当前焦点决定是否收起。
  useEffect(() => {
    cancelHide();
    if (!dialogOpen) scheduleHide();
  }, [cancelHide, dialogOpen, scheduleHide]);

  useEffect(() => {
    if (pinned || !open || dialogOpen) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !dockRef.current?.contains(target)
        && !target.closest(".mobile-nav-toggle")) {
        cancelHide();
        onOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [cancelHide, dialogOpen, onOpenChange, open, pinned]);

  const closeToContent = useCallback(() => {
    cancelHide();
    if (pinned) {
      document.getElementById("main-content")?.focus({ preventScroll: true });
      return;
    }
    returnFocus.current = true;
    onOpenChange(false);
  }, [cancelHide, onOpenChange, pinned]);

  // 弹窗与滑入状态改变时保持列表回调身份，避免重新渲染整份游戏库。
  const handleNavigate = useCallback(() => {
    if (compact) closeToContent();
  }, [closeToContent, compact]);

  return (
    <>
      <button className="btn mobile-nav-toggle" aria-label="打开游戏库" aria-expanded={expanded} aria-controls="library-sidebar" onClick={reveal}>
        <Menu size={17} aria-hidden="true" /> 游戏库
      </button>
      <div
        ref={dockRef}
        className="sidebar-dock"
        data-open={expanded}
        onPointerEnter={(event) => { if (!compact && event.pointerType !== "touch") reveal(); }}
        onPointerLeave={(event) => { if (event.pointerType !== "touch") scheduleHide(); }}
        onFocusCapture={reveal}
        onBlurCapture={scheduleHide}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !dialogOpen) {
            event.preventDefault();
            event.stopPropagation();
            closeToContent();
          }
        }}
      >
        <button className="sidebar-reveal" aria-label="打开游戏库" aria-controls="library-sidebar" aria-expanded={expanded} onClick={reveal} />
        <div className="sidebar-panel" inert={!expanded}>
          <Sidebar onNavigate={handleNavigate} />
        </div>
      </div>
    </>
  );
}
