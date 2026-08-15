// Peer comparison: industry mean / rank / prev-period fallback / radar 0-1.
import type { FinBoard, FinMain } from "@/lib/api";

export function prevPeriodFn(p: string): string {
  const y = parseInt(p.slice(0, 4), 10);
  const md = p.slice(4);
  const map: Record<string, string> = { "-03-31": "-12-31", "-06-30": "-03-31", "-09-30": "-06-30", "-12-31": "-09-30" };
  return `${md === "-03-31" ? y - 1 : y}${map[md] || "-06-30"}`;
}

export type PeerMetricKey = "np" | "py" | "ry" | "roe" | "eps";

export interface PeerMetric {
  key: PeerMetricKey;
  label: string;
  companyVal: number;
  peerAvg: number | null;
  rank: number | null;
  barVal: number;
  barAvg: number;
}

export interface PeerRadarAxis {
  label: string;
  company: number;
  peer: number;
}

export interface PeerComparison {
  industry: string | null;
  count: number;
  inBoard: boolean;
  usePrev: boolean;
  metrics: PeerMetric[];
  radar: PeerRadarAxis[];
}

/** Company vs industry mean/rank + radar. If current peers < 3, fall back to previous period (no rank). */
export function computePeerComparison(
  board: FinBoard | null | undefined,
  prevBoard: FinBoard | null | undefined,
  finData: FinMain | null | undefined,
  companyCode: string,
  companyName: string,
): PeerComparison | null {
  if (!board?.stocks?.length || !finData?.reports?.[0]) return null;
  const bare = companyCode.replace(/^(sh|sz|bj)/i, "");
  let companyInBoard = board.stocks.find(
    (s) => s.code === bare || s.code === companyCode,
  );
  if (!companyInBoard) {
    companyInBoard = board.stocks.find((s) => s.name === companyName || s.name === finData.name);
  }
  const finIndustry = finData.industry || "";

  if (!companyInBoard && !finIndustry) {
    return { industry: null, count: 0, inBoard: false, usePrev: false, metrics: [], radar: [] };
  }

  const industry = companyInBoard?.industry || finIndustry;
  const curPeers = board.stocks.filter((s) => s.industry === industry);
  const usePrev = curPeers.length < 3 && !!prevBoard?.stocks?.length;
  const peerSource = usePrev && prevBoard ? prevBoard : board;
  const peers = peerSource.stocks.filter((s) => s.industry === industry);
  const count = peers.length;
  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const rankOf = (arr: number[], val: number) => arr.filter((v) => v > val).length + 1;

  const peerNp = peers.map((s) => s.net_profit);
  const peerPy = peers.map((s) => s.profit_yoy);
  const peerRy = peers.map((s) => s.revenue_yoy);
  const peerRoe = peers.map((s) => s.roe);
  const peerEps = peers.map((s) => s.eps);

  const r0 = finData.reports[0];
  const cmpNp = companyInBoard ? companyInBoard.net_profit : r0.net_profit;
  const cmpPy = companyInBoard ? companyInBoard.profit_yoy : r0.profit_yoy;
  const cmpRy = companyInBoard ? companyInBoard.revenue_yoy : r0.revenue_yoy;
  const cmpRoe = companyInBoard ? companyInBoard.roe : r0.roe;
  const cmpEps = companyInBoard ? companyInBoard.eps : (r0.eps ?? 0);

  const rankable = !!companyInBoard && !usePrev;

  const metrics: PeerMetric[] = [
    { key: "np", label: "净利", companyVal: r0.net_profit, peerAvg: count > 0 ? avg(peerNp) : null, rank: rankable ? rankOf(peerNp, cmpNp) : null, barVal: cmpNp, barAvg: avg(peerNp) },
    { key: "py", label: "净利增速", companyVal: cmpPy, peerAvg: count > 0 ? avg(peerPy) : null, rank: rankable ? rankOf(peerPy, cmpPy) : null, barVal: cmpPy, barAvg: avg(peerPy) },
    { key: "ry", label: "营收增速", companyVal: cmpRy, peerAvg: count > 0 ? avg(peerRy) : null, rank: rankable ? rankOf(peerRy, cmpRy) : null, barVal: cmpRy, barAvg: avg(peerRy) },
    { key: "roe", label: "ROE", companyVal: cmpRoe, peerAvg: count > 0 ? avg(peerRoe) : null, rank: rankable ? rankOf(peerRoe, cmpRoe) : null, barVal: cmpRoe, barAvg: avg(peerRoe) },
    { key: "eps", label: "EPS", companyVal: cmpEps, peerAvg: count > 0 ? avg(peerEps) : null, rank: rankable ? rankOf(peerEps, cmpEps) : null, barVal: cmpEps, barAvg: avg(peerEps) },
  ];

  const radar: PeerRadarAxis[] = metrics.map((m) => {
    const max = Math.max(Math.abs(m.barVal), Math.abs(m.barAvg), 1);
    return {
      label: m.label,
      company: Math.max(m.barVal / max, 0.02),
      peer: Math.max(m.barAvg / max, 0.02),
    };
  });

  return { industry, count, inBoard: !!companyInBoard, usePrev, metrics, radar };
}
