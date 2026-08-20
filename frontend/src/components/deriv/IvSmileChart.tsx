import { useEffect, useMemo, useRef, useState } from "react";
import type { OvlabTQuoteStrike } from "@/lib/api";
import { LcHoverTag, LcWell } from "@/components/ui/LcFrame";
import {
  LineSeries, LineStyle, UP, DN, createSeriesMarkers, useLcHoverTag, useLcPriceChart, resizeLcHost,
  type ISeriesMarkersPluginApi,
} from "@/lib/lcChart";
import { smilePoints } from "./TQuotePanel";

const SMILE_LINE = {
  lineWidth: 2 as const,
  lastValueVisible: true,
  priceLineVisible: false,
  crosshairMarkerVisible: true,
  priceFormat: { type: "price" as const, precision: 1, minMove: 0.1 },
};

const SPOT_LINE = {
  color: "#38bdf8",
  lineWidth: 1 as const,
  lineStyle: LineStyle.Dashed,
  lastValueVisible: false,
  priceLineVisible: false,
  crosshairMarkerVisible: false,
  priceFormat: { type: "price" as const, precision: 1, minMove: 0.1 },
};

function addSmileLine(chart: NonNullable<ReturnType<typeof useLcPriceChart>["chartRef"]["current"]>, color: string) {
  return chart.addSeries(LineSeries, { ...SMILE_LINE, color });
}

function addSpotLine(chart: NonNullable<ReturnType<typeof useLcPriceChart>["chartRef"]["current"]>) {
  return chart.addSeries(LineSeries, SPOT_LINE);
}

/** Vertical ref at futures/forward. Two x values so LC can draw a stem. */
export function smileSpotPts(
  spot: number | null,
  ivs: number[],
): Array<{ time: number; value: number }> {
  if (spot == null || !Number.isFinite(spot) || ivs.length === 0) return [];
  const lo = Math.min(...ivs);
  const hi = Math.max(...ivs);
  const pad = Math.max((hi - lo) * 0.08, 0.3);
  const eps = Math.max(Math.abs(spot) * 1e-8, 1e-6);
  return [
    { time: spot, value: lo - pad },
    { time: spot + eps, value: hi + pad },
  ];
}

/** T-quote IV smile. X = strike (createOptionsChart). Does not change theo prices. */
export function IvSmileChart({
  strikes,
  fwd,
  keep,
  hideItm,
  spot,
  atm,
}: {
  strikes: OvlabTQuoteStrike[];
  fwd: number | null;
  keep: number | readonly number[] | null;
  hideItm: boolean;
  spot: number | null;
  atm: number | null;
}) {
  const { ref, chartRef, rev, onHoverRef } = useLcPriceChart();
  const [hoverIv, setHoverIv] = useState<number | null>(null);
  onHoverRef.current = setHoverIv;
  const bag = useRef<{
    rev: number;
    call: ReturnType<typeof addSmileLine> | null;
    put: ReturnType<typeof addSmileLine> | null;
    stem: ReturnType<typeof addSpotLine> | null;
  }>({ rev: -1, call: null, put: null, stem: null });
  const atmMarks = useRef<ISeriesMarkersPluginApi<number> | null>(null);
  const { call, put } = useMemo(
    () => smilePoints(strikes, fwd, keep, hideItm),
    [strikes, fwd, keep, hideItm],
  );
  const empty = call.length === 0 && put.length === 0;
  const ivs = useMemo(() => [...call, ...put].map((p) => p.value), [call, put]);
  const stem = useMemo(() => smileSpotPts(spot, ivs), [spot, ivs]);
  const atmIv = useMemo(() => {
    if (atm == null) return null;
    return call.find((p) => p.time === atm)?.value ?? put.find((p) => p.time === atm)?.value ?? null;
  }, [atm, call, put]);
  const { tag: hoverTag, y: tagY } = useLcHoverTag(
    () => bag.current.call ?? bag.current.put,
    hoverIv,
    atmIv,
    (v) => v.toFixed(1),
    rev,
  );

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (bag.current.rev !== rev) {
      bag.current = { rev, call: null, put: null, stem: null };
      atmMarks.current = null;
    }
    if (empty) {
      bag.current.call?.setData([]);
      bag.current.put?.setData([]);
      bag.current.stem?.setData([]);
      atmMarks.current?.setMarkers([]);
      return;
    }
    if (!bag.current.call || !bag.current.put || !bag.current.stem) {
      bag.current.call = addSmileLine(chart, UP);
      bag.current.put = addSmileLine(chart, DN);
      bag.current.stem = addSpotLine(chart);
    }
    bag.current.call.setData(call);
    bag.current.put.setData(put);
    bag.current.stem.setData(stem);
    const marks = atm != null && Number.isFinite(atm)
      ? [{
          time: atm,
          position: "aboveBar" as const,
          shape: "circle" as const,
          color: "#38bdf8",
          text: "ATM",
        }]
      : [];
    if (!atmMarks.current) atmMarks.current = createSeriesMarkers(bag.current.call, marks);
    else atmMarks.current.setMarkers(marks);
    resizeLcHost(chart, ref.current);
    chart.timeScale().fitContent();
  }, [call, put, stem, empty, atm, chartRef, ref, rev]);

  return (
    <div className="shrink-0 px-1.5 pb-1">
      <div className="flex h-5 items-center gap-1.5 font-mono text-[10px] text-slate-500">
        <span className="font-medium text-slate-400">IV微笑</span>
        <span className="text-[#f6465d]">购</span>
        <span className="text-[#0ecb81]">沽</span>
        <span className="text-sky-400">现价</span>
        <span className="text-slate-600">横轴行权价</span>
      </div>
      <LcWell className="h-[128px] rounded-md">
        {empty && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-[11px] text-slate-500">无IV</div>
        )}
        <LcHoverTag tag={hoverTag} y={tagY} />
        <div ref={ref} className="h-full w-full" />
      </LcWell>
    </div>
  );
}
