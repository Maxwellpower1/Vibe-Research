import { CHAINS } from "@/config/chains";

const MACRO = [
  "央行", "美联储", "降息", "加息", "降准", "GDP", "CPI", "PMI",
  "财政部", "国债", "专项债", "汇率", "人民币", "关税", "国常会",
];

/** Tag a headline by chain keywords, then macro, then policy. */
export function newsTag(title: string, extra = ""): { label: string; color: string } | null {
  const text = `${title}${extra}`;
  for (const c of CHAINS) {
    if (c.keywords.some((k) => k && text.includes(k))) return { label: c.name, color: "#22d3ee" };
  }
  if (MACRO.some((k) => text.includes(k))) return { label: "宏观", color: "#fbbf24" };
  if (/MLF|LPR/.test(text)) return { label: "政策", color: "#fbbf24" };
  return null;
}
