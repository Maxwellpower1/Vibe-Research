import { useId } from "react";
import { sparkXs, type SparkSession } from "@/lib/sparkAxis";

/** Compact intraday sparkline (SVG). Soft red/green vs prev_close, gradient fill. */
export function MinuteSpark({
  closes,
  times,
  session = "ashare",
  prevClose,
  pct,
  className,
  emptyLabel,
}: {
  closes: number[];
  times?: string[];
  session?: SparkSession;
  prevClose?: number | null;
  pct: number;
  className?: string;
  emptyLabel?: string;
}) {
  const gradId = `ms-${useId().replace(/:/g, "")}`;
  const label = emptyLabel ?? (session === "h24" ? "—" : "休市");
  if (closes.length < 2) {
    return (
      <div
        className={`flex h-7 w-full items-center justify-center text-[10px] text-slate-600 ${className ?? ""}`}
      >
        {label}
      </div>
    );
  }
  const base = prevClose != null && Number.isFinite(prevClose) ? prevClose : closes[0];
  let min = Math.min(...closes, base);
  let max = Math.max(...closes, base);
  if (max - min < 1e-9) {
    max += 1;
    min -= 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;
  const span = max - min;
  const w = 160;
  const h = 36;
  const xs = sparkXs(times, closes.length, w, session);
  const yAt = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const pts = closes.map((c, i) => `${xs[i].toFixed(1)},${yAt(c).toFixed(1)}`).join(" ");
  const area = `${xs[0].toFixed(1)},${h - 1} ${pts} ${xs[xs.length - 1].toFixed(1)},${h - 1}`;
  const y0 = yAt(base);
  const stroke = pct > 0 ? "#fda4af" : pct < 0 ? "#6ee7b7" : "#cbd5e1";
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`h-7 w-full ${className ?? ""}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity={0.38} />
          <stop offset="1" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <line
        x1={1}
        y1={y0}
        x2={w - 1}
        y2={y0}
        stroke="currentColor"
        strokeOpacity={0.22}
        strokeWidth={0.8}
        strokeDasharray="2 3"
        className="text-muted-foreground"
      />
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        points={pts}
      />
    </svg>
  );
}
