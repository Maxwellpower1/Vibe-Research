import { useEffect, useRef, useState } from "react";

/** Interval poller. Pauses when the document is hidden; resumes on visible. */
export function usePolling<T>(
  fn: () => Promise<T>,
  ms: number,
  deps: unknown[] = [],
  enabled = true,
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(0);

  const depKey = JSON.stringify(deps);
  const prevDepKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (prevDepKey.current !== depKey) {
      prevDepKey.current = depKey;
      setData(null);
      setError(null);
    }
    let cancelled = false;
    const run = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fnRef.current()
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
    const onVis = () => {
      if (!document.hidden) run();
    };
    run();
    const id = window.setInterval(run, ms);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
    // Caller controls freshness via deps (tab / filter / etc). fn is read from ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ms, depKey]);

  return { data, error, updated };
}
