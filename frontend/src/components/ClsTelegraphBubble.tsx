import { useNavigate } from "react-router-dom";
import { Zap } from "lucide-react";
import { markClsSeen, useTelegraph } from "@/lib/telegraphHub";

/** Unread badge only. Feed lives in the review news cell; no popup. */
export function ClsTelegraphBubble() {
  const { newCount, loading, cls } = useTelegraph();
  const navigate = useNavigate();

  const goNews = () => {
    const el = document.getElementById("cockpit-news");
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      markClsSeen();
      return;
    }
    navigate("/a-share");
  };

  return (
    <div className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-50 md:bottom-6 md:right-6">
      <button
        type="button"
        onClick={goNews}
        className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-card/95 text-primary shadow-lg backdrop-blur-md transition-transform hover:scale-105 hover:border-primary/40"
        title="查看实时热点"
      >
        <Zap className="h-6 w-6" />
        {newCount > 0 && (
          <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
            {newCount > 9 ? "9+" : newCount}
          </span>
        )}
        {loading.cls && !cls && (
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" aria-hidden />
        )}
      </button>
    </div>
  );
}
