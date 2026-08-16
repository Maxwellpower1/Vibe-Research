import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Loader2, ExternalLink, AlertCircle, Star } from "lucide-react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { api, ApiError, type Announcement, type NewsItem } from "@/lib/api";
import { useQuotes } from "@/lib/quoteHub";
import { loadWatch } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

const FEED_PREVIEW = 8;
const MAX_ROWS = 60;

export interface FeedRow {
  code: string;
  name: string;
  when: string;
  title: string;
  meta?: string;
  url?: string;
}

/** Aggregate announcements / news for local A-share watchlist (no picks, no ranking). */
export function WatchlistFeed({
  kind,
  storageKeyPrefix = "watch.feed",
}: {
  kind: "filings" | "news";
  storageKeyPrefix?: string;
}) {
  const [codes, setCodes] = useState<string[]>(loadWatch);
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [depNote, setDepNote] = useState<string | null>(null);
  const hub = useQuotes(codes);

  const load = useCallback(async (cs: string[]) => {
    if (!cs.length) { setRows([]); return; }
    setLoading(true); setErr(null); setDepNote(null);
    try {
      const out: FeedRow[] = [];
      if (kind === "filings") {
        const res = await Promise.all(
          cs.map((c) => api.announcements(c).then((a) => ({ c, a })).catch(() => ({ c, a: [] as Announcement[] }))),
        );
        for (const { c, a } of res)
          for (const x of a)
            out.push({ code: c, name: c, when: x.date, title: x.title.replace(/^[^:：]*[:：]/, ""), meta: x.type, url: x.url });
      } else {
        let dep: string | null = null;
        const res = await Promise.all(
          cs.map((c) =>
            api.news(c).then((n) => ({ c, n })).catch((e) => {
              if (e instanceof ApiError && e.status === 501) dep = e.message;
              return { c, n: [] as NewsItem[] };
            }),
          ),
        );
        for (const { c, n } of res)
          for (const x of n)
            out.push({ code: c, name: c, when: x.发布时间 || "", title: x.新闻标题 || "", url: x.新闻链接 });
        if (dep && out.length === 0) setDepNote(dep);
      }
      const ts = (s: string) => {
        const raw = (s || "").trim();
        let t = Date.parse(raw);
        if (Number.isNaN(t)) t = Date.parse(raw.replace(" ", "T"));
        return Number.isNaN(t) ? 0 : t;
      };
      out.sort((p, q) => ts(q.when) - ts(p.when));
      setRows(out.slice(0, MAX_ROWS));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { const cs = loadWatch(); setCodes(cs); void load(cs); }, [load]);

  const refresh = () => { const cs = loadWatch(); setCodes(cs); void load(cs); };

  if (!codes.length) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground/70">
        还没有关注股票。到<Link to="/a-share" className="text-primary">「A股 · 每日复盘」</Link>加自选（6 位代码），这里会汇总它们的{kind === "filings" ? "公告" : "新闻"}。
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Star className="h-3.5 w-3.5 text-primary/70" /> 关注 {codes.length} 只 · 共 {rows.length} 条{kind === "filings" ? "公告" : "新闻"}（近期）
        </span>
        <button type="button" onClick={refresh} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {loading ? "拉取中…" : "刷新"}
        </button>
      </div>

      {err && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {depNote ? (
        <p className="py-6 text-center text-xs text-warning">{depNote}（安装后新闻即可用）</p>
      ) : loading && rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 正在汇总关注股的{kind === "filings" ? "公告" : "新闻"}…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground/60">关注列表里的个股近期暂无{kind === "filings" ? "公告" : "新闻"}。</p>
      ) : (
        (() => {
          const renderRow = (r: FeedRow, i: number) => (
            <a key={`${r.code}-${r.when}-${i}`} href={r.url || undefined} target={r.url ? "_blank" : undefined} rel="noreferrer"
              className={cn("group flex items-baseline gap-3 border-b border-border/30 pb-2 text-sm last:border-0", r.url && "cursor-pointer")}>
              <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground/70">{(r.when || "").slice(kind === "filings" ? 0 : 5, kind === "filings" ? 10 : 16)}</span>
              <span className="w-16 shrink-0 truncate text-xs text-primary/90" title={r.code}>{hub[r.code]?.name || r.name}</span>
              {kind === "filings" && r.meta && <span className="hidden w-20 shrink-0 truncate text-xs text-muted-foreground sm:block">{r.meta}</span>}
              <span className="flex-1 group-hover:text-primary">{r.title}</span>
              {r.url && <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/0 group-hover:text-primary/60" />}
            </a>
          );
          const head = rows.slice(0, FEED_PREVIEW);
          const tail = rows.slice(FEED_PREVIEW);
          return (
            <div className="space-y-2">
              {head.map(renderRow)}
              {tail.length > 0 && (
                <CollapsibleSection
                  title="查看全部"
                  storageKey={`${storageKeyPrefix}.${kind}`}
                  defaultOpen={false}
                  summary={`另有 ${tail.length} 条`}
                >
                  <div className="space-y-2">
                    {tail.map((r, i) => renderRow(r, i + FEED_PREVIEW))}
                  </div>
                </CollapsibleSection>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}
