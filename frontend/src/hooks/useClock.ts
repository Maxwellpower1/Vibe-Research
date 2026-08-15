import { useEffect, useState } from "react";

/** Tick the current time every `ms` (default 1s). */
export function useClock(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
