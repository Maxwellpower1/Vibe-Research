import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  frosted?: boolean;
  onClick?: () => void;
}

/** Cockpit surface. glow / frosted kept as no-op flags so old call sites still typecheck. */
export function GlassCard({ children, className, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-md border border-border/60 bg-card/90 p-3",
        onClick && "cursor-pointer transition-colors hover:border-cyan-500/40",
        className,
      )}
    >
      {children}
    </div>
  );
}
