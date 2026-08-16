"""Vibe-Research 后端 —— A股数据层 HTTP 接口（FastAPI）。

端点全部在 /api 下，前端 vite 代理 /api → localhost:8900。
只读、无状态、按用户传入代码返回客观数据。不预置标的、不建议。

启动：
    uvicorn app:app --host 127.0.0.1 --port 8900
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv(path: Path | None = None) -> None:
    """Load backend/.env into os.environ (no python-dotenv dependency).

    Existing process env wins. Lines: KEY=VALUE, optional quotes, # comments.
    """
    env_path = path or Path(__file__).with_name(".env")
    if not env_path.is_file():
        return
    try:
        text = env_path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        os.environ[key] = val


_load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import portfolio as pf
import review_mail
import review_warmup
from api_common import _warm_review_dc
from routers import (
    ai,
    ai_watch_routes,
    ashare,
    core,
    fin_routes,
    fino_routes,
    global_routes,
    market_routes,
    ovlab_routes,
    portfolio,
    research_routes,
)
from version import read_version

__version__ = read_version()

app = FastAPI(title="Vibe-Research API", version=__version__)

# 每半小时后台刷新持仓数据
pf.start_scheduler(1800)

# CORS：默认放开（本地自托管友好）；公网部署时用 VR_ALLOW_ORIGINS 收紧成白名单。
#   例：VR_ALLOW_ORIGINS="https://myhost"  （逗号分隔多个）
_ORIGINS = [
    o.strip() for o in os.environ.get("VR_ALLOW_ORIGINS", "*").split(",") if o.strip()
] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 可选鉴权：设了 VR_API_KEY 就要求所有 /api/* 带 `Authorization: Bearer <key>`
#   （本地自托管不设=开放；公网部署务必设，否则别人能读你的持仓/调你的后端）。
_API_KEY = os.environ.get("VR_API_KEY", "").strip()


@app.middleware("http")
async def _require_api_key(request: Request, call_next):
    if (
        _API_KEY
        and request.method != "OPTIONS"
        and request.url.path.startswith("/api/")
        and request.url.path != "/api/health"
    ):
        if request.headers.get("authorization", "") != f"Bearer {_API_KEY}":
            return JSONResponse(
                {"detail": "未授权：缺少或错误的 API Key（VR_API_KEY）"},
                status_code=401,
            )
    return await call_next(request)


app.include_router(core.router)
app.include_router(ai.router)
app.include_router(portfolio.router)
app.include_router(market_routes.router)
app.include_router(global_routes.router)
app.include_router(ashare.router)
app.include_router(ovlab_routes.router)
app.include_router(fino_routes.router)
app.include_router(ai_watch_routes.router)
app.include_router(fin_routes.router)
app.include_router(research_routes.router)

# Background: keep Daily Review caches warm (session-aware interval).
review_warmup.start_scheduler(extra=_warm_review_dc)
# Opt-in: weekday AI review email (VR_REVIEW_MAIL=1).
review_mail.start_scheduler()
