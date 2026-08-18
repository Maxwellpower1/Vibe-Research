"""OpenVlab MQTT sidecar (offline). optionflow overlay does not write REST cache."""
import gzip
import json

import pytest

import ovlab
import ovlab_mqtt


TOPIC = "vlab/stream/optionflow/guest"
CTA = "vlab/stream/ctamap/guest"
DV = "vlab/stream/dataview/guest/instr/+"


def setup_function():
    ovlab_mqtt.reset_for_tests()
    ovlab._CACHE.clear()


def test_topic_optionflow_and_ctamap():
    assert ovlab_mqtt.topic_of("optionflow", tier="guest") == TOPIC
    assert ovlab_mqtt.topic_of("ctamap", tier="guest") == CTA


def test_topic_dataview_wildcard_without_instr():
    assert ovlab_mqtt.topic_of("dataview") == DV
    assert ovlab_mqtt.topic_of("dataview", instr="MA2609C3000") == (
        "vlab/stream/dataview/guest/instr/MA2609C3000"
    )


def test_topic_unknown_and_fitterport_skipped():
    assert ovlab_mqtt.topic_of("nope") is None
    assert ovlab_mqtt.topic_of("fitterport") is None


def test_default_sources_are_three():
    assert ovlab_mqtt.mqtt_sources() == ["optionflow", "ctamap", "dataview"]


def test_source_from_topic():
    assert ovlab_mqtt.source_from_topic(TOPIC) == "optionflow"
    assert ovlab_mqtt.source_from_topic("other/optionflow/guest") is None
    assert ovlab_mqtt.source_from_topic("vlab/stream/dataview/guest/instr/X") == "dataview"


def test_parse_live_envelope_aliases_instr():
    raw = json.dumps(
        {"t": "live", "s": "optionflow", "d": {"instrument": "MA2609C3000"}}
    ).encode()
    msg = ovlab_mqtt.parse_message(TOPIC, raw)
    assert msg is not None
    assert msg["source"] == "optionflow"
    assert msg["data"]["instr"] == "MA2609C3000"
    assert msg["data"]["contract_code"] == "MA2609C3000"


def test_parse_gzip_payload():
    body = json.dumps(
        {"t": "live", "s": "optionflow", "d": {"instr": "RB2609P3000"}}
    ).encode()
    msg = ovlab_mqtt.parse_message(TOPIC, gzip.compress(body))
    assert msg is not None
    assert msg["data"]["instrument"] == "RB2609P3000"


def test_parse_bare_json_uses_topic_source():
    raw = json.dumps([{"instrument": "CU2609C70000"}]).encode()
    msg = ovlab_mqtt.parse_message(TOPIC, raw)
    assert msg is not None
    assert msg["source"] == "optionflow"
    assert msg["data"][0]["instr"] == "CU2609C70000"


def test_parse_dataview_kv_text():
    topic = "vlab/stream/dataview/guest/instr/al2609"
    msg = ovlab_mqtt.parse_message(topic, b"instr:al2609 last_trade_price:18500 oi:12")
    assert msg is not None
    assert msg["source"] == "dataview"
    assert msg["data"]["instr"] == "al2609"
    assert msg["data"]["oi"] == 12


def test_as_flow_rows_list_and_single():
    rows = ovlab_mqtt.as_flow_rows(
        [{"rule_id": "r001_single_trade", "instrument": "A", "time": "2026-08-18 21:00:00"}]
    )
    assert len(rows) == 1
    assert rows[0]["contract_code"] == "A"
    one = ovlab_mqtt.as_flow_rows(
        {"t": "nope", "rule_id": "r002_1m_pct_move", "contract_code": "B"}
    )
    assert one[0]["rule_id"] == "r002_1m_pct_move"


