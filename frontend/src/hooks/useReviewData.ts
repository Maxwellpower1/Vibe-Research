import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  api, type IndexQuote, type MarketOverview, type ShortTermEmotion,
  type DailyDragonTiger, type IndustryData,
  type EtfFlow, type EtfShares, ETF_SHARE_WATCH, type ShareholderChanges,
  type LprData, type CnBondYield, type ReviewSnapshot, type HsgtLive,
  type MarketBreadth,
} from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { useSegment } from "@/components/ui/SegmentNav";
import { formatClock } from "@/lib/freshness";
import { buildReviewContext, type ReviewContextInput } from "@/lib/reviewContext";
import { useWatchCodes } from "@/lib/watchlist";

const SEG_KEYS = ["boards", "money", "chain"] as const;

export type ReviewSeg = "boards" | "money" | "chain";

export function useReviewData() {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [emotion, setEmotion] = useState<ShortTermEmotion | null>(null);
  const [lhb, setLhb] = useState<DailyDragonTiger | null>(null);
  const [industry, setIndustry] = useState<IndustryData | null>(null);
  const [etfFlow, setEtfFlow] = useState<EtfFlow | null>(null);
  const [etfShares, setEtfShares] = useState<EtfShares | null>(null);
  const [etfSharesList, setEtfSharesList] = useState<EtfShares[]>([]);
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

  const applyFull = useCallback((s: ReviewSnapshot) => {
    applyTop(s);
    setLhb(s.lhb ?? null);
    setLhbDone(true);
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
    setOvDone(false); setEmoDone(false); setLhbDone(false);
    void (async () => {
      const snap = (scope: "paint" | "top" | "full") =>
        api.reviewSnapshot({ scope });
      const paintP = snap("paint").then((s) => {
        if (!cancelled) {
          applyPaint(s);
          setTopUpdatedAt(new Date());
        }
      }).catch(() => {
        if (!cancelled) setOvDone(true);
      });
      await paintP;
      if (cancelled) return;
      const topP = snap("top").then((s) => {
        if (!cancelled) applyTop(s);
      }).catch(() => {
        if (!cancelled) setEmoDone(true);
      });
      await topP;
      if (cancelled) return;
      try {
        const full = await snap("full");
        if (!cancelled) applyFull(full);
      } catch {
        if (!cancelled) {
          setLhbDone(true);
        }
      } finally {
        if (!cancelled) setTopUpdatedAt(new Date());
      }
    })();
    return () => { cancelled = true; };
    // bootstrap once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    let cancelled = false;
    api.etfSharesBatch(ETF_SHARE_WATCH.map((x) => x.code), 80).then((d) => {
      if (cancelled) return;
      const items = d.items ?? [];
      setEtfSharesList(items);
      setEtfShares(items.find((x) => x.code === "510300") ?? items[0] ?? null);
    }).catch(() => {
      if (cancelled) return;
      setEtfSharesList([]);
      setEtfShares(null);
    });
    return () => { cancelled = true; };
  }, []);

  const contextInput: ReviewContextInput = useMemo(() => ({
    indices,
    overview,
    emotion,
    industry,
    lhb,
    etfFlow,
    etfShares,
    etfSharesList,
    shChg,
    lpr,
    bondY,
    hsgt,
    breadth: breadth ?? null,
    watchCodes,
  }), [
    indices, overview, emotion, industry, lhb, etfFlow, etfShares, etfSharesList,
    shChg, lpr, bondY, hsgt, breadth, watchCodes,
  ]);
  const dataSummary = useMemo(() => buildReviewContext(contextInput), [contextInput]);

  return {
    emotion,
    breadth,
    lhb,
    etfFlow,
    etfShares,
    etfSharesList,
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
    topRefreshing,
    topUpdatedLabel,
    refreshTopRows,
    seg,
    setSeg,
    dataSummary,
    contextInput,
    sentiment: overview?.sentiment,
    indTop: industry?.top?.[0],
    indBot: industry?.bottom?.[0],
  };
}
