/** Compact intraday sparkline (SVG). Red up / green down vs prev_close. */
export function MinuteSpark({
  closes,
  prevClose,
  pct,
}: {
  closes: number[];
  prevClose?: number | null;
  pct: number;
}) {
  if (closes.length < 2) {
    return <div className="h-9 w-full rounded bg-muted/25" />;
  }
  const base = prevClose != null && Number.isFinite(prevClose) ? prevClose : closes[0];
  const min = Math.min(...closes, base);
  const max = Math.max(...closes, base);
  const span = max - min || 1;
  const w = 160;
  const h = 36;
  const pts = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * w;
    const y = h - ((c - min) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const y0 = h - ((base - min) / span) * (h - 4) - 2;
  const stroke = pct > 0 ? "#ef4444" : pct < 0 ? "#22c55e" : "#94a3b8";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <line
        x1={0}
        y1={y0}
        x2={w}
        y2={y0}
        stroke="currentColor"
        strokeOpacity={0.18}
        strokeDasharray="3 2"
        className="text-muted-foreground"
      />
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}
