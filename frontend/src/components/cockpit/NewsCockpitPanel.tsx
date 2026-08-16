import { useEffect, useRef } from "react";
import { newsTag } from "@/lib/newsTag";
import { itemKey, loadTelegraph, markClsSeen, useTelegraph, type FeedSource } from "@/lib/telegraphHub";
import type { ClsTelegraphItem } from "@/lib/api";
import { cn } from "@/lib/utils";

function TagPills({ title, extra, isNew }: { title: string; extra?: string; isNew?: boolean }) {
  const tag = newsTag(title, extra);
  if (!tag && !isNew) return null;
  return (
    <span className="flex items-center gap-1">
      {tag && (
        <span
          className="rounded-sm px-1 py-px text-[9px] leading-none"
          style={{ background: `${tag.color}22`, color: tag.color }}
        >
          {tag.label}
        </span>
      )}
      {isNew && (
        <span className="rounded-sm bg-cyan-500/20 px-1 py-px text-[9px] leading-none text-cyan-300">NEW</span>
      )}
    </span>
  );
}

function NewsRow({ it, isNew }: { it: ClsTelegraphItem; isNew: boolean }) {
  const extra = it.content || it.summary || "";
  const body = extra && extra !== it.title ? extra : null;
  return (
    <article
      className={cn(
        "rounded border-l-2 px-2 py-1.5",
        isNew ? "border-cyan-400 bg-cyan-500/5" : "border-slate-700/50",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] tabular-nums text-slate-500">
          {(it.time || "").slice(11, 16) || (it.time || "").slice(-8, -3) || "—"}
        </span>
        <TagPills title={it.title} extra={extra} isNew={isNew} />
      </div>
      <p className="mt-0.5 text-[12px] font-semibold leading-5 text-slate-200">{it.title}</p>
      {body && <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.55] text-slate-400">{body}</p>}
    </article>
  );
}

export function NewsFeedBar({
  source,
  auto,
  onSource,
  onAuto,
}: {
  source: FeedSource;
  auto: boolean;
  onSource: (s: FeedSource) => void;
  onAuto: (v: boolean) => void;
}) {
  const snap = useTelegraph();
  const count = (source === "lives" ? snap.lives : snap.cls)?.count;
  return (
    <div className="flex items-center gap-1 text-[10px]">
      {([
        ["cls", "财联社"],
        ["lives", "新浪/见闻"],
      ] as const).map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onSource(k)}
          className={cn(
            "rounded px-1.5 py-0.5",
            source === k ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:text-slate-200",
          )}
        >
          {label}
        </button>
      ))}
      <span className="mx-0.5 h-3 w-px bg-slate-700" />
      <label className="flex cursor-pointer items-center gap-1 text-slate-400">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => onAuto(e.target.checked)}
          className="accent-cyan-400"
        />
        自动滚动{count != null ? ` · ${count}条` : ""}
      </label>
    </div>
  );
}

/** CLS + Sina/Wallstreetcn feed for the review cockpit cell. */
export function NewsCockpitPanel({ source, auto }: { source: FeedSource; auto: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const snap = useTelegraph();
  const data = source === "lives" ? snap.lives : snap.cls;
  const err = snap.err[source];
  const loading = snap.loading[source];
  const fresh = snap.fresh[source];

  useEffect(() => {
    if (source === "lives" && !snap.lives) void loadTelegraph("lives");
  }, [source, snap.lives]);

  useEffect(() => {
    if (snap.cls) markClsSeen();
  }, [snap.cls]);

  useEffect(() => {
    if (!auto || !fresh.size) return;
    boxRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [auto, fresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={boxRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto scroll-smooth p-1.5">
        {err && <p className="px-1 py-4 text-center text-[11px] text-rose-400/80">{err}</p>}
        {loading && !data && <p className="py-6 text-center text-[11px] text-slate-600">加载中…</p>}
        {data && !(data.items?.length) && <p className="py-6 text-center text-[11px] text-slate-600">暂无数据</p>}
        {(data?.items ?? []).map((it, i) => (
          <NewsRow key={itemKey(it, i)} it={it} isNew={fresh.has(itemKey(it, i))} />
        ))}
      </div>
    </div>
  );
}
