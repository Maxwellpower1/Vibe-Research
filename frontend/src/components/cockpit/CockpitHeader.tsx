import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Maximize2, Minimize2 } from "lucide-react";
import { useClock } from "@/hooks/useClock";
import { cn } from "@/lib/utils";

const PAGE_TITLES: { match: (p: string) => boolean; title: string; subtitle: string; to: string }[] = [
  { match: (p) => p.startsWith("/fin"), title: "财报窗口", subtitle: "EARNINGS WINDOW", to: "/fin" },
  { match: (p) => p.startsWith("/us-market"), title: "美股观察", subtitle: "US MARKET", to: "/us-market" },
  { match: (p) => p.startsWith("/research"), title: "研究桌", subtitle: "RESEARCH DESK", to: "/research" },
  { match: (p) => p.startsWith("/backtest"), title: "回测", subtitle: "BACKTEST", to: "/backtest" },
  { match: (p) => p.startsWith("/data"), title: "本机数据", subtitle: "LOCAL STORE", to: "/data" },
  { match: (p) => p.startsWith("/ai-watch"), title: "AI 观察", subtitle: "AI INDUSTRY WATCH", to: "/ai-watch" },
  { match: (p) => p.startsWith("/derivatives"), title: "期权期货", subtitle: "OPTIONS & FUTURES", to: "/derivatives" },
  { match: (p) => p.startsWith("/portfolio"), title: "我的持仓", subtitle: "PORTFOLIO", to: "/portfolio" },
  { match: (p) => p.startsWith("/settings"), title: "接入 AI", subtitle: "YOUR MODEL", to: "/settings" },
];

const DEFAULT_TITLE = { title: "市场研究驾驶舱", subtitle: "MARKET RESEARCH COCKPIT", to: "/a-share" };

export type PageNavItem = {
  to: string;
  label: string;
  short: string;
  match: (p: string) => boolean;
  primary: boolean;
};

/** Desktop header and phone bottom bar share this list. primary = thumb-row on phone. */
export const PAGE_NAV: PageNavItem[] = [
  { to: "/a-share", label: "A股", short: "A股", match: (p) => p.startsWith("/a-share"), primary: true },
  { to: "/derivatives", label: "期权期货", short: "期权", match: (p) => p.startsWith("/derivatives"), primary: true },
  { to: "/fin", label: "财报窗口", short: "财报", match: (p) => p.startsWith("/fin"), primary: true },
  { to: "/us-market", label: "美股", short: "美股", match: (p) => p.startsWith("/us-market"), primary: true },
  { to: "/research", label: "研究", short: "研究", match: (p) => p.startsWith("/research"), primary: false },
  { to: "/backtest", label: "回测", short: "回测", match: (p) => p.startsWith("/backtest"), primary: true },
  { to: "/data", label: "数据", short: "数据", match: (p) => p.startsWith("/data"), primary: false },
  { to: "/ai-watch", label: "AI观察", short: "AI观察", match: (p) => p.startsWith("/ai-watch"), primary: false },
  { to: "/portfolio", label: "持仓", short: "持仓", match: (p) => p.startsWith("/portfolio"), primary: true },
  { to: "/settings", label: "接入 AI", short: "接入AI", match: (p) => p.startsWith("/settings"), primary: false },
];

export const A_SHARE_TABS = [
  { to: "/a-share", label: "复盘", tab: null as string | null },
  { to: "/a-share?tab=kline", label: "K线", tab: "kline" },
  { to: "/a-share?tab=detail", label: "详情", tab: "detail" },
  { to: "/a-share?tab=feed", label: "公告", tab: "feed" },
];

export const OVL_TABS = [
  { to: "/derivatives", label: "复盘", tab: null as string | null },
  { to: "/derivatives?tab=kline", label: "K线", tab: "kline" },
];

