/**
 * @file 前端入口：创建 React 根节点，并在 Tauri 环境中标记「首帧准备中」。
 *
 * 标记用于让标题栏/背景在窗口显示前就使用保存的遮罩强度，避免闪一下默认底色。
 * 对应文档：docs/前端实现.md「启动、主题与资源」。
 */
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
if (isTauri()) document.documentElement.dataset.starting = "true";
createRoot(root).render(<App />);
