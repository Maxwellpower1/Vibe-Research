import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { storageGet, storageSet } from "@/lib/storage";

export interface FinCompany {
  code: string;
  name: string;
}

interface FinCtx {
  company: FinCompany;
  recent: FinCompany[];
  select: (code: string, name: string) => void;
  period: string;
  setPeriod: (p: string) => void;
  periods: { value: string; label: string }[];
}

const DEFAULT: FinCompany = { code: "600519", name: "贵州茅台" };
const LS_KEY = "fin:recent";
const MAX_RECENT = 6;

function currentPeriod(d = new Date()): string {
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  if (m <= 3) return `${y - 1}-09-30`;
  if (m <= 6) return `${y}-03-31`;
  if (m <= 9) return `${y}-06-30`;
  return `${y}-09-30`;
}

function prevPeriod(p: string): string {
  const y = p.slice(0, 4);
  const md = p.slice(4);
  if (md === "-03-31") return `${Number(y) - 1}-12-31`;
  const map: Record<string, string> = {
    "-06-30": "-03-31",
    "-09-30": "-06-30",
    "-12-31": "-09-30",
  };
  return `${y}${map[md] ?? "-09-30"}`;
}

function periodLabel(p: string): string {
  const q: Record<string, string> = { "-03-31": "Q1", "-06-30": "Q2", "-09-30": "Q3", "-12-31": "Q4" };
  return `${p.slice(2, 4)}${q[p.slice(4)] ?? ""}`;
}

const CUR = currentPeriod();
const PREV = prevPeriod(CUR);
const PERIOD_OPTIONS = [
  { value: CUR, label: `${periodLabel(CUR)}·披露` },
  { value: PREV, label: periodLabel(PREV) },
];

function loadRecent(): FinCompany[] {
  try {
    const raw = storageGet(LS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (Array.isArray(v)) {
      return v.filter((x) => x && typeof x.code === "string" && typeof x.name === "string").slice(0, MAX_RECENT);
    }
  } catch {
    /* ignore */
  }
  return [];
}

const FinContext = createContext<FinCtx>({
  company: DEFAULT,
  recent: [],
  select: () => {},
  period: CUR,
  setPeriod: () => {},
  periods: PERIOD_OPTIONS,
});

export function FinProvider({ children }: { children: ReactNode }) {
  const [company, setCompany] = useState<FinCompany>(DEFAULT);
  const [recent, setRecent] = useState<FinCompany[]>(loadRecent);
  const [period, setPeriod] = useState(CUR);

  const select = useCallback((code: string, name: string) => {
    const bare = code.replace(/^(sh|sz|bj)/i, "");
    setCompany({ code: bare, name });
    setRecent((rs) => {
      const next = [{ code: bare, name }, ...rs.filter((r) => r.code !== bare)].slice(0, MAX_RECENT);
      storageSet(LS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ company, recent, select, period, setPeriod, periods: PERIOD_OPTIONS }),
    [company, recent, select, period],
  );
  return <FinContext.Provider value={value}>{children}</FinContext.Provider>;
}

export function useFin() {
  return useContext(FinContext);
}
