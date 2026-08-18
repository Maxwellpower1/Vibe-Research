"""ST / 次新 mask. No Omicron, no second instruments file."""

from datetime import date, timedelta

from backtest.panel import build_panel
from backtest.screen import apply_from_body, build_mask, name_blocked


def _weekdays(n: int, start: str = "2023-01-02") -> list[str]:
    out: list[str] = []
    d = date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _panel(names: dict[str, str], n_days: int = 80):
    days = _weekdays(n_days)
    bars = {}
    for i, sym in enumerate(names):
        closes = [10.0 + i + t * 0.01 for t in range(n_days)]
        bars[sym] = [
            {"datetime": d, "open": c, "high": c, "low": c, "close": c, "adj_close": c, "volume": 1}
            for d, c in zip(days, closes)
        ]
    return build_panel(bars, names)


def test_name_blocked_st_and_delist():
    assert name_blocked("*ST宁科") is True
    assert name_blocked("ST厦华") is True
    assert name_blocked("退市旭电") is True
    assert name_blocked("贵州茅台") is False
    assert name_blocked("") is False


def test_st_name_drops_whole_column():
    panel = _panel({"sh600000": "浦发银行", "sh600001": "*ST宁科"}, 20)
    mask, notes = build_mask(panel, exclude_st=True, min_list_days=0)
    assert mask is not None
    assert mask[:, 0].all()
    assert not mask[:, 1].any()
    assert any("前视" in n for n in notes)


def test_new_list_uses_first_bar():
    panel = _panel({"sh600000": "浦发银行"}, 80)
    mask, notes = build_mask(panel, exclude_st=False, min_list_days=60)
    assert mask is not None
    assert not mask[59, 0]
    assert mask[60, 0]
    assert any("次新" in n for n in notes)


def test_short_panel_skips_new_list():
    panel = _panel({"sh600000": "浦发银行"}, 20)
    mask, notes = build_mask(panel, exclude_st=False, min_list_days=60)
    assert mask is None
    assert any("未启用" in n for n in notes)


def test_apply_from_body_defaults_and_off():
    panel = _panel({"sh600000": "浦发银行", "sh600001": "ST厦华"}, 20)
    mask, _notes = apply_from_body(panel, {}, None)
    assert mask is not None
    assert not mask[:, 1].any()
    off, notes = apply_from_body(panel, {"exclude_st": False, "min_list_days": 0}, None)
    assert off is None
    assert not notes
