import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onClose: () => void;
  width?: number;
  title: string;
};

export function Modal({ children, onClose, width = 560, title }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropPointer = useRef<number | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        )).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { e.preventDefault(); return; }
        if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onPointerDown={(e) => {
        backdropPointer.current = e.isPrimary && e.button === 0 && e.target === e.currentTarget
          ? e.pointerId
          : null;
      }}
      onPointerUp={(e) => {
        const startedOutside = backdropPointer.current === e.pointerId;
        backdropPointer.current = null;
        if (!startedOutside || e.button !== 0) return;
        const panel = panelRef.current?.getBoundingClientRect();
        if (!panel) return;
        // Touch can implicitly capture the pointer: use the release coordinates,
        // since its event target can still be the backdrop after moving inside.
        const endedOutside = e.clientX < panel.left || e.clientX > panel.right
          || e.clientY < panel.top || e.clientY > panel.bottom;
        if (endedOutside) onClose();
      }}
      onPointerCancel={() => {
        backdropPointer.current = null;
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel glass animate-pop-in relative w-full overflow-hidden rounded-2xl shadow-2xl"
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </dialog>
  );
}
