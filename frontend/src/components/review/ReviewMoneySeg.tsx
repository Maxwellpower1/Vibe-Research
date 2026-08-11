import { type RefObject } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowDownUp, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeader, ChipGroup, Chip } from "@/components/ui/SectionHeader";
import { PctChip } from "@/components/review/PctChip";
import { fmt, pctColor } from "@/components/review/format";
import { reviewPending } from "@/components/review/reviewPending";
import type {
  BoardFlow, CnBondYield, EtfFlow, LprData, SectorFlow, ShareholderChanges,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  boardFlow: BoardFlow | null;
  boardType: "industry" | "concept" | "region";
  onBoardType: (v: "industry" | "concept" | "region") => void;
  boardPeriod: "today" | "5d" | "10d";
  onBoardPeriod: (v: "today" | "5d" | "10d") => void;
  sectors: SectorFlow[];
  etfFlow: EtfFlow | null;
  etfSort: "net_inflow" | "change_pct";
  onEtfSort: (v: "net_inflow" | "change_pct") => void;
  lpr: LprData | null;
  bondY: CnBondYield | null;
  bondChartRef: RefObject<HTMLDivElement | null>;
  shChg: ShareholderChanges | null;
  shType: "all" | "增持" | "减持";
  onShType: (v: "all" | "增持" | "减持") => void;
  extraDone: boolean;
  ovDone: boolean;
  moneyDone: boolean;
}

