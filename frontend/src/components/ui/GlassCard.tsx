import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
  /** Soft accent edge wash. Does not enable backdrop blur. */
  glow?: boolean;
  /**
   * Opt into frosted glass (sidebar / overlay language).
   * Dense data panels should stay on the default solid surface.
   */
  frosted?: boolean;
  onClick?: () => void;
}

/** Panel container: solid by default; frosted glass only when explicitly requested. */
export function GlassCard({ children, className, glow, frosted, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "p-5",
        frosted ? "glass" : "surface-panel",
        glow && (frosted ? "glass-glow" : "surface-glow"),
        onClick && "btn-press cursor-pointer hover:-translate-y-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
