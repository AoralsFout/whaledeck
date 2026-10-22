import { useEffect, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onClose: () => void;
  width?: number;
  align?: "center" | "right";
};

export function Modal({ children, onClose, width = 560 }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
      <div
        className="glass animate-pop-in relative max-h-[88vh] w-full overflow-hidden rounded-2xl shadow-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
