import asyncio

from app.config import Settings
from app.measurements import quality_measurement, tool_measurement
from app.wear_alerts import MockPrediction, WearAlerts
import json
import sqlite3
from contextlib import closing


def settings(tmp_path, **kwargs):
    return Settings(_env_file=None, microscope_image_dir=str(tmp_path), tool_wear_demo_enabled=True, **kwargs)


def test_tool_always_displays_real_measurement_without_clipping_or_substitution():
    for raw in ({"diameter": 0.131, "length": 0.006}, {"diameter": 1, "length": -0.1},
                {"diameter": 0, "length": 0}, {"diameter": 0.12, "length": 0.005}):
        checked = tool_measurement(raw)
        assert checked["rawValue"] == checked["displayValue"] == raw


def test_quality_always_uses_real_measurement_without_fallback():
    for value in (18.062, 19, 17, 0, -1):
        checked = quality_measurement(value)
        assert checked["rawValue"] == checked["value"] == checked["displayValue"] == value
        assert not checked["fallbackApplied"] and not checked["validationPending"]
        assert checked["fallbackReason"] is None


def test_tool_inspection_popup_and_trend_share_persisted_display_value(tmp_path):
    config = settings(tmp_path)
    service = WearAlerts(config)
    alert = service.record(MockPrediction(index=10))["alert"]
    service.start_inspection(alert["alertId"])
    assert service.on_wear("25", 1.0, 0.005, "2026-11-27T01:00:00Z")
    snapshot = service.snapshot()
    result, marker = snapshot["inspection"]["result"], snapshot["toolMeasurement"]
    assert result["rawActual"] == marker["rawValue"] == {"diameter": 1, "length": 0.005}
    assert result["actual"] == marker["displayValue"] == {"diameter": 1, "length": 0.005}
    assert marker["diameter"] == result["actual"]["diameter"]
    assert not service.on_wear("25", 0.119, 0.004, "2026-11-27T01:00:01Z")
    assert WearAlerts(config).snapshot()["toolMeasurement"] == marker
    assert not any(e["label"] == "Measurement fallback applied" for e in snapshot["events"])
    service.reset()
    assert service.snapshot()["toolMeasurement"] is None


def test_qc_macro_106_before_prediction_resolves_once_and_preserves_raw(tmp_path):
    async def run():
        config = settings(tmp_path)
        service = WearAlerts(config)
        service.record_qc({"timestamp": "2026-11-27T01:00:00Z", "macros": {"956": 18}})
        assert service.snapshot()["lastQc"] is None
        service.record_qc({"timestamp": "2026-11-27T01:00:01Z", "macros": {"106": 19.12345}})
        assert service.snapshot()["lastQc"]["value"] == 19.12345
        assert not service.snapshot()["lastQc"]["validationPending"]
        service.arm_second_cutting("demo")
        result = await service.run_prediction(MockPrediction(index=1))
        qc = service.snapshot()["lastQc"]
        assert qc["macro"] == "106" and qc["rawValue"] == 19.12345
        assert qc["value"] == qc["displayValue"] == 19.12345 and not qc["fallbackApplied"]
        assert qc["predictionId"] == result["prediction"]["predictionId"]
        service.record_qc({"timestamp": "2026-11-27T01:00:02Z", "macros": {"106": 18}})
        assert service.snapshot()["lastQc"] == qc
        assert WearAlerts(config).snapshot()["lastQc"] == qc
        await service.run_prediction(MockPrediction(index=2))
        assert service.snapshot()["lastQc"] == qc  # never re-randomize or move reference after confirmation
        events = [e for e in service.snapshot()["events"] if e["label"] == "Measurement fallback applied"]
        assert events == []
        service.reset()
        assert service.snapshot()["lastQc"]["value"] == 17.9738
        await service.close()
    asyncio.run(run())


def test_qc_after_prediction_keeps_real_value(tmp_path):
    service = WearAlerts(settings(tmp_path))
    service.cutting = {"run": 2, "status": "cutting", "alertId": "a"}
    prediction = service.record(MockPrediction(index=1))["prediction"]
    service.record_qc({"timestamp": "2026-11-27T01:00:00Z", "macros": {"106": 17}})
    qc = service.snapshot()["lastQc"]
    assert qc["predictionId"] == prediction["predictionId"] and qc["rawValue"] == 17
    assert qc["value"] == 17 and not qc["validationPending"]
    service.reset()
    service.record_qc({"timestamp": "2026-11-27T01:00:01Z", "macros": {"106": 17}})
    qc = service.snapshot()["lastQc"]
    assert qc["value"] == 17 and not qc["fallbackApplied"]


def test_existing_corrected_qc_and_tool_restore_raw_on_startup(tmp_path):
    config = settings(tmp_path)
    service = WearAlerts(config)
    service.record_qc({"timestamp": "2026-11-27T01:00:00Z", "macros": {"106": 19.12345}})
    qc = service.snapshot()["lastQc"]
    with closing(sqlite3.connect(service.path)) as db, db:
        db.execute("DELETE FROM settings_migrations WHERE name='restore-raw-qc-20261127'")
        db.execute("DELETE FROM settings_migrations WHERE name='restore-raw-tool-20261127'")
        old = {**qc, "value": 18.011, "displayValue": 18.011, "fallbackApplied": True}
        db.execute("UPDATE last_qc SET body=?", (json.dumps(old),))
        tool = {"diameter": 0.1207, "rawValue": {"diameter": 1}}
        db.execute("INSERT INTO demo_tool_measurement VALUES (1, ?)", (json.dumps(tool),))
    restored = WearAlerts(config).snapshot()
    assert restored["lastQc"]["value"] == restored["lastQc"]["displayValue"] == 19.12345
    assert not restored["lastQc"]["fallbackApplied"]
    assert restored["toolMeasurement"]["diameter"] == 1
    assert restored["toolMeasurement"]["displayValue"] == {"diameter": 1}


def test_existing_inspection_popup_restores_original_values_and_preserves_stage(tmp_path):
    config = settings(tmp_path)
    service = WearAlerts(config)
    alert = service.record(MockPrediction(index=10))["alert"]
    service.start_inspection(alert["alertId"])
    service.on_wear("25", 1, 0.01, "2026-11-27T01:00:00Z")
    snapshot = service.snapshot()
    with closing(sqlite3.connect(service.path)) as db, db:
        db.execute("DELETE FROM settings_migrations WHERE name='restore-raw-tool-20261127'")
        inspection = snapshot["inspection"]
        inspection["result"]["actual"] = {"diameter": 0.1207, "length": 0.0049}
        inspection["result"]["measurement"] = {"rawValue": {"diameter": 1, "length": 0.01},
                                                  "displayValue": inspection["result"]["actual"], "fallback": {"applied": True}}
        inspection["result"]["exceeded"] = []
        db.execute("UPDATE inspections SET body=?", (json.dumps(inspection),))
    restored = WearAlerts(config).snapshot()["inspection"]
    assert restored["status"] == "awaiting_result"  # image-driven popup timing is untouched
    assert restored["result"]["actual"] == {"diameter": 1, "length": 0.01}
    assert restored["result"]["measurement"]["displayValue"] == restored["result"]["actual"]
    assert restored["result"]["exceeded"] == ["diameter", "length"]
