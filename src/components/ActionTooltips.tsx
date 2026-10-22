import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const OPEN_DELAY = 1000;
const EXPLORE_GRACE = 600;
const HIDE_DELAY = 100;
type Timer = ReturnType<typeof setTimeout> | null;
type ActiveTooltip = { anchor: HTMLElement; text: string };

function findTrigger(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>("button[data-tooltip]") : null;
}

/** One warm-up period for the action row; the buttons keep their native layout. */
export function ActionTooltips({ children, className }: { children: ReactNode; className: string }) {
  const id = useId();
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const popupRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const warm = useRef(false);
  const openTimer = useRef<Timer>(null);
  const hideTimer = useRef<Timer>(null);
  const resetTimer = useRef<Timer>(null);

  const clearTimers = useCallback(() => {
    for (const timer of [openTimer, hideTimer, resetTimer]) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    anchorRef.current = null;
    warm.current = false;
    setActive(null);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  const enter = (anchor: HTMLElement, immediate = false) => {
    clearTimers();
    anchorRef.current = anchor;
    const reveal = () => {
      if (anchorRef.current !== anchor || !anchor.isConnected) return;
      warm.current = true;
      setActive({ anchor, text: anchor.dataset.tooltip ?? "" });
    };
    if (immediate || warm.current) reveal();
    else openTimer.current = setTimeout(reveal, OPEN_DELAY);
  };

  const leave = () => {
    clearTimers();
    // Briefly keep the popup hoverable across the gap above the trigger.
    hideTimer.current = setTimeout(() => {
      anchorRef.current = null;
      setActive(null);
    }, HIDE_DELAY);
    resetTimer.current = setTimeout(() => { warm.current = false; }, EXPLORE_GRACE);
  };

  useLayoutEffect(() => {
    if (!active || !popupRef.current) return;
    const anchor = active.anchor.getBoundingClientRect();
    const popup = popupRef.current.getBoundingClientRect();
    const above = anchor.top - popup.height - 10;
    setPosition({
      left: Math.max(12, Math.min(anchor.left + (anchor.width - popup.width) / 2, window.innerWidth - popup.width - 12)),
      top: Math.max(12, Math.min(above >= 12 ? above : anchor.bottom + 10, window.innerHeight - popup.height - 12)),
    });
    const describedBy = active.anchor.getAttribute("aria-describedby");
    active.anchor.setAttribute("aria-describedby", [describedBy, id].filter(Boolean).join(" "));
    return () => {
      const remaining = (active.anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((value) => value && value !== id);
      if (remaining.length) active.anchor.setAttribute("aria-describedby", remaining.join(" "));
      else active.anchor.removeAttribute("aria-describedby");
    };
  }, [active, id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [dismiss]);

  return (
    <div
      className={className}
      onPointerOver={(event) => {
        if (event.pointerType === "touch") return;
        const anchor = findTrigger(event.target);
        if (anchor && anchor !== findTrigger(event.relatedTarget)) enter(anchor);
      }}
      onPointerOut={(event) => {
        const anchor = findTrigger(event.target);
        if (anchor && anchor === anchorRef.current && anchor !== findTrigger(event.relatedTarget)
          && !anchor.matches(":focus-visible")) leave();
      }}
      onFocusCapture={(event) => {
        const anchor = findTrigger(event.target);
        if (anchor?.matches(":focus-visible")) enter(anchor, true);
      }}
      onBlurCapture={(event) => {
        if (findTrigger(event.target) === anchorRef.current) leave();
      }}
      onClickCapture={dismiss}
    >
      {children}
      {active && createPortal(
        <div
          ref={popupRef}
          id={id}
          role="tooltip"
          className="action-tooltip animate-fade-in"
          style={position}
          onPointerEnter={clearTimers}
          onPointerLeave={leave}
        >
          {active.text}
        </div>,
        document.getElementById("root")!,
      )}
    </div>
  );
}
