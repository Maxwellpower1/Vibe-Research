import { useState, useEffect, useCallback, useRef } from "react";
import {
  api, ApiError, type IndexQuote, type MarketOverview, type ShortTermEmotion,
  type TurnoverTop, type GlobalIndex, type DailyDragonTiger, type BoardFlow,
  type HotList, type MonitorPool, type AnomalyPool, type LimitPool, type IndustryData,
  type ThsLimitUpPool, type IwencaiItem, type EtfFlow, type ShareholderChanges,
  type LprData, type CnBondYield, type ReviewSnapshot, type HsgtLive, type StockFlow, type BoardFlowRow,
  type MarketBreadth, type AShareLightKline,
} from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { useSegment } from "@/components/ui/SegmentNav";
import { type IdxPanel } from "@/components/review/constants";
import { formatClock } from "@/lib/freshness";
import { storageGet, storageSet } from "@/lib/storage";
import { getAShareSession } from "@/lib/ashareSession";
import { loadWatch } from "@/lib/watchlist";

const TOP_AUTO_MS = 30_000;
const TOP_AUTO_KEY = "ashare.review.topAuto";
const IDX_PANEL_KEY = "ashare.review.idxPanel";
const SEG_KEYS = ["boards", "money", "chain"] as const;
const EMPTY_IDX_MINUTE: Record<string, AShareLightKline | null> = {};

export type ReviewSeg = "boards" | "money" | "chain";
export type LimitKind = "zt" | "zb" | "dt" | "yzt" | "jm";
export type BoardType = "industry" | "concept" | "region";
export type BoardPeriod = "today" | "5d" | "10d";

