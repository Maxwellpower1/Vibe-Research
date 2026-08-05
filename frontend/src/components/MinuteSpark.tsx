import { cn } from "@/lib/utils";

/** Downsample closes for a tiny sparkline. */
export function downsampleCloses(vals: number[], max = 72): number[] {
  if (vals.length <= max) return vals;
  const out: number[] = [];
  const step = (vals.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(vals[Math.round(i * step)]!);
  }
  return out;
}

/** A-share minute spark: red if last >= baseline (prev_close or first), else green. */
export function MinuteSpark({
  closes,
  prevClose,
  width = 72,
  height = 28,
  className,
}: {
  closes: number[];
  prevClose?: number | null;
  width?: number;
  height?: number;
  className?: string;
}) {
  const pad = 1.5;
  if (closes.length < 2) {
    return (
      <svg width={width} height={height} className={cn("text-muted-foreground/35", className)} aria-hidden>
        <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke="currentColor" strokeDasharray="2 2" />
      </svg>
    );
  }

  const baseline = prevClose != null && Number.isFinite(prevClose) ? prevClose : closes[0]!;
  const lo = Math.min(...closes, baseline);
  const hi = Math.max(...closes, baseline);
  const span = hi - lo || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const xAt = (i: number) => pad + (i / (closes.length - 1)) * innerW;
  const yAt = (v: number) => pad + (1 - (v - lo) / span) * innerH;

  const line = closes
    .map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
    .join(" ");
  const last = closes[closes.length - 1]!;
  const up = last >= baseline;
  const stroke = up ? "hsl(var(--danger))" : "hsl(var(--success))";
  const zeroY = yAt(baseline);
  const area = `${line} L${xAt(closes.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${xAt(0).toFixed(1)},${zeroY.toFixed(1)} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <line
        x1={pad}
        y1={zeroY}
        x2={width - pad}
        y2={zeroY}
        stroke="currentColor"
        className="text-muted-foreground/25"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <path d={area} fill={stroke} opacity={0.12} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
