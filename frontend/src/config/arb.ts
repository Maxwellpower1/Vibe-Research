/** Arb cockpit static defs. Must match backend/arb_catalog.py same order. */

export interface CalendarUndDef {
  und: string;
  label: string;
}

export const CALENDAR_UNDS: CalendarUndDef[] = [
  { und: "IF", label: "沪深300" },
  { und: "IH", label: "上证50" },
  { und: "IM", label: "中证1000" },
  { und: "RB", label: "螺纹钢" },
  { und: "HC", label: "热卷" },
  { und: "I", label: "铁矿石" },
  { und: "J", label: "焦炭" },
  { und: "JM", label: "焦煤" },
  { und: "AU", label: "沪金" },
  { und: "AG", label: "沪银" },
  { und: "CU", label: "沪铜" },
  { und: "AL", label: "沪铝" },
  { und: "ZN", label: "沪锌" },
  { und: "SC", label: "原油" },
  { und: "FU", label: "燃油" },
  { und: "TA", label: "PTA" },
  { und: "EG", label: "乙二醇" },
  { und: "MA", label: "甲醇" },
  { und: "PP", label: "聚丙烯" },
  { und: "M", label: "豆粕" },
  { und: "Y", label: "豆油" },
  { und: "P", label: "棕榈油" },
  { und: "OI", label: "菜油" },
  { und: "RM", label: "菜粕" },
  { und: "C", label: "玉米" },
  { und: "SR", label: "白糖" },
  { und: "SA", label: "纯碱" },
  { und: "FG", label: "玻璃" },
];

export interface CrossPairDef {
  a: string;
  b: string;
  label: string;
  sector: string;
}

export const CROSS_PAIRS: CrossPairDef[] = [
  { a: "RB", b: "HC", label: "螺卷", sector: "黑色" },
  { a: "RB", b: "I", label: "螺矿", sector: "黑色" },
  { a: "J", b: "JM", label: "焦炭焦煤", sector: "黑色" },
  { a: "I", b: "J", label: "矿焦", sector: "黑色" },
  { a: "Y", b: "P", label: "豆棕", sector: "油脂" },
  { a: "Y", b: "OI", label: "豆菜油", sector: "油脂" },
  { a: "M", b: "RM", label: "豆菜粕", sector: "油脂" },
  { a: "AU", b: "AG", label: "金银", sector: "金属" },
  { a: "TA", b: "EG", label: "TA-EG", sector: "能化" },
  { a: "MA", b: "EG", label: "甲醇乙二醇", sector: "能化" },
  { a: "SC", b: "FU", label: "原油燃油", sector: "能化" },
  { a: "IF", b: "IH", label: "IF-IH", sector: "股指" },
  { a: "IF", b: "IM", label: "IF-IM", sector: "股指" },
];

export interface IndexBasisDef {
  und: string;
  cashCode: string;
  cashKind: "index" | "etf";
  cashLabel: string;
  cashMult: number;
}

export const INDEX_BASIS: IndexBasisDef[] = [
  { und: "IF", cashCode: "sh000300", cashKind: "index", cashLabel: "沪深300", cashMult: 1 },
  { und: "IF", cashCode: "sh510300", cashKind: "etf", cashLabel: "300ETF", cashMult: 1000 },
  { und: "IH", cashCode: "sh000016", cashKind: "index", cashLabel: "上证50", cashMult: 1 },
  { und: "IH", cashCode: "sh510050", cashKind: "etf", cashLabel: "50ETF", cashMult: 1000 },
  { und: "IM", cashCode: "sh000852", cashKind: "index", cashLabel: "中证1000", cashMult: 1 },
];

export const INDEX_CASH_CODES = INDEX_BASIS.map((d) => d.cashCode);

export const NO_RECEIPT = new Set(["IF", "IH", "IM"]);
