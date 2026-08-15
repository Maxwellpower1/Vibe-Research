import { type ReactNode } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PanelZoomProps {
  panelId?: string;
  isZoomed?: boolean;
  onToggleZoom?: (id: string) => void;
}

interface PanelProps extends PanelZoomProps {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** Terminal-style cockpit panel with optional zoom. */
export function Panel({
  title,
  icon,
  right,
  children,
  className = "",
  bodyClassName = "",
  panelId,
  isZoomed = false,
  onToggleZoom,
}: PanelProps) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-md border bg-[#0c1320]/90 shadow-[0_0_24px_rgba(0,0,0,0.35)] backdrop-blur transition-all duration-300",
        isZoomed
          ? "border-cyan-500/50 shadow-[0_0_32px_rgba(34,211,238,0.18)]"
          : "border-slate-700/40",
        className,
      )}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-slate-700/40 px-2.5">
        <span className="inline-block h-3.5 w-1 shrink-0 rounded-sm bg-cyan-400" />
        {icon && (
          <span className="inline-flex shrink-0 items-center text-cyan-400">{icon}</span>
        )}
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-wide text-slate-200">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          {panelId && onToggleZoom && (
            <button
              type="button"
              onClick={() => onToggleZoom(panelId)}
              title={isZoomed ? "缩小" : "放大"}
              className={cn(
                "flex h-[22px] w-[22px] items-center justify-center rounded border transition-colors",
                isZoomed
                  ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                  : "border-slate-700/60 bg-slate-800/40 text-slate-400 hover:border-cyan-500/60 hover:text-cyan-300",
              )}
            >
              {isZoomed ? <ZoomOut size={12} /> : <ZoomIn size={12} />}
            </button>
          )}
        </div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </section>
  );
}
