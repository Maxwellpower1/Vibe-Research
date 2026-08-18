/** Deriv cockpit static defs. Must match backend/deriv_catalog.py same order. */

export interface DerivDef {
  product: string;
  und: string;
  label: string;
  group: "index" | "etf" | "commodity";
  sector: string;
}

export const DERIV_DEFS: DerivDef[] = [
  { product: "IO", und: "IF", label: "沪深300", group: "index", sector: "股指" },
  { product: "HO", und: "IH", label: "上证50", group: "index", sector: "股指" },
  { product: "MO", und: "IM", label: "中证1000", group: "index", sector: "股指" },
  { product: "50ETF", und: "510050", label: "50ETF", group: "etf", sector: "股指" },
  { product: "300ETF", und: "510300", label: "300ETF", group: "etf", sector: "股指" },
  { product: "500ETF", und: "510500", label: "500ETF", group: "etf", sector: "股指" },
  { product: "915ETF", und: "159915", label: "创业板ETF", group: "etf", sector: "股指" },
  { product: "000ETF", und: "588000", label: "科创50ETF", group: "etf", sector: "股指" },
  { product: "AU_O", und: "AU", label: "沪金", group: "commodity", sector: "金属" },
  { product: "AG_O", und: "AG", label: "沪银", group: "commodity", sector: "金属" },
  { product: "CU_O", und: "CU", label: "沪铜", group: "commodity", sector: "金属" },
  { product: "AL_O", und: "AL", label: "沪铝", group: "commodity", sector: "金属" },
  { product: "RB_O", und: "RB", label: "螺纹钢", group: "commodity", sector: "黑色" },
  { product: "I_O", und: "I", label: "铁矿石", group: "commodity", sector: "黑色" },
  { product: "SC_O", und: "SC", label: "原油", group: "commodity", sector: "能化" },
  { product: "MA_O", und: "MA", label: "甲醇", group: "commodity", sector: "能化" },
  { product: "TA_O", und: "TA", label: "PTA", group: "commodity", sector: "能化" },
  { product: "M_O", und: "M", label: "豆粕", group: "commodity", sector: "油脂" },
  { product: "Y_O", und: "Y", label: "豆油", group: "commodity", sector: "油脂" },
  { product: "C_O", und: "C", label: "玉米", group: "commodity", sector: "农副" },
  { product: "SR_O", und: "SR", label: "白糖", group: "commodity", sector: "农副" },
];

export const DERIV_PRODUCTS = DERIV_DEFS.map((d) => d.product);
