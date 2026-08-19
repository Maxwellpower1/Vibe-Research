/** TradingView-style Lightweight Charts for K/minute cards. ECharts stays on non-time-series. */

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  BaselineSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
  type LineData,
  type WhitespaceData,
  type HistogramData,
  type CandlestickData,
  type SeriesType,
  type Time,
} from "lightweight-charts";

export {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  BaselineSeries,
  createSeriesMarkers,
};
export type { IChartApi, ISeriesApi, MouseEventParams, SeriesType, Time };

/** CN convention, TV saturation. */
export const UP = "#f6465d";
export const DN = "#0ecb81";
export const UP_VOL = "rgba(246,70,93,0.28)";
export const DN_VOL = "rgba(14,203,129,0.28)";
export const IV_COLOR = "#8b7cff";
export const OI_COLOR = "#f0b90b";

const INK = "#c8cdd6";
const GRID = "rgba(255,255,255,0.045)";
const HAIR = "rgba(34,211,238,0.42)";
const TAG = "#1a2330";
const FONT = '"Geist Mono", ui-monospace, monospace';

/** Logical unix seconds so lunch/night gaps stay one bar, not hours of empty axis. */
export const LC_ORIGIN = 1_700_000_000;

export type LcPreset = "desk" | "glance";

export function lcTime(i: number): UTCTimestamp {
  return (LC_ORIGIN + i) as UTCTimestamp;
}

export type TimeLabelMode = "hm" | "md" | "mdhm" | "raw";

export function labelAt(time: unknown, labels: string[]): string {
  if (typeof time === "number") return labels[Math.round(time - LC_ORIGIN)] ?? "";
  if (typeof time === "string") return time;
  return "";
}

export function formatLabel(lab: string, mode: TimeLabelMode): string {
  if (!lab) return "";
  if (mode === "hm") return lab.slice(11, 16) || lab;
  if (mode === "md") return lab.length >= 10 ? lab.slice(5, 10) : lab;
  if (mode === "mdhm") {
    const m = lab.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
    return m ? `${m[2]}-${m[3]} ${m[4]}` : lab;
  }
  return lab;
}

/** Crosshair / leftover echarts axis-pointer -> category index. */
export function hoverIdxFromParam(raw: unknown, n: number): number | null {
  const p = raw as MouseEventParams & {
    currTrigger?: string;
    axesInfo?: Array<{ axisDim?: string; value?: unknown; seriesDataIndices?: Array<{ dataIndex?: number }> }>;
  };
  if (!p) return null;
  if (p.currTrigger === "leave") return null;
  if ("point" in p && p.point == null) return null;
  if (typeof p.logical === "number" && Number.isFinite(p.logical)) {
    const i = Math.round(p.logical);
    return i >= 0 && i < n ? i : null;
  }
  if (typeof p.time === "number") {
    const i = Math.round(p.time - LC_ORIGIN);
    return i >= 0 && i < n ? i : null;
  }
  return null;
}

export function sparseLine(vals: Array<number | null | undefined>): Array<LineData | WhitespaceData> {
  return vals.map((v, i) => {
    const time = lcTime(i);
    if (v == null || !Number.isFinite(v)) return { time };
    return { time, value: v };
  });
}

/** Drop empty slots so the line connects (echarts connectNulls). */
export function finiteLine(vals: Array<number | null | undefined>): LineData[] {
  const out: LineData[] = [];
  vals.forEach((v, i) => {
    if (v != null && Number.isFinite(v) && v > 0) out.push({ time: lcTime(i), value: v });
  });
  return out;
}

