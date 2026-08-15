// 关注股票（自选股）—— 只存本地 localStorage，不上传、不进仓库。
// 行情复用 /api/quote；复盘时把关注股行情一并喂给用户自己的 AI。

import { useMemo, useSyncExternalStore } from "react";

const KEY = "vr-watchlist";
export const WATCH_EVENT = "vr-watchlist-changed";

let _ver = 0;
const _subs = new Set<() => void>();

function bump() {
  _ver += 1;
  _subs.forEach((l) => l());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WATCH_EVENT));
  }
}

function subscribe(l: () => void) {
  _subs.add(l);
  return () => _subs.delete(l);
}

export function watchDigits(code: string): string {
  const d = (code || "").replace(/^(sh|sz|bj)/i, "");
  return /^\d{6}$/.test(d) ? d : "";
}

export function loadWatch(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((c) => /^\d{6}$/.test(c)) : [];
  } catch {
    return [];
  }
}

export function saveWatch(codes: string[]) {
  // localStorage 在隐私模式 / 嵌入式浏览器 / 配额写满时会抛异常。
  // 存不下就算了——自选丢失总好过整页崩掉（读取侧同样是 try/catch 兜底）。
  try {
    localStorage.setItem(KEY, JSON.stringify(codes));
  } catch {
    /* 存储不可用：本次会话内仍可正常使用，只是关掉页面后不保留 */
  }
  bump();
}

// 从任意文本里抽取 6 位 A 股代码（逗号 / 空格 / 换号 / 顿号分隔都行，方便一次粘贴一串）。
export function parseCodes(raw: string): string[] {
  const tokens = raw.split(/[^\d]+/).filter(Boolean);
  return Array.from(new Set(tokens.filter((t) => /^\d{6}$/.test(t))));
}

// 把用户输入的一串代码并入已有自选，返回去重后的新列表 + 实际新增数量。
export function addCodes(existing: string[], raw: string): { next: string[]; added: number } {
  const incoming = parseCodes(raw).filter((c) => !existing.includes(c));
  return { next: [...existing, ...incoming], added: incoming.length };
}

export function hasWatch(code: string): boolean {
  const d = watchDigits(code);
  return !!d && loadWatch().includes(d);
}

export function addWatch(code: string): boolean {
  const d = watchDigits(code);
  if (!d) return false;
  const cur = loadWatch();
  if (cur.includes(d)) return false;
  saveWatch([...cur, d]);
  return true;
}

export function removeWatch(code: string): boolean {
  const d = watchDigits(code);
  if (!d) return false;
  const cur = loadWatch();
  const next = cur.filter((c) => c !== d);
  if (next.length === cur.length) return false;
  saveWatch(next);
  return true;
}

export function toggleWatch(code: string): boolean {
  return hasWatch(code) ? (removeWatch(code), false) : (addWatch(code), true);
}

export function useWatchVersion(): number {
  return useSyncExternalStore(subscribe, () => _ver, () => 0);
}

export function useWatchCodes(): string[] {
  const v = useWatchVersion();
  return useMemo(() => loadWatch(), [v]);
}

export function useWatched(code: string): boolean {
  const v = useWatchVersion();
  const d = watchDigits(code);
  return useMemo(() => !!d && loadWatch().includes(d), [v, d]);
}
