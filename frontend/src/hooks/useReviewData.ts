import { useState, useEffect, useCallback, useRef } from "react";
import {
  api, ApiError, type IndexQuote, type MarketOverview, type ShortTermEmotion,
  type DailyDragonTiger, type MonitorPool, type AnomalyPool, type LimitPool, type IndustryData,
  type ThsLimitUpPool, type IwencaiItem, type EtfFlow, type ShareholderChanges,
  type LprData, type CnBondYield, type ReviewSnapshot, type HsgtLive,
  type MarketBreadth,
} from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { useSegment } from "@/components/ui/SegmentNav";
import { formatClock } from "@/lib/freshness";
import { useWatchCodes } from "@/lib/watchlist";

const SEG_KEYS = ["boards", "money", "chain"] as const;

export type ReviewSeg = "boards" | "money" | "chain";
export type LimitKind = "zt" | "zb" | "dt" | "yzt" | "jm";

export function useReviewData() {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [emotion, setEmotion] = useState<ShortTermEmotion | null>(null);
  const [lhb, setLhb] = useState<DailyDragonTiger | null>(null);
  const [monitor, setMonitor] = useState<MonitorPool | null>(null);
  const [anomaly, setAnomaly] = useState<AnomalyPool | null>(null);
  const [limitPool, setLimitPool] = useState<LimitPool | null>(null);
  const [limitKind, setLimitKind] = useState<LimitKind>("zt");
  const [thsLimit, setThsLimit] = useState<ThsLimitUpPool | null>(null);
  const [industry, setIndustry] = useState<IndustryData | null>(null);
  const [iwencaiReady, setIwencaiReady] = useState(false);
  const [iwencaiQ, setIwencaiQ] = useState("");
  const [iwencaiBusy, setIwencaiBusy] = useState(false);
  const [iwencaiErr, setIwencaiErr] = useState<string | null>(null);
  const [iwencaiItems, setIwencaiItems] = useState<IwencaiItem[]>([]);
  const [etfFlow, setEtfFlow] = useState<EtfFlow | null>(null);
  const [etfSort, setEtfSort] = useState<"net_inflow" | "change_pct">("net_inflow");
  const [shChg, setShChg] = useState<ShareholderChanges | null>(null);
  const [shType, setShType] = useState<"all" | "增持" | "减持">("all");
  const [lpr, setLpr] = useState<LprData | null>(null);
  const [bondY, setBondY] = useState<CnBondYield | null>(null);
  const [hsgt, setHsgt] = useState<HsgtLive | null>(null);
  const [moneyDone, setMoneyDone] = useState(false);
  const watchCodes = useWatchCodes();

  const [ovDone, setOvDone] = useState(false);
  const [emoDone, setEmoDone] = useState(false);
  const [lhbDone, setLhbDone] = useState(false);
  const [extraDone, setExtraDone] = useState(false);
  const [topRefreshing, setTopRefreshing] = useState(false);
  const [topUpdatedAt, setTopUpdatedAt] = useState<Date | null>(null);
  const topRefreshingRef = useRef(false);

  const [segRaw, setSeg] = useSegment("ashare.review", [...SEG_KEYS], "boards");
  const seg: ReviewSeg = segRaw === "boards" || segRaw === "chain" ? segRaw : "money";

  const topUpdatedLabel = formatClock(topUpdatedAt, { refreshing: topRefreshing });

  const { data: breadth } = usePolling<MarketBreadth>(
    () => api.marketBreadth(),
    180_000,
    [],
    emoDone,
  );

  const applyPaint = useCallback((s: ReviewSnapshot) => {
    setIndices(s.indices ?? []);
    setHsgt(s.hsgt ?? null);
    setOverview(s.overview ?? null);
    setOvDone(true);
  }, []);

  const applyTop = useCallback((s: ReviewSnapshot) => {
    applyPaint(s);
    setEmotion(s.emotion ?? null);
    setIndustry(s.industry ?? null);
    setEmoDone(true);
  }, [applyPaint]);

  const applyFull = useCallback((s: ReviewSnapshot, kind: LimitKind) => {
    applyTop(s);
    setLhb(s.lhb ?? null);
    setLhbDone(true);
    setMonitor(s.monitor ?? null);
    setAnomaly(s.anomaly ?? null);
    if (kind === "jm") {
      setThsLimit(s.ths_limit_up ?? null);
    } else {
      setLimitPool(s.limit_pool ?? null);
    }
    setExtraDone(true);
  }, [applyTop]);

  const refreshTopRows = useCallback(() => {
    if (topRefreshingRef.current) return;
    topRefreshingRef.current = true;
    setTopRefreshing(true);
    setOvDone(false);
    setEmoDone(false);

    void api.reviewSnapshot({ scope: "top" })
      .then(applyTop)
      .catch(() => {
        setIndices([]);
        setOverview(null);
        setEmotion(null);
        setHsgt(null);
        setOvDone(true);
        setEmoDone(true);
      })
      .finally(() => {
        setTopUpdatedAt(new Date());
        setTopRefreshing(false);
        topRefreshingRef.current = false;
      });
  }, [applyTop]);

  useEffect(() => {
    let cancelled = false;
    setOvDone(false); setEmoDone(false); setLhbDone(false); setExtraDone(false);
    void (async () => {
      const snap = (scope: "paint" | "top" | "full") =>
        api.reviewSnapshot({ scope, limitKind });
      const paintP = snap("paint").then((s) => {
        if (!cancelled) {
          applyPaint(s);
          setTopUpdatedAt(new Date());
        }
      }).catch(() => {
        if (!cancelled) setOvDone(true);
      });
      const topP = snap("top").then((s) => {
        if (!cancelled) applyTop(s);
      }).catch(() => {
        if (!cancelled) setEmoDone(true);
      });
      await paintP;
      await topP;
      if (cancelled) return;
      try {
        const full = await snap("full");
        if (!cancelled) applyFull(full, limitKind);
      } catch {
        if (!cancelled) {
          setLhbDone(true);
          setExtraDone(true);
        }
      } finally {
        if (!cancelled) setTopUpdatedAt(new Date());
      }
    })();
    return () => { cancelled = true; };
    // bootstrap once; limit tab changes use the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const limitBoot = useRef(true);
  useEffect(() => {
    if (limitBoot.current) {
      limitBoot.current = false;
      return;
    }
    if (limitKind === "jm") {
      api.thsLimitUp().then(setThsLimit).catch(() => setThsLimit(null));
      return;
    }
    api.limitPools(limitKind, 40).then(setLimitPool).catch(() => setLimitPool(null));
  }, [limitKind]);

  useEffect(() => {
    let cancelled = false;
    setMoneyDone(false);
    Promise.all([
      api.etfFlow(etfSort, 40).catch(() => null),
      api.shareholderChanges({ changeType: shType, limit: 40 }).catch(() => null),
      api.lpr(730).catch(() => null),
      api.cnBondYield("treasury").catch(() => null),
    ]).then(([ef, sc, lp, by]) => {
      if (cancelled) return;
      setEtfFlow(ef);
      setShChg(sc);
      setLpr(lp);
      setBondY(by);
    }).finally(() => {
      if (!cancelled) setMoneyDone(true);
    });
    return () => { cancelled = true; };
  }, [etfSort, shType]);

  useEffect(() => {
    api.iwencaiStatus().then((s) => setIwencaiReady(!!s.configured)).catch(() => setIwencaiReady(false));
  }, []);

  const runIwencai = useCallback(async () => {
    const q = iwencaiQ.trim();
    if (!q) return;
    setIwencaiBusy(true);
    setIwencaiErr(null);
    try {
      const r = await api.iwencaiSearch(q, "report", 20);
      setIwencaiItems(r.items || []);
      if (!(r.items || []).length) setIwencaiErr("无结果");
    } catch (e) {
      setIwencaiItems([]);
      setIwencaiErr(e instanceof ApiError ? e.message : "问财搜索失败");
    } finally {
      setIwencaiBusy(false);
    }
  }, [iwencaiQ]);

  const p50 = breadth?.p50;
  const dataSummary = (indices.length
    ? indices.map((i) => `${i.name} ${i.price}（${i.change_pct > 0 ? "+" : ""}${i.change_pct}%）`).join("；")
    : "（指数数据未取到）")
    + (p50 != null ? `；全市场中位涨跌 ${p50 > 0 ? "+" : ""}${p50}%（n=${breadth?.n ?? "—"}）` : "");

  return {
    emotion,
    breadth,
    lhb,
    monitor,
    anomaly,
    limitPool,
    limitKind,
    setLimitKind,
    thsLimit,
    iwencaiReady,
    iwencaiQ,
    setIwencaiQ,
    iwencaiBusy,
    iwencaiErr,
    iwencaiItems,
    runIwencai,
    etfFlow,
    etfSort,
    setEtfSort,
    shChg,
    shType,
    setShType,
    lpr,
    bondY,
    hsgt,
    moneyDone,
    watchCodes,
    ovDone,
    emoDone,
    lhbDone,
    extraDone,
    topRefreshing,
    topUpdatedLabel,
    refreshTopRows,
    seg,
    setSeg,
    dataSummary,
    sentiment: overview?.sentiment,
    sectors: overview?.sectors || [],
    indTop: industry?.top?.[0],
    indBot: industry?.bottom?.[0],
  };
}
