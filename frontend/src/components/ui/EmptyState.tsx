import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Show skeleton instead of the empty copy */
  loading?: boolean;
  /** Prefer table-shaped skeleton for dense data panels */
  skeleton?: "lines" | "table";
  className?: string;
}

/** Composed empty / loading placeholder for data panels. */
export function EmptyState({
  title,
  description,
  action,
  loading,
  skeleton = "lines",
  className,
}: Props) {
  if (loading) {
    return (
      <div className={cn("w-full", className)} role="status" aria-label={title || "加载中"}>
        {skeleton === "table" ? (
          <SkeletonTable rows={5} cols={4} />
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 px-6">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-28" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-10 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-foreground/85">{title}</p>
      {description && (
        <p className="max-w-[42ch] text-xs leading-relaxed text-muted-foreground/70">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
