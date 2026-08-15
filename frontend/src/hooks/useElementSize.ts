import { useCallback, useEffect, useRef, useState } from "react";

/** ResizeObserver box size. Callback ref so late-mounted / swapped nodes still measure. */
export function useElementSize(threshold = 0) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (!r) return;
        if (r.width <= threshold && r.height <= threshold) return;
        setSize({ w: r.width, h: r.height });
      });
      ro.observe(el);
      observerRef.current = ro;
    },
    [threshold],
  );

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  return { ref, size };
}
