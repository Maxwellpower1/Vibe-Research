import { Suspense, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  CandlestickChart,
  Cpu,
  Database,
  FlaskConical,
  FileSpreadsheet,
  Globe2,
  LineChart,
  MoreHorizontal,
  Plug,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { PageFallback } from "@/components/ui/PageFallback";
import { A_SHARE_TABS, CockpitHeader, PAGE_NAV, parseAShareTab } from "@/components/cockpit/CockpitHeader";
import { TickerTape } from "@/components/cockpit/TickerTape";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useTapeQuotes } from "@/hooks/useTapeQuotes";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/a-share": CandlestickChart,
  "/fin": FileSpreadsheet,
  "/us-market": Globe2,
  "/research": BookOpen,
  "/backtest": FlaskConical,
  "/data": Database,
  "/ai-watch": Cpu,
  "/ovlab": LineChart,
  "/portfolio": Wallet,
  "/settings": Plug,
};

const PRIMARY_NAV = PAGE_NAV.filter((l) => l.primary);
const MORE_NAV = PAGE_NAV.filter((l) => !l.primary);

function isCockpitPath(pathname: string, tab: string | null) {
  if (pathname.startsWith("/ai-watch") || pathname.startsWith("/fin")) return true;
  if (!pathname.startsWith("/a-share")) return false;
  if (!tab || tab === "review") return true;
  return false;
}

export function Layout() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { isFullscreen, toggle } = useFullscreen();
  const tapeItems = useTapeQuotes();
  const cockpit = isCockpitPath(pathname, params.get("tab"));
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_NAV.some((l) => l.match(pathname));
  const aTab = parseAShareTab(params.get("tab"));

  useEffect(() => {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        跳到内容
      </a>
      <CockpitHeader isFullscreen={isFullscreen} onToggleFullscreen={toggle} />
      <TickerTape items={tapeItems} />
      {pathname.startsWith("/a-share") && (
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-background px-2 py-1 lg:hidden"
          aria-label="A股页签"
        >
          {A_SHARE_TABS.map((t) => {
            const active = t.tab === null ? aTab === "review" : aTab === t.tab;
            return (
              <Link
                key={t.label}
                to={t.to}
                className={cn(
                  "shrink-0 rounded px-2 py-0.5 text-[10px]",
                  active ? "bg-cyan-500/10 text-cyan-300" : "text-slate-500",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      )}
      <main
        id="main"
        className={cn(
          "min-h-0 flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0",
          cockpit ? "flex flex-col overflow-auto lg:overflow-hidden" : "overflow-auto",
        )}
      >
        {cockpit ? (
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        ) : (
          <div
            className={cn(
              "mx-auto w-full pb-6 pt-3 px-3 sm:px-4",
              pathname.startsWith("/settings")
                ? "max-w-3xl"
                : "max-w-[1680px]",
            )}
          >
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </div>
        )}
      </main>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-md md:hidden pb-[env(safe-area-inset-bottom)]"
        aria-label="主导航"
      >
        {moreOpen && (
          <div className="absolute bottom-full left-2 right-2 mb-2 rounded-md border border-border bg-card p-1.5 shadow-lg">
            {MORE_NAV.map((l) => {
              const Icon = NAV_ICONS[l.to];
              const active = l.match(pathname);
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className={cn(
                    "flex items-center gap-2 rounded px-3 py-2 text-[13px]",
                    active ? "bg-cyan-500/10 text-cyan-200" : "text-slate-300",
                  )}
                >
                  {Icon ? <Icon className="h-4 w-4" /> : null}
                  {l.label}
                </Link>
              );
            })}
          </div>
        )}
        <div className="flex h-14 items-center justify-around px-1">
          {PRIMARY_NAV.map((l) => {
            const Icon = NAV_ICONS[l.to];
            const active = l.match(pathname);
            return (
              <Link
                key={l.to}
                to={l.to}
                className={cn(
                  "flex min-w-[56px] flex-col items-center justify-center gap-0.5 py-1 text-[10px]",
                  active ? "text-cyan-300" : "text-slate-500",
                )}
              >
                {Icon ? <Icon className="h-5 w-5" /> : null}
                {l.short}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "flex min-w-[56px] flex-col items-center justify-center gap-0.5 py-1 text-[10px]",
              moreOpen || moreActive ? "text-cyan-300" : "text-slate-500",
            )}
            aria-expanded={moreOpen}
            aria-label="更多页面"
          >
            <MoreHorizontal className="h-5 w-5" />
            更多
          </button>
        </div>
      </nav>
    </div>
  );
}
