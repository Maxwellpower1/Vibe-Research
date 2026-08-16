import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw, X, Zap } from "lucide-react";
import { api, ApiError, type ClsTelegraph, type ClsTelegraphItem } from "@/lib/api";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30_000;
const TOAST_MS = 3 * 60_000;
const SEEN_KEY = "vr.cls.seenId";
const LIMIT = 40;

type FeedSource = "cls" | "lives";

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) || "";
  } catch {
    return "";
  }
}

function writeSeen(id: string) {
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch { /* ignore */ }
}

function itemKey(it: ClsTelegraphItem, i: number) {
  return String(it.id ?? `${it.time}-${i}`);
}

function countNew(items: ClsTelegraphItem[], seen: string): number {
  if (!items.length) return 0;
  if (!seen) return Math.min(items.length, 9);
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    if (itemKey(items[i], i) === seen) break;
    n += 1;
  }
  return Math.min(n, 99);
}

function collectSince(items: ClsTelegraphItem[], sinceKey: string): ClsTelegraphItem[] {
  if (!sinceKey) return [];
  const out: ClsTelegraphItem[] = [];
  for (let i = 0; i < items.length; i++) {
    if (itemKey(items[i], i) === sinceKey) break;
    out.push(items[i]);
  }
  return out;
}

type ToastState = { count: number; items: ClsTelegraphItem[] };

