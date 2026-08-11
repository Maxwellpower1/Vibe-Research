import { cn } from "@/lib/utils";

/** Layout-shaped pulse placeholder (prefer over a bare spinner). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted/55", className)}
      aria-hidden
    />
  );
}

/** Compact table-shaped skeleton for data panels. */
export function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5 p-4", className)} role="status" aria-label="加载中">
      <div className="flex gap-2">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={`h-${i}`} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={`r-${r}`} className="flex gap-2">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={`c-${c}`} className="h-7 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
