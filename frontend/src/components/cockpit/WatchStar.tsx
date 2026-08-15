import { Star } from "lucide-react";
import { toggleWatch, useWatched, watchDigits } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

/** Add / remove an A-share from the local watchlist. */
export function WatchStar({ code, className }: { code: string; className?: string }) {
  const digits = watchDigits(code);
  const on = useWatched(digits);
  if (!digits) return null;
  return (
    <button
      type="button"
      aria-label={on ? "移出自选" : "加入自选"}
      title={on ? "移出自选" : "加入自选"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleWatch(digits);
      }}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-slate-700/50",
        className,
      )}
    >
      <Star
        size={12}
        className={on ? "fill-amber-400 text-amber-400" : "text-slate-600 hover:text-amber-300"}
      />
    </button>
  );
}
