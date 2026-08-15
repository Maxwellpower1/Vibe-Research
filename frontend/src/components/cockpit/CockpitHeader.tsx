import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CloudSun, Maximize2, Minimize2 } from "lucide-react";
import { useClock } from "@/hooks/useClock";
import { cn } from "@/lib/utils";

const PAGE_TITLES: { match: (p: string) => boolean; title: string; subtitle: string }[] = [
  { match: (p) => p.startsWith("/fin"), title: "财报窗口", subtitle: "EARNINGS WINDOW" },
  { match: (p) => p.startsWith("/us-market"), title: "美股观察", subtitle: "US MARKET" },
  { match: (p) => p.startsWith("/ai-watch"), title: "AI 观察", subtitle: "AI INDUSTRY WATCH" },
  { match: (p) => p.startsWith("/ovlab"), title: "期权期货", subtitle: "OPTIONS & FUTURES" },
  { match: (p) => p.startsWith("/portfolio"), title: "我的持仓", subtitle: "PORTFOLIO" },
  { match: (p) => p.startsWith("/settings"), title: "接入 AI", subtitle: "YOUR MODEL" },
  { match: (p) => p.startsWith("/weather"), title: "天气", subtitle: "WEATHER" },
];

const DEFAULT_TITLE = { title: "市场研究驾驶舱", subtitle: "MARKET RESEARCH COCKPIT" };

const NAV = [
  { to: "/a-share", label: "A股", match: (p: string) => p.startsWith("/a-share") },
  { to: "/fin", label: "财报窗口", match: (p: string) => p.startsWith("/fin") },
  { to: "/us-market", label: "美股", match: (p: string) => p.startsWith("/us-market") },
  { to: "/ai-watch", label: "AI观察", match: (p: string) => p.startsWith("/ai-watch") },
  { to: "/ovlab", label: "期权期货", match: (p: string) => p.startsWith("/ovlab") },
  { to: "/portfolio", label: "持仓", match: (p: string) => p.startsWith("/portfolio") },
  { to: "/settings", label: "接入 AI", match: (p: string) => p.startsWith("/settings") },
];

export const A_SHARE_TABS = [
  { to: "/a-share", label: "复盘", tab: null as string | null },
  { to: "/a-share?tab=kline", label: "K线", tab: "kline" },
  { to: "/a-share?tab=detail", label: "详情", tab: "detail" },
  { to: "/a-share?tab=feed", label: "公告", tab: "feed" },
];

export function parseAShareTab(raw: string | null): string {
  if (raw === "kline" || raw === "chart" || raw === "stock") return "kline";
  if (raw === "detail" || raw === "feed") return raw;
  return "review";
}

export function CockpitHeader({
  isFullscreen,
  onToggleFullscreen,
  extra,
}: {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  extra?: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const now = useClock(1000);
  const aTab = parseAShareTab(params.get("tab"));
  const onAShare = pathname.startsWith("/a-share");
  const brand = PAGE_TITLES.find((t) => t.match(pathname)) ?? DEFAULT_TITLE;

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-700/50 bg-gradient-to-r from-[#0a1424] via-[#0c1320] to-[#0a1424] px-2 sm:gap-3 sm:px-3">
      <Link to="/a-share" className="flex shrink-0 items-center gap-2">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-cyan-500/15 text-[11px] font-bold text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.35)]">
          V
        </span>
        <h1 className="text-[13px] font-bold tracking-wider text-slate-100">
          {brand.title}
          <span className="ml-2 hidden text-[8px] font-medium tracking-[0.2em] text-cyan-500/80 sm:inline">
            {brand.subtitle}
          </span>
        </h1>
      </Link>
      <div className="mx-0.5 hidden h-4 w-px bg-slate-700 md:block" />
      <nav className="hidden items-center gap-1.5 md:flex">
        {NAV.map((l) => {
          const active = l.match(pathname);
          return (
            <Link
              key={l.to}
              to={l.to}
              className={cn(
                "rounded border px-2 py-0.5 text-[10px] transition-colors",
                active
                  ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200"
                  : "border-slate-700/60 bg-slate-800/40 text-slate-400 hover:border-cyan-500/50 hover:text-cyan-300",
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      {onAShare && (
        <nav className="hidden items-center gap-1 lg:flex">
          {A_SHARE_TABS.map((t) => {
            const active = t.tab === null ? aTab === "review" : aTab === t.tab;
            return (
              <Link
                key={t.label}
                to={t.to}
                className={cn(
                  "px-1.5 text-[10px] transition-colors",
                  active ? "text-cyan-300" : "text-slate-500 hover:text-slate-300",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {extra}
        <span className="hidden items-center gap-1.5 text-[10px] text-emerald-400 sm:flex">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          实时
        </span>
        <span className="hidden text-[10px] tabular-nums text-slate-400 md:inline">
          {dateStr} 星期{week}
        </span>
        <span className="rounded border border-slate-700/60 bg-slate-800/40 px-2 py-px font-mono text-[12px] font-bold text-cyan-300">
          {hh}:{mm}
          <span className="text-cyan-600">:{ss}</span>
        </span>
        <Link
          to="/weather"
          title="天气"
          className="flex h-[22px] w-[22px] items-center justify-center rounded border border-slate-700/60 bg-slate-800/40 text-slate-400 hover:border-cyan-500/60 hover:text-cyan-300"
        >
          <CloudSun size={12} />
        </Link>
        <button
          type="button"
          onClick={onToggleFullscreen}
          title={isFullscreen ? "退出全屏" : "全屏显示"}
          className="flex h-[22px] w-[22px] items-center justify-center rounded border border-slate-700/60 bg-slate-800/40 text-slate-400 hover:border-cyan-500/60 hover:text-cyan-300"
        >
          {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>
    </header>
  );
}
