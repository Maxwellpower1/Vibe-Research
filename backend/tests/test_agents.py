"""工具层回归测。全部离线、不联网（真实取数走 test_live.py）。

覆盖：工具定义与 handler 一一对应、裁剪逻辑、错误不抛。
"""
import chat
import tools


# ---- 工具层 ----

def test_every_tool_has_handler():
    """工具定义与执行实现必须一一对应——漏一个就是模型调了却报「未知工具」。"""
    assert set(tools.TOOL_NAMES) == set(tools._HANDLERS.keys())
    assert len(tools.TOOLS) == len(tools.TOOL_NAMES)


def test_tool_schema_shape():
    for t in tools.TOOLS:
        fn = t["function"]
        assert t["type"] == "function"
        assert fn["name"] and fn["description"]
        params = fn["parameters"]
        assert params["type"] == "object"
        for req in params.get("required", []):
            assert req in params["properties"], f"{fn['name']} 的必填参数 {req} 未在 properties 中定义"


def test_chat_reexports_tools():
    """mcp_server 与既有测试按 chat.TOOLS / chat._exec_tool 取用，别名不能断。"""
    assert chat.TOOLS is tools.TOOLS
    assert chat._exec_tool is tools.exec_tool


def test_pick_trims_and_tolerates():
    rows = [{"a": 1, "b": 2}, {"a": 3, "b": 4}, "脏数据", {"a": 5}]
    assert tools._pick(rows, ("a",), 2) == [{"a": 1}, {"a": 3}]
    assert tools._pick(rows, None, 10) == [{"a": 1, "b": 2}, {"a": 3, "b": 4}, {"a": 5}]
    assert tools._pick(None, ("a",), 5) == []


def test_exec_tool_never_raises():
    assert "error" in tools.exec_tool("不存在的工具", {})
    # 缺必填参数：应返回 error 字段而不是抛异常（错误要能回喂给模型）
    assert "error" in tools.exec_tool("query_valuation", {})


def test_exec_tool_wraps_handler_exception(monkeypatch):
    monkeypatch.setitem(tools._HANDLERS, "query_quote", lambda a: 1 / 0)
    out = tools.exec_tool("query_quote", {"codes": ["600519"]})
    assert "error" in out and "query_quote" in out["error"]
