import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

const PREFIX = "vr.glance.";
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function subscribeKey(key: string, onStoreChange: () => void) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onStoreChange);
  return () => {
    set!.delete(onStoreChange);
  };
}

export function readSectionOpen(storageKey: string, defaultOpen: boolean): boolean {
  try {
    const raw = localStorage.getItem(PREFIX + storageKey);
    if (raw === null) return defaultOpen;
    return raw === "1";
  } catch {
    return defaultOpen;
  }
}

export function writeSectionOpen(storageKey: string, open: boolean) {
  try {
    localStorage.setItem(PREFIX + storageKey, open ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
  notify(storageKey);
}

/** Read/write a single collapsible section open state (localStorage + cross-hook sync). */
export function useSectionOpen(storageKey: string | undefined, defaultOpen: boolean) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);

  const key = storageKey ?? "";
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!key) return () => {};
      return subscribeKey(key, onStoreChange);
    },
    [key],
  );
  const getSnapshot = useCallback(() => {
    if (!key) return defaultOpen;
    return readSectionOpen(key, defaultOpen);
  }, [key, defaultOpen]);

  const storedOpen = useSyncExternalStore(subscribe, getSnapshot, () => defaultOpen);
  const open = key ? storedOpen : localOpen;

  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      if (!key) {
        setLocalOpen((prev) => (typeof next === "function" ? next(prev) : next));
        return;
      }
      const resolved = typeof next === "function" ? next(readSectionOpen(key, defaultOpen)) : next;
      writeSectionOpen(key, resolved);
    },
    [key, defaultOpen],
  );

  return [open, setOpen] as const;
}

/** Page-level expand/collapse all for a fixed list of section storage keys. */
export function useExpandAll(keys: readonly string[], defaults: Record<string, boolean> = {}) {
  const keySig = keys.join("|");
  const stableKeys = useMemo(() => [...keys], [keySig]); // eslint-disable-line react-hooks/exhaustive-deps

  const subscribeAll = useCallback(
    (onStoreChange: () => void) => {
      const unsubs = stableKeys.map((k) => subscribeKey(k, onStoreChange));
      return () => unsubs.forEach((u) => u());
    },
    [stableKeys],
  );

  const snapshot = useSyncExternalStore(
    subscribeAll,
    () => stableKeys.map((k) => (readSectionOpen(k, defaults[k] ?? false) ? "1" : "0")).join(""),
    () => "",
  );

  const allOpen = useMemo(() => {
    if (!stableKeys.length) return false;
    return snapshot.length > 0
      ? snapshot.split("").every((c) => c === "1")
      : stableKeys.every((k) => readSectionOpen(k, defaults[k] ?? false));
  }, [stableKeys, snapshot, defaults]);

  const expandAll = useCallback(() => {
    stableKeys.forEach((k) => writeSectionOpen(k, true));
  }, [stableKeys]);

  const collapseAll = useCallback(() => {
    stableKeys.forEach((k) => writeSectionOpen(k, false));
  }, [stableKeys]);

  const toggleAll = useCallback(() => {
    if (allOpen) collapseAll();
    else expandAll();
  }, [allOpen, collapseAll, expandAll]);

  return { allOpen, expandAll, collapseAll, toggleAll };
}

export { PREFIX as GLANCE_STORAGE_PREFIX };
