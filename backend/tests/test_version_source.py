"""版本号单一来源 + MCP stdout 洁净（#20 / codex 复审）。"""
import contextlib
import io

import version


def test_reads_version_from_package_json():
    assert version.read_version() != "unknown"


def test_missing_file_returns_unknown_not_a_stale_version(monkeypatch):
    """读不到就说 unknown，**绝不退回写死的旧版本号**——那正是 #20 的成因。"""
    monkeypatch.setattr(version, "_PACKAGE_JSON", "/nonexistent/package.json")
    assert version.read_version() == "unknown"


def test_warning_never_goes_to_stdout(monkeypatch):
    """🔴 本模块被 mcp_server 导入，MCP 的 stdout 专供 JSON-RPC。

    往 stdout 打一行警告会插在初始化响应之前，客户端可能直接拒收整条流。
    仅后端部署（没有 frontend/）时正好会走到这个分支。
    """
    monkeypatch.setattr(version, "_PACKAGE_JSON", "/nonexistent/package.json")
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        version.read_version()
    assert out.getvalue() == ""
    assert "读不到版本号" in err.getvalue()


def test_mcp_server_reports_the_same_version():
    import mcp_server
    assert mcp_server.SERVER_INFO["version"] == version.read_version()


def test_turnover_projection_keeps_every_documented_field():
    """注释里列了 float_cap 却没放进取值清单——自相矛盾（codex 第四轮指出）。"""
    import inspect

    import tools

    src = inspect.getsource(tools._market)
    idx = src.find('scope == "turnover"')
    block = src[idx:idx + 600]
    for field in ("price", "pct", "amount", "mcap", "float_cap", "industry"):
        assert f'"{field}"' in block, f"turnover 投影漏了 {field}"
