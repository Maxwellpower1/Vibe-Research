import type { Chain, ChainSegment, ChainStock } from "@/config/chains";
import { storageGet, storageSet } from "@/lib/storage";

export const CUSTOM_CHAINS_KEY = "ashare.review.chain.custom";

export type ParsedStock = { code: string; name: string };
export type ParsedSeg = { name: string; desc: string; stocks: ParsedStock[] };
export type ParseResult = { name: string; segments: ParsedSeg[]; warnings: string[] };

const HEADERS: ParsedSeg[] = [
  { name: "上游 · 材料/设备", desc: "原材料、设备与零部件", stocks: [] },
  { name: "中游 · 制造/封测", desc: "代工、制造与封测", stocks: [] },
  { name: "下游 · 应用/终端", desc: "应用、终端与整车", stocks: [] },
];

const FALLBACK_KEYS = [
  ["材料", "设备", "原料", "矿产", "化工", "硅", "锂", "稀土", "靶材", "晶圆", "气体", "试剂", "新材", "半导体", "芯片", "元器件", "元件", "部件", "模组"],
  ["代工", "制造", "封测", "组装", "加工", "铸造", "冶炼", "封装", "测试", "PCB", "面板", "光伏", "绿能", "电池", "电芯", "电机", "集成", "系统"],
  ["应用", "终端", "整车", "车企", "汽车", "消费", "手机", "电脑", "服务器", "机器人", "无人机", "储能", "运营", "服务", "互联网", "平台", "AI", "智能", "数据", "软件", "方案", "车"],
];

function code6(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(-6);
  return /^\d{6}$/.test(d) ? d : "";
}

function stocksFromText(text: string): ParsedStock[] {
  const out: ParsedStock[] = [];
  const seen = new Set<string>();
  const push = (code: string, name: string) => {
    const c = code6(code);
    if (!c || seen.has(c)) return;
    seen.add(c);
    out.push({ code: c, name: name.trim() || c });
  };
  const re1 = /([\u4e00-\u9fa5]{2,8})[（(]\s*(?:sh|sz|bj)?(\d{6})[^）)]*[）)]/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) push(m[2], m[1]);
  const re2 = /(?:sh|sz|bj)?(\d{6})\s*([\u4e00-\u9fa5]{2,8})/g;
  while ((m = re2.exec(text)) !== null) push(m[1], m[2]);
  return out;
}

function headerIndex(line: string): number {
  const keys = ["上游", "中游", "下游"] as const;
  for (let i = 0; i < keys.length; i++) {
    if (!line.includes(keys[i])) continue;
    const looksHeader = line.length < 24 || !/[\u4e00-\u9fa5]{2,8}[（(]\s*\d{4}/.test(line);
    if (looksHeader) return i;
  }
  return -1;
}

/** Parse pasted 问财 / 上中下游 text. Codes are 6-digit A-share only. */
export function parseChainText(name: string, content: string): ParseResult {
  const warnings: string[] = [];
  const title = name.trim();
  if (!content.trim()) return { name: title, segments: [], warnings: ["请粘贴问财结论或股票名单"] };

  const sectionTexts = ["", "", ""];
  let cur = -1;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    const hi = headerIndex(line);
    if (hi >= 0) {
      cur = hi;
      if (line.length >= 15 && /[（(]\s*(?:sh|sz|bj)?\d{6}/i.test(line)) {
        sectionTexts[cur] += `\n${line}`;
      }
      continue;
    }
    if (cur >= 0) sectionTexts[cur] += `\n${line}`;
  }

  const byHeader = HEADERS.map((h, i) => ({
    ...h,
    stocks: stocksFromText(sectionTexts[i]).slice(0, 10),
  }));
  const headerTotal = byHeader.reduce((n, s) => n + s.stocks.length, 0);
  if (headerTotal >= 3) return { name: title, segments: byHeader, warnings };

  const all = stocksFromText(content);
  if (!all.length) return { name: title, segments: [], warnings: ["未从文本中提取到 A 股代码"] };

  const left = [...all];
  const buckets = FALLBACK_KEYS.map((keys) => {
    const stocks: ParsedStock[] = [];
    for (let i = left.length - 1; i >= 0; i--) {
      if (stocks.length >= 10) break;
      if (keys.some((k) => left[i].name.includes(k))) {
        stocks.push(left[i]);
        left.splice(i, 1);
      }
    }
    stocks.reverse();
    return stocks;
  });
  if (left.length && left.length < all.length) {
    warnings.push(`${left.length} 只未分到上中下游: ${left.map((s) => s.name).join("、")}`);
  }
  return {
    name: title,
    segments: HEADERS.map((h, i) => ({ ...h, stocks: buckets[i] })),
    warnings,
  };
}

function techFromSegs(segs: ParsedSeg[]): string[] {
  return segs
    .flatMap((s) => s.name.match(/[（(][^)）]*[)）]/g)?.map((t) => t.replace(/[（()）]/g, "")) ?? [])
    .filter(Boolean)
    .slice(0, 12);
}

export function buildChainFromParse(name: string, parsed: ParseResult): Chain {
  const title = name.trim().replace(/产业链\s*$/, "") || name.trim();
  return {
    id: `custom_${Date.now()}`,
    name: title,
    segments: parsed.segments.map((seg, si) => ({
      name: seg.name || `${["上游", "中游", "下游"][si] || `环节${si + 1}`}`,
      desc: seg.desc || "",
      stocks: seg.stocks.map((s) => ({ code: s.code, name: s.name, tag: seg.name })),
    })),
    keywords: [title],
    tech: techFromSegs(parsed.segments),
  };
}

export function updateChainSegments(segments: ChainSegment[], parsed: ParseResult): ChainSegment[] {
  return segments.map((seg, si) => ({
    ...seg,
    stocks: parsed.segments[si]?.stocks.length
      ? parsed.segments[si].stocks.map((s) => ({
          code: s.code,
          name: s.name,
          tag: seg.desc.split("·")[0]?.trim() || seg.name,
        }))
      : seg.stocks,
  }));
}

export function isCustomChain(id: string): boolean {
  return id.startsWith("custom_");
}

function asChain(v: unknown): Chain | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Chain;
  if (typeof c.id !== "string" || typeof c.name !== "string" || !Array.isArray(c.segments)) return null;
  return {
    id: c.id,
    name: c.name,
    segments: c.segments.map((s) => ({
      name: String(s?.name || ""),
      desc: String(s?.desc || ""),
      stocks: (s?.stocks || []).filter((x): x is ChainStock => !!x?.code && !!x?.name),
      query: s?.query,
    })),
    keywords: Array.isArray(c.keywords) && c.keywords.length ? c.keywords : [c.name],
    tech: Array.isArray(c.tech) ? c.tech : [],
  };
}

export function loadCustomChains(): Chain[] {
  const raw = storageGet(CUSTOM_CHAINS_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.map(asChain).filter((c): c is Chain => !!c);
  } catch {
    return [];
  }
}

export function saveCustomChains(chains: Chain[]): void {
  storageSet(CUSTOM_CHAINS_KEY, JSON.stringify(chains));
}