export function ReviewMoneySeg({
  boardFlow,
  boardType,
  onBoardType,
  boardPeriod,
  onBoardPeriod,
  sectors,
  etfFlow,
  etfSort,
  onEtfSort,
  lpr,
  bondY,
  bondChartRef,
  shChg,
  shType,
  onShType,
  extraDone,
  ovDone,
  moneyDone,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <SectionHeader
          icon={<TrendingUp className="h-3.5 w-3.5 text-primary/80" />}
          title="板块资金流"
          hint="东财 · 主力净流入"
          meta={boardFlow?.rows?.length ? `${boardFlow.rows.length} 条` : (extraDone ? "暂无" : "加载中…")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ChipGroup>
                {([["industry", "行业"], ["concept", "概念"], ["region", "地域"]] as const).map(([k, label]) => (
                  <Chip key={k} active={boardType === k} onClick={() => onBoardType(k)}>{label}</Chip>
                ))}
              </ChipGroup>
              <ChipGroup>
                {([["today", "今日"], ["5d", "5日"], ["10d", "10日"]] as const).map(([k, label]) => (
                  <Chip key={k} active={boardPeriod === k} onClick={() => onBoardPeriod(k)}>{label}</Chip>
                ))}
              </ChipGroup>
            </div>
          }
        />
        <GlassCard className="!p-0 overflow-hidden">
          {!boardFlow?.rows?.length ? (
            <div className="p-5">{reviewPending(extraDone)}</div>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {["#", "板块", "涨跌%", "主力净流入", "净占比", "领涨股"].map((h) => (
                      <th key={h} className={h !== "板块" && h !== "领涨股" ? "num" : ""}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {boardFlow.rows.map((r) => (
                    <tr key={`${r.code}-${r.name}`}>
                      <td className="num text-muted-foreground/50">{r.rank}</td>
                      <td className="font-medium">{r.name}</td>
                      <td className="num"><PctChip pct={r.change_pct} /></td>
                      <td className={cn("num font-mono", pctColor(r.main_net))}>
                        {r.main_net > 0 ? "+" : ""}{fmt(r.main_net / 1e8)} 亿
                      </td>
                      <td className="num text-muted-foreground">{r.main_pct}%</td>
                      <td className="text-muted-foreground">{r.leader || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>

      <div>
        <SectionHeader
          icon={<ArrowDownUp className="h-3.5 w-3.5 text-primary/80" />}
          title="资金轮动速览"
          hint="行业级净流入 / 流出"
          meta={sectors.length ? `${sectors.length} 行业` : (ovDone ? "暂无" : "加载中…")}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { title: "流入 Top", icon: TrendingUp, color: "text-danger", rows: sectors.slice(0, 6) },
            { title: "流出 Top", icon: TrendingDown, color: "text-success", rows: [...sectors].slice(-6).reverse() },
          ].map((col) => (
            <GlassCard key={col.title} className="!p-4">
              <h4 className={cn("mb-3 flex items-center gap-1.5 text-sm font-semibold", col.color)}>
                <col.icon className="h-4 w-4" /> {col.title}
              </h4>
              {col.rows.length === 0 ? (
                reviewPending(ovDone)
              ) : (
                <div className="space-y-1">
                  {col.rows.map((s, i) => (
                    <div key={s.name} className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm hover:bg-muted/25">
                      <span className="w-5 text-xs text-muted-foreground/45">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <PctChip pct={s.pct} />
                      <span className={cn("w-20 text-right font-mono text-xs", pctColor(s.net))}>{s.net > 0 ? "+" : ""}{fmt(s.net)} 亿</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      </div>

      <div>
        <SectionHeader
          icon={<TrendingUp className="h-3.5 w-3.5 text-primary/80" />}
          title="ETF 资金流"
          hint="东财 · 主力净流入(亿)"
          meta={etfFlow?.rows?.length ? `${etfFlow.rows.length} 只` : (moneyDone ? "暂无" : "加载中…")}
          actions={(
            <ChipGroup>
              {([["net_inflow", "净流入"], ["change_pct", "涨跌幅"]] as const).map(([k, label]) => (
                <Chip key={k} active={etfSort === k} onClick={() => onEtfSort(k)}>{label}</Chip>
              ))}
            </ChipGroup>
          )}
        />
        <GlassCard className="!p-0 overflow-hidden">
          {!etfFlow?.rows?.length ? (
            <div className="p-5">{reviewPending(moneyDone)}</div>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {["#", "代码", "名称", "涨跌%", "主力净流入", "超大单", "大单"].map((h) => (
                      <th key={h} className={h === "名称" || h === "代码" ? "" : "num"}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {etfFlow.rows.map((r, i) => (
                    <tr key={r.code}>
                      <td className="num text-muted-foreground/50">{i + 1}</td>
                      <td className="font-mono text-xs">
                        <Link to={`/a-share?tab=kline&code=${r.code}`} className="hover:text-primary">{r.code}</Link>
                      </td>
                      <td className="font-medium">{r.name}</td>
                      <td className="num"><PctChip pct={r.change_pct} /></td>
                      <td className={cn("num font-mono", pctColor(r.main_net_inflow))}>
                        {r.main_net_inflow > 0 ? "+" : ""}{fmt(r.main_net_inflow)} 亿
                      </td>
                      <td className={cn("num font-mono text-xs", pctColor(r.super_large_net))}>
                        {r.super_large_net > 0 ? "+" : ""}{fmt(r.super_large_net)}
                      </td>
                      <td className={cn("num font-mono text-xs", pctColor(r.large_net))}>
                        {r.large_net > 0 ? "+" : ""}{fmt(r.large_net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
        <p className="mt-1.5 text-[11px] text-muted-foreground/55">客观公开榜单，只呈现事实，不构成买卖建议。</p>
      </div>

      <div>
        <SectionHeader
          icon={<Activity className="h-3.5 w-3.5 text-primary/80" />}
          title="利率 · LPR / 国债"
          hint="中国货币网 · 中债登"
          meta={
            lpr?.latest?.date || bondY?.date
              ? `LPR ${lpr?.latest?.date ?? "—"} · 曲线 ${bondY?.date || "—"}`
              : (moneyDone ? "暂无" : "加载中…")
          }
        />
        <div className="grid gap-4 md:grid-cols-2">
          <GlassCard className="!p-4">
            <h4 className="mb-3 text-sm font-semibold">LPR 报价</h4>
            {!lpr?.latest ? (
              reviewPending(moneyDone)
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-center">
                    <p className="text-[11px] text-muted-foreground">1 年期</p>
                    <p className="mt-1 font-mono text-xl font-bold">{lpr.latest.one_year.toFixed(2)}%</p>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-center">
                    <p className="text-[11px] text-muted-foreground">5 年期以上</p>
                    <p className="mt-1 font-mono text-xl font-bold">{lpr.latest.five_year.toFixed(2)}%</p>
                  </div>
                </div>
                {lpr.rows.length > 1 && (
                  <div className="mt-3 max-h-36 space-y-1 overflow-y-auto border-t border-border/40 pt-2">
                    {lpr.rows.slice(0, 8).map((r) => (
                      <div key={r.date} className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                        <span className="w-24 shrink-0">{r.date}</span>
                        <span className="flex-1">1Y {r.one_year.toFixed(2)}%</span>
                        <span>5Y {r.five_year.toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </GlassCard>
          <GlassCard className="!p-4">
            <h4 className="mb-3 text-sm font-semibold">中债国债收益率</h4>
            {!bondY?.terms || Object.keys(bondY.terms).length === 0 ? (
              reviewPending(moneyDone)
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {(["1Y", "2Y", "5Y", "10Y", "30Y"] as const).map((k) => (
                    <div key={k} className="min-w-[4.5rem] rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2 text-center">
                      <p className="text-[10px] text-muted-foreground">{k}</p>
                      <p className="font-mono text-sm font-semibold">
                        {bondY.terms[k] != null ? `${bondY.terms[k].toFixed(2)}%` : "—"}
                      </p>
                    </div>
                  ))}
                </div>
                {(bondY.curve_points?.length ?? 0) >= 2 && (
                  <div ref={bondChartRef} className="mt-3 h-[140px] w-full min-w-0" />
                )}
                <div className="mt-3 flex flex-wrap gap-3 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                  <span>
                    10Y-2Y{" "}
                    <span className="font-mono text-foreground">
                      {bondY.spread_10_2 == null ? "—" : `${bondY.spread_10_2 > 0 ? "+" : ""}${bondY.spread_10_2.toFixed(2)}`}
                    </span>
                  </span>
                  <span>
                    30Y-10Y{" "}
                    <span className="font-mono text-foreground">
                      {bondY.spread_30_10 == null ? "—" : `${bondY.spread_30_10 > 0 ? "+" : ""}${bondY.spread_30_10.toFixed(2)}`}
                    </span>
                  </span>
                  {bondY.date && <span className="ml-auto">{bondY.date}</span>}
                </div>
              </>
            )}
          </GlassCard>
        </div>
      </div>

      <div>
        <SectionHeader
          icon={<ShieldAlert className="h-3.5 w-3.5 text-primary/80" />}
          title="股东 / 高管增减持"
          hint="东财披露 · 客观呈现"
          meta={shChg?.rows?.length ? `${shChg.rows.length} 条` : (moneyDone ? "暂无" : "加载中…")}
          actions={(
            <ChipGroup>
              {([["all", "全部"], ["增持", "增持"], ["减持", "减持"]] as const).map(([k, label]) => (
                <Chip key={k} active={shType === k} onClick={() => onShType(k)}>{label}</Chip>
              ))}
            </ChipGroup>
          )}
        />
        <GlassCard className="!p-0 overflow-hidden">
          {!shChg?.rows?.length ? (
            <div className="p-5">{reviewPending(moneyDone)}</div>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {["日期", "代码", "名称", "变动人", "方向", "股数", "均价", "职务"].map((h) => (
                      <th key={h} className={h === "股数" || h === "均价" ? "num" : ""}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shChg.rows.map((r, i) => (
                    <tr key={`${r.code}-${r.date}-${r.person}-${i}`}>
                      <td className="font-mono text-xs text-muted-foreground">{r.date}</td>
                      <td className="font-mono text-xs">
                        <Link to={`/a-share?tab=kline&code=${r.code}`} className="hover:text-primary">{r.code}</Link>
                      </td>
                      <td className="font-medium">{r.name}</td>
                      <td className="max-w-[6rem] truncate">{r.person || "—"}</td>
                      <td className={cn("text-xs font-medium", r.change_type === "增持" ? "text-danger" : "text-success")}>
                        {r.change_type}
                      </td>
                      <td className="num font-mono text-xs">
                        {r.change_shares ? `${(r.change_shares / 1e4).toFixed(1)} 万` : "—"}
                      </td>
                      <td className="num font-mono text-xs">{r.avg_price ? fmt(r.avg_price) : "—"}</td>
                      <td className="max-w-[5rem] truncate text-xs text-muted-foreground">{r.position || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
        <p className="mt-1.5 text-[11px] text-muted-foreground/55">公开披露数据，仅供了解变动事实，不构成买卖建议。</p>
      </div>
    </div>
  );
}
