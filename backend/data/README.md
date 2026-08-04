# Fino uni_id -> 机构名映射

`detail` API 只返回 `uni_id`, 不返回机构名. 把映射表放到本目录即可补全 `source`.

## 推荐格式 (JSON)

文件名: `fino_uni_id_map.json`

```json
{
  "6354": "某某期货",
  "9593": "某某证券"
}
```

或:

```json
[
  {"uni_id": "6354", "公司名称": "某某期货"}
]
```

## 兼容 run.py 原 xlsx

把 `uni_id_ v1.1_20260119.xlsx` (列: `uni_id`, `公司名称`) 放到本目录,
需已安装 `pandas` 或 `openpyxl`.

也可设环境变量:

```bash
set FINO_UNI_ID_MAP=C:\path\to\uni_id_ v1.1_20260119.xlsx
```

无映射表时, 前端/后端会显示 `机构#<uni_id>` 作为兜底.
