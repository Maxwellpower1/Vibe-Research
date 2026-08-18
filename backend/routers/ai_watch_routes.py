from fastapi import APIRouter, HTTPException

import ai_watch
from api_common import _dc

router = APIRouter(tags=["ai-watch"])


@router.get("/api/ai-watch/openrouter-usage")
def openrouter_usage():
    try:
        data = _dc("aiw_or", "all", 3600, ai_watch.handle_openrouter_usage)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"OpenRouter 用量异常: {e}") from e


@router.get("/api/ai-watch/spend-index")
def spend_index():
    try:
        data = _dc("aiw_ttsi", "all", 3600, ai_watch.handle_spend_index)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"TTSI 支出指数异常: {e}") from e


@router.get("/api/ai-watch/aa-models")
def aa_models():
    try:
        data = _dc("aiw_aa", "all", 86400, ai_watch.handle_aa_models)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"大模型价格表异常: {e}") from e


@router.get("/api/ai-watch/ai-infra")
def ai_infra():
    try:
        data = _dc("aiw_infra", "all", 86400, ai_watch.handle_ai_infra)
        return {"data": data}
    except Exception as e:
        raise HTTPException(502, f"AI 基建 ROI 异常: {e}") from e
