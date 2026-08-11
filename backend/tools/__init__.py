"""AI tool layer — schemas + exec for chat.py / mcp_server.py."""
from __future__ import annotations

import astock
from tools.handlers import _HANDLERS
from tools.schema import TOOL_NAMES, TOOLS, _pick, _t

def exec_tool(name: str, args: dict):
    """执行工具，返回可序列化结果（失败返回 error 字段，不抛）。"""
    fn = _HANDLERS.get(name)
    if fn is None:
        return {"error": f"未知工具 {name}"}
    try:
        return fn(args or {})
    except astock.DependencyMissing as e:
        return {"error": str(e)}
    except KeyError as e:
        return {"error": f"{name} 缺少必填参数 {e}"}
    except Exception as e:  # noqa: BLE001 — 工具错误回喂给模型，不中断循环
        return {"error": f"{name} 执行失败：{e}"}


__all__ = ["TOOLS", "TOOL_NAMES", "exec_tool", "_pick", "_t", "_HANDLERS"]
