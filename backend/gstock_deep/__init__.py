"""美股 / 港股深度数据 —— 移植自 global-stock-data V2 子集。

覆盖:
- Yahoo: 估值 / 分析师 / 机构持仓
- 东财: 三表关键科目 + 日级资金流
- SEC EDGAR: 个股申报列表 / 全市场当日流 (需 VR_SEC_CONTACT)
- FINRA: 空头成交量时序
- Nasdaq: 财报日历

合规: 客观数据整理, 不推荐不预测. SEC 须声明 UA (VR_SEC_CONTACT).
"""
from __future__ import annotations

from gstock_deep.common import DataNotAvailable, _FORM_LABEL, _UA, _YAHOO_UA, _sec_contact
from gstock_deep.yahoo import (
    analyst_estimates,
    institutional_holders,
    key_statistics,
    stock_fundamentals,
    stock_news,
    to_yahoo_symbol,
)
from gstock_deep.eastmoney import financial_statements, fund_flow_daily
from gstock_deep.official import official_get
from gstock_deep.sec import daily_filings, sec_filings, ticker_to_cik
from gstock_deep.finra import short_volume_all, short_volume_symbol
from gstock_deep.earnings import earnings_calendar, earnings_calendar_range
from gstock_deep.treasury import treasury_curve_overview, treasury_yield_curve
from gstock_deep.options import (
    assert_us_ticker,
    chain_summary,
    filter_expiry,
    options_chain_cboe,
    options_overview,
    parse_osi,
    unusual_activity,
)
from gstock_deep.edgar import edgar_screener, frame_ranking, market_frame
from gstock_deep.movers import (
    market_movers,
    market_stock_list,
    short_volume_ranking,
    short_volume_ranking_overview,
)

__all__ = [
    "DataNotAvailable",
    "to_yahoo_symbol",
    "stock_news",
    "key_statistics",
    "analyst_estimates",
    "institutional_holders",
    "stock_fundamentals",
    "financial_statements",
    "fund_flow_daily",
    "official_get",
    "ticker_to_cik",
    "sec_filings",
    "daily_filings",
    "short_volume_all",
    "short_volume_symbol",
    "earnings_calendar",
    "earnings_calendar_range",
    "treasury_yield_curve",
    "treasury_curve_overview",
    "assert_us_ticker",
    "parse_osi",
    "options_chain_cboe",
    "filter_expiry",
    "unusual_activity",
    "chain_summary",
    "options_overview",
    "market_frame",
    "frame_ranking",
    "edgar_screener",
    "market_stock_list",
    "market_movers",
    "short_volume_ranking_overview",
    "short_volume_ranking",
]
