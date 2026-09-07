import type { TdxQuote } from "@/lib/api";
import { isFuturesCode } from "@/lib/quoteHub";
import { cn } from "@/lib/utils";

export function bookPx(v: number) {
  if (!Number.isFinite(v) || v <= 0) return "—";
  return v < 1 ? v.toFixed(3) : v.toFixed(2);
}

export function bookVol(v: number) {
  if (!Number.isFinite(v) || v <= 0) return "—";
  return v >= 10000 ? `${(v / 10000).toFixed(1)} 万` : String(Math.round(v));
}

/** A-share / HK 5-digit / US ticker. Index catalog and futures stay out. */
export function canTdxBook(code: string): boolean {
  const c = (code || "").trim();
  if (!c || isFuturesCode(c)) return false;
  if (/^(?:sh|sz|bj)\d{6}$/i.test(c) || /^\d{6}$/.test(c)) return true;
  if (/^(?:hk)?\d{5}$/i.test(c)) return true;
  if (/^us(?:dji|ixic|inx|vix|soxx)$/i.test(c) || /^hk(?:hsi|hstech)$/i.test(c)) return false;
  if (/^(?:us)?[A-Za-z]{1,5}$/i.test(c)) return true;
  return false;
}

function hasBook(book: TdxQuote) {
  return Boolean((book.bids && book.bids.length) || (book.asks && book.asks.length));
}

export function DepthBook({ book }: { book: TdxQuote }) {
  const bids = book.bids || [];
  const asks = book.asks || [];
  if (!hasBook(book)) return null;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-baseline gap-2">
        <p className="text-xs font-medium text-muted-foreground">五档</p>
        {book.suspended && <span className="text-[11px] text-warning">停牌</span>}
        {book.time && <span className="font-mono text-[10px] text-muted-foreground/60">{book.time}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-0.5">
          {[0, 1, 2, 3, 4].map((i) => {
            const lv = bids[i];
            return (
              <div key={`b${i}`} className="flex justify-between font-mono text-xs">
                <span className="text-muted-foreground">买{i + 1}</span>
                <span className="text-danger">{lv ? bookPx(lv.px) : "—"}</span>
                <span className="text-muted-foreground">{lv ? bookVol(lv.vol) : "—"}</span>
              </div>
            );
          })}
        </div>
        <div className="space-y-0.5">
          {[0, 1, 2, 3, 4].map((i) => {
            const lv = asks[i];
            return (
              <div key={`a${i}`} className="flex justify-between font-mono text-xs">
                <span className="text-muted-foreground">卖{i + 1}</span>
                <span className="text-success">{lv ? bookPx(lv.px) : "—"}</span>
                <span className="text-muted-foreground">{lv ? bookVol(lv.vol) : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Narrow rail for 分时 right side: 卖5..卖1 then 买1..买5. */
export function DepthRail({ book, className }: { book: TdxQuote; className?: string }) {
  const bids = book.bids || [];
  const asks = book.asks || [];
  if (!hasBook(book)) return null;
  return (
    <div className={cn("flex w-[92px] shrink-0 flex-col justify-center gap-0.5 border-l border-white/[0.06] px-1.5 py-1", className)}>
      {[4, 3, 2, 1, 0].map((i) => {
        const lv = asks[i];
        return (
          <div key={`a${i}`} className="flex justify-between font-mono text-[10px] leading-4">
            <span className="text-slate-500">卖{i + 1}</span>
            <span className="text-[#00d26a]">{lv ? bookPx(lv.px) : "—"}</span>
            <span className="text-slate-500">{lv ? bookVol(lv.vol) : "—"}</span>
          </div>
        );
      })}
      <div className="my-0.5 border-t border-white/[0.06]" />
      {[0, 1, 2, 3, 4].map((i) => {
        const lv = bids[i];
        return (
          <div key={`b${i}`} className="flex justify-between font-mono text-[10px] leading-4">
            <span className="text-slate-500">买{i + 1}</span>
            <span className="text-[#ff2d2d]">{lv ? bookPx(lv.px) : "—"}</span>
            <span className="text-slate-500">{lv ? bookVol(lv.vol) : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}
