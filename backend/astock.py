"""A股全栈数据层 —— 移植自 a-stock-data 工具包（五层数据源，自包含）。

分级依赖：
  - 行情（腾讯）        : 仅需标准库 urllib —— 永远可用
  - 研报（东财）+ PDF   : 仅需 requests —— 轻量必装
  - 一致预期/新闻/公告  : akshare（惰性导入，缺失时优雅报错）
  - K线/财务/F10        : mootdx（惰性导入，缺失时优雅报错）

合规：本模块只按用户传入的代码返回客观数据，不预置任何标的、不排名、不建议。
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import re
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def get_prefix(code: str) -> str:
    """6 位代码 → 交易所前缀。5 开头是沪市基金/ETF（51/56/58 等），深市基金 15/16 开头走默认 sz。"""
    if code.startswith(("6", "9", "5")):
        return "sh"
    if code.startswith("8"):
        return "bj"
    return "sz"


class DependencyMissing(RuntimeError):
    """惰性依赖未安装时抛出，前端据此提示 pip install。"""


# ---------------------------------------------------------------------------
# Layer 1 · 行情（腾讯财经，仅标准库，不封 IP）
# ---------------------------------------------------------------------------

def _fetch_gtimg(prefixed_codes: list[str]) -> str:
    url = "https://qt.gtimg.cn/q=" + ",".join(prefixed_codes)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read().decode("gbk")


def _parse_gtimg(data: str) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for line in data.strip().split(";"):
        if not line.strip() or "=" not in line or '"' not in line:
            continue
        key = line.split("=")[0].split("_")[-1]
        vals = line.split('"')[1].split("~")
        if len(vals) < 53:
            continue
        code = key[2:]

        def num(i: int) -> float:
            try:
                return float(vals[i]) if vals[i] else 0.0
            except (ValueError, IndexError):
                return 0.0

        result[code] = {
            "name": vals[1],
            "price": num(3),
            "last_close": num(4),
            "open": num(5),
            "change_amt": num(31),
            "change_pct": num(32),
            "high": num(33),
            "low": num(34),
            "amount_wan": num(37),
            "turnover_pct": num(38),
            "pe_ttm": num(39),
            "amplitude_pct": num(43),
            "mcap_yi": num(44),
            "float_mcap_yi": num(45),
            "pb": num(46),
            "limit_up": num(47),
            "limit_down": num(48),
            "vol_ratio": num(49),
            "pe_static": num(52),
        }
    return result


def tencent_quote(codes: list[str]) -> dict[str, dict]:
    """批量个股实时行情：现价 / 涨跌 / PE / PB / 市值 / 换手 / 涨跌停。"""
    prefixed = [f"{get_prefix(c)}{c}" for c in codes]
    return _parse_gtimg(_fetch_gtimg(prefixed))


# A股大盘指数（前缀规则与个股不同，固定带前缀代码）
A_INDICES = ["sh000001", "sz399001", "sz399006", "sh000300"]


def index_quote() -> list[dict]:
    """A股大盘指数实时行情（上证/深证成指/创业板指/沪深300）。"""
    parsed = _parse_gtimg(_fetch_gtimg(A_INDICES))
    out = []
    for full in A_INDICES:
        q = parsed.get(full[2:])
        if q:
            out.append({"name": q["name"], "price": q["price"], "change_pct": q["change_pct"], "change_amt": q["change_amt"]})
    return out


# ---------------------------------------------------------------------------
# Layer 2 · 研报（东财 reportapi，仅 requests）
# ---------------------------------------------------------------------------

_REPORT_API = "https://reportapi.eastmoney.com/report/list"
_PDF_TPL = "https://pdf.dfcfw.com/pdf/H3_{info_code}_1.pdf"


def _report_session():
    import requests  # 轻依赖，随后端一起装

    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Referer": "https://data.eastmoney.com/"})
    return s


def eastmoney_reports(code: str, max_pages: int = 3) -> list[dict]:
    """按个股代码拉研报列表（qType=0）。"""
    session = _report_session()
    out: list[dict] = []
    for page in range(1, max_pages + 1):
        params = {
            "industryCode": "*", "pageSize": "100", "industry": "*",
            "rating": "*", "ratingChange": "*",
            "beginTime": "2000-01-01", "endTime": "2030-01-01",
            "pageNo": str(page), "fields": "", "qType": "0",
            "orgCode": "", "code": code, "rcode": "",
            "p": str(page), "pageNum": str(page), "pageNumber": str(page),
        }
        r = session.get(_REPORT_API, params=params, timeout=30)
        d = r.json()
        rows = d.get("data") or []
        if not rows:
            break
        out.extend(rows)
        if page >= (d.get("TotalPage", 1) or 1):
            break
        time.sleep(0.3)
    return out


def eastmoney_industry_reports(keywords: list[str] | None = None, days: int = 90, max_pages: int = 3) -> list[dict]:
    """按行业拉研报（qType=1）——适合产业链 / 主题级检索。keywords 在标题上过滤。"""
    from datetime import date, timedelta

    session = _report_session()
    end = date.today()
    begin = end - timedelta(days=days)
    out: list[dict] = []
    for page in range(1, max_pages + 1):
        params = {
            "industryCode": "*", "pageSize": "100", "industry": "*",
            "rating": "*", "ratingChange": "*",
            "beginTime": begin.isoformat(), "endTime": end.isoformat(),
            "pageNo": str(page), "fields": "", "qType": "1",
            "orgCode": "", "code": "", "rcode": "",
        }
        r = session.get(_REPORT_API, params=params, timeout=30)
        rows = r.json().get("data") or []
        if not rows:
            break
        out.extend(rows)
        time.sleep(0.3)
    if keywords:
        out = [r for r in out if any(k in r.get("title", "") for k in keywords)]
    return out


def pdf_url(info_code: str) -> str:
    return _PDF_TPL.format(info_code=info_code)


# ---------------------------------------------------------------------------
# Layer 3/4/5 · akshare 惰性封装（一致预期 / 新闻 / 公告 / 基本面）
# ---------------------------------------------------------------------------

def _akshare():
    try:
        import akshare as ak
        return ak
    except ImportError as e:
        raise DependencyMissing("akshare 未安装：pip install akshare") from e


def profit_forecast(code: str) -> list[dict]:
    """机构一致预期 EPS（同花顺）。"""
    ak = _akshare()
    df = ak.stock_profit_forecast_ths(symbol=code, indicator="预测年报每股收益")
    return df.to_dict("records") if df is not None and not df.empty else []


def stock_news(code: str, limit: int = 20) -> list[dict]:
    """个股新闻（东财）。"""
    ak = _akshare()
    df = ak.stock_news_em(symbol=code)
    return df.head(limit).to_dict("records") if df is not None and not df.empty else []


def cls_telegraph(page_size: int = 50) -> list[dict]:
    """财联社电报（全市场实时快讯）。v1 API + 本地签名，零 key。

    sign = md5(sha1(sorted query string)); no API key required (a-stock-data §5.2).
    Returns [{id, title, content, time, share_url}, ...].
    """
    import requests

    n = max(10, min(int(page_size or 50), 100))
    params = {
        "appName": "CailianpressWeb",
        "os": "web",
        "sv": "7.7.5",
        "last_time": "",
        "refresh_type": "1",
        "rn": str(n),
    }
    qs = "&".join(f"{k}={params[k]}" for k in sorted(params))
    sign = hashlib.md5(hashlib.sha1(qs.encode()).hexdigest().encode()).hexdigest()
    url = f"https://www.cls.cn/v1/roll/get_roll_list?{qs}&sign={sign}"
    try:
        r = requests.get(
            url,
            headers={"User-Agent": UA, "Referer": "https://www.cls.cn/"},
            timeout=12,
        )
        r.raise_for_status()
        payload = r.json()
    except Exception:
        return []
    # errno may be 0 on success; tolerate missing field
    if payload.get("errno") not in (None, 0, "0"):
        return []
    rows: list[dict] = []
    for item in (payload.get("data") or {}).get("roll_data") or []:
        if not isinstance(item, dict):
            continue
        ts = item.get("ctime")
        t = ""
        if isinstance(ts, (int, float)) and ts > 0:
            try:
                t = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
            except (OSError, OverflowError, ValueError):
                t = ""
        title = (item.get("title") or item.get("brief") or "").strip()
        content = (item.get("content") or item.get("brief") or "").strip()
        if not title and not content:
            continue
        share = item.get("shareurl") or item.get("shareUrl") or ""
        if not share and item.get("id"):
            share = f"https://www.cls.cn/detail/{item.get('id')}"
        rows.append({
            "id": item.get("id"),
            "title": title or content[:80],
            "content": content,
            "time": t,
            "share_url": share or None,
        })
    return rows


def individual_info(code: str) -> dict:
    """个股基本面（东财）：行业 / 总股本 / 上市时间等。"""
    ak = _akshare()
    df = ak.stock_individual_info_em(symbol=code)
    if df is None or df.empty:
        return {}
    return {str(row["item"]): row["value"] for _, row in df.iterrows()}


def disclosure(code: str) -> list[dict]:
    """巨潮公告全文列表（akshare cninfo，本环境不稳，保留作备用）。"""
    ak = _akshare()
    market = "沪市" if code.startswith("6") else ("北交所" if code.startswith("8") else "深市")
    df = ak.stock_zh_a_disclosure_report_cninfo(symbol=code, market=market)
    return df.head(30).to_dict("records") if df is not None and not df.empty else []


def announcements(code: str, limit: int = 15) -> list[dict]:
    """个股近期公告（东财公开接口，仅 requests，稳定）。返回 日期/标题/类型/详情链接。"""
    import requests

    r = requests.get(
        "https://np-anotice-stock.eastmoney.com/api/security/ann",
        params={"sr": -1, "page_size": limit, "page_index": 1, "ann_type": "A",
                "client_source": "web", "stock_list": code, "f_node": 0, "s_node": 0},
        headers={"User-Agent": UA}, timeout=20,
    )
    lst = (r.json().get("data") or {}).get("list") or []
    out = []
    for a in lst:
        cols = [c.get("column_name") for c in (a.get("columns") or []) if c.get("column_name")]
        art = a.get("art_code", "")
        out.append({
            "date": (a.get("notice_date", "") or "")[:10],
            "title": a.get("title", ""),
            "type": cols[0] if cols else "",
            "url": f"https://data.eastmoney.com/notices/detail/{code}/{art}.html" if art else "",
        })
    return out


# ---------------------------------------------------------------------------
# Layer 1b · 轻量 K 线（腾讯 ifzq，标准库 urllib，前复权日 K）
# ---------------------------------------------------------------------------

def _tencent_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://gu.qq.com/"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _parse_minute_line(line: str, day: str = "") -> dict | None:
    """Parse '0930 1328.36 521 69207556.00' -> bar. day=YYYYMMDD optional for 5-day."""
    parts = str(line).split()
    if len(parts) < 2:
        return None
    try:
        hm = parts[0].zfill(4)
        price = float(parts[1])
        vol = int(float(parts[2])) if len(parts) > 2 else 0
        amount = float(parts[3]) if len(parts) > 3 else 0.0
    except (TypeError, ValueError):
        return None
    if day:
        dt = f"{day[:4]}-{day[4:6]}-{day[6:8]} {hm[:2]}:{hm[2:4]}"
    else:
        dt = f"{hm[:2]}:{hm[2:4]}"
    return {
        "datetime": dt,
        "open": price, "high": price, "low": price, "close": price,
        "volume": vol, "amount": amount,
    }


def light_kline(code: str, resolution: str = "1D", num: int = 365) -> dict:
    """A 股轻量图数据（腾讯）：分时 / 5日 / 日K(前复权)。

    resolution: '1' 当日分时 · '5' 近5日分时 · '1D' 日K前复权
    返回: {code, name?, resolution, adjust, source, prev_close?, bars: [...]}
    bars 统一字段: datetime, open, high, low, close, volume (, amount)
    """
    code = (code or "").strip()
    if not re.fullmatch(r"\d{6}", code):
        return {}
    res = (resolution or "1D").strip()
    symbol = f"{get_prefix(code)}{code}"
    n = max(20, min(int(num or 365), 1000))

    name = None
    prev_close = None
    bars: list[dict] = []
    adjust = "none"

    try:
        if res == "1":
            # Today minute timeline
            d = _tencent_json(f"https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={symbol}")
            block = ((d.get("data") or {}).get(symbol) or {})
            # shape: data.data.data = ["0930 price vol amount", ...]
            inner = (block.get("data") or {})
            lines = inner.get("data") if isinstance(inner, dict) else None
            if not isinstance(lines, list):
                lines = block.get("data") if isinstance(block.get("data"), list) else []
            today = datetime.now().strftime("%Y%m%d")
            for line in lines or []:
                b = _parse_minute_line(line, today)
                if b:
                    bars.append(b)
            # qt prec / name
            qt = (block.get("qt") or {}).get(symbol) or []
            if isinstance(qt, list) and len(qt) > 4:
                name = qt[1] if isinstance(qt[1], str) else name
                try:
                    prev_close = float(qt[4]) if qt[4] not in ("", None) else None
                except (TypeError, ValueError):
                    prev_close = None

        elif res == "5":
            # Last 5 sessions minute series
            d = _tencent_json(f"https://web.ifzq.gtimg.cn/appstock/app/day/query?code={symbol}")
            block = ((d.get("data") or {}).get(symbol) or {})
            days = block.get("data") or []
            # API returns newest-first; reverse to chronological
            if isinstance(days, list):
                for day in reversed(days):
                    if not isinstance(day, dict):
                        continue
                    dd = str(day.get("date") or "")
                    for line in day.get("data") or []:
                        b = _parse_minute_line(line, dd)
                        if b:
                            bars.append(b)
            qt = (block.get("qt") or {}).get(symbol) or []
            if isinstance(qt, list) and len(qt) > 4:
                name = qt[1] if isinstance(qt[1], str) else name
                try:
                    prev_close = float(qt[4]) if qt[4] not in ("", None) else None
                except (TypeError, ValueError):
                    prev_close = None

        else:
            # Daily forward-adjusted OHLC
            adjust = "qfq"
            param = f"{symbol},day,,,{n},qfq"
            d = _tencent_json(
                f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={param}"
            )
            block = ((d.get("data") or {}).get(symbol) or {})
            rows = block.get("qfqday") or block.get("day") or []
            for row in rows:
                if not isinstance(row, (list, tuple)) or len(row) < 6:
                    continue
                try:
                    # [date, open, close, high, low, volume]
                    bars.append({
                        "datetime": str(row[0]),
                        "open": float(row[1]),
                        "close": float(row[2]),
                        "high": float(row[3]),
                        "low": float(row[4]),
                        "volume": int(float(row[5])),
                    })
                except (TypeError, ValueError):
                    continue
            bars = bars[-n:]
            qt = (block.get("qt") or {}).get(symbol) or []
            if isinstance(qt, list) and len(qt) > 1:
                name = qt[1] if isinstance(qt[1], str) else name
    except Exception:
        return {}

    if not bars:
        return {}

    # Minute APIs return cumulative volume within each session — convert to per-bar delta
    if res in ("1", "5"):
        prev_v = 0
        prev_day = ""
        for b in bars:
            day = str(b.get("datetime") or "")[:10]
            if day != prev_day:
                prev_v = 0
                prev_day = day
            cum = int(b.get("volume") or 0)
            b["volume"] = max(0, cum - prev_v)
            prev_v = cum

    # Fallback name from quote batch
    if not name:
        try:
            q = tencent_quote([code]).get(code) or {}
            name = q.get("name") or code
            if prev_close is None and isinstance(q.get("last_close"), (int, float)):
                prev_close = float(q["last_close"])
        except Exception:
            name = code

    return {
        "code": code,
        "name": name,
        "resolution": res if res in ("1", "5") else "1D",
        "adjust": adjust,
        "source": "tencent",
        "prev_close": prev_close,
        "bars": bars,
    }


# ---------------------------------------------------------------------------
# mootdx 惰性封装（K线 / 财务 / F10）
# ---------------------------------------------------------------------------

def _mootdx_client():
    try:
        from mootdx.quotes import Quotes
        return Quotes.factory(market="std")
    except ImportError as e:
        raise DependencyMissing("mootdx 未安装：pip install mootdx") from e


def kline(code: str, category: int = 4, offset: int = 60) -> list[dict]:
    """K线：category 4=日 5=周 6=月 11=60分钟。"""
    client = _mootdx_client()
    df = client.bars(symbol=code, category=category, offset=offset)
    return df.to_dict("records") if df is not None and not df.empty else []


def finance(code: str) -> dict:
    """季报财务快照（37 字段）。"""
    client = _mootdx_client()
    df = client.finance(symbol=code)
    if df is None or (hasattr(df, "empty") and df.empty):
        return {}
    return df.to_dict("records")[0] if hasattr(df, "to_dict") else dict(df)


# ---------------------------------------------------------------------------
# 估值计算
# ---------------------------------------------------------------------------

def calc_peg(pe: float, cagr: float) -> float:
    if cagr <= 0:
        return float("inf")
    return pe / (cagr * 100)


def pe_digestion(current_pe: float, cagr: float, target_pe: float = 30) -> float:
    if current_pe <= target_pe:
        return 0.0
    if cagr <= 0:
        return float("inf")
    return math.log(current_pe / target_pe) / math.log(1 + cagr)


def financials(code: str) -> dict:
    """财务关键指标（同花顺财务摘要，最新报告期）—— 干净可靠的营收/净利/ROE/毛利率等。

    注：mootdx finance() 的营收/净利数值不可靠(实测放大数倍)，故财务摘要走此源。
    """
    ak = _akshare()
    df = ak.stock_financial_abstract_ths(symbol=code, indicator="按报告期")
    if df is None or df.empty:
        return {}
    row = df.iloc[-1].to_dict()  # 最新报告期（按报告期升序，取末行）

    def g(k):
        v = row.get(k)
        return None if v in (False, "false", "", None) else v

    return {
        "period": g("报告期"),
        "revenue": g("营业总收入"), "revenue_yoy": g("营业总收入同比增长率"),
        "net_profit": g("净利润"), "net_profit_yoy": g("净利润同比增长率"),
        "eps": g("基本每股收益"), "bvps": g("每股净资产"),
        "roe": g("净资产收益率"), "gross_margin": g("销售毛利率"), "net_margin": g("销售净利率"),
        "op_cf_ps": g("每股经营现金流"),
    }


def valuation_percentile(code: str, period: str = "近五年") -> dict:
    """历史估值分位（百度股市通）：PE-TTM / PB 的当前值 + 历史 20/50/80 分位带 + 所处分位。

    只表达"处于历史什么位置"，不划买卖线（理杏仁式中立呈现）。
    """
    ak = _akshare()

    def _q(vals: list, p: float) -> float:
        if not vals:
            return 0.0
        idx = p * (len(vals) - 1)
        lo = int(idx)
        if lo + 1 >= len(vals):
            return vals[-1]
        frac = idx - lo
        return vals[lo] * (1 - frac) + vals[lo + 1] * frac

    metrics = {}
    for key, ind in (("pe_ttm", "市盈率(TTM)"), ("pb", "市净率")):
        try:
            df = ak.stock_zh_valuation_baidu(symbol=code, indicator=ind, period=period)
            raw = df.iloc[:, 1].dropna().astype(float).tolist()
            if not raw:
                continue
            cur = float(raw[-1])
            s = sorted(raw)
            below = sum(1 for x in s if x < cur)
            metrics[key] = {
                "current": round(cur, 2),
                "percentile": round(below / max(len(s) - 1, 1) * 100, 1),
                "min": round(s[0], 2), "max": round(s[-1], 2),
                "p20": round(_q(s, 0.2), 2), "p50": round(_q(s, 0.5), 2), "p80": round(_q(s, 0.8), 2),
                "n": len(s),
            }
        except Exception:
            continue
    return {"period": "近5年", "metrics": metrics}


def full_valuation(code: str) -> dict:
    """单票完整估值：腾讯行情 + 一致预期 EPS + 前向PE/PEG/消化年数。"""
    quotes = tencent_quote([code])
    q = quotes.get(code)
    if not q:
        raise ValueError(f"未取到 {code} 的行情")

    price = q["price"]
    out = {
        "name": q["name"], "code": code, "price": price,
        "mcap_yi": q["mcap_yi"], "pe_ttm": q["pe_ttm"], "pb": q["pb"],
        "eps_26e": None, "eps_27e": None, "pe_26e": None,
        "cagr_pct": None, "peg": None, "digest_years": None, "analyst_count": 0,
    }

    try:
        rows = profit_forecast(code)
    except DependencyMissing:
        out["forecast_note"] = "一致预期需安装 akshare"
        return out

    def _eps(row: dict):
        # 同花顺对覆盖不全的股票会缺「均值」或给 '-' 占位，硬取会让整只票的估值接口 502
        try:
            return float(str(row.get("均值", "")).replace(",", ""))
        except ValueError:
            return None

    eps_26 = eps_27 = None
    for row in rows:
        y = str(row.get("年度", ""))
        if "2026" in y:
            eps_26 = _eps(row)
            try:
                out["analyst_count"] = int(float(row.get("预测机构数") or 0))
            except (TypeError, ValueError):
                pass
        elif "2027" in y:
            eps_27 = _eps(row)

    out["eps_26e"], out["eps_27e"] = eps_26, eps_27
    if eps_26 and eps_26 > 0:
        pe_26e = price / eps_26
        out["pe_26e"] = round(pe_26e, 1)
        if eps_27:
            cagr = eps_27 / eps_26 - 1
            out["cagr_pct"] = round(cagr * 100, 0)
            peg = calc_peg(pe_26e, cagr)
            out["peg"] = round(peg, 2) if peg != float("inf") else None
            dig = pe_digestion(pe_26e, cagr)
            out["digest_years"] = round(dig, 1) if dig != float("inf") else None
    return out


# ===========================================================================
# Layer 3/4/10 · 资金面 / 筹码 / 信号（东财数据中心，移植自 a-stock-data v3.3）
#
# 合规：以下端点全部按【用户传入的单个代码】返回该股的客观公开数据（龙虎榜记录、
# 融资融券、大宗交易、股东户数、分红、资金流、解禁、板块归属、投资者问答），
# 不预置标的、不做主观评分、不给买卖建议。
# 定位调整（2026-07-05）：涨停池 / 全市场成交额榜等【客观公开榜单】现已用于产品 UI
# （每日复盘的连板股 + 成交额 TOP20）——如实展示公开榜单≠荐股，只要不附推荐/评分/预测。
# 2026-08：全市场龙虎榜同口径进 UI（公开榜单 + 免责声明）；仍不做主观评分/买卖点/预测。
# ===========================================================================

_DATACENTER_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"
_EM_MIN_INTERVAL = 1.0          # 两次东财请求最小间隔（秒），内置防封节流
_em_last_call = [0.0]
_EM_SESSIONS: dict = {}         # {direct(bool): requests.Session}

# 数据层连接模式：国内财经站（东财/腾讯/新浪）本应「直连」——很多用户开着 Clash/V2Ray
# 科学上网，系统代理会把东财这类国内站路由挂掉（典型：push2.eastmoney.com 的 CONNECT 被掐）。
# 默认 auto：先试直连、失败再降级走系统代理；探测一次后固定，避免每次都重试。
# 只有少数「必须靠代理才能出网」的环境需要 VR_DATA_PROXY=1 强制走代理。
# 注意：这只影响数据层；AI 层（可能要调国外模型）仍走各自的系统代理，不受影响。
_em_mode = ["proxy" if os.environ.get("VR_DATA_PROXY", "").strip().lower() in ("1", "true", "yes") else "auto"]


def _em_session(direct: bool):
    """东财专用会话。direct=True → `trust_env=False` 忽略 HTTP(S)_PROXY 环境变量、直连。

    直连会话不重试（探测要快，失败即降级）；代理会话保留瞬态错误退避重试。惰性构建、复用。
    """
    if direct in _EM_SESSIONS:
        return _EM_SESSIONS[direct]
    import requests

    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    s.trust_env = not direct     # 直连会话不读环境里的代理配置
    try:
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry

        retry = Retry(total=0) if direct else Retry(
            total=3, connect=3, backoff_factor=0.6,
            status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["GET"])
        adapter = HTTPAdapter(max_retries=retry)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
    except Exception:
        pass  # 老版本 urllib3 缺参数时降级为无重试
    _EM_SESSIONS[direct] = s
    return s


def em_get(url: str, params: dict | None = None, headers: dict | None = None, timeout: int = 15):
    """东财统一请求入口：串行限流 + **直连优先、失败降级系统代理**（避免科学上网代理挂掉国内站）。

    第一次请求探测：先直连（短超时、不重试），成功即固定走直连；失败则降级走系统代理并固定。
    探测结果整个进程复用，避免每次重试。`VR_DATA_PROXY=1` 可跳过探测、强制走代理。
    """
    wait = _EM_MIN_INTERVAL - (time.time() - _em_last_call[0])
    if wait > 0:
        time.sleep(wait + random.uniform(0.1, 0.5))
    try:
        mode = _em_mode[0]
        if mode != "auto":
            return _em_session(mode == "direct").get(url, params=params, headers=headers, timeout=timeout)
        # auto：先直连，成功固定 direct；直连失败再走系统代理、成功固定 proxy。
        try:
            r = _em_session(True).get(url, params=params, headers=headers, timeout=min(timeout, 8))
            _em_mode[0] = "direct"
            return r
        except Exception:
            r = _em_session(False).get(url, params=params, headers=headers, timeout=timeout)
            _em_mode[0] = "proxy"
            return r
    finally:
        _em_last_call[0] = time.time()


# ---------------------------------------------------------------------------
# 打板层 · 涨停/炸板/跌停/昨涨停 原始池（东财 push2ex，走 em_get 限流）
# ⚠️ 合规：原始池含个股 code/name —— 仅供 market.py 聚合成【不含个股名】的短线情绪指标。
#    切勿把原始池直接接成 API/UI（会甩个股名单、破产品「零标的」红线）。
# ---------------------------------------------------------------------------
_ZTB_UT = "7eea3edcaed734bea9cbfc24409ed989"


def em_zt_topic_pool(endpoint: str, date: str, sort: str = "fbt:asc") -> list[dict]:
    """东财涨停板行情中心原始池（push2ex）。
    endpoint: getTopicZTPool(涨停) / getTopicZBPool(炸板) / getTopicDTPool(跌停) / getYesterdayZTPool(昨涨停)
    date: YYYYMMDD 交易日。非交易日 / 参数错 → []。
    池内每项字段含 lbc(连板数) / zbc(炸板次数) / hybk(行业) 等。"""
    url = f"https://push2ex.eastmoney.com/{endpoint}"
    params = {"ut": _ZTB_UT, "dpt": "wz.ztzt", "Pageindex": 0,
              "pagesize": 10000, "sort": sort, "date": date}
    headers = {"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"}
    try:
        r = em_get(url, params=params, headers=headers, timeout=10)
        return (r.json().get("data") or {}).get("pool") or []
    except Exception:
        return []


def _numf(v):
    """东财数值字段可能是 '-'（停牌/无数据）→ 归一成 float 或 None。"""
    return v if isinstance(v, (int, float)) else None


def market_turnover_rank(n: int = 20) -> list[dict]:
    """全市场成交额榜（沪深京 A 股按成交额降序 TopN）。

    东财行情中心 clist。**push2(实时) 不可达时降级 push2delay(延迟行情，日榜场景足够)**。
    返回每只: code / name / price / pct / amount(成交额,元) / mcap(总市值,元) /
    float_cap(流通市值,元) / industry。
    ⚠️ 这是客观公开榜单数据（东财/同花顺同款），产品侧只做客观展示——非推荐、非预测、不评分。
    """
    params = {"pn": 1, "pz": n, "po": 1, "np": 1, "fltt": 2, "invt": 2, "fid": "f6",
              "fs": "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048",
              "fields": "f12,f14,f2,f3,f6,f20,f21,f100"}
    diff: list[dict] = []
    for host in ("push2.eastmoney.com", "push2delay.eastmoney.com"):
        try:
            r = em_get(f"https://{host}/api/qt/clist/get", params=params,
                       headers={"User-Agent": UA}, timeout=12)
            diff = (r.json().get("data") or {}).get("diff") or []
            if diff:
                break
        except Exception:
            continue
    return [{
        "code": str(d.get("f12", "")), "name": d.get("f14", ""),
        "price": _numf(d.get("f2")), "pct": _numf(d.get("f3")),
        "amount": _numf(d.get("f6")), "mcap": _numf(d.get("f20")),
        "float_cap": _numf(d.get("f21")), "industry": d.get("f100", "") or "",
    } for d in diff]


def eastmoney_datacenter(report_name: str, columns: str = "ALL", filter_str: str = "",
                         page_size: int = 50, sort_columns: str = "", sort_types: str = "-1") -> list[dict]:
    """东财数据中心统一查询 —— 龙虎榜/解禁/融资融券/大宗交易/股东户数/分红 共用（已内置限流）。"""
    params = {
        "reportName": report_name, "columns": columns, "filter": filter_str,
        "pageNumber": "1", "pageSize": str(page_size),
        "sortColumns": sort_columns, "sortTypes": sort_types, "source": "WEB", "client": "WEB",
    }
    try:
        d = em_get(_DATACENTER_URL, params=params, timeout=15).json()
    except Exception:
        return []
    if d.get("result") and d["result"].get("data"):
        return d["result"]["data"]
    return []


def margin_trading(code: str, page_size: int = 30) -> list[dict]:
    """融资融券明细（日级）：融资余额 / 融资买入 / 融券余额 / 两融合计。"""
    data = eastmoney_datacenter(
        "RPTA_WEB_RZRQ_GGMX", filter_str=f'(SCODE="{code}")',
        page_size=page_size, sort_columns="DATE", sort_types="-1")
    return [{
        "date": str(r.get("DATE", ""))[:10],
        "rzye": r.get("RZYE", 0), "rzmre": r.get("RZMRE", 0), "rzche": r.get("RZCHE", 0),
        "rqye": r.get("RQYE", 0), "rqmcl": r.get("RQMCL", 0),
        "rzrqye": r.get("RZRQYE", 0),
    } for r in data]


def block_trade(code: str, page_size: int = 20) -> list[dict]:
    """大宗交易：成交价 / 折溢价率 / 量 / 买卖方营业部。"""
    data = eastmoney_datacenter(
        "RPT_DATA_BLOCKTRADE", filter_str=f'(SECURITY_CODE="{code}")',
        page_size=page_size, sort_columns="TRADE_DATE", sort_types="-1")
    rows = []
    for r in data:
        close = r.get("CLOSE_PRICE") or 0
        deal = r.get("DEAL_PRICE") or 0
        rows.append({
            "date": str(r.get("TRADE_DATE", ""))[:10],
            "price": deal, "close": close,
            "premium_pct": round((deal / close - 1) * 100, 2) if close else 0,
            "vol": r.get("DEAL_VOLUME", 0), "amount": r.get("DEAL_AMT", 0),
            "buyer": r.get("BUYER_NAME", ""), "seller": r.get("SELLER_NAME", ""),
        })
    return rows


def holder_num_change(code: str, page_size: int = 10) -> list[dict]:
    """股东户数变化（季度级）：户数 / 环比 / 户均持股。持续减少 = 筹码集中。"""
    data = eastmoney_datacenter(
        "RPT_HOLDERNUMLATEST", filter_str=f'(SECURITY_CODE="{code}")',
        page_size=page_size, sort_columns="END_DATE", sort_types="-1")
    return [{
        "date": str(r.get("END_DATE", ""))[:10],
        "holder_num": r.get("HOLDER_NUM", 0),
        "change_ratio": r.get("HOLDER_NUM_RATIO", 0),
        "avg_shares": r.get("AVG_FREE_SHARES", 0),
    } for r in data]


def dividend_history(code: str, page_size: int = 20) -> list[dict]:
    """分红送转历史：每股派息（税前）/ 每10股转增 / 每10股送股 / 进度。"""
    data = eastmoney_datacenter(
        "RPT_SHAREBONUS_DET", filter_str=f'(SECURITY_CODE="{code}")',
        page_size=page_size, sort_columns="EX_DIVIDEND_DATE", sort_types="-1")
    return [{
        "date": str(r.get("EX_DIVIDEND_DATE", ""))[:10],
        "bonus_rmb": r.get("PRETAX_BONUS_RMB", 0),
        "transfer_ratio": r.get("TRANSFER_RATIO", 0),
        "bonus_ratio": r.get("BONUS_RATIO", 0),
        "plan": r.get("ASSIGN_PROGRESS", ""),
    } for r in data]


def stock_fund_flow_120d(code: str) -> list[dict]:
    """个股资金流（日级，最近 120 交易日）：主力 / 小单 / 中单 / 大单 / 超大单净流入（元）。"""
    market_code = 1 if code.startswith("6") else 0
    params = {
        "secid": f"{market_code}.{code}",
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
        "lmt": "120",
    }
    headers = {"User-Agent": UA, "Referer": "https://quote.eastmoney.com/", "Origin": "https://quote.eastmoney.com"}
    try:
        d = em_get("https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get",
                   params=params, headers=headers, timeout=15).json()
    except Exception:
        return []
    rows = []
    for line in d.get("data", {}).get("klines", []):
        p = line.split(",")
        if len(p) >= 6:
            def _f(x):
                try:
                    return float(x) if x not in ("-", "") else 0.0
                except ValueError:
                    return 0.0
            rows.append({
                "date": p[0], "main_net": _f(p[1]), "small_net": _f(p[2]),
                "mid_net": _f(p[3]), "large_net": _f(p[4]), "super_net": _f(p[5]),
            })
    return rows


def eastmoney_fund_flow_minute(code: str) -> list[dict]:
    """个股当日分钟级资金流（东财 push2）。单位: 元。

    返回 [{time, main_net, small_net, mid_net, large_net, super_net}, ...]。
    """
    c = (code or "").strip()
    if not re.fullmatch(r"\d{6}", c):
        return []
    secid = f"1.{c}" if c.startswith("6") else f"0.{c}"
    params = {
        "secid": secid,
        "klt": 1,
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57",
    }
    headers = {
        "User-Agent": UA,
        "Referer": "https://quote.eastmoney.com/",
        "Origin": "https://quote.eastmoney.com",
    }
    try:
        d = em_get(
            "https://push2.eastmoney.com/api/qt/stock/fflow/kline/get",
            params=params,
            headers=headers,
            timeout=10,
        ).json()
    except Exception:
        return []
    rows: list[dict] = []
    for line in (d.get("data") or {}).get("klines") or []:
        parts = str(line).split(",")
        if len(parts) < 6:
            continue

        def _f(x: str) -> float:
            try:
                return float(x) if x not in ("-", "") else 0.0
            except ValueError:
                return 0.0

        rows.append({
            "time": parts[0],
            "main_net": _f(parts[1]),
            "small_net": _f(parts[2]),
            "mid_net": _f(parts[3]),
            "large_net": _f(parts[4]),
            "super_net": _f(parts[5]),
        })
    return rows


def eastmoney_global_news(page_size: int = 50) -> list[dict]:
    """东财全球财经资讯 7x24。返回 [{id, title, summary, time}, ...]。"""
    import uuid

    n = max(10, min(int(page_size or 50), 100))
    params = {
        "client": "web",
        "biz": "web_724",
        "fastColumn": "102",
        "sortEnd": "",
        "pageSize": str(n),
        "req_trace": str(uuid.uuid4()),
    }
    headers = {"User-Agent": UA, "Referer": "https://kuaixun.eastmoney.com/"}
    try:
        d = em_get(
            "https://np-weblist.eastmoney.com/comm/web/getFastNewsList",
            params=params,
            headers=headers,
            timeout=10,
        ).json()
    except Exception:
        return []
    rows: list[dict] = []
    for i, item in enumerate((d.get("data") or {}).get("fastNewsList") or []):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        summary = str(item.get("summary") or "")[:200]
        show = str(item.get("showTime") or "")
        nid = item.get("code") or item.get("art_code") or f"{show}-{i}"
        rows.append({
            "id": nid,
            "title": title,
            "summary": summary,
            "content": summary,
            "time": show,
            "share_url": None,
        })
    return rows


def ths_limit_up_pool(date: str | None = None) -> dict:
    """同花顺涨停揭秘：涨停原因题材 / 板型 / 封板成功率。

    date: YYYYMMDD 或 YYYY-MM-DD；默认今天(北京时间)。
    返回 {date, total, source, rows:[...]}。
    """
    import requests
    from datetime import timezone as _tz

    cn = datetime.now(_tz(timedelta(hours=8)))
    raw = (date or "").strip().replace("-", "")
    if not re.fullmatch(r"\d{8}", raw):
        raw = cn.strftime("%Y%m%d")
    url = "https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool"
    params = {
        "page": 1,
        "limit": 200,
        "field": "199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004",
        "filter": "HS,GEM2STAR",
        "order_field": "330324",
        "order_type": "0",
        "date": raw,
    }
    try:
        r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=12)
        r.raise_for_status()
        info = ((r.json() or {}).get("data") or {}).get("info") or []
    except Exception:
        return {"date": raw, "total": 0, "source": "ths", "rows": [], "note": "同花顺涨停揭秘暂无数据"}

    out: list[dict] = []
    for it in info:
        if not isinstance(it, dict):
            continue
        ft = it.get("first_limit_up_time")
        first_time = ""
        try:
            if ft not in (None, "", 0, "0"):
                first_time = datetime.fromtimestamp(int(ft)).strftime("%H:%M:%S")
        except (TypeError, ValueError, OSError):
            first_time = ""
        seal = it.get("limit_up_suc_rate")
        try:
            seal_rate = round(float(seal) * 100, 1) if seal is not None else None
        except (TypeError, ValueError):
            seal_rate = None
        out.append({
            "code": str(it.get("code") or ""),
            "name": str(it.get("name") or ""),
            "price": it.get("latest"),
            "pct": it.get("change_rate"),
            "reason": str(it.get("reason_type") or ""),
            "board_type": str(it.get("limit_up_type") or ""),
            "seal_rate": seal_rate,
            "break_times": it.get("open_num") or 0,
            "seal_amount": it.get("order_amount"),
            "high_days": str(it.get("high_days") or ""),
            "first_time": first_time,
            "is_again": it.get("is_again_limit"),
        })
    return {
        "date": raw,
        "total": len(out),
        "source": "ths",
        "note": "客观公开榜单 · 含涨停原因题材 · 非推荐",
        "rows": out,
    }


def iwencai_configured() -> bool:
    return bool(os.environ.get("IWENCAI_API_KEY", "").strip())


def _iwencai_claw_headers(call_type: str = "normal") -> dict:
    import secrets

    return {
        "X-Claw-Call-Type": call_type,
        "X-Claw-Skill-Id": "report-search",
        "X-Claw-Skill-Version": "2.0.0",
        "X-Claw-Plugin-Id": "none",
        "X-Claw-Plugin-Version": "none",
        "X-Claw-Trace-Id": secrets.token_hex(32),
    }


def iwencai_search(query: str, channel: str = "report", size: int = 20) -> dict:
    """iwencai NL 语义搜索。需 IWENCAI_API_KEY + X-Claw headers。

    channel: report / announcement / news
    """
    import requests

    key = os.environ.get("IWENCAI_API_KEY", "").strip()
    if not key:
        raise DependencyMissing(
            "未配置 IWENCAI_API_KEY。在 backend/.env 设置后重启后端；仅语义搜研报需要。"
        )
    base = os.environ.get("IWENCAI_BASE_URL", "https://openapi.iwencai.com").rstrip("/")
    q = (query or "").strip()
    if not q:
        return {"query": "", "channel": channel, "items": []}
    ch = channel if channel in ("report", "announcement", "news") else "report"
    n = max(5, min(int(size or 20), 50))
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        **_iwencai_claw_headers(),
    }
    payload = {
        "channels": [ch],
        "app_id": "AIME_SKILL",
        "query": q,
        "size": n,
    }
    r = requests.post(
        f"{base}/v1/comprehensive/search",
        json=payload,
        headers=headers,
        timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"iwencai HTTP {r.status_code}: {r.text[:200]}")
    data = r.json() if r.content else {}
    if data.get("status_code", 0) != 0:
        raise RuntimeError(f"iwencai error: {data.get('status_msg', '')}")

    raw = data.get("data") or []
    # Dedup by uid, keep highest score
    best: dict[str, dict] = {}
    for a in raw:
        if not isinstance(a, dict):
            continue
        uid = a.get("uid") or f"{a.get('title', '')}|{a.get('publish_date', '')}"
        score = float(a.get("score") or 0)
        prev = best.get(uid)
        if prev is None or score > float(prev.get("score") or 0):
            best[uid] = a
    items_sorted = sorted(
        best.values(),
        key=lambda x: str(x.get("publish_date") or ""),
        reverse=True,
    )
    items: list[dict] = []
    for a in items_sorted:
        extra = a.get("extra") or {}
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except json.JSONDecodeError:
                extra = {}
        if not isinstance(extra, dict):
            extra = {}
        items.append({
            "title": str(a.get("title") or ""),
            "publish_date": str(a.get("publish_date") or "")[:10],
            "score": a.get("score"),
            "organization": extra.get("organization") or extra.get("org") or "",
            "url": a.get("url") or a.get("link") or None,
            "channel": ch,
        })
    return {"query": q, "channel": ch, "count": len(items), "items": items}


def dragon_tiger_board(code: str, trade_date: str | None = None, look_back: int = 30) -> dict:
    """龙虎榜：该股近期上榜记录 + 最近一次买卖席位 TOP5 + 机构专用席位净买。"""
    trade_date = trade_date or datetime.now().strftime("%Y-%m-%d")
    start = (datetime.strptime(trade_date, "%Y-%m-%d") - timedelta(days=look_back)).strftime("%Y-%m-%d")
    records = []
    data = eastmoney_datacenter(
        "RPT_DAILYBILLBOARD_DETAILSNEW",
        filter_str=f'(TRADE_DATE>=\'{start}\')(TRADE_DATE<=\'{trade_date}\')(SECURITY_CODE="{code}")',
        page_size=50, sort_columns="TRADE_DATE", sort_types="-1")
    for r in data:
        records.append({
            "date": str(r.get("TRADE_DATE", ""))[:10],
            "reason": r.get("EXPLANATION", ""),
            "net_buy": round((r.get("BILLBOARD_NET_AMT") or 0) / 10000, 1),  # 万元
            "turnover": round(float(r.get("TURNOVERRATE") or 0), 2),
        })

    seats = {"buy": [], "sell": []}
    institution = {"buy_amt": 0.0, "sell_amt": 0.0, "net_amt": 0.0}
    if records:
        latest = records[0]["date"]
        buy_data = eastmoney_datacenter(
            "RPT_BILLBOARD_DAILYDETAILSBUY",
            filter_str=f'(TRADE_DATE=\'{latest}\')(SECURITY_CODE="{code}")',
            page_size=10, sort_columns="BUY", sort_types="-1")
        sell_data = eastmoney_datacenter(
            "RPT_BILLBOARD_DAILYDETAILSSELL",
            filter_str=f'(TRADE_DATE=\'{latest}\')(SECURITY_CODE="{code}")',
            page_size=10, sort_columns="SELL", sort_types="-1")
        for r in buy_data[:5]:
            seats["buy"].append({"name": r.get("OPERATEDEPT_NAME", ""),
                                 "buy_amt": round((r.get("BUY") or 0) / 10000, 1),
                                 "sell_amt": round((r.get("SELL") or 0) / 10000, 1),
                                 "net": round((r.get("NET") or 0) / 10000, 1)})
        for r in sell_data[:5]:
            seats["sell"].append({"name": r.get("OPERATEDEPT_NAME", ""),
                                  "buy_amt": round((r.get("BUY") or 0) / 10000, 1),
                                  "sell_amt": round((r.get("SELL") or 0) / 10000, 1),
                                  "net": round((r.get("NET") or 0) / 10000, 1)})
        for detail, side in ((buy_data, "buy"), (sell_data, "sell")):
            for r in detail:
                if str(r.get("OPERATEDEPT_CODE", "")) == "0":  # 机构专用席位
                    amt = (r.get("BUY") or 0) if side == "buy" else (r.get("SELL") or 0)
                    institution[f"{side}_amt"] += amt
        institution["buy_amt"] = round(institution["buy_amt"] / 10000, 1)
        institution["sell_amt"] = round(institution["sell_amt"] / 10000, 1)
        institution["net_amt"] = round(institution["buy_amt"] - institution["sell_amt"], 1)
    return {"records": records, "seats": seats, "institution": institution}


def daily_dragon_tiger(
    trade_date: str | None = None,
    min_net_buy: float | None = None,
    look_back_days: int = 10,
    top: int = 50,
) -> dict:
    """全市场龙虎榜（东财公开榜单）。默认取最近有数据的交易日。

    金额单位：万元。客观榜单呈现，不附推荐/评分。
    """
    n = max(5, min(int(top or 50), 200))
    start_day = trade_date or datetime.now().strftime("%Y-%m-%d")
    try:
        base = datetime.strptime(start_day, "%Y-%m-%d")
    except ValueError:
        base = datetime.now()
        start_day = base.strftime("%Y-%m-%d")

    data: list[dict] = []
    actual_date = start_day
    # If explicit date empty, walk back a few calendar days (weekends / late publish)
    days = 1 if trade_date else max(1, min(int(look_back_days or 10), 15))
    for i in range(days):
        d = (base - timedelta(days=i)).strftime("%Y-%m-%d")
        rows = eastmoney_datacenter(
            "RPT_DAILYBILLBOARD_DETAILSNEW",
            filter_str=f"(TRADE_DATE>='{d}')(TRADE_DATE<='{d}')",
            page_size=500,
            sort_columns="BILLBOARD_NET_AMT",
            sort_types="-1",
        )
        if rows:
            data = rows
            actual_date = str(rows[0].get("TRADE_DATE") or d)[:10]
            break

    if not data:
        return {
            "date": start_day,
            "total_records": 0,
            "stocks": [],
            "note": "无数据(非交易日或盘后未更新)",
        }

    stocks = []
    for row in data:
        net_buy = (row.get("BILLBOARD_NET_AMT") or 0) / 10000
        if min_net_buy is not None and net_buy < min_net_buy:
            continue
        stocks.append({
            "code": row.get("SECURITY_CODE") or "",
            "name": row.get("SECURITY_NAME_ABBR") or "",
            "reason": row.get("EXPLANATION") or "",
            "close": row.get("CLOSE_PRICE") or 0,
            "change_pct": round(float(row.get("CHANGE_RATE") or 0), 2),
            "net_buy_wan": round(net_buy, 1),
            "buy_wan": round((row.get("BILLBOARD_BUY_AMT") or 0) / 10000, 1),
            "sell_wan": round((row.get("BILLBOARD_SELL_AMT") or 0) / 10000, 1),
            "turnover_pct": round(float(row.get("TURNOVERRATE") or 0), 2),
        })
        if len(stocks) >= n:
            break
    return {
        "date": actual_date,
        "total_records": len(stocks),
        "stocks": stocks,
        "note": "公开榜单,仅客观呈现,不构成投资建议",
    }


def lockup_expiry(code: str, trade_date: str | None = None, forward_days: int = 90) -> dict:
    """限售解禁日历：历史解禁记录 + 未来 N 天待解禁事件。

    字段随东财 2026 改列名同步（a-stock-data §3.6）：旧 LIMITED_STOCK_TYPE/FREE_SHARES_NUM
    已废、致 type/shares 恒空 → 改 FREE_SHARES_TYPE/FREE_SHARES，并补 able_shares（实际可流通股数）。
    """
    trade_date = trade_date or datetime.now().strftime("%Y-%m-%d")
    history = [{
        "date": str(r.get("FREE_DATE", ""))[:10], "type": r.get("FREE_SHARES_TYPE", ""),
        "shares": r.get("FREE_SHARES", 0), "able_shares": r.get("ABLE_FREE_SHARES", 0),
        "ratio": r.get("FREE_RATIO", 0),
    } for r in eastmoney_datacenter(
        "RPT_LIFT_STAGE", filter_str=f'(SECURITY_CODE="{code}")',
        page_size=15, sort_columns="FREE_DATE", sort_types="-1")]

    end = (datetime.strptime(trade_date, "%Y-%m-%d") + timedelta(days=forward_days)).strftime("%Y-%m-%d")
    upcoming = [{
        "date": str(r.get("FREE_DATE", ""))[:10], "type": r.get("FREE_SHARES_TYPE", ""),
        "shares": r.get("FREE_SHARES", 0), "able_shares": r.get("ABLE_FREE_SHARES", 0),
        "ratio": r.get("FREE_RATIO", 0),
    } for r in eastmoney_datacenter(
        "RPT_LIFT_STAGE",
        filter_str=f'(SECURITY_CODE="{code}")(FREE_DATE>=\'{trade_date}\')(FREE_DATE<=\'{end}\')',
        page_size=20, sort_columns="FREE_DATE", sort_types="1")]
    return {"history": history, "upcoming": upcoming}


def concept_blocks(code: str) -> dict:
    """个股所属板块/概念归属（东财 slist，行业/概念/地域混合，板块名自解释）。"""
    market_code = 1 if code.startswith("6") else 0
    params = {"fltt": "2", "invt": "2", "secid": f"{market_code}.{code}",
              "spt": "3", "pi": "0", "pz": "200", "po": "1", "fields": "f12,f14,f3,f128"}
    headers = {"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"}
    try:
        d = em_get("https://push2.eastmoney.com/api/qt/slist/get", params=params, headers=headers, timeout=15).json()
    except Exception:
        return {"total": 0, "boards": [], "concept_tags": []}
    diff = (d.get("data") or {}).get("diff") or {}
    items = diff.values() if isinstance(diff, dict) else diff
    boards = [{"name": it.get("f14", ""), "code": it.get("f12", ""),
               "change_pct": it.get("f3", ""), "lead_stock": it.get("f128", "")} for it in items]
    return {"total": len(boards), "boards": boards, "concept_tags": [b["name"] for b in boards]}


def hot_concepts(code: str) -> list[dict]:
    """个股当下被市场归到哪些概念在炒（东财热门概念命中，按热度降序）。"""
    import requests

    try:
        prefix = "SH" if code.startswith("6") else "SZ"
        r = requests.post(
            "https://emappdata.eastmoney.com/stockrank/getHotStockRankList",
            json={"appId": "appId01", "globalId": "786e4c21-70dc-435a-93bb-38", "srcSecurityCode": prefix + code},
            headers={"User-Agent": UA}, timeout=10)
        data = r.json().get("data") or []
    except Exception:
        return []
    return [{"concept": x.get("conceptName"), "bk": x.get("conceptId"), "hit": x.get("hitCount")} for x in data]


def investor_qa(code: str, page_size: int = 40) -> list[dict]:
    """互动易问答（巨潮）：投资者提问 + 公司回复（answer=None 表示未回复）。

    Latest asks are often unanswered; return list with answered items first
    so the dashboard can surface company replies without paging deep.
    """
    import requests

    n = max(10, min(int(page_size or 40), 80))
    try:
        r1 = requests.post(
            "https://irm.cninfo.com.cn/newircs/index/queryKeyboardInfo",
            data={"keyWord": code},
            headers={"User-Agent": UA},
            timeout=10,
        )
        d1 = r1.json().get("data") or []
        if not d1:
            return []
        org_id = d1[0].get("secid")
        # Params must be query string (POST with empty body), else HTTP 400
        params = {
            "_t": 1, "stockcode": code, "orgId": org_id, "pageSize": n,
            "pageNum": 1, "keyWord": "", "startDay": "", "endDay": "",
        }
        rows = (
            requests.post(
                "https://irm.cninfo.com.cn/newircs/company/question",
                params=params,
                headers={"User-Agent": UA},
                timeout=10,
            ).json().get("rows")
            or []
        )
    except Exception:
        return []
    out: list[dict] = []
    for it in rows:
        ts = it.get("pubDate")
        ans = it.get("attachedContent")
        if isinstance(ans, str):
            ans = ans.strip() or None
        out.append({
            "company": it.get("companyShortName"),
            "question": it.get("mainContent"),
            "answer": ans,
            "answerer": it.get("attachedAuthor"),
            "ask_time": datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M") if ts else "",
        })
    # Answered first (newest within each bucket) so UI surfaces company replies
    answered = sorted(
        [x for x in out if x.get("answer")],
        key=lambda x: x.get("ask_time") or "",
        reverse=True,
    )
    pending = sorted(
        [x for x in out if not x.get("answer")],
        key=lambda x: x.get("ask_time") or "",
        reverse=True,
    )
    return answered + pending


def industry_comparison(top_n: int = 20) -> dict:
    """全行业涨跌幅排名（东财行业板块，~100 个行业）：板块级涨跌 / 涨跌家数 / 领涨。

    push2(实时) 不可达时降级 push2delay(延迟行情)，与 market_turnover_rank 同策略。
    """
    params = {"pn": "1", "pz": "100", "po": "1", "np": "1", "fltt": "2", "invt": "2",
              "fid": "f3",  # fid=f3 + po=1：按涨跌幅降序，否则 top/bottom 切片非涨幅序（a-stock-data §3.7）
              "fs": "m:90+t:2", "fields": "f2,f3,f4,f12,f13,f14,f104,f105,f128,f136,f140,f141,f207"}
    items: list = []
    for host in ("push2.eastmoney.com", "push2delay.eastmoney.com"):
        try:
            d = em_get(f"https://{host}/api/qt/clist/get",
                       params=params, headers={"User-Agent": UA}, timeout=15).json()
            raw = (d.get("data") or {}).get("diff") or []
            if isinstance(raw, dict):
                raw = list(raw.values())
            if raw:
                items = raw
                break
        except Exception:
            continue
    if not items:
        return {"top": [], "bottom": [], "total": 0}
    rows = [{
        "rank": i + 1, "name": it.get("f14", ""), "change_pct": it.get("f3", 0) or 0,
        "code": it.get("f12", ""), "up_count": it.get("f104", 0), "down_count": it.get("f105", 0),
    } for i, it in enumerate(items)]
    # bottom: reverse ascending by pct (worst first), not just tail of sorted-desc list
    # (tail of desc list is correct for worst N when list is full-market sorted)
    return {"top": rows[:top_n], "bottom": list(reversed(rows[-top_n:])), "total": len(rows)}


# ---------------------------------------------------------------------------
# Distilled from cn-financial-scraper v4.7+: ETF flow / insider changes / LPR / CN bond yield
# Objective public data only; no rankings-as-recommendations.
# ---------------------------------------------------------------------------

def _safe_float(val, default: float = 0.0) -> float:
    if val is None:
        return default
    if isinstance(val, str) and val.strip() in ("-", "--", "", "—"):
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _norm_date(val) -> str:
    if val is None:
        return ""
    s = str(val).strip().replace("/", "-").replace(".", "-")
    if not s:
        return ""
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        return s[:10]


def etf_fund_flow(sort_by: str = "net_inflow", limit: int = 50) -> list[dict]:
    """ETF 资金流向排行（东财 push2 clist, fs=b:MK0021）。

    sort_by: net_inflow (主力净流入) | change_pct
    金额字段单位: 亿元。客观公开榜单, 非推荐。
    """
    n = max(5, min(int(limit or 50), 100))
    fid = "f3" if sort_by == "change_pct" else "f62"
    # po=1: descending (largest inflow / biggest gain first)
    params = {
        "pn": "1", "pz": str(n), "po": "1", "np": "1", "fltt": "2", "invt": "2",
        "fid": fid, "fs": "b:MK0021",
        "fields": "f12,f14,f2,f3,f20,f62,f66,f69,f72,f75,f78,f81,f84,f87,f124",
    }
    headers = {"User-Agent": UA, "Referer": "https://data.eastmoney.com/"}
    diff: list = []
    for host in ("push2.eastmoney.com", "push2delay.eastmoney.com"):
        try:
            d = em_get(
                f"https://{host}/api/qt/clist/get",
                params=params, headers=headers, timeout=12,
            ).json()
            raw = (d.get("data") or {}).get("diff") or []
            if isinstance(raw, dict):
                raw = list(raw.values())
            if raw:
                diff = raw
                break
        except Exception:
            continue
    out: list[dict] = []
    for it in diff:
        if not isinstance(it, dict):
            continue
        ts = it.get("f124")
        update_time = ""
        try:
            if isinstance(ts, (int, float)) and ts > 1e9:
                update_time = datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M")
            elif ts not in (None, "", "-"):
                update_time = str(ts)
        except (TypeError, ValueError, OSError):
            update_time = ""
        out.append({
            "code": str(it.get("f12") or ""),
            "name": str(it.get("f14") or ""),
            "price": _safe_float(it.get("f2")),
            "change_pct": _safe_float(it.get("f3")),
            "total_mv": round(_safe_float(it.get("f20")) / 1e8, 2),
            "main_net_inflow": round(_safe_float(it.get("f62")) / 1e8, 2),
            "super_large_net": round(_safe_float(it.get("f66")) / 1e8, 2),
            "large_net": round(_safe_float(it.get("f72")) / 1e8, 2),
            "medium_net": round(_safe_float(it.get("f78")) / 1e8, 2),
            "small_net": round(_safe_float(it.get("f84")) / 1e8, 2),
            "update_time": update_time,
        })
    return out


def shareholder_changes(
    code: str = "",
    change_type: str = "all",
    limit: int = 50,
) -> list[dict]:
    """股东/高管增减持（东财 RPT_EXECUTIVE_HOLD_DETAILS）。

    change_type: all | 增持 | 减持
    code 为空时返回全市场最近变动; 有 code 时按个股过滤。
    """
    n = max(5, min(int(limit or 50), 100))
    c = (code or "").strip()
    if c and not re.fullmatch(r"\d{6}", c):
        return []
    filt = f'(SECURITY_CODE="{c}")' if c else ""
    # Fetch extra rows so local 增持/减持 filter still yields ~n
    fetch_n = n if change_type in ("", "all") else min(n * 3, 100)
    data = eastmoney_datacenter(
        "RPT_EXECUTIVE_HOLD_DETAILS",
        filter_str=filt,
        page_size=fetch_n,
        sort_columns="CHANGE_DATE",
        sort_types="-1",
    )
    want = change_type if change_type in ("增持", "减持") else "all"
    out: list[dict] = []
    for it in data:
        shares = _safe_float(it.get("CHANGE_SHARES"))
        direction = "增持" if shares >= 0 else "减持"
        if want != "all" and direction != want:
            continue
        out.append({
            "date": _norm_date(it.get("CHANGE_DATE")),
            "code": str(it.get("SECURITY_CODE") or ""),
            "name": str(it.get("SECURITY_NAME") or it.get("SECURITY_NAME_ABBR") or ""),
            "person": str(it.get("PERSON_NAME") or ""),
            "change_type": direction,
            "change_shares": shares,
            "change_ratio": _safe_float(it.get("CHANGE_RATIO")),
            "avg_price": _safe_float(it.get("AVERAGE_PRICE")),
            "change_amount": _safe_float(it.get("CHANGE_AMOUNT")),
            "after_holding": _safe_float(it.get("CHANGE_AFTER_HOLDNUM")),
            "reason": str(it.get("CHANGE_REASON") or ""),
            "position": str(it.get("POSITION_NAME") or ""),
        })
        if len(out) >= n:
            break
    return out


def lpr_rates(days: int = 365) -> list[dict]:
    """LPR 贷款市场报价利率历史（全国银行间同业拆借中心 chinamoney）。

    返回 [{date, one_year, five_year}, ...]，按日期降序。失败返回 []。
    """
    import requests

    d = max(30, min(int(days or 365), 2000))
    page_size = max(1, min(d // 20 + 10, 200))
    url = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis"
    headers = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.chinamoney.com.cn/chinese/bklpr/",
    }
    try:
        r = requests.post(
            url,
            json={"pageNum": 1, "pageSize": page_size},
            headers=headers,
            timeout=15,
        )
        r.raise_for_status()
        payload = r.json()
    except Exception:
        return []
    records = payload.get("records") or payload.get("data") or []
    seen: dict[str, dict] = {}
    for row in records:
        if not isinstance(row, dict):
            continue
        date = _norm_date(row.get("showDateCN") or row.get("showDateEN") or "")
        if not date:
            continue
        seen[date] = {
            "date": date,
            "one_year": _safe_float(row.get("1Y")),
            "five_year": _safe_float(row.get("5Y")),
        }
    rows = sorted(seen.values(), key=lambda x: x["date"], reverse=True)
    # LPR updates monthly; keep roughly days/28 + buffer
    keep = max(3, min(len(rows), d // 28 + 3))
    return rows[:keep]


def bond_yield_curve(curve_type: str = "treasury") -> dict:
    """中债国债/政策性金融债收益率曲线（chinabond inityc）。

    返回 {date, curve_type, source, terms, spread_10_2, spread_30_10, curve_points}。
    失败返回 {error, warning, terms:{}, curve_points:[]}。
    """
    import requests

    xyz = "txy" if curve_type != "policy" else "tpxy"
    url = "https://yield.chinabond.com.cn/cbweb-mn/yc/inityc"
    headers = {
        "User-Agent": UA,
        "Accept": "application/json, text/javascript, */*",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://yield.chinabond.com.cn/cbweb-mn/yield_main?locale=zh_CN",
    }
    form = {
        "xyzSelect": xyz,
        "workTime": "",
        "dxbj": "0",
        "qxll": "0",
        "yqqxN": "N",
        "yqqxK": "K",
        "wrjxCBFlag": "0",
        "locale": "zh_CN",
    }
    empty = {
        "date": "", "curve_type": "", "source": "chinabond.com.cn",
        "terms": {}, "curve_points": [],
        "spread_10_2": None, "spread_30_10": None,
    }
    try:
        r = requests.post(url, data=form, headers=headers, timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        return {**empty, "error": str(e)[:120], "warning": "中债登接口不可用"}

    try:
        if not isinstance(data, list) or len(data) < 2:
            return {**empty, "error": "bad_shape", "warning": "中债登返回格式异常"}
        curve_obj = None
        if isinstance(data[1], list) and data[1]:
            inner = data[1][1] if len(data[1]) > 1 else data[1][0]
            if isinstance(inner, list) and inner:
                curve_obj = inner[0]
            elif isinstance(inner, dict):
                curve_obj = inner
        if not isinstance(curve_obj, dict):
            return {**empty, "error": "empty_curve", "warning": "当前无曲线数据"}
        series = curve_obj.get("seriesData") or []
        worktime = _norm_date(curve_obj.get("worktime"))
        curve_name = str(curve_obj.get("ycDefName") or "国债收益率曲线")
    except (IndexError, TypeError, KeyError) as e:
        return {**empty, "error": str(e)[:80], "warning": "中债登解析失败"}

    target_years = {"1Y": 1, "2Y": 2, "3Y": 3, "5Y": 5, "7Y": 7, "10Y": 10, "30Y": 30}
    terms: dict[str, float] = {}
    for label, year in target_years.items():
        best = None
        best_diff = float("inf")
        for pt in series:
            try:
                y, v = float(pt[0]), float(pt[1])
            except (TypeError, ValueError, IndexError):
                continue
            diff = abs(y - year)
            if diff < best_diff:
                best_diff = diff
                best = v
        if best is not None and best_diff < 0.05:
            terms[label] = round(best, 4)

    points: list[list[float]] = []
    for p in series:
        try:
            if len(p) >= 2:
                points.append([round(float(p[0]), 3), round(float(p[1]), 4)])
        except (TypeError, ValueError, IndexError):
            continue

    result = {
        "date": worktime,
        "curve_type": curve_name,
        "source": "中债登 chinabond.com.cn",
        "terms": terms,
        "curve_points": points,
        "spread_10_2": round(terms["10Y"] - terms["2Y"], 4) if "10Y" in terms and "2Y" in terms else None,
        "spread_30_10": round(terms["30Y"] - terms["10Y"], 4) if "30Y" in terms and "10Y" in terms else None,
    }
    return result
