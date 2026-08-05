import { type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type GlanceTone = "up" | "down" | "flat" | "primary" | "muted";

export interface GlanceMetric {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: GlanceTone;
}

interface Props {
  metrics: GlanceMetric[];
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** When provided, shows expand/collapse-all control */
  allOpen?: boolean;
  onToggleAll?: () => void;
  actions?: ReactNode;
  className?: string;
}

const toneClass: Record<GlanceTone, string> = {
  up: "text-danger",
  down: "text-success",
  flat: "text-muted-foreground",
  primary: "text-primary",
  muted: "text-foreground",
};

/** First-screen summary strip: key metrics + optional refresh / expand-all / actions. */
export function GlanceStrip({
  metrics,
  title,
  subtitle,
  onRefresh,
  refreshing,
  allOpen,
  onToggleAll,
  actions,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "mb-5 rounded-2xl border border-border/60 bg-muted/15 p-3 sm:p-3.5",
        className,
      )}
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {title && <p className="text-sm font-semibold text-foreground">{title}</p>}
          {subtitle && <p className="text-[11px] text-muted-foreground/65">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onToggleAll && (
            <button
              type="button"
              onClick={onToggleAll}
              className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              title={allOpen ? "全部收起" : "全部展开"}
            >
              {allOpen ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
              {allOpen ? "全部收起" : "全部展开"}
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-lg border border-border/50 p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-primary"
              title="刷新"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
          )}
          {actions}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="min-w-0 rounded-xl border border-border/40 bg-card/40 px-2.5 py-2"
          >
            <p className="truncate text-[10px] text-muted-foreground">{m.label}</p>
            <p className={cn("mt-0.5 truncate font-mono text-sm font-bold tabular-nums", toneClass[m.tone ?? "muted"])}>
              {m.value}
            </p>
            {m.sub != null && m.sub !== "" && (
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70">{m.sub}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
