from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

import ctp_account as ctp
import myreports as mr
import portfolio as pf

router = APIRouter(tags=["portfolio"])

class HoldingIn(BaseModel):
    code: str
    shares: float
    cost: float


class ReportIn(BaseModel):
    name: str
    content_b64: str


class CloseIn(BaseModel):
    code: str
    date: str
    price: float
    shares: float
    cost: float

@router.get("/api/portfolio")
def portfolio_get():
    """持仓 + 实时盈亏（浮动盈亏红涨绿跌）。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:
        raise HTTPException(502, f"持仓读取异常：{e}") from e


@router.post("/api/portfolio/holding")
def portfolio_add(h: HoldingIn):
    """加一笔持仓（同代码按加权平均成本合并）。存本地，不上传。"""
    code = (h.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    if h.shares <= 0:
        raise HTTPException(400, "数量必须大于 0")
    # 成本价不限正负：融券 / 返息 / 摊薄后为负成本等情形按结果计算，用户想怎么输就怎么输。
    return {"data": pf.add_holding(code, h.shares, h.cost)}


@router.delete("/api/portfolio/holding")
def portfolio_remove(code: str = Query(...)):
    return {"data": pf.remove_holding(code.strip())}


@router.get("/api/myreports")
def myreports_list():
    return {"data": mr.list_reports()}


@router.post("/api/myreports")
def myreports_upload(r: ReportIn):
    """上传一份研报（base64）→ 存本地 + 按文件名自动打行业标签。"""
    try:
        return {"data": mr.save_report(r.name, r.content_b64)}
    except mr.ReportError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/api/myreports/file/{rid}")
def myreports_file(rid: str):
    """下载/预览某份研报原文件。"""
    hit = mr.report_path(rid)
    if not hit:
        raise HTTPException(404, "研报不存在")
    path, name = hit
    return FileResponse(str(path), filename=name)


@router.delete("/api/myreports/{rid}")
def myreports_delete(rid: str):
    return {"data": {"ok": mr.delete_report(rid)}}


@router.post("/api/portfolio/close")
def portfolio_close(c: CloseIn):
    """记一笔已清仓（已实现盈亏）。存本地。"""
    code = (c.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    if c.price <= 0 or c.shares <= 0:
        raise HTTPException(400, "清仓价与股数必须大于 0")
    # 买入成本不限正负（同持仓录入）：按 (清仓价 - 成本) × 股数 的结果计算已实现盈亏。
    date = (c.date or "").strip()
    if not date:
        raise HTTPException(400, "请填清仓日期")
    from datetime import datetime

    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "清仓日期格式应为 YYYY-MM-DD") from None
    return {"data": pf.close_position(code, date, c.price, c.shares, c.cost)}


@router.delete("/api/portfolio/close")
def portfolio_close_remove(index: int = Query(...)):
    return {"data": pf.remove_closed(index)}


@router.post("/api/portfolio/refresh")
def portfolio_refresh():
    """手动刷新：立即重拉行情算盈亏。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:
        raise HTTPException(502, f"刷新失败：{e}") from e


@router.get("/api/portfolio/ctp/status")
def portfolio_ctp_status():
    """CTP 配置 / 依赖 / 登录状态（不主动连前置）。"""
    return {"data": ctp.config_status()}


@router.get("/api/portfolio/ctp/logs")
def portfolio_ctp_logs(since: int = Query(0, ge=0)):
    """CTP 操作日志（供前端轮询）。"""
    return {"data": ctp.get_logs(since)}


@router.post("/api/portfolio/ctp/login")
def portfolio_ctp_login():
    """点击登录：连前置 + 认证 + 登录，保持会话（不下单）。"""
    try:
        return {"data": ctp.login()}
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"CTP 登录异常：{e}") from e


@router.post("/api/portfolio/ctp/logout")
def portfolio_ctp_logout():
    """退出登录，断开 CTP 会话。"""
    try:
        return {"data": ctp.logout()}
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"CTP 退出异常：{e}") from e


@router.get("/api/portfolio/ctp")
def portfolio_ctp():
    """CTP 只读查询资金 + 持仓（需已登录，不下单）。"""
    try:
        return {"data": ctp.fetch_portfolio()}
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"CTP 持仓查询异常：{e}") from e


@router.get("/api/portfolio/ctp/market-equity")
def portfolio_ctp_market_equity():
    """轮询后台市值权益任务(期权合约/行情流控, 不阻塞主查询)。"""
    return {"data": ctp.get_market_equity_job()}


@router.get("/api/portfolio/ctp/settlement")
def portfolio_ctp_settlement(
    day: str = Query(..., description="YYYYMMDD 或 YYYYMM"),
    force: bool = Query(False, description="忽略本地缓存强制重查"),
):
    """查单日结算单并解析市值权益（有缓存则直接读本地）。"""
    try:
        return {"data": ctp.fetch_settlement(day, force=force)}
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"CTP 结算单查询异常：{e}") from e


@router.get("/api/portfolio/ctp/settlement/range")
def portfolio_ctp_settlement_range(
    start: str = Query(..., description="开始日 YYYYMMDD / YYYY-MM-DD"),
    end: str | None = Query(None, description="结束日, 默认今天"),
    refresh: bool = Query(True, description="是否向 CTP 补拉缺失日"),
    force: bool = Query(False, description="忽略缓存全部重查"),
):
    """日期区间结算单: 本地缓存优先, 缺失日登录后补拉, 返回市值权益序列。"""
    try:
        return {
            "data": ctp.fetch_settlement_range(
                start, end, refresh=refresh, force=force,
            )
        }
    except ctp.CtpError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"CTP 结算区间查询异常：{e}") from e
