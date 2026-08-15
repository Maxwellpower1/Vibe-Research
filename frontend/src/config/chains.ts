/** Industry-chain templates for the review cockpit. 6-digit A-share codes only. */

export interface ChainStock {
  code: string;
  name: string;
  tag?: string;
}

export interface ChainSegment {
  name: string;
  desc: string;
  stocks: ChainStock[];
  query?: string;
}

export interface Chain {
  id: string;
  name: string;
  segments: ChainSegment[];
  keywords: string[];
}

export function matchRelatedBoards<T extends { name: string; pct: number }>(
  boards: T[],
  keywords: string[],
  n = 8,
): T[] {
  const keys = keywords.filter(Boolean);
  return boards
    .filter((b) => keys.some((k) => b.name.includes(k) || k.includes(b.name)))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, n);
}

export const CHAINS: Chain[] = [
  {
    id: "llm",
    name: "大模型",
    segments: [
      {
        name: "上游 · 算力基座",
        desc: "GPU/AI芯片 · 光模块/服务器",
        stocks: [
          { code: "688041", name: "海光信息", tag: "国产DCU" },
          { code: "688256", name: "寒武纪", tag: "AI ASIC" },
          { code: "300308", name: "中际旭创", tag: "光模块" },
          { code: "601138", name: "工业富联", tag: "AI服务器" },
          { code: "000977", name: "浪潮信息", tag: "服务器" },
        ],
        query: "算力硬件",
      },
      {
        name: "中游 · 模型与平台",
        desc: "大模型训练/推理 · AI平台",
        stocks: [
          { code: "002230", name: "科大讯飞", tag: "星火" },
          { code: "601360", name: "三六零", tag: "360智脑" },
          { code: "300418", name: "昆仑万维", tag: "天工" },
          { code: "688111", name: "金山办公", tag: "AI办公" },
          { code: "300229", name: "拓尔思", tag: "大数据" },
        ],
        query: "大模型",
      },
      {
        name: "下游 · Agent与应用",
        desc: "AI Agent · 行业应用",
        stocks: [
          { code: "300624", name: "万兴科技", tag: "AI创意" },
          { code: "300496", name: "中科创达", tag: "AI OS" },
          { code: "688088", name: "虹软科技", tag: "视觉AI" },
          { code: "688327", name: "云从科技", tag: "人机协同" },
          { code: "002362", name: "汉王科技", tag: "AI交互" },
        ],
        query: "AI应用",
      },
    ],
    keywords: ["大模型", "AI", "人工智能", "GPT", "多模态", "算力", "GPU", "Agent", "智能体", "训练", "推理"],
  },
  {
    id: "embodied",
    name: "具身智能",
    segments: [
      {
        name: "上游 · 核心零部件",
        desc: "减速器/丝杠 · 传感器/电机",
        stocks: [
          { code: "688017", name: "绿的谐波", tag: "谐波减速器" },
          { code: "002472", name: "双环传动", tag: "精密齿轮" },
          { code: "603728", name: "鸣志电器", tag: "空心杯" },
          { code: "603662", name: "柯力传感", tag: "力传感" },
          { code: "300580", name: "贝斯特", tag: "滚柱丝杠" },
        ],
        query: "减速器",
      },
      {
        name: "中游 · 整机与执行器",
        desc: "机器人本体 · 伺服系统",
        stocks: [
          { code: "002747", name: "埃斯顿", tag: "工业机器人" },
          { code: "300124", name: "汇川技术", tag: "伺服" },
          { code: "002050", name: "三花智控", tag: "执行器" },
          { code: "601689", name: "拓普集团", tag: "线性执行器" },
          { code: "300660", name: "江苏雷利", tag: "微特电机" },
        ],
        query: "伺服系统",
      },
      {
        name: "下游 · 大脑与场景",
        desc: "人形/服务/特种机器人",
        stocks: [
          { code: "300024", name: "机器人", tag: "新松" },
          { code: "603666", name: "亿嘉和", tag: "特种" },
          { code: "689009", name: "九号公司", tag: "移动" },
          { code: "688169", name: "石头科技", tag: "服务" },
          { code: "603486", name: "科沃斯", tag: "扫地" },
        ],
        query: "人形机器人",
      },
    ],
    keywords: ["具身智能", "人形机器人", "减速器", "丝杠", "灵巧手", "伺服", "传感器"],
  },
  {
    id: "semi",
    name: "半导体",
    segments: [
      {
        name: "上游 · 设备与材料",
        desc: "光刻/刻封 · 硅片/光刻胶",
        stocks: [
          { code: "002371", name: "北方华创", tag: "设备" },
          { code: "688012", name: "中微公司", tag: "刻蚀" },
          { code: "688126", name: "沪硅产业", tag: "大硅片" },
          { code: "002409", name: "雅克科技", tag: "材料" },
          { code: "688037", name: "芯源微", tag: "涂胶显影" },
        ],
        query: "半导体设备",
      },
      {
        name: "中游 · 制造与封测",
        desc: "晶圆代工 · 封装测试",
        stocks: [
          { code: "688981", name: "中芯国际", tag: "代工" },
          { code: "688347", name: "华虹公司", tag: "特色工艺" },
          { code: "600584", name: "长电科技", tag: "封测" },
          { code: "002156", name: "通富微电", tag: "先进封装" },
          { code: "688249", name: "晶合集成", tag: "代工" },
        ],
        query: "晶圆代工",
      },
      {
        name: "下游 · 设计与应用",
        desc: "芯片设计 · 终端",
        stocks: [
          { code: "603501", name: "韦尔股份", tag: "CIS" },
          { code: "300782", name: "卓胜微", tag: "射频" },
          { code: "603986", name: "兆易创新", tag: "存储/MCU" },
          { code: "688256", name: "寒武纪", tag: "AI芯片" },
          { code: "688008", name: "澜起科技", tag: "内存接口" },
        ],
        query: "芯片设计",
      },
    ],
    keywords: ["半导体", "芯片", "晶圆", "光刻", "存储", "封测", "先进封装", "碳化硅"],
  },
  {
    id: "newenergy",
    name: "新能源",
    segments: [
      {
        name: "上游 · 资源与材料",
        desc: "锂/钴 · 硅料/硅片",
        stocks: [
          { code: "002466", name: "天齐锂业", tag: "锂矿" },
          { code: "002460", name: "赣锋锂业", tag: "锂盐" },
          { code: "603799", name: "华友钴业", tag: "钴镍" },
          { code: "600438", name: "通威股份", tag: "硅料" },
          { code: "601012", name: "隆基绿能", tag: "硅片" },
        ],
        query: "光伏材料",
      },
      {
        name: "中游 · 电池与电力设备",
        desc: "动力/储能 · 逆变器 · 风机",
        stocks: [
          { code: "300750", name: "宁德时代", tag: "电池" },
          { code: "002594", name: "比亚迪", tag: "垂直整合" },
          { code: "300014", name: "亿纬锂能", tag: "动力/储能" },
          { code: "300274", name: "阳光电源", tag: "逆变器" },
          { code: "002202", name: "金风科技", tag: "风电" },
        ],
        query: "动力电池",
      },
      {
        name: "下游 · 运营与整车",
        desc: "整车 · 充电 · 电站",
        stocks: [
          { code: "000625", name: "长安汽车", tag: "自主" },
          { code: "601127", name: "赛力斯", tag: "智选车" },
          { code: "300001", name: "特锐德", tag: "充电网" },
          { code: "600905", name: "三峡能源", tag: "运营" },
          { code: "600406", name: "国电南瑞", tag: "电网" },
        ],
        query: "新能源整车",
      },
    ],
    keywords: ["新能源", "光伏", "风电", "锂电", "储能", "电池", "充电", "电动车", "逆变器"],
  },
  {
    id: "pharma",
    name: "创新药",
    segments: [
      {
        name: "上游 · CXO与原料",
        desc: "研发外包 · 原料药",
        stocks: [
          { code: "603259", name: "药明康德", tag: "CXO" },
          { code: "300347", name: "泰格医药", tag: "临床CRO" },
          { code: "002821", name: "凯莱英", tag: "CDMO" },
          { code: "603127", name: "昭衍新药", tag: "安评" },
          { code: "300759", name: "康龙化成", tag: "一体化" },
        ],
        query: "CXO",
      },
      {
        name: "中游 · 创新药企",
        desc: "创新管线 · 国际化",
        stocks: [
          { code: "600276", name: "恒瑞医药", tag: "创新药" },
          { code: "688235", name: "百济神州", tag: "国际化" },
          { code: "600196", name: "复星医药", tag: "综合" },
          { code: "002422", name: "科伦药业", tag: "ADC" },
          { code: "688266", name: "泽璟制药", tag: "小分子" },
        ],
        query: "创新药",
      },
      {
        name: "下游 · 商业化与流通",
        desc: "疫苗 · 流通 · 药房",
        stocks: [
          { code: "300122", name: "智飞生物", tag: "疫苗" },
          { code: "601607", name: "上海医药", tag: "工商业" },
          { code: "000028", name: "国药一致", tag: "流通" },
          { code: "603939", name: "益丰药房", tag: "连锁" },
          { code: "600998", name: "九州通", tag: "流通" },
        ],
        query: "疫苗",
      },
    ],
    keywords: ["创新药", "医药", "ADC", "疫苗", "临床", "CXO", "靶点"],
  },
  {
    id: "newindustrial",
    name: "新型工业化",
    segments: [
      {
        name: "上游 · 工业软件与控制",
        desc: "DCS/PLC · 工业软件",
        stocks: [
          { code: "688777", name: "中控技术", tag: "DCS" },
          { code: "600845", name: "宝信软件", tag: "工业软件" },
          { code: "600588", name: "用友网络", tag: "工业互联网" },
          { code: "603859", name: "能科科技", tag: "数字化" },
          { code: "300687", name: "赛意信息", tag: "智能制造" },
        ],
        query: "工业软件",
      },
      {
        name: "中游 · 智能制造装备",
        desc: "工业机器人 · 数控/自动化",
        stocks: [
          { code: "300124", name: "汇川技术", tag: "自动化" },
          { code: "002747", name: "埃斯顿", tag: "机器人" },
          { code: "300450", name: "先导智能", tag: "锂电设备" },
          { code: "300724", name: "捷佳伟创", tag: "光伏设备" },
          { code: "002595", name: "豪迈科技", tag: "精密加工" },
        ],
        query: "工业机器人",
      },
      {
        name: "下游 · 数字化与互联",
        desc: "工业互联网 · 数字孪生",
        stocks: [
          { code: "601138", name: "工业富联", tag: "工业互联网" },
          { code: "300166", name: "东方国信", tag: "工业大数据" },
          { code: "300378", name: "鼎捷软件", tag: "智能制造" },
          { code: "688568", name: "中科星图", tag: "数字孪生" },
          { code: "002230", name: "科大讯飞", tag: "工业AI" },
        ],
        query: "工业互联网",
      },
    ],
    keywords: ["新型工业化", "工业互联网", "智能制造", "工业软件", "自动化", "机器人", "数字孪生"],
  },
  {
    id: "digitalgov",
    name: "数字政府",
    segments: [
      {
        name: "上游 · 云网与安全",
        desc: "政务云 · 网络安全 · 信创",
        stocks: [
          { code: "002368", name: "太极股份", tag: "政务云" },
          { code: "300454", name: "深信服", tag: "安全" },
          { code: "002439", name: "启明星辰", tag: "安全" },
          { code: "600536", name: "中国软件", tag: "国产OS" },
          { code: "603019", name: "中科曙光", tag: "算力" },
        ],
        query: "政务云",
      },
      {
        name: "中游 · 平台与数据",
        desc: "数字政务 · 数据治理",
        stocks: [
          { code: "000938", name: "紫光股份", tag: "数字化" },
          { code: "300075", name: "数字政通", tag: "数字城管" },
          { code: "300525", name: "博思软件", tag: "财政信息化" },
          { code: "603636", name: "南威软件", tag: "数字政务" },
          { code: "300212", name: "易华录", tag: "数据湖" },
        ],
        query: "数字政务",
      },
      {
        name: "下游 · 智慧场景",
        desc: "智慧城市 · 交通 · 安防",
        stocks: [
          { code: "002415", name: "海康威视", tag: "安防" },
          { code: "002236", name: "大华股份", tag: "智慧城市" },
          { code: "300188", name: "美亚柏科", tag: "电子取证" },
          { code: "600728", name: "佳都科技", tag: "智慧交通" },
          { code: "002152", name: "广电运通", tag: "终端" },
        ],
        query: "智慧城市",
      },
    ],
    keywords: ["数字政府", "政务", "智慧城市", "信创", "数据要素", "网络安全", "一网通办"],
  },
  {
    id: "smartmed",
    name: "智慧医疗",
    segments: [
      {
        name: "上游 · 医疗信息化",
        desc: "HIS/EMR · 医疗大数据",
        stocks: [
          { code: "300253", name: "卫宁健康", tag: "医疗IT" },
          { code: "300451", name: "创业慧康", tag: "信息化" },
          { code: "600718", name: "东软集团", tag: "HIS" },
          { code: "300168", name: "万达信息", tag: "智慧医疗" },
          { code: "300078", name: "思创医惠", tag: "物联网" },
        ],
        query: "医疗信息化",
      },
      {
        name: "中游 · AI医疗与设备",
        desc: "AI诊断 · 影像 · 基因",
        stocks: [
          { code: "688271", name: "联影医疗", tag: "高端影像" },
          { code: "300760", name: "迈瑞医疗", tag: "设备" },
          { code: "603882", name: "金域医学", tag: "第三方检验" },
          { code: "300244", name: "迪安诊断", tag: "诊断" },
          { code: "300676", name: "华大基因", tag: "测序" },
        ],
        query: "AI医疗",
      },
      {
        name: "下游 · 互联网与健康管理",
        desc: "互联网医院 · 健康管理",
        stocks: [
          { code: "002603", name: "以岭药业", tag: "中药" },
          { code: "002044", name: "美年健康", tag: "体检" },
          { code: "002223", name: "鱼跃医疗", tag: "家用" },
          { code: "300146", name: "汤臣倍健", tag: "营养" },
          { code: "600998", name: "九州通", tag: "供应链" },
        ],
        query: "互联网医疗",
      },
    ],
    keywords: ["智慧医疗", "医疗信息化", "AI医疗", "互联网医疗", "远程医疗", "健康管理", "影像"],
  },
];