export function useReviewData() {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [idxErr, setIdxErr] = useState(false);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [emotion, setEmotion] = useState<ShortTermEmotion | null>(null);
  const [turnover, setTurnover] = useState<TurnoverTop | null>(null);
  const [lhb, setLhb] = useState<DailyDragonTiger | null>(null);
  const [globalIdx, setGlobalIdx] = useState<GlobalIndex[]>([]);
  const [boardFlow, setBoardFlow] = useState<BoardFlow | null>(null);
  const [boardType, setBoardType] = useState<BoardType>("industry");
  const [boardPeriod, setBoardPeriod] = useState<BoardPeriod>("today");
  const [hot, setHot] = useState<HotList | null>(null);
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
  const [boardStockFlow, setBoardStockFlow] = useState<StockFlow | null>(null);
  const [flowBoard, setFlowBoard] = useState<BoardFlowRow | null>(null);
  const [moneyDone, setMoneyDone] = useState(false);
  const [session, setSession] = useState(() => getAShareSession());
  const [idxPanel, setIdxPanel] = useState<IdxPanel>(() => {
    const s = storageGet(IDX_PANEL_KEY);
    return s === "global" || s === "watch" || s === "cn" ? s : "cn";
  });
  const idxMinute = EMPTY_IDX_MINUTE;
  const idxMinuteDone = true;
  const [watchCodes, setWatchCodes] = useState<string[]>(() => loadWatch());

  const [ovDone, setOvDone] = useState(false);
  const [emoDone, setEmoDone] = useState(false);
  const [toDone, setToDone] = useState(false);
  const [lhbDone, setLhbDone] = useState(false);
  const [extraDone, setExtraDone] = useState(false);
  const [topRefreshing, setTopRefreshing] = useState(false);
  const [topUpdatedAt, setTopUpdatedAt] = useState<Date | null>(null);
  const [topAuto, setTopAuto] = useState(() => storageGet(TOP_AUTO_KEY) !== "0");
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
    setIdxErr(!(s.indices && s.indices.length));
    setHsgt(s.hsgt ?? null);
    setOverview(s.overview ?? null);
    setOvDone(true);
  }, []);

  const applyTop = useCallback((s: ReviewSnapshot) => {
    applyPaint(s);
    setGlobalIdx(s.global_indices ?? []);
    setEmotion(s.emotion ?? null);
    setTurnover(s.turnover ?? null);
    setHot(s.hot ?? null);
    setIndustry(s.industry ?? null);
    setEmoDone(true);
    setToDone(true);
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
    setBoardFlow(s.board_flow ?? null);
    setExtraDone(true);
  }, [applyTop]);

  const refreshTopRows = useCallback(() => {
    if (topRefreshingRef.current) return;
    topRefreshingRef.current = true;
    setTopRefreshing(true);
    setIdxErr(false);
    setOvDone(false);
    setEmoDone(false);
    setToDone(false);

    void api.reviewSnapshot({ scope: "top" })
      .then(applyTop)
      .catch(() => {
        setIdxErr(true);
        setIndices([]);
        setGlobalIdx([]);
        setOverview(null);
        setEmotion(null);
        setTurnover(null);
        setHsgt(null);
        setOvDone(true);
        setEmoDone(true);
        setToDone(true);
      })
      .finally(() => {
        setTopUpdatedAt(new Date());
        setTopRefreshing(false);
        topRefreshingRef.current = false;
      });
  }, [applyTop]);

  useEffect(() => {
    storageSet(TOP_AUTO_KEY, topAuto ? "1" : "0");
  }, [topAuto]);

  useEffect(() => {
    let cancelled = false;
    setOvDone(false); setEmoDone(false); setToDone(false); setLhbDone(false); setExtraDone(false);
    setIdxErr(false);
    void (async () => {
      const snap = (scope: "paint" | "top" | "full") =>
        api.reviewSnapshot({ scope, boardType, period: boardPeriod, limitKind });
      const paintP = snap("paint").then((s) => {
        if (!cancelled) {
          applyPaint(s);
          setTopUpdatedAt(new Date());
        }
      }).catch(() => {
        if (!cancelled) {
          setIdxErr(true);
          setOvDone(true);
        }
      });
      const topP = snap("top").then((s) => {
        if (!cancelled) applyTop(s);
      }).catch(() => {
        if (!cancelled) {
          setEmoDone(true);
          setToDone(true);
        }
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
    // bootstrap once; board/limit changes use the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!topAuto) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshTopRows();
    };
    const onVis = () => {
      if (!document.hidden) refreshTopRows();
    };
    const t = window.setInterval(tick, TOP_AUTO_MS);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [topAuto, refreshTopRows]);

  const boardBoot = useRef(true);
  useEffect(() => {
    if (boardBoot.current) {
      boardBoot.current = false;
      return;
    }
    api.boardFlow(boardType, boardPeriod, 20).then(setBoardFlow).catch(() => setBoardFlow(null));
  }, [boardType, boardPeriod]);

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

  // Always prefetch money extras so switching the detail tab is instant.
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
    if (!flowBoard?.code) {
      setBoardStockFlow(null);
      return;
    }
    let cancelled = false;
    void api.stockFlow(15, flowBoard.code).then((d) => {
      if (!cancelled) setBoardStockFlow(d);
    }).catch(() => {
      if (!cancelled) setBoardStockFlow(null);
    });
    return () => { cancelled = true; };
  }, [flowBoard?.code]);

  useEffect(() => {
    api.iwencaiStatus().then((s) => setIwencaiReady(!!s.configured)).catch(() => setIwencaiReady(false));
  }, []);

  useEffect(() => {
    const tick = () => setSession(getAShareSession());
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    storageSet(IDX_PANEL_KEY, idxPanel);
  }, [idxPanel]);

  // CN index minutes now live in WorldIndexPanel; skip the unused fan-out here.

  useEffect(() => {
    setWatchCodes(loadWatch());
  }, [topUpdatedAt]);

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

  const today = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  const p50 = breadth?.p50;
  const dataSummary = (indices.length
    ? indices.map((i) => `${i.name} ${i.price}（${i.change_pct > 0 ? "+" : ""}${i.change_pct}%）`).join("；")
    : "（指数数据未取到）")
    + (p50 != null ? `；全市场中位涨跌 ${p50 > 0 ? "+" : ""}${p50}%（n=${breadth?.n ?? "—"}）` : "");

  return {
    indices,
    idxErr,
    overview,
    emotion,
    breadth,
    turnover,
    lhb,
    globalIdx,
    boardFlow,
    boardType,
    setBoardType,
    boardPeriod,
    setBoardPeriod,
    hot,
    monitor,
    anomaly,
    limitPool,
    limitKind,
    setLimitKind,
    thsLimit,
    industry,
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
    stockFlow: null,
    boardStockFlow,
    flowBoard,
    setFlowBoard,
    moneyDone,
    session,
    idxPanel,
    setIdxPanel,
    idxMinute,
    idxMinuteDone,
    watchCodes,
    ovDone,
    emoDone,
    toDone,
    lhbDone,
    extraDone,
    topRefreshing,
    topAuto,
    setTopAuto,
    topUpdatedLabel,
    refreshTopRows,
    seg,
    setSeg,
    today,
    dataSummary,
    sentiment: overview?.sentiment,
    sectors: overview?.sectors || [],
    indTop: industry?.top?.[0],
    indBot: industry?.bottom?.[0],
    indexPanel: (idxPanel === "watch" ? "cn" : idxPanel) as IdxPanel,
  };
}
