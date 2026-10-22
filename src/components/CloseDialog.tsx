/**
 * @file 自定义关闭对话框：首次选择、运行中退出警告与关闭错误。
 *
 * 复用 Modal 的主题、焦点与取消规则；是否退出始终由后端确认，不在此销毁窗口。
 * 对应文档：docs/界面与交互.md §6.1、docs/前端实现.md §4.4。
 */
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useStore } from "zustand";
import { AlertTriangle, X } from "lucide-react";
import { api, onCloseRequested } from "../lib/ipc";
import { createCloseFlow } from "../store/closeFlow";
import { Modal } from "./Modal";

/** 即使库仍在加载也订阅关闭请求，托盘确认与普通关闭共用同一个弹窗。 */
export function CloseDialog() {
  const [store] = useState(() => createCloseFlow({ subscribe: onCloseRequested, snapshot: api.getCloseRequest, resolve: api.resolveCloseRequest }));
  const { request, busy, error, submit } = useStore(store);
  useEffect(() => {
    if (isTauri()) return store.getState().connect();
  }, [store]);
  if (!request) return null;
  const choosing = request.kind === "choose";
  const warning = request.kind === "confirmExit";
  const title = choosing ? "关闭 WhaleDeck 时，你希望…" : warning ? "仍有程序正在运行" : "暂时无法关闭";
  const cancel = () => { if (!busy) void submit("cancel"); };

  return (
    <Modal title={title} onClose={cancel} width={560}>
      <div className="modal-header flex items-center justify-between gap-4 border-b" style={{ borderColor: "var(--border)" }}>
        <h2 className="m-0 flex items-center gap-2 text-[17px] font-semibold">
          {warning && <AlertTriangle size={20} aria-hidden="true" style={{ color: "var(--danger)" }} />}
          {title}
        </h2>
        <button className="btn btn-ghost !p-1 shrink-0" aria-label="取消关闭" onClick={cancel} disabled={busy}><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="modal-body grid gap-4">
        {choosing ? (
          <>
            <p className="hint m-0">选择后会记住你的偏好，可随时在「设置 → 常规 → 关闭行为」修改。</p>
            <div className="grid gap-3">
              <button className="close-behavior-option" disabled={busy} onClick={() => void submit("hide")}>
                <span className="font-medium">后台隐藏</span>
                <span className="hint">隐藏到程序托盘，继续追踪和记录运行时长。</span>
              </button>
              <button className="close-behavior-option" disabled={busy} onClick={() => void submit("exit")}>
                <span className="font-medium">直接关闭</span>
                <span className="hint">退出 WhaleDeck；有程序正在运行时，会再次确认。</span>
              </button>
            </div>
          </>
        ) : warning ? (
          <>
            <p className="m-0">通过启动器运行的 {request.runningCount} 个程序仍在运行。退出 WhaleDeck 后，这些程序会继续运行，但将无法继续追踪和记录运行时长。</p>
            <p className="hint m-0">已运行时长会保存到退出时刻。如需继续记录，请取消退出并选择后台隐藏。</p>
          </>
        ) : <p className="m-0">{request.message}</p>}
        {error && <p className="m-0 text-sm" role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
      <div className="modal-footer flex flex-wrap justify-end gap-2 border-t" style={{ borderColor: "var(--border)" }}>
        <button className="btn" onClick={cancel} disabled={busy}>{warning ? "取消退出" : "取消"}</button>
        {warning && <button className="btn btn-danger" disabled={busy} onClick={() => void submit("confirmExit")}>{busy ? "正在保存…" : "确认退出"}</button>}
      </div>
    </Modal>
  );
}
