/**
 * @file 全局通知与超分进度提示，弹窗打开时挂到对话框内。
 *
 * 文案由 store 提供；这里只负责图标、状态色、可访问性与挂载位置。
 * 对应文档：docs/界面与交互.md §4.4。
 */
import { AlertCircle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useLibrary, type ToastKind } from "../store/useLibrary";

const STYLE = {
  success: { icon: CheckCircle2, color: "#34d399", border: "rgba(52,211,153,.35)" },
  error: { icon: AlertCircle, color: "#fb7185", border: "rgba(251,113,133,.4)" },
  info: { icon: Info, color: "var(--primary)", border: "rgba(var(--primary-rgb),.4)" },
} as const;

/** 进度和结果共用外观；进度由任务结束清理，普通通知提供手动关闭。 */
function ToastCard({ kind, text, progress = false, onClose }: { kind: ToastKind; text: string; progress?: boolean; onClose?: () => void }) {
  const conf = STYLE[kind];
  const Icon = progress ? Loader2 : conf.icon;
  return (
    <div
      className="animate-fade-in pointer-events-auto flex max-w-[420px] items-start gap-3 rounded-xl px-4 py-3 shadow-xl"
      role="status" aria-live="polite" aria-atomic="true"
      style={{
        background: "color-mix(in srgb, var(--surface) 92%, transparent)",
        border: `1px solid ${conf.border}`,
        backdropFilter: "blur(14px)",
      }}
    >
      <Icon size={17} style={{ color: conf.color }} className={`mt-0.5 shrink-0${progress ? " animate-spin" : ""}`} aria-hidden="true" />
      <p className="m-0 min-w-0 text-[13px] leading-5 [overflow-wrap:anywhere]" style={{ color: "var(--text)" }}>
        {text}
      </p>
      {onClose && (
        <button
          onClick={onClose}
          className="btn-ghost -mr-1 ml-1 rounded-md p-1"
          aria-label="关闭"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** 纵向排列进度与普通通知；弹窗打开时挂到 dialog 内，避免被顶层遮住。 */
export function Toast() {
  const toast = useLibrary((s) => s.toast);
  const progress = useLibrary((s) => s.superresProgress);
  const hide = useLibrary((s) => s.hideToast);
  const dialogOpen = useLibrary((s) => s.formOpen || s.settingsOpen || s.scanOpen || s.metaOpen);
  if (!toast && !progress) return null;

  return createPortal(
    <div className="toast-position pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {toast && <ToastCard key={toast.id} kind={toast.kind} text={toast.text} onClose={hide} />}
      {progress && <ToastCard key="superres-progress" kind="info" text={progress} progress />}
    </div>,
    (dialogOpen ? document.querySelector("dialog[open]") : null) ?? document.getElementById("root")!,
  );
}
