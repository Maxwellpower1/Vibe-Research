import type { ClsTelegraphItem } from "@/lib/api";
import { itemKey, type FeedSource } from "@/lib/telegraphHub";

export const NEWS_TOAST_MS = 180_000;
export const NEWS_TOAST_CAP = 4;

export const NEWS_SRC_LABEL: Record<FeedSource, string> = {
  cls: "财联社",
  lives: "新浪",
  jin10: "金十",
};

export type NewsToastItem = {
  id: string;
  title: string;
  content?: string;
  time: string;
  tags?: string[];
  source: FeedSource;
};

export type NewsToast = NewsToastItem & { until: number };

export function incomingFromFresh(
  items: ClsTelegraphItem[],
  fresh: ReadonlySet<string>,
  source: FeedSource,
  already: ReadonlySet<string>,
): NewsToastItem[] {
  const out: NewsToastItem[] = [];
  items.forEach((it, i) => {
    const id = itemKey(it, i);
    if (!fresh.has(id) || already.has(id)) return;
    const extra = it.content || it.summary || "";
    out.push({
      id,
      title: it.title,
      content: extra && extra !== it.title ? extra : undefined,
      time: it.time,
      tags: it.tags,
      source,
    });
  });
  return out;
}

export function enqueueNewsToasts(
  queue: NewsToast[],
  incoming: NewsToastItem[],
  now: number,
  ttl = NEWS_TOAST_MS,
  cap = NEWS_TOAST_CAP,
): NewsToast[] {
  const alive = queue.filter((t) => t.until > now);
  const have = new Set(alive.map((t) => t.id));
  const add = incoming
    .filter((it) => it.id && !have.has(it.id))
    .map((it) => ({ ...it, until: now + ttl }));
  return [...add, ...alive].slice(0, cap);
}

export function pruneNewsToasts(queue: NewsToast[], now: number): NewsToast[] {
  return queue.filter((t) => t.until > now);
}

export function dismissNewsToast(queue: NewsToast[], id: string): NewsToast[] {
  return queue.filter((t) => t.id !== id);
}
