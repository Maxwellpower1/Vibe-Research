import { useCallback, useEffect, useRef, useState } from "react";

const HOUR = 3_600_000;

export function useAsyncPoll<T>(fn: () => Promise<T>, interval = HOUR) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fnRef.current()
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, interval);
    return () => window.clearInterval(t);
  }, [load, interval]);

  return { data, loading, error, retry: load };
}
