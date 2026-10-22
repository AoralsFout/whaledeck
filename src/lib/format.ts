/**
 * @file 展示格式化：时长、计时、相对时间、路径与文件大小。
 *
 * 所有面向用户的时间/大小文案都从这里产出，避免各组件各写一套。
 * 对应文档：docs/前端实现.md「格式化规则」。
 */

/** 秒 → 人类可读时长 */
export function formatPlaytime(sec: number): string {
  if (sec <= 0) return "未玩过";
  const minutes = Math.floor(sec / 60);
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} 天 ${restHours} 小时` : `${days} 天`;
}

/** 秒 → 计时器样式 HH:MM:SS */
export function formatTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h, m, r].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Unix ms → 相对时间 */
export function formatRelative(ms: number | null): string {
  if (!ms) return "从未玩过";
  const diff = Date.now() - ms;
  if (diff < 0) return "刚刚";
  const sec = diff / 1000;
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day === 1) return "昨天";
  if (day < 30) return `${day} 天前`;
  return formatDate(ms);
}

/** Unix ms → 本地日期 YYYY-MM-DD。 */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 从 exe 路径推断标题：去扩展名 */
export function titleFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.exe$/i, "");
}

/** 从 exe 路径推断工作目录 */
export function dirFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : "";
}

export function shortPath(path: string, max = 46): string {
  if (path.length <= max) return path;
  return "…" + path.slice(-(max - 1));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
