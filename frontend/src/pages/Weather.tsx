import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { CloudSun, Droplets, Eye, Gauge, MapPin, RefreshCw, Sun, Wind } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, type WeatherDay, type WeatherHourly, type WeatherPayload } from "@/lib/api";
import { storageGet, storageSet } from "@/lib/storage";
import { cn } from "@/lib/utils";

const CITY_KEY = "vr-weather-city";
const DAYS_KEY = "vr-weather-days";
const MODE_KEY = "vr-weather-chart-mode";
const PRESETS = ["上海", "北京", "深圳", "杭州", "香港", "纽约", "伦敦", "东京"];
const DAY_OPTIONS = [7, 10, 14] as const;

function fmtTemp(v: number | null | undefined) {
  return v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}°`;
}

function fmtNum(v: number | null | undefined, suffix = "") {
  return v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}${suffix}`;
}

function weekday(date: string) {
  if (!date) return "";
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("zh-CN", { weekday: "short", month: "numeric", day: "numeric" });
}

function cssHsl(name: string, fallback: string) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : fallback;
}

function labelHour(time: string) {
  // "2026-08-05T15:00" or "2026-08-05T15:00:00"
  const m = time.match(/(\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  return time;
}

function readDays(): number {
  const n = Number(storageGet(DAYS_KEY) || "7");
  return DAY_OPTIONS.includes(n as (typeof DAY_OPTIONS)[number]) ? n : 7;
}

export function Weather() {
  const [city, setCity] = useState(() => storageGet(CITY_KEY) || "上海");
  const [input, setInput] = useState(() => storageGet(CITY_KEY) || "上海");
  const [days, setDays] = useState(readDays);
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chartMode, setChartMode] = useState<"hourly" | "daily">(
    () => (storageGet(MODE_KEY) === "daily" ? "daily" : "hourly"),
  );

  function selectChartMode(mode: "hourly" | "daily") {
    setChartMode(mode);
    storageSet(MODE_KEY, mode);
  }

  async function load(target = city, dayCount = days) {
    const q = target.trim() || "上海";
    setLoading(true);
    setError("");
    try {
      const payload = await api.weather(q, dayCount);
      setData(payload);
      setCity(q);
      setInput(q);
      setDays(dayCount);
      storageSet(CITY_KEY, q);
      storageSet(DAYS_KEY, String(dayCount));
      // Only force daily when hourly series is missing; never override user's choice back to hourly
      if (!(payload.hourly && payload.hourly.length > 1)) {
        setChartMode("daily");
        storageSet(MODE_KEY, "daily");
      }
    } catch (e) {
      setData(null);
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(city, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  const cur = data?.current;
  const hourly = data?.hourly ?? [];
  const hasHourly = hourly.length > 1;

  return (
    <div>
      <PageHeader
        title="天气"
        subtitle="出门看盘前先看天。默认 7 天预报（可切 10/14 天），Open-Meteo 主源，无需 API Key。"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-muted/40 p-0.5 text-xs">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={loading}
                  onClick={() => void load(city, d)}
                  className={cn(
                    "rounded-md px-2.5 py-1 transition-colors disabled:opacity-50",
                    days === d ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {d}天
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load(city, days)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </button>
          </div>
        }
      />

      <GlassCard className="mb-4">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(input);
          }}
        >
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="城市 / 机场代码，如 上海、JFK"
            className="field-input min-w-[200px] flex-1"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-primary/15 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
          >
            查询
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => void load(c)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                city === c
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </GlassCard>

      {error && (
        <GlassCard className="mb-4 border-destructive/40 text-sm text-destructive">
          {error}
        </GlassCard>
      )}

      {data && cur && (
        <div className="space-y-4">
          <GlassCard glow>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{data.location}</p>
                <div className="mt-2 flex items-end gap-3">
                  <CloudSun className="mb-1 h-10 w-10 text-primary" />
                  <span className="text-5xl font-extrabold tracking-tight tabular-nums">
                    {fmtTemp(cur.temp_c)}
                  </span>
                  <div className="mb-1">
                    <p className="text-lg font-medium">{cur.condition || "—"}</p>
                    <p className="text-sm text-muted-foreground">
                      体感 {fmtTemp(cur.feels_like_c)}
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                来源 {data.source}
                {data.fallback_note ? "（已降级）" : ""}
              </p>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Metric icon={Droplets} label="湿度" value={fmtNum(cur.humidity, "%")} />
              <Metric
                icon={Wind}
                label="风力"
                value={
                  cur.wind_kmh == null
                    ? "—"
                    : `${Math.round(cur.wind_kmh)} km/h${cur.wind_dir ? ` ${cur.wind_dir}` : ""}`
                }
              />
              <Metric icon={Droplets} label="降水" value={fmtNum(cur.precip_mm, " mm")} />
              <Metric icon={Eye} label="能见度" value={fmtNum(cur.visibility_km, " km")} />
              <Metric icon={Gauge} label="气压" value={fmtNum(cur.pressure_mb, " mb")} />
              <Metric icon={Sun} label="紫外线" value={fmtNum(cur.uv)} />
            </div>
          </GlassCard>

          {(hasHourly || data.forecast.length > 0) && (
            <GlassCard className="!p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-muted-foreground">气温走势</h2>
                <div className="flex rounded-lg bg-muted/40 p-0.5 text-xs">
                  <button
                    type="button"
                    disabled={!hasHourly}
                    onClick={() => selectChartMode("hourly")}
                    className={cn(
                      "rounded-md px-2.5 py-1 transition-colors disabled:opacity-40",
                      chartMode === "hourly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    逐时
                  </button>
                  <button
                    type="button"
                    onClick={() => selectChartMode("daily")}
                    className={cn(
                      "rounded-md px-2.5 py-1 transition-colors",
                      chartMode === "daily" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    日高/低
                  </button>
                </div>
              </div>
              <TempChart
                mode={chartMode}
                hourly={hourly}
                forecast={data.forecast}
              />
            </GlassCard>
          )}

          {data.forecast.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">未来几天</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.forecast.map((d) => (
                  <GlassCard key={d.date} className="!p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{weekday(d.date)}</span>
                      <span className="font-mono text-xs text-muted-foreground">{d.date}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{d.condition || "—"}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      <span className="text-danger">{fmtTemp(d.max_c)}</span>
                      <span className="mx-1 text-muted-foreground/50">/</span>
                      <span className="text-sky-400">{fmtTemp(d.min_c)}</span>
                    </p>
                    <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
                      <span>降雨 {fmtNum(d.chance_of_rain, "%")}</span>
                      <span>UV {fmtNum(d.uv)}</span>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!data && !error && loading && (
        <GlassCard className="!p-0">
          <EmptyState loading title="正在拉取天气" skeleton="lines" />
        </GlassCard>
      )}

      <Disclaimer />
    </div>
  );
}

function TempChart({
  mode,
  hourly,
  forecast,
}: {
  mode: "hourly" | "daily";
  hourly: WeatherHourly[];
  forecast: WeatherDay[];
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const cText = cssHsl("--muted-foreground", "#94a3b8");
    const cAxis = cssHsl("--border", "#475569");
    const cPrimary = cssHsl("--primary", "#f35d2b");
    const cHi = cssHsl("--danger", "#ef4444");
    const cLo = "#38bdf8";

    if (mode === "hourly" && hourly.length > 1) {
      const labels = hourly.map((h) => labelHour(h.time));
      const temps = hourly.map((h) => h.temp_c);
      const feels = hourly.map((h) => h.feels_like_c);
      const finite = temps.filter((v) => Number.isFinite(v));
      const ymin = Math.min(...finite) - 2;
      const ymax = Math.max(...finite) + 2;

      chart.setOption(
        {
          animationDuration: 400,
          grid: { left: 40, right: 16, top: 28, bottom: 36 },
          tooltip: {
            trigger: "axis",
            backgroundColor: "rgba(15,23,42,0.92)",
            borderColor: "transparent",
            textStyle: { color: "#e2e8f0", fontSize: 12 },
            formatter: (params: unknown) => {
              const list = Array.isArray(params) ? params : [params];
              const first = list[0] as { dataIndex?: number; axisValue?: string };
              const i = first?.dataIndex ?? 0;
              const h = hourly[i];
              if (!h) return "";
              return [
                `<div style="margin-bottom:4px">${labelHour(h.time)}</div>`,
                `气温 <b>${fmtTemp(h.temp_c)}</b>`,
                h.feels_like_c != null ? `体感 ${fmtTemp(h.feels_like_c)}` : "",
                h.condition ? h.condition : "",
              ]
                .filter(Boolean)
                .join("<br/>");
            },
          },
          legend: {
            data: ["气温", "体感"],
            top: 0,
            textStyle: { color: cText, fontSize: 11 },
            itemWidth: 14,
            itemHeight: 8,
          },
          xAxis: {
            type: "category",
            data: labels,
            boundaryGap: false,
            axisLabel: {
              color: cText,
              fontSize: 10,
              interval: Math.max(0, Math.floor(labels.length / 8) - 1),
            },
            axisLine: { lineStyle: { color: cAxis } },
            axisTick: { show: false },
          },
          yAxis: {
            type: "value",
            min: Math.floor(ymin),
            max: Math.ceil(ymax),
            axisLabel: { color: cText, fontSize: 10, formatter: "{value}°" },
            splitLine: { lineStyle: { color: cAxis, opacity: 0.35, type: "dashed" } },
            axisLine: { show: false },
          },
          series: [
            {
              name: "气温",
              type: "line",
              data: temps,
              smooth: true,
              symbol: "circle",
              symbolSize: 5,
              showSymbol: temps.length <= 24,
              lineStyle: { width: 2.5, color: cPrimary },
              itemStyle: { color: cPrimary },
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: "rgba(243,93,43,0.28)" },
                  { offset: 1, color: "rgba(243,93,43,0.02)" },
                ]),
              },
            },
            {
              name: "体感",
              type: "line",
              data: feels,
              smooth: true,
              symbol: "none",
              lineStyle: { width: 1.5, type: "dashed", color: cText, opacity: 0.7 },
            },
          ],
        },
        true,
      );
      return;
    }

    const labels = forecast.map((d) => weekday(d.date));
    const maxs = forecast.map((d) => d.max_c);
    const mins = forecast.map((d) => d.min_c);
    const finite = [...maxs, ...mins].filter((v): v is number => v != null && Number.isFinite(v));
    const ymin = finite.length ? Math.min(...finite) - 2 : 0;
    const ymax = finite.length ? Math.max(...finite) + 2 : 30;

    chart.setOption(
      {
        animationDuration: 400,
        grid: { left: 40, right: 16, top: 28, bottom: 36 },
        tooltip: {
          trigger: "axis",
          backgroundColor: "rgba(15,23,42,0.92)",
          borderColor: "transparent",
          textStyle: { color: "#e2e8f0", fontSize: 12 },
        },
        legend: {
          data: ["最高", "最低"],
          top: 0,
          textStyle: { color: cText, fontSize: 11 },
          itemWidth: 14,
          itemHeight: 8,
        },
        xAxis: {
          type: "category",
          data: labels,
          boundaryGap: false,
          axisLabel: { color: cText, fontSize: 11 },
          axisLine: { lineStyle: { color: cAxis } },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          min: Math.floor(ymin),
          max: Math.ceil(ymax),
          axisLabel: { color: cText, fontSize: 10, formatter: "{value}°" },
          splitLine: { lineStyle: { color: cAxis, opacity: 0.35, type: "dashed" } },
          axisLine: { show: false },
        },
        series: [
          {
            name: "最高",
            type: "line",
            data: maxs,
            smooth: true,
            symbol: "circle",
            symbolSize: 7,
            lineStyle: { width: 2.5, color: cHi },
            itemStyle: { color: cHi },
          },
          {
            name: "最低",
            type: "line",
            data: mins,
            smooth: true,
            symbol: "circle",
            symbolSize: 7,
            lineStyle: { width: 2.5, color: cLo },
            itemStyle: { color: cLo },
          },
        ],
      },
      true,
    );
  }, [mode, hourly, forecast]);

  return <div ref={elRef} className="h-[280px] w-full" />;
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Droplets;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-1 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}