/** Global floating feed: CLS telegraph + Sina/Wallstreetcn 7x24. */
export function ClsTelegraphBubble() {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<FeedSource>("cls");
  const [data, setData] = useState<ClsTelegraph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const seenRef = useRef(readSeen());
  const openRef = useRef(false);
  const lastTopRef = useRef("");
  const toastTimerRef = useRef<number | null>(null);
  const sourceRef = useRef<FeedSource>("cls");
  openRef.current = open;
  sourceRef.current = source;

  const dismissToast = useCallback(() => {
    setToast(null);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const showToast = useCallback((next: ToastState) => {
    setToast(next);
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_MS);
  }, []);

  const load = useCallback(async (silent = false, feed?: FeedSource) => {
    const src = feed ?? sourceRef.current;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setErr(null);
    try {
      let next: ClsTelegraph;
      if (src === "lives") {
        const lives = await api.marketLives(1, LIMIT);
        next = {
          count: lives.count,
          items: lives.items.map((it) => ({ id: it.id, title: it.title, content: it.content, time: it.time })),
        };
      } else {
        next = await api.clsTelegraph(LIMIT);
      }
      const items = next.items || [];
      const top = items[0] ? itemKey(items[0], 0) : "";

      // Toast / unread badge only for CLS (primary feed)
      if (src === "cls") {
        if (silent && !openRef.current && lastTopRef.current && top && top !== lastTopRef.current) {
          const fresh = collectSince(items, lastTopRef.current);
          if (fresh.length) {
            showToast({ count: fresh.length, items: fresh.slice(0, 3) });
          }
        }
        if (top) lastTopRef.current = top;

        if (!openRef.current) {
          setNewCount(countNew(items, seenRef.current));
        } else if (items.length) {
          seenRef.current = top;
          writeSeen(top);
          setNewCount(0);
          dismissToast();
        }
      }

      if (src === sourceRef.current) setData(next);
    } catch (e) {
      if (!silent && src === sourceRef.current) setData(null);
      if (src === sourceRef.current) setErr(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dismissToast, showToast]);

  useEffect(() => {
    void load(false, source);
  }, [source, load]);

  useEffect(() => {
    const t = window.setInterval(() => void load(true, "cls"), REFRESH_MS);
    return () => {
      window.clearInterval(t);
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, [load]);

  useEffect(() => {
    if (!open || source !== "cls" || !data?.items?.length) return;
    const key = itemKey(data.items[0], 0);
    seenRef.current = key;
    writeSeen(key);
    setNewCount(0);
    dismissToast();
  }, [open, source, data, dismissToast]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openFromToast = () => {
    dismissToast();
    setSource("cls");
    setOpen(true);
  };

  const renderItem = (it: ClsTelegraphItem, i: number) => {
    const body = (it.content || it.summary) && (it.content || it.summary) !== it.title
      ? (it.content || it.summary)
      : null;
    const row = (
      <div className="flex gap-2.5 border-b border-border/40 py-2.5 text-sm last:border-0">
        <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {(it.time || "").slice(11, 16) || (it.time || "").slice(-8, -3) || "—"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug group-hover:text-primary">{it.title}</p>
          {body && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
          )}
        </div>
        {it.share_url && (
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/0 group-hover:text-primary/60" />
        )}
      </div>
    );
    return it.share_url ? (
      <a
        key={itemKey(it, i)}
        href={it.share_url}
        target="_blank"
        rel="noreferrer"
        className="group block"
      >
        {row}
      </a>
    ) : (
      <div key={itemKey(it, i)}>{row}</div>
    );
  };

  const title = source === "lives" ? "新浪/见闻 7×24" : "财联社电报";

  return (
    <>
      {toast && !open && (
        <div className="pointer-events-none fixed right-5 top-5 z-[60] w-[min(22rem,calc(100vw-1.5rem))] sm:right-6 sm:top-6">
          <div
            role="status"
            className="pointer-events-auto overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <p className="min-w-0 flex-1 text-xs font-semibold">
                新电报 · {toast.count} 条
              </p>
              <button
                type="button"
                onClick={dismissToast}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                title="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={openFromToast}
              className="w-full px-3 py-2 text-left transition-colors hover:bg-muted/25"
            >
              {toast.items.map((it, i) => (
                <div key={itemKey(it, i)} className="border-b border-border/30 py-2 last:border-0">
                  <p className="flex gap-2 text-sm">
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {(it.time || "").slice(11, 16) || "—"}
                    </span>
                    <span className="line-clamp-2 font-medium leading-snug">{it.title}</span>
                  </p>
                </div>
              ))}
              {toast.count > toast.items.length && (
                <p className="pt-1.5 text-[11px] text-primary">
                  另有 {toast.count - toast.items.length} 条 · 点此查看全部
                </p>
              )}
              {toast.count <= toast.items.length && (
                <p className="pt-1.5 text-[11px] text-muted-foreground/70">点此打开电报</p>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        {open && (
          <div
            className="pointer-events-auto flex w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-xl backdrop-blur-md"
            role="dialog"
            aria-label={title}
          >
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
              <Zap className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-[10px] text-muted-foreground/65">
                  {data?.count != null ? `${data.count} 条` : "—"} · 客观呈现
                </p>
              </div>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={refreshing || loading}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                title="刷新"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                title="收起"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex gap-1 border-b border-border/40 px-2 py-1.5">
              {([
                { key: "cls" as const, label: "财联社" },
                { key: "lives" as const, label: "新浪/见闻" },
              ]).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setSource(t.key)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    source === t.key
                      ? "bg-primary/15 font-medium text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="max-h-[min(28rem,60vh)] overflow-y-auto px-3">
              {err && (
                <div className="my-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {err}
                </div>
              )}
              {loading && !data ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
                </p>
              ) : !data?.items?.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground/60">暂无数据</p>
              ) : (
                data.items.map(renderItem)
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-card/95 text-primary shadow-lg backdrop-blur-md transition-transform hover:scale-105 hover:border-primary/40",
            open && "border-primary/50 bg-primary/15",
          )}
          title={open ? "收起资讯" : "打开资讯（财联社 / 新浪/见闻）"}
          aria-expanded={open}
        >
          <Zap className="h-6 w-6" />
          {newCount > 0 && !open && (
            <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
              {newCount > 9 ? "9+" : newCount}
            </span>
          )}
          {refreshing && !open && (
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" aria-hidden />
          )}
        </button>
      </div>
    </>
  );
}
