import { Link } from "react-router-dom";
import { Loader2, Search, Trophy } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { PctChip } from "@/components/review/PctChip";
import { fmt, pctColor } from "@/components/review/format";
import { reviewPending } from "@/components/review/reviewPending";
import type { DailyDragonTiger, IwencaiItem } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  lhb: DailyDragonTiger | null;
  lhbDone: boolean;
  iwencaiReady: boolean;
  iwencaiQ: string;
  onIwencaiQ: (v: string) => void;
  iwencaiBusy: boolean;
  iwencaiErr: string | null;
  iwencaiItems: IwencaiItem[];
  onRunIwencai: () => void;
}

export function ReviewBoardsSeg({
  lhb,
  lhbDone,
  iwencaiReady,
  iwencaiQ,
  onIwencaiQ,
  iwencaiBusy,
  iwencaiErr,
  iwencaiItems,
  onRunIwencai,
}: Props) {
  return (
    <div>
      <SectionHeader
        icon={<Trophy className="h-3.5 w-3.5 text-primary/80" />}
        title="全市场龙虎榜"
        hint="按席位净买额 · 非推荐"
        meta={lhb?.date ? `${lhb.date} · ${lhb.total_records} 条` : (lhbDone ? "暂无" : "加载中…")}
      />
      <GlassCard className="!p-0 overflow-hidden">
        {!lhb || lhb.stocks.length === 0 ? (
          <div className="p-5">{reviewPending(lhbDone)}</div>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {["#", "名称", "涨跌%", "净买(万)", "买入(万)", "卖出(万)", "换手%", "上榜原因"].map((h) => (
                    <th key={h} className={h !== "名称" && h !== "上榜原因" ? "num" : ""}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lhb.stocks.map((s, i) => (
                  <tr key={`${s.code}-${s.reason}-${i}`}>
                    <td className="num text-muted-foreground/50">{i + 1}</td>
                    <td>
                      <Link to={`/a-share?tab=kline&code=${s.code}`} className="hover:text-primary">
                        <span className="font-medium">{s.name}</span>{" "}
                        <span className="text-muted-foreground/50">{s.code}</span>
                      </Link>
                    </td>
                    <td className="num"><PctChip pct={s.change_pct} /></td>
                    <td className={cn("num font-mono", pctColor(s.net_buy_wan))}>
                      {s.net_buy_wan > 0 ? "+" : ""}{fmt(s.net_buy_wan)}
                    </td>
                    <td className="num text-muted-foreground">{fmt(s.buy_wan)}</td>
                    <td className="num text-muted-foreground">{fmt(s.sell_wan)}</td>
                    <td className="num text-muted-foreground">{s.turnover_pct}</td>
                    <td className="max-w-[220px] truncate text-muted-foreground" title={s.reason}>
                      {s.reason || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <div className="mt-6">
        <SectionHeader
          icon={<Search className="h-3.5 w-3.5 text-primary/80" />}
          title="问财研报"
          hint="iwencai NL 主题检索 · 需配置 key"
          meta={iwencaiReady ? "已配置" : "未配置 key"}
        />
        <GlassCard>
          {!iwencaiReady ? (
            <p className="text-sm text-muted-foreground">
              在 <code className="rounded bg-muted/50 px-1">backend/.env</code> 设置{" "}
              <code className="rounded bg-muted/50 px-1">IWENCAI_API_KEY</code> 后重启后端即可语义搜研报
              （如「人形机器人 丝杠」）。按个股搜研报请用详情页东财列表。
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={iwencaiQ}
                  onChange={(e) => onIwencaiQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onRunIwencai()}
                  placeholder="主题关键词，如 人形机器人 行星滚柱丝杠"
                  className="field-input min-w-0 flex-1"
                />
                <button
                  type="button"
                  onClick={onRunIwencai}
                  disabled={iwencaiBusy || !iwencaiQ.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {iwencaiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  搜索
                </button>
              </div>
              {iwencaiErr && (
                <p className="mt-2 text-xs text-destructive">{iwencaiErr}</p>
              )}
              {iwencaiItems.length > 0 && (
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                  {iwencaiItems.map((it, i) => (
                    <div key={`${it.title}-${i}`} className="border-b border-border/40 pb-2 text-sm last:border-0">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{it.publish_date || "—"}</span>
                        <span className="min-w-0 flex-1 font-medium leading-snug">{it.title}</span>
                      </div>
                      {(it.organization || it.url) && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                          {it.organization || ""}
                          {it.url ? (
                            <>
                              {" · "}
                              <a href={it.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">原文</a>
                            </>
                          ) : null}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
