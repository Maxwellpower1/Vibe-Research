"""MCP stdio 必须是 UTF-8（#27）。

Windows 上 Python 的 stdio 默认 GBK(cp936)。JSON-RPC 响应里带中文、RSS 正文里的
`\xa0`（不换行空格）等字符 GBK 编不出来 —— 整条响应写不出去，客户端表现为工具调用
失败 + 反复重连；即便不崩，中文也会被按 UTF-8 解 GBK 字节，全是乱码。
"""
import io
import json

import mcp_server


PAYLOAD = {"result": {"text": "中文\xa0不换行空格—测试"}}


def _gbk_stdout():
    buf = io.BytesIO()
    return buf, io.TextIOWrapper(buf, encoding="gbk", errors="strict", newline="")


def test_gbk_stdout_would_crash_without_the_fix(monkeypatch):
    """先证明这个坑真实存在，否则下面的修复测试等于没测。"""
    buf, stream = _gbk_stdout()
    monkeypatch.setattr(mcp_server.sys, "stdout", stream)

    try:
        mcp_server._send(PAYLOAD)
    except UnicodeEncodeError as e:
        assert "gbk" in str(e)
    else:
        raise AssertionError("GBK stdout 竟然没报错——用例失去意义，请检查夹具")


def test_force_utf8_lets_the_response_through(monkeypatch):
    buf, stream = _gbk_stdout()
    monkeypatch.setattr(mcp_server.sys, "stdout", stream)

    mcp_server._force_utf8_stdio()
    mcp_server._send(PAYLOAD)
    mcp_server.sys.stdout.flush()

    decoded = json.loads(buf.getvalue().decode("utf-8"))
    assert decoded["result"]["text"] == PAYLOAD["result"]["text"]


def test_force_utf8_survives_streams_without_reconfigure(monkeypatch):
    """被替换过的流（如测试框架的捕获对象）没有 reconfigure，不能因此把服务弄挂。"""
    class Dumb:
        def write(self, s): return len(s)
        def flush(self): pass

    monkeypatch.setattr(mcp_server.sys, "stdout", Dumb())
    monkeypatch.setattr(mcp_server.sys, "stderr", Dumb())
    monkeypatch.setattr(mcp_server.sys, "stdin", Dumb())

    mcp_server._force_utf8_stdio()   # 不该抛
