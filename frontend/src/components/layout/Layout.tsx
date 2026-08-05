import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  Radar, Wallet, Settings, Search, NotebookPen,
  Moon, Sun, ChevronsLeft, ChevronsRight, LineChart, Github, UserRound,
  Star, FileText, Waves, Landmark, CandlestickChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import { storageGet, storageSet } from "@/lib/storage";

const APP_VERSION = "v0.2.2";
const REPO_URL = "https://github.com/simonlin1212/Vibe-Research";
// 作者联系方式
const X_URL = "https://x.com/linsizhen";
const MAIL_URL = "mailto:simonlin0423@gmail.com";

const NAV = [
  { to: "/a-share", icon: CandlestickChart, label: "A股" },
  { to: "/us-market", icon: Landmark, label: "美股" },
  { to: "/ovlab", icon: Waves, label: "期权/期货" },
  { to: "/portfolio", icon: Wallet, label: "我的持仓" },
  { to: "/intel", icon: Radar, label: "资讯雷达" },
  { to: "/stock-data", icon: Search, label: "个股数据" },
  { to: "/watchlist", icon: Star, label: "自选股" },
  { to: "/my-reports", icon: FileText, label: "我的研报" },
  { to: "/notes", icon: NotebookPen, label: "研究记录" },
  { to: "/settings", icon: Settings, label: "接入 AI" },
];

export function Layout() {
  const { pathname } = useLocation();
  const { dark, toggle } = useDarkMode();
  const [collapsed, setCollapsed] = useState(() => storageGet("vr-sidebar") === "collapsed");

  useEffect(() => {
    storageSet("vr-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className={cn(
        "glass z-10 m-2 flex shrink-0 flex-col rounded-2xl transition-all duration-200",
        collapsed ? "w-14" : "w-60",
      )}>
        {/* Brand */}
        <div className={cn("border-b border-border/50", collapsed ? "flex justify-center p-3" : "p-4")}>
          <Link to="/a-share" className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
            <LineChart className="h-6 w-6 shrink-0 text-primary text-glow" />
            {!collapsed && (
              <span className="text-lg font-extrabold tracking-tight">
                Vibe-<span className="text-primary">Research</span>
              </span>
            )}
          </Link>
          {!collapsed && <p className="mt-1 text-[11px] text-muted-foreground">个人 AI 投研系统 · A股/美股/港股</p>}
        </div>

        {/* Nav */}
        <nav className={cn("flex-1 space-y-1 overflow-auto", collapsed ? "p-1.5" : "p-2.5")}>
          {NAV.map(({ to, icon: Icon, label }) => {
            const active = pathname === to || (to === "/a-share" && pathname.startsWith("/a-share"));
            return (
              <Link
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                className={cn(
                  "flex items-center rounded-lg text-sm transition-colors",
                  collapsed ? "justify-center p-2.5" : "gap-2.5 px-3 py-2.5",
                  active
                    ? "bg-primary/15 font-medium text-primary shadow-glow"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={cn("border-t border-border/50", collapsed ? "flex flex-col items-center gap-2 p-2" : "space-y-2 p-3")}>
          {collapsed ? (
            <>
              <button onClick={toggle} className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title={dark ? "亮色" : "暗色"}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <a href={X_URL} target="_blank" rel="noreferrer" className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title="联系作者 · X @linsizhen">
                <UserRound className="h-4 w-4" />
              </a>
              <button onClick={() => setCollapsed(false)} className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title="展开">
                <ChevronsRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button onClick={toggle} className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  {dark ? "亮色" : "暗色"}
                </button>
                <div className="flex items-center gap-2">
                  <a href={X_URL} target="_blank" rel="noreferrer" className="text-muted-foreground transition-colors hover:text-foreground" title="联系作者 · X @linsizhen">
                    <UserRound className="h-3.5 w-3.5" />
                  </a>
                  <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-muted-foreground transition-colors hover:text-foreground" title="GitHub">
                    <Github className="h-3.5 w-3.5" />
                  </a>
                  <button onClick={() => setCollapsed(true)} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground" title="收起">
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-primary/80">
                <span className="text-muted-foreground/60">联系作者</span>
                <a href={X_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-primary">X</a>
                <span className="text-muted-foreground/40">·</span>
                <a href={MAIL_URL} className="transition-colors hover:text-primary">Email</a>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                {APP_VERSION} · 不荐股 · 不预测 · 无倾向
              </p>
            </>
          )}
        </div>
      </aside>

      {/* Main: ovlab tables need a wider canvas; other pages keep the original reading width */}
      <main className="flex-1 overflow-auto">
        <div
          className={cn(
            "mx-auto py-6",
            pathname.startsWith("/ovlab") || pathname.startsWith("/us-market") || pathname.startsWith("/a-share")
              ? "max-w-[1680px] px-3 sm:px-4"
              : "max-w-6xl px-6",
          )}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