export function parseAShareTab(raw: string | null): string {
  if (raw === "kline" || raw === "chart" || raw === "stock") return "kline";
  if (raw === "detail" || raw === "feed") return raw;
  return "review";
}

export function parseOvlabTab(raw: string | null): string {
  return raw === "kline" ? "kline" : "review";
}

/** Recessed rail for page nav and 复盘/K线. */
export const NAV_RAIL_CLASS =
  "flex min-w-0 items-center gap-px overflow-x-auto rounded-md bg-black/40 p-[3px] ring-1 ring-white/[0.08] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** 12px chip: idle slate-300 (readable), active cyan fill. */
export function navChipClass(active: boolean): string {
  return cn(
    "relative shrink-0 rounded-[5px] px-2.5 py-[5px] text-[12px] font-medium leading-none transition-colors duration-150",
    active
      ? "bg-cyan-400/20 text-cyan-50 shadow-[0_0_0_1px_rgba(34,211,238,0.5),0_0_14px_rgba(34,211,238,0.14)]"
      : "text-slate-300 hover:bg-white/[0.07] hover:text-white",
  );
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
  const oTab = parseOvlabTab(params.get("tab"));
  const onOvlab = pathname.startsWith("/derivatives");
  const brand = PAGE_TITLES.find((t) => t.match(pathname)) ?? DEFAULT_TITLE;

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-background px-2 sm:gap-2.5 sm:px-3">
      <Link to={brand.to} title="返回本区首页" className="flex shrink-0 items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-cyan-400/20 text-[12px] font-bold text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.4)]">
          V
        </span>
        <h1 className="text-[14px] font-semibold tracking-wide text-slate-50">
          {brand.title}
          <span className="ml-2 hidden text-[9px] font-medium tracking-[0.18em] text-cyan-400/70 xl:inline">
            {brand.subtitle}
          </span>
        </h1>
      </Link>
      <div className="mx-0.5 hidden h-5 w-px bg-white/[0.08] md:block" />
      <nav className={cn(NAV_RAIL_CLASS, "hidden flex-1 md:flex")} aria-label="主导航">
        {PAGE_NAV.map((l) => {
          const active = l.match(pathname);
          return (
            <Link
              key={l.to}
              to={l.to}
              prefetch={l.to === "/fin" ? "render" : "intent"}
              aria-current={active ? "page" : undefined}
              className={navChipClass(active)}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      {onAShare && (
        <nav className={cn(NAV_RAIL_CLASS, "hidden shrink-0 lg:flex")} aria-label="A股页签">
          {A_SHARE_TABS.map((t) => {
            const active = t.tab === null ? aTab === "review" : aTab === t.tab;
            return (
              <Link key={t.label} to={t.to} aria-current={active ? "page" : undefined} className={navChipClass(active)}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      )}
      {onOvlab && (
        <nav className={cn(NAV_RAIL_CLASS, "hidden shrink-0 lg:flex")} aria-label="期权期货页签">
          {OVL_TABS.map((t) => {
            const active = t.tab === null ? oTab === "review" : oTab === t.tab;
            return (
              <Link key={t.label} to={t.to} aria-current={active ? "page" : undefined} className={navChipClass(active)}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <div id="cockpit-header-actions" className="flex items-center gap-1.5" />
        {extra}
        <span className="hidden items-center gap-1.5 text-[11px] font-medium text-emerald-400 sm:flex">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          实时
        </span>
        <span className="hidden text-[11px] tabular-nums text-slate-400 lg:inline">
          {dateStr} 星期{week}
        </span>
        <span className="rounded-md border border-white/[0.08] bg-black/30 px-2 py-0.5 font-mono text-[12px] font-bold text-cyan-200">
          {hh}:{mm}
          <span className="text-cyan-600">:{ss}</span>
        </span>
        <button
          type="button"
          onClick={onToggleFullscreen}
          title={isFullscreen ? "退出全屏" : "全屏显示"}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] bg-black/30 text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200"
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
    </header>
  );
}