export function candleValues(
  bars: Array<{ open: number; high: number; low: number; close: number }>,
): CandlestickData[] {
  return bars.map((b, i) => ({
    time: lcTime(i),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
}

export function volValues(
  pts: Array<{ value: number | null | undefined; up: boolean }>,
  translucent = true,
): Array<HistogramData | WhitespaceData> {
  const upC = translucent ? UP_VOL : UP;
  const dnC = translucent ? DN_VOL : DN;
  return pts.map((p, i) => {
    const time = lcTime(i);
    if (p.value == null || !Number.isFinite(p.value)) return { time };
    return { time, value: p.value, color: p.up ? upC : dnC };
  });
}

const AXIS_BORDER = "rgba(255,255,255,0.14)";

export function candleOpts(_glance = false) {
  return {
    upColor: UP,
    downColor: DN,
    borderVisible: false,
    wickUpColor: UP,
    wickDownColor: DN,
    priceScaleId: "right",
    lastValueVisible: true,
    priceLineVisible: true,
    priceLineWidth: 1 as const,
    priceLineStyle: LineStyle.SparseDotted,
    priceLineColor: UP,
  };
}

export function volOpts() {
  return {
    lastValueVisible: false,
    priceLineVisible: false,
    priceScaleId: "vol",
    priceFormat: { type: "volume" as const },
  };
}

export function baselineOpts(base: number, glance = false) {
  return {
    priceScaleId: "right",
    lastValueVisible: true,
    priceLineVisible: true,
    priceLineWidth: 1 as const,
    priceLineStyle: LineStyle.SparseDotted,
    priceLineColor: UP,
    baseValue: { type: "price" as const, price: base },
    relativeGradient: true,
    topLineColor: UP,
    topFillColor1: "rgba(246,70,93,0.22)",
    topFillColor2: "rgba(246,70,93,0.01)",
    bottomLineColor: DN,
    bottomFillColor1: "rgba(14,203,129,0.22)",
    bottomFillColor2: "rgba(14,203,129,0.01)",
    lineWidth: (glance ? 1 : 2) as 1 | 2,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: glance ? 3 : 4,
    crosshairMarkerBorderWidth: 1,
    crosshairMarkerBorderColor: "#0b0f17",
  };
}

export function overlayLineOpts(color: string, scaleId: string) {
  return {
    color,
    lineWidth: 1 as const,
    priceScaleId: scaleId,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
  };
}

export function createLcChart(el: HTMLElement, preset: LcPreset = "desk"): IChartApi {
  const glance = preset === "glance";
  return createChart(el, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: INK,
      fontSize: glance ? 10 : 11,
      fontFamily: FONT,
      attributionLogo: false,
      panes: { enableResize: false, separatorColor: "rgba(255,255,255,0.06)" },
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: GRID, style: LineStyle.Solid },
    },
    rightPriceScale: {
      visible: true,
      borderVisible: true,
      borderColor: AXIS_BORDER,
      ticksVisible: true,
      alignLabels: true,
      ensureEdgeTickMarksVisible: true,
      scaleMargins: { top: 0.06, bottom: 0.18 },
      textColor: INK,
      minimumWidth: glance ? 52 : 64,
    },
    leftPriceScale: { visible: false },
    timeScale: {
      borderVisible: true,
      borderColor: AXIS_BORDER,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: glance ? 2 : 6,
      ticksVisible: true,
      barSpacing: glance ? 5 : 7,
      minBarSpacing: 3,
    },
    crosshair: {
      mode: glance ? CrosshairMode.Magnet : CrosshairMode.MagnetOHLC,
      vertLine: {
        color: HAIR,
        style: LineStyle.Dashed,
        width: 1,
        labelVisible: true,
        labelBackgroundColor: TAG,
      },
      horzLine: {
        color: HAIR,
        style: LineStyle.Dashed,
        width: 1,
        labelVisible: true,
        labelBackgroundColor: TAG,
      },
    },
    handleScale: { axisPressedMouseMove: { time: true, price: true } },
    handleScroll: { vertTouchDrag: false },
    kineticScroll: { mouse: true, touch: true },
  });
}

export function wipeLc(chart: IChartApi): void {
  for (const pane of chart.panes()) {
    for (const s of [...pane.getSeries()]) chart.removeSeries(s);
  }
  while (chart.panes().length > 1) {
    chart.removePane(chart.panes().length - 1);
  }
}

