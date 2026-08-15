/** Cockpit static defs: world indices + commodities. */

export interface IndexDef {
  code: string;
  label: string;
  region: "CN" | "HK" | "US" | "FX";
}

export const WORLD_INDEX_DEFS: IndexDef[] = [
  { code: "sh000001", label: "上证指数", region: "CN" },
  { code: "sz399001", label: "深证成指", region: "CN" },
  { code: "sz399006", label: "创业板指", region: "CN" },
  { code: "sh000688", label: "科创50", region: "CN" },
  { code: "sh000300", label: "沪深300", region: "CN" },
  { code: "sh000905", label: "中证500", region: "CN" },
  { code: "hkHSI", label: "恒生指数", region: "HK" },
  { code: "hkHSTECH", label: "恒生科技", region: "HK" },
  { code: "usDJI", label: "道琼斯", region: "US" },
  { code: "usIXIC", label: "纳斯达克", region: "US" },
  { code: "usINX", label: "标普500", region: "US" },
  { code: "usVIX", label: "恐慌指数", region: "US" },
  { code: "usSOXX", label: "费城半导体", region: "US" },
  { code: "whUSDCNY", label: "美元/人民币", region: "FX" },
];

export interface CommodityDef {
  code: string;
  label: string;
  unit: string;
  accent: string;
}

export const COMMODITIES: CommodityDef[] = [
  { code: "hf_GC", label: "纽约黄金", unit: "COMEX · 美元/盎司", accent: "#f5c542" },
  { code: "hf_XAU", label: "伦敦金", unit: "现货 · 美元/盎司", accent: "#ffca28" },
  { code: "nf_AU0", label: "沪金", unit: "元/克", accent: "#e6c25a" },
  { code: "hf_SI", label: "纽约白银", unit: "COMEX · 美元/盎司", accent: "#c0d0e0" },
  { code: "hf_CAD", label: "LME伦铜", unit: "美元/吨", accent: "#e8833a" },
  { code: "hf_CL", label: "NYMEX原油", unit: "美元/桶", accent: "#5aa9e6" },
  { code: "BTCUSDT", label: "BTC/USDT", unit: "美元", accent: "#f7931a" },
];

export const COMMODITY_CODES = COMMODITIES.map((c) => c.code).join(",");
