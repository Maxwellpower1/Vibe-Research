import type { AiInfraPoint } from "@/lib/api";

export type SeriesKey = "capexB" | "grid" | "costPerM" | "pricePerM" | "roiPct";

export function seriesPath(
  points: AiInfraPoint[],
  key: SeriesKey,
  X: (i: number) => number,
  Y: (v: number) => number,
): { actual: string; forecast: string; bridge: string } {
  let actual = "";
  let forecast = "";
  let cur = "";
  let curActual: boolean | null = null;
  let started = false;
  let lastActualSeg = "";
  let firstForecastSeg = "";
  let sawActual = false;
  let sawForecast = false;
  const flush = () => {
    if (!cur) return;
    if (curActual) actual += cur;
    else forecast += cur;
  };
  for (let i = 0; i < points.length; i++) {
    const v = points[i][key];
    if (v == null || !Number.isFinite(v)) {
      flush();
      cur = "";
      curActual = null;
      started = false;
      continue;
    }
    const a = points[i].actual;
    if (curActual !== a) {
      flush();
      cur = "";
      curActual = a;
      started = false;
    }
    const cmd = started ? "L" : "M";
    cur += `${cmd}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    if (a) {
      lastActualSeg = `${cmd}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      sawActual = true;
    } else if (!sawForecast) {
      firstForecastSeg = `${cmd}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      sawForecast = true;
    }
    started = true;
  }
  flush();
  const bridge =
    sawActual && sawForecast && lastActualSeg.startsWith("L")
      ? `M${lastActualSeg.slice(1)} L${firstForecastSeg.slice(1)}`
      : "";
  return { actual, forecast, bridge };
}