/** Last-price box on the right scale, TV red/green. */
export function styleLastTag(
  series: ISeriesApi<SeriesType> | null,
  last: number | null | undefined,
  ref: number | null | undefined,
): void {
  if (!series) return;
  const up = last == null || ref == null || !Number.isFinite(last) || !Number.isFinite(ref)
    ? true
    : last >= ref;
  series.applyOptions({
    lastValueVisible: true,
    priceLineVisible: true,
    priceLineColor: up ? UP : DN,
  });
}

/** Volume sits in the bottom of the main pane, TV overlay, not a second chart. */
export function styleVolOverlay(chart: IChartApi, band = 0.2): void {
  const bottom = Math.min(0.28, Math.max(0.16, band));
  try {
    chart.priceScale("right").applyOptions({
      visible: true,
      borderVisible: true,
      ticksVisible: true,
      scaleMargins: { top: 0.06, bottom },
    });
  } catch {
    /* right scale always exists */
  }
  try {
    chart.priceScale("vol").applyOptions({
      visible: false,
      borderVisible: false,
      scaleMargins: { top: 1 - band, bottom: 0 },
    });
  } catch {
    /* scale created with the series */
  }
}

/** OI shares the volume band so the yellow line rides the histograms. */
export function styleOiOverlay(chart: IChartApi, band = 0.18): void {
  try {
    chart.priceScale("oi").applyOptions({
      visible: false,
      borderVisible: false,
      scaleMargins: { top: 1 - band, bottom: 0 },
    });
  } catch {
    /* scale created with the series */
  }
}

/** IV wiggles in the price area, leaving the volume band alone. */
export function styleIvOverlay(chart: IChartApi): void {
  try {
    chart.priceScale("iv").applyOptions({
      visible: false,
      borderVisible: false,
      scaleMargins: { top: 0.08, bottom: 0.28 },
    });
  } catch {
    /* scale created with the series */
  }
}

export function hideOverlayScale(chart: IChartApi, scaleId: string, paneIndex = 0): void {
  try {
    chart.priceScale(scaleId, paneIndex).applyOptions({ visible: false, borderVisible: false });
  } catch {
    /* scale created with the series */
  }
}

export function applyTimeLabels(
  chart: IChartApi,
  labelsRef: { current: string[] },
  mode: TimeLabelMode,
): void {
  const lock = mode === "hm" || mode === "mdhm";
  chart.applyOptions({
    localization: {
      timeFormatter: (t: Time) => formatLabel(labelAt(t, labelsRef.current), mode),
      locale: "zh-CN",
    },
    timeScale: {
      tickMarkFormatter: (t: Time) => formatLabel(labelAt(t, labelsRef.current), mode) || null,
      fixLeftEdge: lock,
      fixRightEdge: lock,
      lockVisibleTimeRangeOnResize: lock,
    },
  });
}

export function showLatest(chart: IChartApi, n: number, view: number): void {
  const ts = chart.timeScale();
  if (n <= 0) return;
  if (n <= view) {
    ts.fitContent();
    return;
  }
  ts.setVisibleLogicalRange({ from: n - view, to: n - 1 + 3 });
}

export function resizeLc(chart: IChartApi, el: HTMLElement | null): void {
  if (!el) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w < 2 || h < 2) return;
  chart.applyOptions({ autoSize: false });
  chart.resize(w, h, true);
  chart.applyOptions({ autoSize: true });
}

export function seriesAlive(chart: IChartApi, s: ISeriesApi<SeriesType> | null): boolean {
  if (!s) return false;
  return chart.panes().some((p) => p.getSeries().some((x) => x === s));
}

/** Chart instance lives as long as the host div; empty pick must not unmount it. */
export function useLcChart(preset: LcPreset = "desk") {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const labelsRef = useRef<string[]>([]);
  const onHoverRef = useRef<(idx: number | null) => void>(() => {});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createLcChart(el, preset);
    chartRef.current = chart;
    const onMove = (param: MouseEventParams) => {
      onHoverRef.current(hoverIdxFromParam(param, labelsRef.current.length));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [preset]);

  return { ref, chartRef, labelsRef, onHoverRef };
}
