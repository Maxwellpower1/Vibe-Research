"""安全守卫（SSRF / 成本负数 / 日期）回归测。全部离线、不联网。

覆盖：
- chat._check_base_url：防 SSRF（本地放行本机、始终挡云元数据、公网姿态挡内网）。
- 成本允许负数、清仓日期格式校验。
"""
from fastapi.testclient import TestClient

import app as app_module
import chat

client = TestClient(app_module.app)


# ---- SSRF 守卫 ----

def _allowed(url: str) -> bool:
    try:
        chat._check_base_url(url)
        return True
    except RuntimeError:
        return False


def test_ssrf_local_mode():
    assert chat._PUBLIC_MODE is False  # 测试进程未设 VR_API_KEY
    assert _allowed("https://api.deepseek.com") is True
    assert _allowed("http://127.0.0.1:11434") is True   # 本机 Ollama 等，本地放行
    assert _allowed("http://169.254.169.254/latest") is False  # 云元数据，始终挡
    assert _allowed("ftp://evil/x") is False


def test_ssrf_public_mode_blocks_internal(monkeypatch):
    monkeypatch.setattr(chat, "_PUBLIC_MODE", True)
    assert _allowed("http://192.168.1.1") is False
    assert _allowed("http://10.0.0.5") is False
    assert _allowed("http://127.0.0.1:11434") is False
    # 注：公网域名在 public 姿态会走真实 DNS 解析核对，为保持离线不在此断言


# ---- 成本负数 / 日期 ----

def test_negative_cost_accepted():
    r = client.post("/api/portfolio/holding", json={"code": "600519", "shares": 100, "cost": -5.5})
    assert r.status_code == 200
    client.request("DELETE", "/api/portfolio/holding", params={"code": "600519"})  # 清理


def test_zero_shares_rejected():
    assert client.post("/api/portfolio/holding", json={"code": "600519", "shares": 0, "cost": 10}).status_code == 400


def test_close_bad_date_400():
    r = client.post("/api/portfolio/close",
                    json={"code": "600519", "date": "2025-13-45", "price": 10, "shares": 100, "cost": 5})
    assert r.status_code == 400
