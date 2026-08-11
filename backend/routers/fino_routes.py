from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import fino

router = APIRouter(tags=["fino"])

def _fino_call(fn, label: str):
    """Fino 端点统一异常包装: 缺依赖 501, 其他 502."""
    try:
        return {"data": fn()}
    except fino.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"Fino {label}异常: {e}") from e

@router.get("/api/fino/overview")
def fino_overview(
    report_type: str = Query("daily", description="daily / weekly"),
    start_date: str = Query("", description="起始日 YYYYMMDD, 空则今天"),
    end_date: str = Query("", description="截止日 YYYYMMDD, 空则今天"),
    codes: str = Query("", description="品种代码逗号分隔, 如 CU,RB; 空则全量"),
):
    """Fino 机构观点汇总。缓存 10 分钟。"""
    code_list = [c for c in codes.split(",") if c.strip()]
    return _fino_call(
        lambda: fino.get_overview(
            report_type.strip(), start_date.strip(), end_date.strip(), code_list
        ),
        "机构观点汇总",
    )


@router.get("/api/fino/detail")
def fino_detail(
    report_type: str = Query("daily", description="daily / weekly"),
    start_date: str = Query("", description="起始日 YYYYMMDD, 空则今天"),
    end_date: str = Query("", description="截止日 YYYYMMDD, 空则今天"),
    codes: str = Query("", description="品种代码逗号分隔, 如 CU,RB; 空则全量"),
):
    """Fino 机构观点明细 (逐条)。缓存 10 分钟。"""
    code_list = [c for c in codes.split(",") if c.strip()]
    return _fino_call(
        lambda: fino.get_detail(
            report_type.strip(), start_date.strip(), end_date.strip(), code_list
        ),
        "机构观点明细",
    )
