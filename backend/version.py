"""版本号的唯一来源（#20）。

`frontend/package.json` 的 `version` 是唯一真相——发版本来就要改它。HTTP API、
`/api/health`、前端 Layout、MCP `serverInfo` 全部读这里，不再各写一份。

**刻意独立成模块**：`app.py` 在导入时会 `pf.start_scheduler(1800)` 起后台线程，
MCP 服务只想拿个版本号，不该被迫承担那个副作用。
"""

from __future__ import annotations

import json
import os
import sys

_PACKAGE_JSON = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "frontend", "package.json",
)


def read_version() -> str:
    """读 frontend/package.json 的 version。

    读不到就返回 `"unknown"` 并打一行警告，**绝不退回写死的旧版本号**——
    那正是 #20 的成因：三处各写一份 `0.2.2`，发 v0.3.0 时全忘了改，
    界面上继续显示旧版本，而且没有任何迹象表明它是错的。
    """
    try:
        with open(_PACKAGE_JSON, encoding="utf-8") as f:
            return json.load(f)["version"]
    except (OSError, ValueError, KeyError) as e:
        # 必须走 stderr。本模块会被 mcp_server 导入，而 MCP 的 stdout 专供
        # JSON-RPC——往 stdout 打一行警告就会插在初始化响应之前，客户端可能直接
        # 拒收整条流。仅后端部署（没有 frontend/ 目录）时正好会走到这个分支。
        print(f"[warn] 读不到版本号（{_PACKAGE_JSON}）：{e}", file=sys.stderr)
        return "unknown"
