// US watchlist — localStorage only, never uploaded.

const KEY = "vr-us-watchlist";
const DEFAULTS = ["AAPL", "MSFT", "NVDA", "TSLA", "SPY"];

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,7}$/;

export function loadUsWatch(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return [...DEFAULTS];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((c) => String(c).toUpperCase()).filter((c) => TICKER_RE.test(c)) : [...DEFAULTS];
  } catch {
    return [...DEFAULTS];
  }
}

export function saveUsWatch(codes: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(codes));
  } catch {
    /* storage unavailable */
  }
}

/** Extract US tickers from free text (comma / space / newline). */
export function parseUsTickers(raw: string): string[] {
  const tokens = raw.toUpperCase().split(/[^A-Z0-9.\-]+/).filter(Boolean);
  return Array.from(new Set(tokens.filter((t) => TICKER_RE.test(t))));
}

export function addUsTickers(existing: string[], raw: string): { next: string[]; added: number } {
  const incoming = parseUsTickers(raw).filter((c) => !existing.includes(c));
  return { next: [...existing, ...incoming], added: incoming.length };
}