def test_remember_optionflow_does_not_write_rest_cache():
    msg = ovlab_mqtt.parse_message(
        TOPIC,
        json.dumps(
            {
                "t": "live",
                "s": "optionflow",
                "d": {
                    "instrument": "al2609C24600",
                    "time": "2026-08-18 23:42:01",
                    "rule_id": "r002_1m_pct_move",
                    "window_volume": 15,
                },
            }
        ).encode(),
    )
    assert msg is not None
    ovlab_mqtt.remember(msg)
    assert ovlab._CACHE.get("ovlab_flow_alert") is None
    assert ovlab._CACHE.get("ovlab_market") is None
    snap = ovlab_mqtt.snapshot()
    assert snap["recv"] == 1
    assert snap["feeds_ui"] is True
    assert snap["optionflow_n"] == 1
    assert snap["optionflow"][0]["contract_code"] == "al2609C24600"


def test_alias_exch_time_to_time():
    rows = ovlab_mqtt.as_flow_rows(
        {
            "instrument": "sn2609C430000",
            "exch_time": "2026-08-18 23:48:30",
            "rule_id": "r003_repeated_aggressive_burst",
        }
    )
    assert rows[0]["time"] == "2026-08-18 23:48:30"


def test_remember_ctamap_and_dataview_counts():
    ovlab_mqtt.remember(
        {
            "topic": CTA,
            "source": "ctamap",
            "data": [
                {"prodUnd": "AL", "price": 18500, "ctn": 0.01},
                {"prodUnd": "CU", "price": 70000, "ctn": "-1.2%"},
            ],
        }
    )
    ovlab_mqtt.remember(
        {
            "topic": "vlab/stream/dataview/guest/instr/al2609",
            "source": "dataview",
            "data": {"instr": "al2609", "last_trade_price": 18510, "oi": 12},
        }
    )
    snap = ovlab_mqtt.snapshot()
    assert snap["ctamap_n"] == 2
    assert snap["dataview_n"] == 1
    assert snap["optionflow"] == []
    by_und = {str(r.get("prodUnd")): r for r in snap["ctamap"]}
    assert by_und["AL"]["price"] == 18500
    assert by_und["CU"]["ctn"] == pytest.approx(-0.012)
    tick = snap["dataview"][0]
    assert tick["instr"] == "al2609"
    assert tick["last"] == 18510
    assert tick["oi"] == 12
    assert ovlab._CACHE.get("ovlab_market") is None


def test_cta_upsert_same_product():
    ovlab_mqtt.remember(
        {"topic": CTA, "source": "ctamap", "data": {"prodUnd": "AL", "price": 1}}
    )
    ovlab_mqtt.remember(
        {"topic": CTA, "source": "ctamap", "data": {"prodUnd": "AL", "price": 2, "ctn": 0.01}}
    )
    snap = ovlab_mqtt.snapshot()
    assert snap["ctamap_n"] == 1
    assert snap["ctamap"][0]["price"] == 2
    assert snap["ctamap"][0]["ctn"] == 0.01


def test_dataview_kv_remember_last():
    msg = ovlab_mqtt.parse_message(
        "vlab/stream/dataview/guest/instr/al2609",
        b"instr:al2609 last_trade_price:18500 oi:12",
    )
    assert msg is not None
    ovlab_mqtt.remember(msg)
    tick = ovlab_mqtt.snapshot()["dataview"][0]
    assert tick["last"] == 18500
    assert tick["instr"].upper() == "AL2609"


def test_start_noop_when_disabled(monkeypatch):
    monkeypatch.setenv("VR_OVLAB_MQTT", "0")
    ovlab_mqtt.stop()
    ovlab_mqtt.start()
    snap = ovlab_mqtt.snapshot()
    assert snap["enabled"] is False
    assert snap["connected"] is False
    assert snap["recv"] == 0


def test_mqtt_status_endpoint():
    from fastapi.testclient import TestClient

    import app as app_module

    r = TestClient(app_module.app).get("/api/ovlab/mqtt")
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["feeds_ui"] is True
    assert body["enabled"] is False
    assert "connected" in body
    assert body.get("sources") == ["optionflow", "ctamap", "dataview"]
    assert "optionflow" in body
    assert "ctamap" in body
    assert "dataview" in body
