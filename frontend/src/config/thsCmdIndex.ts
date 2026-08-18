/** 同花顺商品指数展示名单 (市场码 64, 850xxx). 只给期权驾驶舱「指数」tab 用.
 *  不进指数目录 / 衍生目录 / 报价中心 / 复盘清单. 行情走 /api/ths. */

export interface ThsCmdIndexDef {
  code: string;
  label: string;
  sector: string;
}

export const THS_CMD_INDICES: ThsCmdIndexDef[] = [
  { code: "850001", label: "同花顺商品", sector: "综合" },
  { code: "850100", label: "工业品", sector: "工业" },
  { code: "850101", label: "能源", sector: "能化" },
  { code: "850102", label: "化工", sector: "能化" },
  { code: "850103", label: "有色金属", sector: "金属" },
  { code: "850105", label: "煤炭", sector: "黑色" },
  { code: "850106", label: "钢铁", sector: "黑色" },
  { code: "850107", label: "建材", sector: "黑色" },
  { code: "850200", label: "农产品", sector: "农产品" },
  { code: "850201", label: "油脂油料", sector: "农产品" },
  { code: "850202", label: "谷物饲料", sector: "农产品" },
];

export const THS_CMD_CODES = THS_CMD_INDICES.map((d) => d.code);
