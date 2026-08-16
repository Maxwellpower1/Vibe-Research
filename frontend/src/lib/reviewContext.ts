/**
 * 复盘上下文: browser asks the backend packer (same text as review mail).
 */

import { api } from "@/lib/api";
import type { FeedSource } from "@/lib/telegraphHub";

export type SectorKind = "01" | "02";

export interface ReviewContextInput {
  watchCodes: string[];
  sectorKind?: SectorKind;
  newsSource?: FeedSource;
}

export async function collectReviewContext(input: ReviewContextInput): Promise<string> {
  const packed = await api.reviewContext({
    watch_codes: input.watchCodes.slice(0, 20),
    sector_kind: input.sectorKind ?? "01",
    news_source: input.newsSource ?? "cls",
  });
  return packed.text;
}
