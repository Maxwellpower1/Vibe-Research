import { useEffect, useState } from "react";

/** Interval poller. Pauses when the document is hidden. */
export function usePolling<T>(
  fn: () => Promise<T>,
  ms: number,
  deps: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fn()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
          setUpdated(Date.now());
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : "load failed");
        });
    };
    run();
    const id = window.setInterval(run, ms);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // Caller controls freshness via deps (tab / filter / etc).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, updated };
}
