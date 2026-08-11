"""Vibe-Research MCP server —— 把 A股数据工具暴露给 Claude Code 等 agent。

零第三方依赖（纯标准库 JSON-RPC over stdio），复用 astock 数据层 +
chat.py 里的工具定义。给「订阅接入 / 高手」通道用：agent 用自己的
订阅额度直接调数据、多步分析，不占本产品成本。

挂进 Claude Code：
    claude mcp add vibe-research -- /路径/backend/.venv/bin/python /路径/backend/mcp_server.py

合规：工具只返回客观数据，不含建议；判断由调用方 agent 给出。
"""

from __future__ import annotations

import json
import sys

import chat  # 复用 TOOLS 定义 + _exec_tool 执行逻辑（内含 astock）
from version import read_version

# 版本号与 HTTP API / 前端同源（#20）。此处曾是第 4 处硬编码，issue 只列了 3 处，
# 照着改就会漏掉它——MCP 客户端初始化时拿到的仍是旧版本。
SERVER_INFO = {"name": "vibe-research", "version": read_version()}
DEFAULT_PROTOCOL = "2024-11-05"

# 把 chat.TOOLS（OpenAI 格式）转成 MCP 的 {name, description, inputSchema}
MCP_TOOLS = [
    {
        "name": t["function"]["name"],
        "description": t["function"]["description"],
        "inputSchema": t["function"]["parameters"],
    }
    for t in chat.TOOLS
]


def _force_utf8_stdio() -> None:
    """把 stdio 钉死成 UTF-8。

    Windows 上 Python 的 stdio 默认编码是 GBK(cp936)，而 JSON-RPC 响应里带
    `ensure_ascii=False` 的中文、RSS 正文里的 `\xa0`（不换行空格）等字符 GBK 编不出来
    —— 整条响应写不出去，客户端表现为工具调用失败 + 反复重连；即便不崩，中文也会被
    客户端按 UTF-8 解 GBK 字节，全是乱码（#27）。

    MCP 协议本身要求 UTF-8，所以这里直接重配而不是退让成 ensure_ascii=True
    （后者能防崩，但会把中文全部变成 Unicode 转义序列，体积翻几倍）。
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            # 极老的 Python 或被替换过的流：没有 reconfigure 就跳过，
            # 至少不要因为这一步把服务弄挂。
            pass


def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _result(rid, result) -> None:
    _send({"jsonrpc": "2.0", "id": rid, "result": result})


def _error(rid, code: int, message: str) -> None:
    _send({"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}})


def _handle(msg: dict) -> None:
    method = msg.get("method")
    rid = msg.get("id")

    # 通知（无 id）不回响应
    if method == "notifications/initialized":
        return

    if method == "initialize":
        params = msg.get("params") or {}
        proto = params.get("protocolVersion", DEFAULT_PROTOCOL)
        _result(rid, {
            "protocolVersion": proto,
            "capabilities": {"tools": {}},
            "serverInfo": SERVER_INFO,
        })
        return

    if method == "ping":
        _result(rid, {})
        return

    if method == "tools/list":
        _result(rid, {"tools": MCP_TOOLS})
        return

    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name", "")
        args = params.get("arguments") or {}
        data = chat._exec_tool(name, args)
        is_error = isinstance(data, dict) and "error" in data
        _result(rid, {
            "content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}],
            "isError": is_error,
        })
        return

    if rid is not None:
        _error(rid, -32601, f"未知方法：{method}")


def main() -> None:
    # 必须在读写任何协议内容之前重配编码（#27）
    _force_utf8_stdio()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            _handle(msg)
        except Exception as e:  # noqa: BLE001 — 单条消息出错不拖垮 server
            if msg.get("id") is not None:
                _error(msg["id"], -32603, f"内部错误：{e}")


if __name__ == "__main__":
    main()
