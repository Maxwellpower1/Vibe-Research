import { useEffect, useRef } from "react";
import type { OvlabTQuoteStrike } from "@/lib/api";
import { LineSeries, UP, DN, useLcPriceChart, wipeLc, type IChartApi } from "@/lib/lcChart";
import { smilePoints } from "./TQuotePanel";

const SMILE_LINE = {
  lineWidth: 2 as const,
  lastValueVisible: true,
  priceLineVisible: false,
  crosshairMarkerVisible: true,
  priceFormat: { type: "price" as const, precision: 1, minMove: 0.1 },
};

function createCall(chart: NonNullable<ReturnType<typeof useLcPriceChart>["chartRef"]["current"]>, color: string) {
  return chart.addSeries(LineSeries, { ...SMILE_LINE, color });
}

/** T-quote IV smile. X = strike (createOptionsChart). Does not change theo prices. */
export function IvSmileChart({
  strikes,
  fwd,
  keep,
  hideItm,
}: {
  strikes: OvlabTQuoteStrike[];
  fwd: number | null;
  keep: number | readonly number[] | null;
  hideItm: boolean;
}) {
  const { ref, chartRef, rev } = useLcPriceChart();
  const bag = useRef<{
    call: ReturnType<typeof createCall> | null;
    put: ReturnType<typeof createCall> | null;
  }>({ call: null, put: null });

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const host = chart as unknown as IChartApi;
    const { call, put } = smilePoints(strikes, fwd, keep, hideItm);
    if (call.length === 0 && put.length === 0) {
      wipeLc(host);
      bag.current = { call: null, put: null };
      return;
    }
    if (!bag.current.call || !bag.current.put) {
      wipeLc(host);
      bag.current.call = createCall(chart, UP);
      bag.current.put = createCall(chart, DN);
    }
    bag.current.call.setData(call);
    bag.current.put.setData(put);
    chart.timeScale().fitContent();
  }, [strikes, fwd, keep, hideItm, chartRef, rev]);

  return <div ref={ref} className="h-[72px] w-full shrink-0" title="IV微笑 购红/沽绿 横轴行权价" />;
}
