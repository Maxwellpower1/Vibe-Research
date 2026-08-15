import { Suspense, useEffect } from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { PageFallback } from "@/components/ui/PageFallback";
import { A_SHARE_TABS, CockpitHeader, parseAShareTab } from "@/components/cockpit/CockpitHeader";
import { TickerTape } from "@/components/cockpit/TickerTape";
import { ClsTelegraphBubble } from "@/components/ClsTelegraphBubble";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useTapeQuotes } from "@/hooks/useTapeQuotes";
import { cn } from "@/lib/utils";

const MOBILE_NAV = [
  { to: "/a-share", label: "A股" },
  { to: "/fin", label: "财报" },
  { to: "/us-market", label: "美股" },
  { to: "/ai-watch", label: "AI观察" },
  { to: "/ovlab", label: "期权" },
  { to: "/portfolio", label: "持仓" },
  { to: "/settings", label: "AI" },
];

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

  useEffect(() => {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#070b12] text-slate-200">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        跳到内容
      </a>
      <CockpitHeader isFullscreen={isFullscreen} onToggleFullscreen={toggle} />
      <TickerTape items={tapeItems} />
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-700/40 bg-[#0a101c] px-2 py-1 md:hidden">
        {MOBILE_NAV.map((l) => {
          const active = pathname.startsWith(l.to);
          return (
            <Link
              key={l.to}
              to={l.to}
              className={cn(
                "shrink-0 rounded border px-2 py-0.5 text-[10px]",
                active
                  ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200"
                  : "border-slate-700/60 text-slate-400",
              )}
            >
              {l.label}
            </Link>
          );
        })}
        {pathname.startsWith("/a-share") && (
          <>
            <span className="mx-0.5 h-4 w-px self-center bg-slate-700" />
            {A_SHARE_TABS.map((t) => {
              const aTab = parseAShareTab(params.get("tab"));
              const active = t.tab === null ? aTab === "review" : aTab === t.tab;
              return (
                <Link
                  key={t.label}
                  to={t.to}
                  className={cn(
                    "shrink-0 px-1.5 py-0.5 text-[10px]",
                    active ? "text-cyan-300" : "text-slate-500",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </>
        )}
      </nav>
      <main
        id="main"
        className={cn(
          "min-h-0 flex-1",
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
              pathname.startsWith("/settings") || pathname.startsWith("/weather")
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
      <ClsTelegraphBubble />
    </div>
  );
}
