import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  icon?: ReactNode;
  title: string;
  hint?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** A股复盘等长页的区块标题: 左侧标题 + 弱提示, 右侧 meta / 操作 */
export function SectionHeader({ icon, title, hint, meta, actions, className }: Props) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-6 w-1 shrink-0 rounded-full bg-primary/70" aria-hidden />
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </h3>
        {hint && <span className="truncate text-[11px] text-muted-foreground/55">{hint}</span>}
      </div>
      {(meta || actions) && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {meta && <span className="text-[11px] text-muted-foreground/50">{meta}</span>}
          {actions}
        </div>
      )}
    </div>
  );
}

interface ChipGroupProps {
  children: ReactNode;
  className?: string;
}

export function ChipGroup({ children, className }: ChipGroupProps) {
  return (
    <div className={cn("inline-flex flex-wrap items-center gap-1 rounded-lg border border-border/50 bg-muted/20 p-0.5", className)}>
      {children}
    </div>
  );
}

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "bg-primary/15 font-medium text-primary shadow-glow"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
