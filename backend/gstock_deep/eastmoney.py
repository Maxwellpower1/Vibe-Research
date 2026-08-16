"""Eastmoney statements for US/HK."""
from __future__ import annotations

import astock
import gstock

_STMT_REPORT = {
    "balance": {"us": "RPT_USF10_FN_BALANCE", "hk": "RPT_HKF10_FN_BALANCE"},
    "income": {"us": "RPT_USF10_FN_INCOME", "hk": "RPT_HKF10_FN_INCOME"},
    "cashflow": {"us": "RPT_USSK_FN_CASHFLOW", "hk": "RPT_HKSK_FN_CASHFLOW"},
}

# Preferred Chinese line items (exact match preferred, then contains).
_STMT_KEYS = {
    "income": [
        "营业收入", "营业总收入", "营业成本", "毛利", "营业利润",
        "利润总额", "净利润", "归属于母公司所有者的净利润",
        "基本每股收益", "稀释每股收益",
    ],
    "balance": [
        "资产总计", "资产合计", "流动资产合计", "货币资金", "现金及现金等价物",
        "负债合计", "负债总计", "流动负债合计",
        "股东权益合计", "所有者权益合计", "归属于母公司股东权益合计",
    ],
    "cashflow": [
        "经营活动产生的现金流量净额", "投资活动产生的现金流量净额",
        "筹资活动产生的现金流量净额", "现金及现金等价物净增加额",
        "期末现金及现金等价物余额", "期初现金及现金等价物余额",
    ],
}


def _match_stmt_item(name: str, keys: list[str]) -> str | None:
    if not name:
        return None
    if name in keys:
        return name
    for k in keys:
        if k in name:
            return k
    return None


def financial_statements(query: str, statement: str = "income", periods: int = 5) -> dict:
    """Eastmoney three-statement key lines, pivoted by report date."""
    statement = (statement or "income").lower()
    if statement not in _STMT_REPORT:
        return {}
    info = gstock.resolve_symbol(query)
    if not info or info.get("market") == "KR":
        return {}
    market = "hk" if info["secucode"].endswith(".HK") else "us"
    report = _STMT_REPORT[statement][market]
    rows = astock.eastmoney_datacenter(
        report,
        filter_str=f'(SECUCODE="{info["secucode"]}")',
        page_size=400,
        sort_columns="REPORT_DATE",
        sort_types="-1",
    )
    if not rows:
        return {}
    keys = _STMT_KEYS[statement]
    by_period: dict[str, dict] = {}
    for r in rows:
        rd = str(r.get("REPORT_DATE") or "")[:10]
        label = _match_stmt_item(str(r.get("ITEM_NAME") or ""), keys)
        if not rd or not label:
            continue
        p = by_period.setdefault(rd, {
            "report_date": rd,
            "report": r.get("REPORT"),
            "currency": r.get("CURRENCY"),
            "items": {},
        })
        # Keep first occurrence per label (rows already newest-first overall)
        if label in p["items"]:
            continue
        amt, yoy = r.get("AMOUNT"), r.get("YOY_RATIO")
        p["items"][label] = {
            "amount": amt if isinstance(amt, (int, float)) else None,
            "yoy": yoy if isinstance(yoy, (int, float)) else None,
        }
    if not by_period:
        return {}
    periods_out = sorted(by_period.values(), key=lambda x: x["report_date"], reverse=True)[:periods]
    # Stable item order: whitelist order, only those present in any period
    present: set[str] = set()
    for p in periods_out:
        present.update(p["items"].keys())
    item_order = [k for k in keys if k in present]
    return {
        "code": info["code"],
        "name": info["name"],
        "market": info["market"],
        "statement": statement,
        "currency": periods_out[0].get("currency"),
        "item_order": item_order,
        "periods": periods_out,
    }

